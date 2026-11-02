# Feature Specification: Verification stage

## Purpose / Big Picture

Today one agent interprets the task, implements it, writes its own tests, and declares itself done. The interpretation,
the implementation and the evidence all come from the same reading of the requirement, so a misunderstood acceptance
criterion produces an implementation and a test suite that agree with each other while both being wrong. `afk` has no
way of catching that: it trusts the outcome the coding agent reports.

This feature adds a second, independent agent to the loop. After every coding iteration, `afk` launches a fresh
verification session that derives its own expectations from the specification and inspects the committed candidate,
rather than accepting the implementer's tests as the definition of correctness. The verification agent — not the
coding agent — decides whether a task is complete and whether the run is finished.

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

| Term                      | Meaning                                                                                                        |
| ----------------------    | -------------------------------------------------------------------------------------------------------------- |
| coding session            | A session running the coding agent; produces a candidate. Bounded by `--max-iterations` as today               |
| verification session      | A fresh session running the verification agent against one candidate; not counted as an iteration              |
| candidate                 | The committed implementation of one task, not yet accepted                                                     |
| correction iteration      | A coding session in which the harness assigns a task and the findings from a rejected candidate                |
| assignment                | The harness-supplied block naming the task a session must work on, and the context it needs                    |
| verificaton findings file | `<feature-name-slug>.verify.md`, the verification agent's notes, stored next to the task plan                  |
| verification attempt      | One verification session that returned a `fail` verdict for a task; bounded per task                           |

## User stories

### US-001: Verify every candidate with an independent agent

For the `afk` harness, we need to run a fresh verification session after each coding iteration and take the completion
decision from it, so that no task is accepted on the sole judgement of the agent that implemented it.

#### Acceptance criteria

- **AC-001:** Given a coding session that returned `repeat`, when the harness continues the run, then it launches a
  verification session before any further coding session. Verification is unconditional; there is no option to skip it.
- **AC-002:** Given a verification session is launched, when its session prompt is assembled, then the prompt is the
  launch prompt, followed by an assignment naming the `task_id`, `task_plan_file` and `revision` reported by the coding
  session, followed by `---` and the bundled verification instructions with this session's nonce substituted. The
  harness passes the paths through verbatim and does not read the specification, task plan or candidate itself.
  
  **Example — a candidate with a revision.** 
  
  The coding session (nonce `c0d1`) ended with:
  ```
  <afk-harness-result nonce="c0d1">
  {"outcome":"repeat","task_id":"TASK-003","task_plan_file":"specs/add-verification-stage.plan.json","revision":"9f3c2ab"}
  </afk-harness-result>
  ```

  The verification session is launched with nonce `7b1e` and this prompt:
  ```
  Verification Assignment:
  - task_id: TASK-003
  - task_plan_file: specs/add-verification-stage.plan.json
  - revision: 9f3c2ab
  ---
  <concatenate verify.md prompt>
  ```

- **AC-003:** Given a verification session, when it is launched, then it is a fresh, non-interactive session in the same
  workspace, using the same agent, permissions, `--cwd` and `--session-timeout` as coding sessions, and it is never
  resumed or forked from a previous session.
- **AC-004:** Given a verification session that returns a valid outcome, when the harness decides what to do next, then
  it applies the following table and nothing else:

  | Verification outcome | Harness action                                                                        |
  | -------------------- | ------------------------------------------------------------------------------------- |
  | `repeat`             | The candidate passed and tasks remain: start a fresh, autonomous coding session       |
  | `complete`           | The candidate passed and no tasks remain: report completion and exit successfully     |
  | `fail`               | The candidate was rejected: start a correction iteration for the same task (US-003)   |
  | `blocked`            | Print the blocker and exit unsuccessfully without launching another session           |

- **AC-005:** Given a verification session passed a candidate and tasks remain, when the next coding session starts,
  then it carries no assignment and no verification notes: the coding agent selects the next task autonomously as it
  does today.
- **AC-006:** Given a verification session, when it ends, then the harness does not count it against
  `--max-iterations`; that limit continues to count coding sessions only, correction iterations included.
- **AC-007:** Given any session, when the harness reports progress on stderr, then it uses agent-neutral wording and
  distinguishes the two phases: `[afk] Iteration <n>/<limit>: starting agent session` for a coding session,
  `[afk] Iteration <n>/<limit>: starting verification session` for a verification session, `[afk] Verification passed`
  for a passing verdict, and `[afk] Verification failed (attempt <k>/<limit>): <failure summary>` for a rejection.
- **AC-008:** Given a verification session that fails to execute or violates the response contract, when the harness
  classifies it, then the existing execution-error policy applies unchanged: one retry per consecutive execution error,
  re-running the verification session with a new nonce, a second consecutive execution error ends the run, and a valid
  outcome resets the retry budget.
- **AC-009:** Given the verification instructions file, when the package is built, then it is bundled and read the same
  way as the coding instructions: stored in the source tree, copied next to the compiled module, excluded from
  formatting, and loaded with this session's nonce substituted.

### US-002: Let the coding agent produce candidates it cannot sign off

For the coding agent contract, we need the coding session to commit a candidate and report it without marking the task
complete, so that the completion decision belongs to the verification session alone.

#### Acceptance criteria

- **AC-010:** Given a coding session that implemented a task, when it responds, then it reports `repeat` with the
  `task_id` and `task_plan_file` it worked on, having committed the candidate and without marking the task complete in
  the task plan.
- **AC-011:** Given a coding session, when it responds, then it may include a `revision` field holding the candidate's
  commit identifier. The field accepts a non-empty string or `null`; an absent or `null` value is valid and leaves the
  verification session to determine the candidate from the repository itself.
- **AC-012:** Given a coding session that responds with outcome `complete`, when the harness classifies the response,
  then it is a contract violation reported as an invalid response, subject to the one-retry execution-error policy.
- **AC-013:** Given a coding session that responds with outcome `fail`, when the harness handles it, then it surfaces
  the failure summary as today and starts a fresh coding session without launching a verification session, because no
  candidate was produced.
- **AC-014:** Given a coding session that responds with outcome `blocked`, when the harness handles it, then it prints
  the blocker and exits unsuccessfully without launching a verification session.
- **AC-015:** Given a coding session's response, when it includes a `findings_file` field, then it is a contract
  violation: that field belongs to verification responses only.
- **AC-016:** Given the bundled coding instructions, when they are updated for this feature, then they state that the
  session commits a candidate, never marks a task complete, never uses the `complete` outcome, and honours an
  assignment when one is present; and they no longer ask the coding agent to delegate its own review of the change.

### US-003: Send rejected work back with the findings

When a verification session rejects a candidate, I want the same task to go back to the coding agent together with the
findings, so that unattended work converges on a correct implementation instead of advancing past a defect.

#### Acceptance criteria

- **AC-017:** Given a verification session that rejects a candidate, when it responds, then it reports `fail` with a
  non-empty `failure_summary`, the `task_id` it reviewed, the `task_plan_file`, and a non-empty `findings_file` naming
  the notes it wrote. A `fail` response without a `findings_file` is a contract violation.
- **AC-018:** Given a rejection, when the harness launches the correction iteration, then the session prompt is the
  launch prompt, followed by an assignment naming the rejected `task_id`, the `task_plan_file`, the `findings_file` and
  the verifier's `failure_summary`, followed by `---` and the bundled coding instructions.
- **AC-019:** Given a session prompt that carries an assignment, when the agent works, then it does not select a task:
  it works on the assigned task only.
- **AC-020:** Given a session that received an assignment, when it responds with a `task_id` different from the assigned
  one, then it is a contract violation reported as an invalid response. This applies to both coding and verification
  sessions.
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
- **AC-025:** Given a task under verification, when a verification session returns `fail` for it, then the harness
  increments that task's verification attempt count. Coding-session failures, blocked outcomes and execution errors do
  not increment it.
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
- **AC-036:** Given the product documentation, when this feature ships, then its domain language table defines
  candidate, verification session, correction iteration, assignment and findings file; its run policy states the
  two-phase loop, the per-task verification limit and the per-phase outcome meanings; and its exit code list includes
  `6`.
- **AC-037:** Given the architecture documentation and the repository map, when this feature ships, then the flow
  description shows the two-phase loop and the map lists the bundled verification instructions file.

## Assumptions

- The content of the verification instructions is out of scope. This feature delivers the file, its bundling and its
  contract; a placeholder body is sufficient for the feature to be complete.
- The verification agent is limited-write, not read-only: it does not modify source files, but it writes its findings
  file, marks the verified task complete in the task plan, and commits that bookkeeping. The harness does not enforce
  this; it is stated in the verification instructions.
- The coding agent commits the candidate before responding. Each accepted task therefore ends with at least two commits
  (candidate, plus the verification agent's bookkeeping) and more when corrections were needed. No history rewriting
  (amend, autosquash) is used.
- `<feature-name-slug>.verify.md` sits next to the task plan and is named by the same convention already used for
  `<feature-name-slug>.code.md`. The convention is stated only in the agent instructions; the harness never derives or
  validates the path.
- The outcome vocabulary stays `repeat | complete | blocked | fail`; the meaning of each outcome depends on the phase
  of the session that reported it, as tabulated in AC-004 and US-002.
- The verification attempt counter lives in memory for the duration of a run. A run that is interrupted and restarted
  gives every task a fresh attempt budget.
- Existing exit codes `0`–`5` and `130` keep their numbers; `6` is additive.
- The agent adapters, the session runner and the process-handling layer need no changes: a verification session is an
  ordinary session with a different prompt, model and effort.

## Out of Scope

- The wording and methodology of the verification instructions themselves.
- An option to skip or disable verification.
- Selecting a different agent CLI for the verification phase.
- Overriding the bundled verification instructions with a user-supplied file.
- Persisting verification attempt counts, findings or run history across runs, and any resume capability.
- The harness reading task plans, findings files, git state or test results to form its own opinion about correctness.
- Capping or truncating the size of the findings summary injected into a correction prompt.

## Clarifications needed

- None. All decisions were settled in the specification interview that produced this document.
