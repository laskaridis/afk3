# Feature Specification: Refactor the code to the target architecture

## Purpose / Big Picture

`doc/ARCHITECTURE.md` describes the target structure of `afk`: a strict layering `CLI -> WorkflowExecutor -> WorkflowStep -> SessionExecutor -> AgentAdapter`, with dependencies pointing only downward, and a `WorkflowExecutor` that publishes `WorkflowEvent`s to `WorkflowObserver`s (the CLI and the reporter). The current code does not follow it: `runner.ts` mixes iteration policy with final-response classification, `cli.ts` formats status lines through ad-hoc callbacks, and `protocol.ts`, `session.ts` and `reporter.ts` are flat modules with no package boundaries.

This refactoring moves the code into that structure so maintainers can add workflow steps, agents and reporters without touching unrelated layers. Users see no change: the `[afk]` wording on stderr, empty stdout, exit codes, the retry-once rule, timeouts and termination signals, the stderr tail, CLI options and help, and the agent-facing session prompt and result-block protocol in `src/code.md` all stay exactly as they are. The unchanged black-box integration suite in `test/integration/` is the proof.

## User stories

### US-001: Observable behavior is preserved

For the maintainers, we need the refactored CLI to pass the existing integration suite unmodified, so that the refactoring is proven to keep every user-visible behavior.

#### Acceptance criteria

- **AC-001:** Given the finished refactoring, when `git diff 3f42e29 -- test/integration` is run, then it prints nothing: no test, helper or fake-agent fixture under `test/integration/` was added, changed or removed.
- **AC-002:** Given the finished refactoring, when `pnpm check` is run, then it exits `0` (build, unit and integration tests, typecheck, lint, prettier).
- **AC-003:** Given the finished refactoring, when `pnpm test:coverage` is run, then it exits `0` with 100% line, statement, function and branch coverage for every file under `src/` (the existing CI gate, which remains a standing rule after the refactoring).
- **AC-004:** Given `pnpm build`, when `dist/` is inspected, then `dist/cli.js` is still the executable `bin` entry point and `dist/code.md` still holds the shipped instructions, byte-identical to `src/code.md`.
- **AC-005:** Given `src/code.md`, when it is compared with commit `3f42e29`, then it is unchanged.

### US-002: Agent-specific knowledge lives only in the agents package

For the `agents/` package, we need one `AgentAdapter` per agent and an `AgentRegistry`, so that adding an agent touches only this package.

#### Acceptance criteria

- **AC-006:** Given `src/agents/`, when it is inspected, then it contains the `AgentAdapter` interface, `CodexAdapter`, `ClaudeAdapter` and `AgentRegistry`. Each adapter builds its executable and arguments from cwd, output file, model and effort, and extracts the final message from captured stdout or the output file. `AgentRegistry` returns the adapter for a name, lists supported names, and names the default agent (`codex`).
- **AC-007:** Given every file under `src/` outside `src/agents/`, when it is searched, then it contains no agent name, agent executable, agent flag (for example `--output-last-message`, `--permission-mode`) or agent output format, and imports nothing from `src/agents/` except the `AgentAdapter` interface and `AgentRegistry`.
- **AC-008:** Given `test/unit/agents/`, when it runs, then each adapter and the registry are covered by their own unit tests.

### US-003: Session execution is a self-contained layer

For the `session/` package, we need a `SessionExecutorFactory`, a `SessionExecutor` and a `SessionResult`, so that process handling is isolated from workflow policy.

#### Acceptance criteria

- **AC-009:** Given `SessionExecutorFactory`, when it is created with the interruption `AbortSignal`, the optional session timeout and the termination grace period, then every `SessionExecutor` it creates uses that same signal, timeout and grace period.
- **AC-010:** Given a `SessionExecutor` for an `AgentAdapter`, when it executes a prompt in a workspace with optional model and effort, then it spawns the adapter's executable, writes the prompt to stdin, captures stdout, keeps the last 20 stderr lines, provides and then removes the temporary output file, escalates SIGINT -> SIGTERM -> SIGKILL on timeout or interruption, and asks the adapter for the final message.
- **AC-011:** Given a finished session, when its `SessionResult` is inspected, then it is exactly one of: launch failed, timed out, interrupted, exited unsuccessfully (signal, non-zero exit, or agent-reported error), missing final message, invalid final message, or success with the final message. Every failure kind carries the detail text and, where the current code prints one, the stderr tail.
- **AC-012:** Given `test/unit/session/`, when it runs, then `SessionExecutorFactory`, `SessionExecutor` and `SessionResult` classification are covered by unit tests written for these components.

### US-004: A workflow step owns the session prompt and the result protocol

For the `workflow/` package, we need a `WorkflowStep` interface with a `CodingStep` implementation that returns a `WorkflowStepResult`, so that prompt assembly and result parsing sit in one place above the session layer.

#### Acceptance criteria

- **AC-013:** Given `CodingStep`, when it executes with a `LaunchPrompt` and a `SessionExecutor`, then it generates a fresh nonce, builds the session prompt (launch prompt, `---`, `code.md` with `{{NONCE}}` replaced), runs it through the `SessionExecutor`, and parses the last `<afk-harness-result>` block carrying that nonce.
- **AC-014:** Given each `SessionResult` or parsed result block, when `CodingStep` converts it, then the `WorkflowStepResult` outcome is:

  | Input                                                              | Outcome         | Carried details                       |
  | ------------------------------------------------------------------ | --------------- | ------------------------------------- |
  | result block `repeat`                                              | `Continue`      | `task_id`, `task_plan_file`           |
  | result block `complete`                                            | `Finished`      | `task_id`, `task_plan_file`           |
  | result block `fail`                                                | `StepFailed`    | failure summary, task metadata        |
  | result block `blocked`                                             | `Blocked`       | blocker text (unblocking condition)   |
  | launch failed, exited unsuccessfully, missing or invalid message, or a result-block contract violation | `SessionFailed` | execution-error detail, stderr tail |
  | timed out                                                          | `Timeout`       | —                                     |
  | interrupted                                                        | `Interrupted`   | —                                     |

- **AC-015:** Given every response covered today by `test/unit/protocol.test.ts` and `test/unit/runner.test.ts`, when `CodingStep` handles it, then the execution-error detail text is identical to today's (for example `agent final response is invalid: <reason>`, `agent exited without a final response`, `agent exited unsuccessfully with exit code <n>`).
- **AC-016:** Given `test/unit/workflow/`, when it runs, then `CodingStep` and `WorkflowStepResult` mapping are covered by unit tests using a stubbed `SessionExecutor`.

### US-005: The workflow executor controls the run and publishes events

For the `workflow/` package, we need a `WorkflowExecutor` that runs steps under `WorkflowOptions` and publishes `WorkflowEvent`s to `WorkflowObserver`s, so that run policy is separate from how it is reported.

#### Acceptance criteria

- **AC-017:** Given `WorkflowOptions` (agent adapter, model, reasoning effort, max iterations, session timeout, cwd), a `LaunchPrompt` and a `SessionExecutorFactory`, when `WorkflowExecutor` runs, then it creates one `SessionExecutor` and one `CodingStep` per iteration and applies today's policy: `Continue` and `StepFailed` start the next iteration; `Finished`, `Blocked`, `Timeout` and `Interrupted` stop immediately; one retry per consecutive `SessionFailed`, a second consecutive one stops the run, and any valid outcome resets the allowance; the iteration limit counts retries.
- **AC-018:** Given a run, when it ends, then `WorkflowExecutor.run()` returns the terminal result, and observers have received exactly one terminal event: `WorkflowFinished`, `WorkflowBlocked`, `WorkflowFailed`, `WorkflowTimedOut`, `WorkflowInterrupted` or `MaxIterationsReached`. Each event is an immutable value with a `type` discriminator and carries all data observers need (iteration and limit, failure detail and stderr tail, blocker text, timeout seconds, task metadata).
- **AC-018a:** Given a run, when it executes, then every event listed for `WorkflowExecutor` in `doc/ARCHITECTURE.md` is published at its point in the run, even if no observer reacts to it (`WorkflowStarted`, `StepExecutionStarted`, `StepExecutionFinished`, `StepExecutionBlocked` and `IterationFinished` have no console output today). `IterationStarted` is published for every iteration, including retries; on a retry iteration `StepExecutionRetried` is published as well, and `ConsoleReporter` prints the retry line instead of the iteration line, so stderr stays identical.
- **AC-019:** Given a `WorkflowObserver`, when it receives an event, then it has no way to change the executor's control flow (events are data only; the executor ignores observer return values).
- **AC-020:** Given `test/unit/workflow/`, when it runs, then `WorkflowExecutor` policy and the event sequence for each scenario (complete, blocked, fail then complete, iteration limit, retry recovers, two consecutive session failures, timeout, interruption) are covered with stubbed steps or session executors and a recording observer.

### US-006: Progress reporting is driven only by events

For the `reporter/` package, we need a `Reporter` interface and a `ConsoleReporter` that observes the workflow, so that every `[afk]` run-time status line comes from a `WorkflowEvent`.

#### Acceptance criteria

- **AC-021:** Given `ConsoleReporter`, when it receives each `WorkflowEvent`, then it writes to stderr exactly the line(s) printed today for that situation: iteration start, retry, `Task failure: …`, `Execution error: …` followed by the stderr tail, and the final status line (none for `WorkflowFailed`).
- **AC-022:** Given `src/reporter/`, when it is inspected, then it imports nothing from `session/` or `agents/` and is invoked only through the `WorkflowObserver` interface; no other module writes run-time `[afk]` status lines.
- **AC-023:** Given `test/unit/reporter/`, when it runs, then each event's console output is pinned by a unit test.

### US-007: The CLI only parses input, wires components and sets the exit code

For the `cli/` package, we need a `CLI` that turns options and the launch prompt into runtime components, wires them, observes the run and exits, so that it holds no run policy or status formatting.

#### Acceptance criteria

- **AC-024:** Given any command line, when `CLI` handles it, then it validates options, resolves the `LaunchPrompt`, looks up the adapter in `AgentRegistry`, builds `WorkflowOptions`, a `SessionExecutorFactory` (with the interruption signal from SIGINT/SIGTERM/SIGHUP and `AFK_TERMINATION_GRACE_MS`) and a `ConsoleReporter`, subscribes the reporter to the `WorkflowExecutor`, runs it, and exits with the code for the terminal result returned by `WorkflowExecutor.run()`.
- **AC-025:** Given `src/cli/`, when it is inspected, then it contains no retry, iteration or outcome policy and writes no run-time status line; it writes only help, version and `[afk] input error: …` output.
- **AC-026:** Given `test/unit/cli/`, when it runs, then option parsing, launch-prompt resolution and terminal-result-to-exit-code mapping are covered by unit tests.

### US-008: Dependencies point only downward

For the maintainers, we need the layering checked automatically, so that an upward dependency fails `pnpm check`.

#### Acceptance criteria

- **AC-027:** Given the source tree, when a unit test reads every `import` in `src/`, then it fails if any module imports from a higher layer in the order `cli -> workflow -> session -> agents`, and if `reporter/` imports anything other than `workflow/` event and observer types. The entry point `src/cli.ts` may import only `src/cli/`.
- **AC-028:** Given `src/`, when it is listed, then no flat modules from the old layout remain (`runner.ts`, `session.ts`, `protocol.ts`, `reporter.ts`, `prompt.ts`, `agents/types.ts`), and `test/unit/` has no tests for removed modules.

### US-009: Documentation matches the code

For the maintainers and coding agents, we need the docs to describe the refactored code, so that they can be trusted as guidance.

#### Acceptance criteria

- **AC-029:** Given `doc/ARCHITECTURE.md`, when it is read, then component, package and event names match the code exactly: typos are fixed (`WorfklowExecutor`, `WorfklowFailed`, `SessionExecutionErrorOccured`, `Interruped`, `FaileInvalidResponse`, `sesison/`, `worfklow`, and spelling errors in prose), `WorkflowExecutionStep` is replaced by `WorkflowStep`, `agent/` and `adapter/` by `agents/`, `reporting` by `reporter`, `SessionResult` lists the exited-unsuccessfully kind, and `WorkflowStepResult` fields match what is implemented, and the CLI is described as getting the terminal result from `WorkflowExecutor.run()` rather than as a `WorkflowObserver`.
- **AC-030:** Given `AGENTS.md`, when its Map table and Must-knows are read, then every path listed exists and describes the new packages and entry point.
- **AC-031:** Given `doc/PRODUCT.md`, `doc/TESTING.md`, `doc/CONVENTIONS.md` and `doc/SECURITY.md`, when they are read, then every reference to a source file, module, constant or unit-test file points to something that exists after the refactoring.

## Assumptions

- **A1 (confirmed):** `WorkflowStepResult` carries only `task_id` and `task_plan_file` from the result block. The specification file path and verification findings file path from `doc/ARCHITECTURE.md` are not added to the result block, because that would change the `src/code.md` contract. They are left out of this refactoring ; `doc/ARCHITECTURE.md` says so.
- **A2 (confirmed):** The internal outcome names `Continue`, `Finished`, `StepFailed`, `SessionFailed`, `Blocked`, `Timeout` and `Interrupted` map onto the unchanged agent protocol values `repeat`, `complete`, `fail` and `blocked` as in AC-014.
- **A3 (confirmed):** `SessionExecutor` classifies only what it can see from the process and the adapter's extraction (launch failed, timed out, interrupted, exit status or agent-reported error, missing or invalid final message as returned by the adapter). `WorkflowStep` owns prompt assembly, nonce generation and parsing of the `<afk-harness-result>` block; a contract violation it finds becomes `SessionFailed` so the retry-once rule and detail wording stay identical.
- **A4 (confirmed):** Packages are `src/cli/`, `src/workflow/`, `src/session/`, `src/agents/` and `src/reporter/`.
- `src/cli.ts` stays as a thin entry point so that `dist/cli.js` remains the `bin` path the integration suite runs. `src/code.md` stays where the build script copies it to `dist/code.md`; only the module that reads it moves.
- Launch-prompt source resolution (argument, `--prompt-file`, stdin; exactly one source) keeps its current rules and messages; `LaunchPrompt` is the resolved value the workflow consumes.
- Exit codes and their help text stay in the CLI layer, since the CLI sets the exit code; the meaning and numbers are unchanged.
- New unit tests are written test-first per component; existing tests in `test/unit/` may be deleted once their behavior is covered by the new ones.

## Out of Scope

- Introducing a `WorkflowDefinition` separate from `WorkflowExecutor`.
- New result-block fields, any change to `src/code.md` or the result protocol.
- Any change to wording, exit codes, options, help text or other observable behavior.
- Any change to `test/integration/`.
- Real-agent smoke tests in the automated suite.

## Decisions

- **D1:** Components may be implemented as classes. The "no classes" rule has been removed from `doc/CONVENTIONS.md`.
- **D2:** `WorkflowExecutor.run()` returns the terminal result; the CLI sets the exit code from it and does not need to observe events (AC-018, AC-024).
- **D3:** Every event listed in `doc/ARCHITECTURE.md` is published even if observers ignore it (AC-018a). The rule that `IterationStarted` and `StepExecutionRetried` are both published on a retry iteration is an assumption made to keep stderr identical.
- **D4:** 100% unit-test coverage per file in `src/` stays a standing rule after the refactoring (AC-003).
