# Product: behavior contract and domain language

User-facing docs live in [README.md](../README.md). Detailed acceptance criteria are in `specs/_done/*/*.spec.md`
(historical; where they disagree with the code, the code wins).

## Domain language

Use these terms in code, tests, and messages; don't invent synonyms.

| Term                 | Meaning                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| launch prompt        | The user's feature instructions, from exactly one source: argument, `--prompt-file`, or stdin                                                                                                                                                                                                                                                    |
| session prompt       | The text one session receives. Coding session: launch prompt + `---` + `src/workflow/steps/coding-step.md` (a correction iteration has a correction assignment instead of the launch prompt). Verification session: launch prompt + verification assignment + `---` + `src/workflow/steps/verification-step.md`. `{{NONCE}}` is replaced in both |
| session              | One fresh, non-interactive agent process. Never resumed or forked                                                                                                                                                                                                                                                                                |
| coding session       | A session running the coding step; produces a candidate                                                                                                                                                                                                                                                                                          |
| verification session | A fresh session running the verification step against one candidate; not counted as an iteration                                                                                                                                                                                                                                                 |
| candidate            | The committed implementation of one task, not yet accepted                                                                                                                                                                                                                                                                                       |
| iteration            | One coding session launch, retries included, plus the verification of its candidate; bounded by `--max-iterations` (`DEFAULT_MAX_ITERATIONS`)                                                                                                                                                                                                    |
| correction iteration | An iteration whose coding session is prompted with the findings of a rejected candidate instead of the launch prompt                                                                                                                                                                                                                             |
| assignment           | The harness-supplied block naming the task a session must work on and the context it needs (verification or correction assignment)                                                                                                                                                                                                               |
| findings file        | `<feature-name-slug>.verify.md`, the verification agent's notes, next to the `.code.md` notes file; the harness only passes its path on                                                                                                                                                                                                          |
| verification attempt | One verification session that returned `verification_failed` for a task; bounded per task by `--max-verification-attempts`                                                                                                                                                                                                                       |
| nonce                | Random per session (`src/workflow/steps/`); the result block must carry it                                                                                                                                                                                                                                                                       |
| result block         | `<afk-harness-result nonce="…">{json}</afk-harness-result>`; the last one with the nonce wins                                                                                                                                                                                                                                                    |
| outcome              | Per phase. Coding: `task_implemented` (+optional `revision`) \| `no_more_tasks` \| `blocked` (+`blocker_text`). Verification: `verification_passed` \| `workflow_finished` \| `verification_failed` (+`failure_summary`, `findings_file`) \| `blocked` (+`blocker_text`)                                                                         |
| execution error      | `launch-failed` \| `exit-status` \| `missing-response` \| `invalid-response`                                                                                                                                                                                                                                                                     |
| contract violation   | Final message present but not a valid result block for its phase → `invalid-response`                                                                                                                                                                                                                                                            |
| stderr tail          | Last `STDERR_TAIL_LINES` of the agent's stderr, printed only after an execution-error line                                                                                                                                                                                                                                                       |
| adapter              | Knowledge of one agent CLI (`src/agents/<name>.ts`)                                                                                                                                                                                                                                                                                              |
| code skill           | The agent-side workflow (`laskaridis/skills`) that picks one task, implements it, and responds                                                                                                                                                                                                                                                   |

## Run policy

- Two-phase loop: a coding session reports `task_implemented`, then a verification session always follows (verification
  cannot be skipped). Verification is never resumed or forked, never counts as an iteration, and runs with the same
  agent, permissions, working directory and session timeout. The candidate of the last allowed coding iteration is still verified.
- Coding outcomes: `task_implemented` → verify the candidate; `no_more_tasks` → `[afk] Run complete: no more tasks`, stop
  successfully without verification; `blocked` → print the blocker, stop.
- Verification outcomes: `verification_passed` → next coding session with the launch prompt alone; `workflow_finished` →
  `[afk] Run complete: feature complete`, stop successfully; `verification_failed` → `[afk] Verification failed (attempt k/n): …`
  and a correction iteration for the same task (counts against `--max-iterations`); `blocked` → print the blocker, stop.
- A session given an assignment that answers with a different `task_id` (except `blocked` with `null`) is an invalid response.
- The rejection count is per task, held in memory for the run only, incremented only by `verification_failed` and reset
  when a different task id is observed. When a task has been rejected `--max-verification-attempts` times (default 2),
  the run stops with `[afk] Run stopped: verification limit of <n> reached for <task id>` and exit code 6, even if the
  iteration limit is reached at once. The harness writes no file when it stops.
- Verification sessions use `--verify-model` and `--verify-reasoning-effort`, each falling back to `--model` /
  `--reasoning-effort` (or the agent's own configuration). Both phases always use the one `--agent`.
- One retry (`MAX_RETRIES` in the executor; not user-configurable) per streak of consecutive execution errors; the next one stops the run. A valid outcome resets it. A retried verification session or correction iteration repeats the same assignment with a new nonce.
- A non-zero exit is an execution error even if the output contains a valid result block.
- Timeout and interruption stop the run immediately, with no retry.
- The harness trusts the outcome: it never reads tasks, findings files, git state, or runs tests.
- Every result block must include `task_id` and `task_plan_file`. `task_id` may be `null` only with `no_more_tasks` or
  `blocked`; `task_plan_file` may be `null` only with `blocked`. A block omitting either field is a contract violation.
  `revision` is accepted only on `task_implemented`; `findings_file` only on `verification_failed`.

## Output and exit codes

- stdout is empty during a run (help and `--version` only). All status goes to stderr as `[afk] …` lines.
- Agent stdout/stderr are captured, never streamed. No heartbeat lines.
- Wording is agent-neutral ("agent session", "the coding agent") and identical across agents; tests assert it.
- Exit codes and their meanings are defined once in `src/cli/cli-exit-codes.ts` (`EXIT_CODES`, shown by `afk --help`). They are
  part of the user contract: don't renumber them.
- `--help` / `-h` wins over every other option and over prompt input.

## Explicitly out of scope

Persisted logs/run history, resume commands, config files, env-var agent selection, plugin adapters, per-agent option
translation or validation, pre-flight checks of agent installation, arbitrary argument passthrough, publishing.
