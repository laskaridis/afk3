# Feature Specification: Verification stage

## Purpose / Big Picture

Today one agent interprets the task, implements it, writes its own tests, and declares itself done. The interpretation,
the implementation and the evidence all come from the same reading of the requirement, so a misunderstood acceptance
criterion produces an implementation and a test suite that agree with each other while both being wrong. `afk` has no
way of catching that: it trusts the outcome the coding agent reports.

This feature adds a second, independent agent to the loop. After every coding iteration, `afk` launches a fresh
verification session that derives its own expectations from the specification and inspects the committed candidate,
rather than accepting the implementer's tests as the definition of correctness. The verification agent — not the
coding agent — decides whether a task is complete.

For the developer who leaves `afk` running unattended, the user-visible effects are: a task is only ever marked
complete after an independent agent agreed, rejected work automatically goes back to the coding agent together with
the findings, a repeatedly rejected task stops the run instead of advancing, and the verification phase can run on a
different model and reasoning effort than the implementation phase.

This specification extends [afk-cli-core.spec.md](_done/001-afk-cli-core/afk-cli-core.spec.md) and
[agent-adapters.spec.md](_done/002-agent-adapters/agent-adapters.spec.md). Where those specs state that the coding
agent reports `complete` and that the harness trusts a single session's outcome, this specification supersedes them:
the harness still trusts outcomes and still reads no task files, git state or test results, but it now obtains the
completion decision from the verification session instead of the coding session.

## Domain language

| Term                 | Meaning                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| coding session       | A session running the coding step; produces a candidate. Bounded by `--max-iterations` as today               |
| verification session | A fresh session running the verification step against one candidate; not counted as an iteration             |
| candidate            | The committed implementation of one task, not yet accepted                                                    |
| correction iteration | A coding session prompted with the findings of a rejected candidate, instead of the launch prompt             |
| assignment           | The harness-supplied block naming the task a session must work on, and the context it needs                   |
| findings file        | `<feature-name-slug>.verify.md`, the verification agent's notes, stored next to the `.code.md` notes file     |
| verification attempt | One verification session that returned a `verification_failed` verdict for a task; bounded per task              |

## User stories

### US-001: Verify every candidate with an independent agent

For the `afk` harness, we need to run a fresh verification session after each coding iteration and take the completion
decision from it, so that no task is accepted on the sole judgement of the agent that implemented it.

#### Acceptance criteria

- **AC-001:** Given a coding session that returned `task_implemented`, when the harness continues the run, then it launches a
  verification session before any further coding session. Verification is unconditional; there is no option to skip it.
- **AC-002:** Given a verification session is launched, when its session prompt is assembled, then the prompt is the
  launch prompt, followed by an assignment naming the `task_id`, `task_plan_file` and `revision` reported by the coding
  session, followed by `---` and the bundled verification instructions with this session's nonce substituted. The
  harness passes the paths through verbatim and does not read the specification, task plan or candidate itself.
  
  **Example — a candidate with a revision.** 
  
  The coding session (nonce `c0d1`) ended with:
  ```
  <afk-harness-result nonce="c0d1">
  {"outcome":"task_implemented","task_id":"TASK-003","task_plan_file":"specs/add-verification-stage.plan.json","revision":"9f3c2ab"}
  </afk-harness-result>
  ```

  The verification session is launched with nonce `7b1e` and this prompt:
  ```
  Verification Assignment:
  - task_id: TASK-003
  - task_plan_file: specs/add-verification-stage.plan.json
  - revision: 9f3c2ab
  ---
  <concatenate src/workflow/steps/verification-step.md with {{NONCE}} replaced by 7b1e>
  ```

  When the coding session reported no `revision` (absent or `null`), the `- revision:` line is omitted from the
  assignment.

- **AC-003:** Given a verification session, when it is launched, then it is a fresh, non-interactive session in the same
  workspace, using the same agent, permissions, `--cwd` and `--session-timeout` as coding sessions, and it is never
  resumed or forked from a previous session.
- **AC-004:** Given a verification session that returns a valid outcome, when the harness decides what to do next, then
  it applies the following table and nothing else:

  | Verification outcome  | Harness action                                                                       |
  | --------------------- | ------------------------------------------------------------------------------------ |
  | `verification_passed` | The candidate passed and tasks remain: start a fresh, autonomous coding session      |
  | `workflow_finished`   | The candidate passed and no tasks remain: report completion and exit successfully    |
  | `verification_failed` | The candidate was rejected: start a correction iteration for the same task (US-003)  |
  | `blocked`             | Print the blocker and exit unsuccessfully without launching another session          |

- **AC-005:** Given a verification session passed a candidate and tasks remain, when the next coding session starts,
  then it is prompted with the launch prompt, exactly like the first coding session, and carries no assignment and no
  verification notes: the coding agent selects the next task autonomously as it does today.
- **AC-006:** Given a verification session, when it ends, then the harness does not count it against
  `--max-iterations`; that limit continues to count coding sessions only, correction iterations and coding retries
  included. Verification sessions, including their retries, never consume an iteration: the candidate produced by the
  last allowed coding iteration is still verified, and the run ends as follows:

  | Verification outcome after the last coding iteration          | Run ends with                              |
  | ------------------------------------------------------------- | ------------------------------------------ |
  | `workflow_finished`                                           | completion, exit `0`                       |
  | `verification_passed`                                         | iteration limit reached, exit `4`          |
  | `verification_failed`, task's attempt limit reached           | verification limit reached, exit `6`       |
  | `verification_failed`, attempt limit not reached              | iteration limit reached, exit `4`          |
  | `blocked`                                                     | blocked, exit `1`                          |

  When both limits are reached at once, the verification limit (exit `6`) takes precedence because it names the actual
  reason the run cannot continue.
- **AC-007:** Given any session, when the harness reports progress on stderr, then it uses agent-neutral wording and
  distinguishes the two phases: `[afk] Iteration <n>/<limit>: starting agent session` for a coding session,
  `[afk] Iteration <n>/<limit>: starting verification session` for a verification session, `[afk] Verification passed`
  for a passing verdict (`verification_passed` or `workflow_finished`), and `[afk] Verification failed (attempt <k>/<limit>): <failure summary>` for a rejection. For a
  verification session, `<n>` is the number of the coding iteration that produced the candidate under verification.
- **AC-008:** Given a verification session that fails to execute or violates the response contract, when the harness
  classifies it, then the existing execution-error policy applies unchanged: one retry per consecutive execution error,
  re-running the verification session with a new nonce and the same assignment, a second consecutive execution error
  ends the run, and a valid outcome resets the retry budget. The retry is reported as
  `[afk] Iteration <n>/<limit>: retrying verification session after execution error`, with `<n>` as in AC-007.
- **AC-009:** Given the verification instructions file, when the package is built, then it is bundled and read the same
  way as the coding instructions: stored as `src/workflow/steps/verification-step.md`, copied to
  `dist/workflow/steps/verification-step.md` by `scripts/dist-prepare.mjs`, listed in `.prettierignore`, included in the
  published package, and loaded with this session's nonce substituted. Like `coding-step.md`, it contains an example
  block `<afk-harness-result nonce="{{NONCE}}">`, from which the fake agents read the session nonce.

### US-002: Let the coding agent produce candidates it cannot sign off

For the coding agent contract, we need the coding session to commit a candidate and report it without marking the task
complete, so that the completion decision belongs to the verification session alone.

#### Acceptance criteria

- **AC-010:** Given the result block of a session, when the harness parses it, then the `outcome` field takes a value
  from the vocabulary of that session's phase, and these are the only valid outcomes:

  | Phase        | Outcome               | Meaning                                                          | Other required fields                          |
  | ------------ | --------------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
  | coding       | `task_implemented`    | A candidate was committed and is ready for verification          | optional `revision` (AC-011)                   |
  | coding       | `no_more_tasks`       | No pending task exists; nothing was implemented                  | `task_id` is `null`                            |
  | coding       | `blocked`             | No progress is possible without outside help                     | `blocker_text`                                 |
  | verification | `verification_passed` | The candidate passed and tasks remain                            |                                                |
  | verification | `workflow_finished`   | The candidate passed and no tasks remain                         |                                                |
  | verification | `verification_failed` | The candidate was rejected                                       | `failure_summary`, `findings_file` (AC-017)    |
  | verification | `blocked`             | No progress is possible without outside help                     | `blocker_text`                                 |

  In both phases every result block must include `task_id` and `task_plan_file`; `task_id` may be `null` only with
  `no_more_tasks` or `blocked`, and `task_plan_file` may be `null` only with `blocked`. A block that omits either field,
  or violates these rules, is a contract violation. This replaces the parser's current acceptance of blocks that omit
  them. A coding session that implemented a task reports `task_implemented` having committed the candidate and without
  marking the task complete in the task plan.
- **AC-011:** Given a coding session that responds `task_implemented`, when it responds, then it may include a
  `revision` field holding the candidate's commit identifier. The field accepts a non-empty string or `null`; an absent
  or `null` value is valid and leaves the verification session to determine the candidate from the repository itself.
  `revision` on any other outcome is a contract violation.
- **AC-012:** Given a session that responds with an outcome outside its phase's vocabulary in AC-010 (for example a
  coding session answering `workflow_finished` or the former `repeat`, `complete` or `fail`), when the harness
  classifies the response, then it is a contract violation reported as an invalid response, subject to the one-retry
  execution-error policy.
- **AC-013:** Given a coding session that responds with outcome `no_more_tasks`, when the harness handles it, then it
  reports `[afk] Run complete: no more tasks` on stderr and exits successfully without launching a verification
  session, because no candidate was produced. This also holds on the last allowed iteration. It is the only successful
  end of a run that the harness takes from the coding agent.
- **AC-014:** Given a coding session that responds with outcome `blocked`, when the harness handles it, then it prints
  the blocker and exits unsuccessfully without launching a verification session.
- **AC-015:** Given a coding session's response, when it includes a `findings_file` field, then it is a contract
  violation: that field belongs to `verification_failed` only.
- **AC-016:** Given the bundled coding instructions (`src/workflow/steps/coding-step.md`), when they are updated for
  this feature, then they state that the session commits a candidate, never marks a task complete, and responds only
  with `task_implemented`, `no_more_tasks` or `blocked` (including in the example result block and the stop conditions,
  which use `repeat`, `complete` and `fail` today), and document the optional `revision` field. A validation task that
  finds a defect records the follow-up task and reports `task_implemented`. Their existing "explicit task assignment"
  rules, which today recognise only an assignment written by the user in the launch prompt (for example
  `Work on TASK-011`), are extended to the harness-supplied correction assignment and its findings reference; in a correction iteration the specification and
  task list are taken from the assigned `task_plan_file` (its `spec_path`), not from a launch prompt. They no longer ask
  the coding agent to delegate its own review of the change.
- **AC-039:** Given a coding session that commits a candidate, when it finishes, then it records a progress entry for
  that candidate in `<feature-name-slug>.code.md` using the exact task id, including in a correction iteration. This
  replaces the existing rule that every task marked completed has an entry, because the coding agent no longer marks
  tasks complete. The verification agent never edits that file.

### US-003: Send rejected work back with the findings

When a verification session rejects a candidate, I want the same task to go back to the coding agent together with the
findings, so that unattended work converges on a correct implementation instead of advancing past a defect.

#### Acceptance criteria

- **AC-017:** Given a verification session that rejects a candidate, when it responds, then it reports `verification_failed`
  with a non-empty `failure_summary`, the `task_id` it reviewed, the `task_plan_file`, and a non-empty `findings_file` naming
  the notes it wrote. A `verification_failed` response without a `findings_file` is a contract violation, and so is a
  `findings_file` on any other verification outcome: the field is accepted only where the harness uses it.
- **AC-018:** Given a rejection, when the harness launches the correction iteration, then the session prompt does not
  contain the launch prompt. It is a correction assignment naming the rejected `task_id`, the `task_plan_file`, the
  `findings_file` and the verifier's `failure_summary`, with a fixed instruction to fix the issues the verifier found for
  that task, followed by `---` and the bundled coding instructions with this session's nonce substituted.
- **AC-019:** Given a session prompt that carries an assignment, when the agent works, then it does not select a task:
  it works on the assigned task only.
- **AC-020:** Given a session that received an assignment, when it responds with a `task_id` different from the assigned
  one, then it is a contract violation reported as an invalid response. This applies to both coding and verification
  sessions. A `blocked` response with `task_id: null` is exempt (for example, when the assigned task cannot be
  identified in the task plan): it ends the run regardless, as in AC-004 and AC-014.
- **AC-021:** Given a correction iteration whose session produced an execution error, when the harness retries, then the
  retry repeats the same assignment, including the same findings reference, with a new nonce.
- **AC-022:** Given a `findings_file` path reported by a verification session, when the harness references it in a
  correction prompt, then it passes the path through verbatim without checking that the file exists or reading it.
- **AC-023:** Given a correction iteration, when it is launched, then it counts against `--max-iterations` like any
  other coding session.

### US-004: Stop when a task keeps failing verification

As a developer running `afk` unattended, I want a run to stop after a task has been rejected too many times, so that the
loop does not spend my budget retrying work that is not converging and does not advance past an unaccepted task.

#### Acceptance criteria

- **AC-024:** Given the option `--max-verification-attempts <count>`, when it is not supplied, then the limit is 2. When
  it is supplied with anything other than a positive integer, then `afk` reports an input error, exits with the input
  error code and launches no session.
- **AC-025:** Given a task under verification, when a verification session returns `verification_failed` for it, then
  the harness increments that task's verification attempt count. Blocked outcomes and execution errors do not
  increment it.
- **AC-026:** Given a task's verification attempt count, when the harness observes a different `task_id` than the one it
  was counting, then it resets the count for the new task. The counts are held for the duration of the run only and
  start fresh in a new run.
- **AC-027:** Given a task whose verification attempt count has reached `--max-verification-attempts`, when the latest
  verification session rejected it, then the harness stops the run without launching a correction iteration, reports
  `[afk] Run stopped: verification limit of <count> reached for <task id>` on stderr, and exits with a dedicated exit
  code `6`.
- **AC-028:** Given exit code `6`, when `afk --help` is shown, then the exit code list includes it with the meaning
  "verification rejected the same task too many times", and the existing exit codes keep their current numbers and
  meanings.
- **AC-029:** Given the verification limit was reached, when the run stops, then the harness writes no files and
  modifies no task plan: the detail of the rejection is already recorded by the verification agent in the findings file.

### US-005: Run verification on a different model and effort

As a developer, I want the verification phase to use its own model and reasoning effort, so that I can review candidates
with a different or stronger model than the one that implemented them.

#### Acceptance criteria

- **AC-030:** Given `--verify-model <name>`, when a verification session starts, then that model is used for the
  verification session and passed to the agent unchanged, while coding sessions keep using `--model` or the agent's own
  configuration.
- **AC-031:** Given `--verify-reasoning-effort <level>`, when a verification session starts, then that reasoning effort
  is used for the verification session and passed to the agent unchanged, while coding sessions keep using
  `--reasoning-effort` or the agent's own configuration.
- **AC-032:** Given neither verification override is supplied, when a verification session starts, then it uses the same
  model and reasoning effort resolution as a coding session, including `--model` and `--reasoning-effort` when they
  were supplied.
- **AC-033:** Given an empty value for either verification override, when the invocation is evaluated, then `afk`
  reports an input error, exits with the input error code and launches no session.
- **AC-034:** Given `--agent <name>`, when a run executes, then both phases use that one agent; there is no per-phase
  agent selection.

### US-006: Record the verification contract in the documentation

For maintainers and users of `afk`, we need the two-phase loop documented where the existing behavior contract lives, so
that the harness's wording, exit codes and domain language stay a single source of truth.

#### Acceptance criteria

- **AC-035:** Given the README, when this feature ships, then the options table lists `--max-verification-attempts`,
  `--verify-model` and `--verify-reasoning-effort`, and a section describes the two-phase loop and the new exit code.
- **AC-036:** Given the product documentation (`doc/PRODUCT.md`), when this feature ships, then its domain language
  table defines candidate, verification session, correction iteration, assignment and findings file, and redefines
  "iteration" (today "one session launch, retries included") and "session prompt" (today launch prompt + `---` +
  `coding-step.md`) for two phases; its outcome row and run policy state the two-phase loop, each phase's outcome vocabulary
  (AC-010), the per-task verification limit and the per-phase outcome meanings, and replaces the statement that the parser accepts blocks that omit `task_id` and
  `task_plan_file`; and its exit code list includes `6`.
- **AC-037:** Given the architecture documentation (`doc/ARCHITECTURE.md`) and the repository map (`AGENTS.md`), when
  this feature ships, then the flow description shows the two-phase loop, the concrete `WorkflowStep` implementations
  list the verification step, the new `WorkflowEvent`s are listed, the note that the findings file path is
  "intentionally left out" of the result block contract is replaced, and the map lists the bundled verification
  instructions file and no longer describes `coding-step.md` as appended to every session prompt.
- **AC-038:** Given the development documentation, when this feature ships, then `doc/WORKFLOW.md` lists
  `<feature-name-slug>.verify.md` among the feature artifacts, `doc/TESTING.md` describes how tests script the coding and
  verification sessions and build the expected verification prompt, and `doc/PUBLISH.md` lists the bundled verification
  instructions file in the expected package contents.

## Assumptions

- The content of the verification instructions is out of scope. This feature delivers the file, its bundling and its
  contract; a placeholder body is sufficient for the feature to be complete, provided it states the verification
  response contract and contains the `{{NONCE}}` example block (AC-009).
- The verification agent is limited-write, not read-only: it does not modify source files, but it writes its findings
  file, marks the verified task complete in the task plan, and commits that bookkeeping. The harness does not enforce
  this; it is stated in the verification instructions.
- The coding agent commits the candidate before responding. Each accepted task therefore ends with at least two commits
  (candidate, plus the verification agent's bookkeeping) and more when corrections were needed. No history rewriting
  (amend, autosquash) is used.
- `<feature-name-slug>.verify.md` is named and placed by the same convention `coding-step.md` already uses for
  `<feature-name-slug>.code.md`: in the folder of the specification, replacing its `.spec.md` suffix (or final
  extension) with `.verify.md`. The convention is stated only in the agent instructions; the harness never derives or
  validates the path. (The archived `specs/_done/004-refactor-architecture/refactor-architecture.verify.json` predates
  this convention and is not a template for it.)
- The result-block field stays `outcome`, but each phase has its own vocabulary (AC-010), replacing
  `repeat | complete | blocked | fail`. The former values are invalid in both phases, which also removes the coding
  `fail` outcome.
- The verification attempt counter lives in memory for the duration of a run. A run that is interrupted and restarted
  gives every task a fresh attempt budget, and a committed but unverified candidate is picked up by the next
  autonomous coding session like any other pending task.
- `no_more_tasks` is trusted without verification: a coding session that reports no pending task ends the run
  successfully (AC-013), for example on a rerun of a finished feature. A verifier that answers `verification_passed`
  when no tasks remain leads to the same end through the next coding session.
- Existing exit codes `0`–`5` and `130` keep their numbers; `6` is additive.
- The agent adapters (`src/agents/`) and the session layer (`src/session/`) need no changes: a verification session is
  an ordinary session with a different prompt, model and effort, and `SessionInput` already carries model and effort per
  session. The change is confined to `src/workflow/` (result-block parser made phase-aware, a new verification step,
  a way to pass an assignment to a step, which `WorkflowStep.execute(launchPrompt, options)` does not support today,
  new step results and events, the two-phase policy in `WorkflowExecutor`), `src/reporting/` (new status lines),
  `src/cli/` (new options, exit code `6`), the build script, and the documentation.
- Most existing tests script coding sessions with the former vocabulary, mainly `complete` (about 20 test files).
  Under this feature that is a contract violation, so the test suites and the fake-agent scripts (`{ sessions: [...] }`) are expected to be updated
  to script the coding and verification sessions separately.

## Out of Scope

- The wording and methodology of the verification instructions themselves.
- An option to skip or disable verification.
- Selecting a different agent CLI for the verification phase.
- Overriding the bundled verification instructions with a user-supplied file.
- Persisting verification attempt counts, findings or run history across runs, and any resume capability.
- The harness reading task plans, findings files, git state or test results to form its own opinion about correctness.
- Capping or truncating the size of the findings summary injected into a correction prompt.
