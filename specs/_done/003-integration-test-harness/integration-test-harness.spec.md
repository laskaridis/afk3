# Feature Specification: Integration test harness for behavior preservation

## Purpose / Big Picture

`afk` is about to go through an architectural refactoring (see `doc/ARCHITECTURE.md`). The refactoring rewrites the internals of the run loop, sessions, reporting, and prompt handling, and the unit tests will be rewritten with it. The CLI integration tests in `test/integration/` are the only tests that will survive unchanged. They must show that the refactoring kept every observable behavior of `afk`.

Today they cannot fully do that:

- Some tests import production modules. Moving or renaming those modules breaks the tests, even when behavior is unchanged.
- Some tests use production constants as their expected values, so a behavior change made in both places goes unnoticed.
- Some tests check a few hand-picked phrases of the session prompt. They miss changes to the rest of it and break on harmless rewording.
- Most checks on `[afk]` status lines only test that a fragment appears, so wording, order, or extra lines can drift.
- Several required behaviors are covered only by unit tests, which are about to be replaced.

This feature changes only the integration suite and its fake agents. Afterwards, maintainers can refactor `src/` freely. A green `pnpm test:integration` then means the CLI still behaves as it did before. The CLI's behavior does not change.

## User stories

### US-001: Integration tests depend only on the built CLI

For the integration test suite, we need every test to observe `afk` only through `dist/cli.js`, its arguments, environment, stdio, exit code, and the files and processes it touches, so that restructuring `src/` cannot break a test without changing behavior.

#### Acceptance criteria

- **AC-001:** Given any file under `test/integration/`, when it is inspected, then it imports nothing from `src/`. Expected agent names (`codex`, `claude`), the default agent (`codex`), and the exit codes listed in help (`0`, `1`, `2`, `3`, `4`, `5`, `130`) are written as literal values in the tests.
- **AC-002:** Given any session, including a retry, when its session prompt is checked, then it equals exactly:
  - the launch prompt verbatim;
  - then the `---` separator;
  - then the instructions file shipped in the built package (`dist/code.md`), with `{{NONCE}}` replaced by that session's nonce;
  - with the same separators and trailing newline the current build produces.

  Tests no longer pick individual phrases out of the instructions. Comparing against the shipped file pins all of its content, including the result-block protocol, task metadata, explicit task assignment, and implementation-notes rules.
- **AC-003:** Given two session prompts, when they are compared with the nonce masked, then masking works for any nonce value. The nonce is identified from the session's result-block example, not by assuming a fixed length or alphabet.
- **AC-004:** Given `doc/TESTING.md`, when it is read, then it lists the contracts the integration suite relies on beyond the public CLI:
  - the `AFK_TERMINATION_GRACE_MS` environment variable;
  - the shipped instructions file `dist/code.md`, against which session prompts are compared;
  - the result-block example in the session prompt, from which the fake agents read the nonce;
  - Codex's `--output-last-message` file as the way the Codex fake agent delivers the final message.

### US-002: Exact status output is pinned for every agent

For the integration test suite, we need the complete `[afk]` stderr output of each shared harness scenario pinned exactly for every registered agent, so that changing how status lines are produced cannot change their wording, order, or number unnoticed.

#### Acceptance criteria

- **AC-005:** Given each scenario in the shared, per-agent harness suite, when it runs against each agent, then the whole of `afk`'s stderr equals an expected transcript written in the test. The scenarios include complete, blocked, fail-then-complete, iteration limit, retry recovers, two consecutive execution errors, missing final response, protocol violation, timeout, and interruption. Stdout is empty.
- **AC-006:** Given the expected transcripts, when they are inspected, then they include, where the scenario produces them:
  - every iteration-start and retry line with its `<n>/<max>` numbers;
  - the `[afk] Task failure: <summary>` line;
  - each `[afk] Execution error: <detail>` line with the full detail text, including the protocol violation reason;
  - the stderr tail lines that follow an execution error;
  - the final status line.

  A scenario that produces no line of a given kind shows that by matching its transcript exactly.
- **AC-007:** Given a launch failure, whose detail contains an operating-system error message that may differ between agents, when it is checked, then the `[afk] Execution error: failed to launch agent` prefix, the retry line, the exit code `3`, and the number of execution-error lines are all asserted exactly. The OS-specific remainder is not.

### US-003: Run-loop policy is pinned at the CLI boundary

For the integration test suite, we need the retry and iteration-limit policy checked end to end for every agent, so that moving the policy into the workflow layer cannot change when `afk` retries, continues, or stops.

#### Acceptance criteria

- **AC-008:** Given sessions that produce an execution error, then a valid `repeat`, then another execution error, then `complete`, when `afk` runs, then it launches 4 sessions and exits `0`. A valid response resets the retry allowance.
- **AC-009:** Given sessions that produce an execution error, then a valid `fail`, then another execution error, then `complete`, when `afk` runs, then it launches 4 sessions and exits `0`. A valid `fail` is not an execution error.
- **AC-010:** Given `--max-iterations 1`, when the only session ends with each result below, then `afk` launches exactly one session and stops as shown:

  | Result of the only session | Exit code | Final status |
  | --- | --- | --- |
  | execution error | `4` | `[afk] Run stopped: iteration limit of 1 reached without reported completion` |
  | valid `repeat` | `4` | same |
  | valid `fail` | `4` | same, after the `[afk] Task failure: …` line |
  | valid `complete` | `0` | `[afk] Run complete: feature complete` |
  | valid `blocked` | `1` | `[afk] Run blocked: <blocker_text>` |

- **AC-011:** Given no `--max-iterations` and sessions that always return `repeat`, when `afk` runs, then it launches exactly 10 sessions and exits `4`. The iteration lines are numbered `1/10` through `10/10`.

### US-004: Final-response handling is pinned at the CLI boundary

For the integration test suite, we need the classification of every session's final response checked end to end for every agent, so that moving protocol parsing into a workflow step cannot change which responses are accepted or how failures are reported.

#### Acceptance criteria

- **AC-012:** Given a session that exits `0` with each final message below, when it runs twice in a row, then `afk` reports `[afk] Execution error: agent final response is invalid: <reason>` each time and exits `3` after 2 sessions. The reason is the current reason text, asserted exactly.
  - no result block carrying this session's nonce (wrong nonce, or prose only);
  - a block body that is not a single JSON object (prose, Markdown fences, or malformed JSON);
  - a JSON value that is not an object;
  - a missing or unsupported `outcome`;
  - `repeat` or `complete` with an unsupported field;
  - `blocked` or `fail` with an unsupported field;
  - `blocked` without a non-empty `blocker_text`, or `fail` without a non-empty `failure_summary`;
  - `task_id` or `task_plan_file` that is neither a non-empty string nor `null`;
  - `task_id: null` with an outcome other than `blocked`.
- **AC-013:** Given a final message with a valid block carrying the session's nonce, when the session ends, then `afk` acts on that block in each of these cases:
  - text such as banners or prose surrounds the block;
  - a block with a different nonce (an echoed example or an injected block) appears before or after it.

  Given two complete blocks carrying the session's nonce, `afk` acts on the last one.
- **AC-014:** Given valid responses, when the session ends, then `afk` accepts each one and acts on its outcome:
  - responses that include `task_id` and `task_plan_file`, including `blocked` with `task_id: null` and `task_plan_file: null`;
  - responses that omit both fields.
- **AC-015:** Given a Codex session that writes a valid result block to stdout but no final message to its output file, and exits `0`, when the session ends, then `afk` reports `agent exited without a final response`. Streamed output is never treated as the final response.
- **AC-016:** Given an agent process that ends by a signal it did not receive from `afk`, when the session ends, then `afk` reports `[afk] Execution error: agent exited unsuccessfully with signal <SIGNAL>` and applies the retry policy. The fake agents support a step that ends their own process with a chosen signal.

### US-005: Termination and diagnostic output are pinned at the CLI boundary

For the integration test suite, we need timeout, interruption, and stderr-tail behavior checked end to end, so that moving process handling into the session layer cannot leave agents running or change what diagnostic output is shown.

#### Acceptance criteria

- **AC-017:** Given `--session-timeout 1` and an agent that ignores SIGINT and SIGTERM, when the timeout expires, then:
  - the agent receives SIGINT and then SIGTERM;
  - the agent process is no longer running when `afk` exits;
  - `afk` exits `5` after one session.
- **AC-018:** Given an agent that writes to stderr and is then interrupted with SIGINT, when the run ends, then none of the agent's stderr appears in `afk`'s output.
- **AC-019:** Given an execution error of each kind (non-zero exit, missing final response, invalid final response) after the agent wrote stderr, when it is reported, then the stderr tail follows the execution-error line, for every agent.
- **AC-020:** Given an active run, when `afk` receives SIGTERM or SIGHUP instead of SIGINT, then it terminates the active agent session, starts no further session, prints `[afk] Run interrupted by user`, and exits `130`.

### US-006: Input validation, agent launch, and workspace effects are pinned for every agent

For the integration test suite, we need the remaining launch-time and side-effect rules checked end to end, so that restructuring the CLI and agent layers cannot change what is accepted, how agents are launched, or what `afk` leaves behind.

#### Acceptance criteria

- **AC-021:** Given a positional prompt or `--prompt-file`, together with a non-TTY stdin that has data, when `afk` starts, then stdin is not read and not combined with the prompt. The run uses the explicit source as the launch prompt. Given the same explicit source with a stdin pipe that is never closed, the run still starts and completes without waiting for stdin.
- **AC-022:** Given `--agent claude` without `--model` or `--reasoning-effort`, when a session starts, then the Claude arguments contain neither `--model` nor `--effort`.
- **AC-023:** Given `--agent claude`, when a session starts, then the Claude arguments never contain:
  - `bypassPermissions` as a permission mode;
  - `--dangerously-skip-permissions`;
  - `--resume`, `--continue`, or `--fork-session`.
- **AC-024:** Given each stop reason (complete, blocked, execution error, iteration limit, timeout, interruption), when a run with each agent ends, then:
  - no file was added to or changed in the workspace, the home directory, or the temporary directory;
  - existing skill files in the workspace (`progress.txt`, `specs/`) are unchanged.

## Assumptions

- The current code is the only source of truth for the behavior to preserve. It is taken from `src/` on the `refactor-architecture` branch at the start of this feature. Documents under `specs/_done/` are historical and partly out of date; they are not used to decide expected behavior. `doc/PRODUCT.md` and `doc/SECURITY.md` summarize the current behavior, but the code wins where they differ.
- The behaviors below are easy to get wrong from the older documents. As implemented today:
  - The session prompt is the launch prompt, a blank line, `---`, then `src/code.md` (shipped as `dist/code.md`) with `{{NONCE}}` replaced, and a trailing newline (`src/protocol.ts`). The instructions are bundled with `afk`; nothing needs to be installed in the workspace.
  - The final response is the body of the last complete `<afk-harness-result nonce="…">` block carrying the session's nonce. Text outside it and blocks with other nonces are ignored (`src/protocol.ts`).
  - `task_id` and `task_plan_file` are optional in a result block and validated when present. No other extra fields are allowed (`src/protocol.ts`).
  - Codex's final message is read only from the `--output-last-message` file. That file sits in a per-session temporary directory outside the workspace, which is removed when the session ends, for every agent (`src/agents/codex.ts`, `src/session.ts`). Codex's stdout is ignored.
  - Stdin is read only when there is no positional prompt and no `--prompt-file`, so a pipe left open cannot block a run (`src/prompt.ts`).
  - An execution error on the last allowed iteration ends the run with the iteration limit (exit `4`), not as an execution error (exit `3`) (`src/runner.ts`).
  - SIGINT, SIGTERM, and SIGHUP sent to `afk` all interrupt the run (`src/cli.ts`).
  - The default iteration limit is 10 (`src/runner.ts`).
- The exact wording asserted is the wording `afk` produces today. When writing an expected transcript, capture it from the current build; do not invent it.
- Shared scenarios belong in the existing per-agent suite (`agent-parity.test.ts`), so they run against both agents. Agent-specific checks stay in agent-specific tests. The shared fake agent (`fake-codex.mjs`, reused by `fake-claude.mjs`) is extended rather than copied.
- Any assertion strengthened by this feature must pass against the current build. If it fails, that is a finding about current behavior, to be resolved before refactoring. It is not a reason to change `src/`.

## Out of Scope

- Any change to files under `src/`, to CLI behavior, wording, exit codes, the protocol, or the session prompt.
- Changes to unit tests, the coverage gate, or static documentation checks in `test/unit/`.
- Merging or reorganizing the overlapping integration test files beyond what the acceptance criteria need.
- A TTY on stdin with no prompt counting as missing input (`src/prompt.ts`). Testing it end to end needs a pseudo-terminal; it stays covered by `test/unit/prompt.test.ts`.
- The architectural refactoring itself.
- Tests against real agent installations.

## Clarifications needed

None.
