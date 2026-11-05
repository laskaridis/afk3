# Design: Refactor the code to the target architecture

Specification: [refactor-architecture.spec.md](refactor-architecture.spec.md)
Target architecture: [doc/ARCHITECTURE.md](../doc/ARCHITECTURE.md)

## Architectural drivers

- **Behavior preservation (US-001).** `test/integration/` is frozen at commit `3f42e29` and must stay green after every
  task. It runs `dist/cli.js` as a black box, so stderr wording and order, exit codes, empty stdout, the session prompt
  (compared byte-for-byte with `dist/code.md`), signals and temp-file handling are all pinned. Every task is a
  behavior-preserving move.
- **100% per-file unit coverage (D4).** `pnpm test:coverage` enforces `perFile` 100% thresholds on `src/**/*.ts`.
  Integration runs of `dist/cli.js` do not count. Every new source file therefore needs its own unit tests in the
  same task, and every replaced module is deleted in the task that replaces it, so no dead code is left behind.
- **Strict downward layering (US-008).** `cli -> workflow -> session -> agents`, with `reporting` depending only on
  workflow event and observer types. The `src/cli.ts` entry point depends only on `src/cli/`.
- **Agent neutrality (US-002, AC-007).** Agent names, executables, flags and output formats live only in
  `src/agents/`. Other code imports only the `AgentAdapter` interface (with the input/output types declared beside
  it) and `AgentRegistry`.
- **Unchanged contracts.** `src/code.md` and the result-block protocol are unchanged (A1, A2). `dist/cli.js` stays
  the `bin` entry and `dist/code.md` stays where the build script copies it.

## Packages and modules

File names inside a package are suggestions. The package each component belongs to is fixed (A4).

| Package     | Component (suggested file)                                         | Responsibility (reason to change)                                                                                                                                                                                                                                                                                                                                                                                                                                      | Interface (conceptual)                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agents/`   | `AgentAdapter` (`agents/adapter.ts`)                               | The contract between the session layer and one agent CLI. Changes when what the session needs from an agent changes. Replaces `agents/types.ts`.                                                                                                                                                                                                                                                                                                                       | `name`, `executable`, `buildArgs({ cwd, outputFile?, model?, effort? })`, `extractFinalMessage(stdout, outputFile?)` → message / missing / invalid(reason) / agentError(detail)                                                  |
| `agents/`   | `CodexAdapter`, `ClaudeAdapter` (`agents/codex.ts`, `agents/claude.ts`) | Knowledge of one agent CLI: launch arguments and where its final message lives. Changes when that agent's CLI changes.                                                                                                                                                                                                                                                                                                                                                 | Implement `AgentAdapter`                                                                                                                                                                                                       |
| `agents/`   | `AgentRegistry` (`agents/registry.ts`)                             | The single list of supported agents. Changes when an agent is added.                                                                                                                                                                                                                                                                                                                                                                                                   | adapter for a name, supported names (in registration order), default agent name (`codex`)                                                                                                                                       |
| `session/`  | `SessionExecutorFactory`                                           | Holds the run-wide session settings so every session gets the same ones.                                                                                                                                                                                                                                                                                                                                                                                               | created with interruption `AbortSignal`, optional session timeout (seconds), optional grace period (ms); `create(adapter)` → `SessionExecutor`                                                                                  |
| `session/`  | `SessionExecutor`                                                  | Runs one agent process: spawn, stdin prompt, stdout capture, 20-line stderr tail, temp output file, SIGINT → SIGTERM → SIGKILL escalation, adapter extraction, and classification of process- and adapter-level results. Changes when process handling changes.                                                                                                                                                                                                         | `execute({ prompt, cwd, model?, effort? })` → `SessionResult`                                                                                                                                                                  |
| `session/`  | `SessionResult`                                                    | Discriminated union of what a session ended as.                                                                                                                                                                                                                                                                                                                                                                                                                        | see "SessionResult" below                                                                                                                                                                                                      |
| `workflow/` | `LaunchPrompt`                                                     | The resolved launch prompt the workflow consumes (a value; source resolution stays in `cli/`).                                                                                                                                                                                                                                                                                                                                                                         | holds the launch prompt text                                                                                                                                                                                                   |
| `workflow/` | `WorkflowOptions`                                                  | Run configuration from the command line.                                                                                                                                                                                                                                                                                                                                                                                                                               | adapter, model?, reasoning effort?, max iterations, session timeout seconds?, cwd                                                                                                                                              |
| `workflow/` | `WorkflowStepOptions` | The per-step subset of `WorkflowOptions`: where to run and with which model. Keeps the adapter, the iteration limit and the session timeout out of a step. | `cwd`, `model?`, `effort?` |
| `workflow/` | `WorkflowStep` + `CodingStep`                                      | One step: nonce generation, session prompt assembly (launch prompt, `---`, `code.md` with `{{NONCE}}` replaced), running it through its `SessionExecutor`, parsing the last `<afk-harness-result>` block with that nonce, converting everything into a `WorkflowStepResult`. Changes when the agent protocol changes. Absorbs `protocol.ts` and the result-block half of `runner.ts`'s classification.                                                                   | constructed with a `SessionExecutor`; `execute(launchPrompt, WorkflowStepOptions)` → `WorkflowStepResult`; a step name                                                                                                                         |
| `workflow/` | `WorkflowStepResult`                                               | Outcome of a step for the executor.                                                                                                                                                                                                                                                                                                                                                                                                                                    | see "WorkflowStepResult" below                                                                                                                                                                                                 |
| `workflow/` | `WorkflowExecutor`                                                 | Run policy: iterations, retry-once, terminal conditions; publishes events. Changes when run policy changes. Replaces `runner.ts`.                                                                                                                                                                                                                                                                                                                                       | created with `WorkflowOptions`, `LaunchPrompt`, `SessionExecutorFactory`; `subscribe(observer)`; `run()` → terminal event                                                                                                      |
| `workflow/` | `WorkflowEvent`, `WorkflowObserver`                                | Event value types and the observer interface.                                                                                                                                                                                                                                                                                                                                                                                                                          | union of immutable events with a `type` discriminator; observer has one method receiving an event, return value ignored                                                                                                         |
| `reporting/` | `Reporter`, `ConsoleReporter`                                      | Turns events into `[afk]` stderr lines. Changes when wording changes. Absorbs the formatting half of `reporter.ts`.                                                                                                                                                                                                                                                                                                                                                    | `Reporter` is a `WorkflowObserver`; `ConsoleReporter` is constructed with its output sink (e.g. `process.stderr`)                                                                                                               |
| `cli/`      | `CLI`, option parsing, launch-prompt resolution, exit codes        | Parse and validate options (commander), resolve the launch prompt (argument / `--prompt-file` / stdin, unchanged rules), look up the adapter, build `WorkflowOptions`, `LaunchPrompt`, `SessionExecutorFactory` (signal from SIGINT/SIGTERM/SIGHUP, `AFK_TERMINATION_GRACE_MS`) and `ConsoleReporter`, subscribe the reporter, run, map the terminal result to an exit code. Owns `EXIT_CODES` and the exit-code help text. Absorbs `cli.ts`, `prompt.ts` and the exit-code half of `reporter.ts`. | returns the process exit code for an argv                                                                                                                                                                                      |
| (root)      | `src/cli.ts`                                                       | Thin executable entry: shebang, calls `cli/`, `process.exit` with the code, prints `[afk] <message>` and exits 2 on an unexpected error.                                                                                                                                                                                                                                                                                                                               | imports only `src/cli/`                                                                                                                                                                                                        |

### SessionResult

Exactly one of the following. The detail texts are today's wording, moved from `runner.ts`'s `classify`.

| Kind                     | When (checked in this order)                                                       | Carries                                                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LaunchFailed` | spawn error                                                                        | detail `failed to launch agent: <error message>`; **no** stderr tail                                                                                        |
| `Interrupted` | aborted before spawn, or abort during the session (wins over a running timeout)   | —                                                                                                                                                           |
| `TimedOut` | session timeout fired first                                                        | —                                                                                                                                                           |
| `ExecutionFailed` | 1. terminated by a signal; 2. adapter reports an agent error; 3. non-zero exit code | detail `agent exited unsuccessfully with signal <S>` / `agent exited unsuccessfully (agent reported an error: <d>)` (exit 0) / `… with exit code <n> (agent reported an error: <d>)` / `agent exited unsuccessfully with exit code <n>`; stderr tail |
| `ExecutionFailed` | adapter returns invalid                                                            | detail `agent final response is invalid: <reason>`; stderr tail                                                                                            |
| `ExecutionFailed` | adapter returns missing                                                            | detail `agent exited without a final response`; stderr tail                                                                                                 |
| `Success` | adapter returns a message                                                          | final message; **stderr tail** (needed because a contract violation found later by `CodingStep` prints it)                                                   |

### WorkflowStepResult

| Outcome         | From                                                                                       | Carries                                                                 |
| --------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `Continue`      | result block `repeat`                                                                      | `task_id`, `task_plan_file` (when present)                              |
| `Finished`      | result block `complete`                                                                    | `task_id`, `task_plan_file`                                             |
| `StepFailed`    | result block `fail`                                                                        | failure summary, task metadata                                          |
| `Blocked`       | result block `blocked`                                                                     | blocker text, task metadata                                             |
| `SessionFailed` | `LaunchFailed`, `ExecutionFailed`, or contract violation | execution-error detail; stderr tail (empty for `LaunchFailed`)           |
| `Timeout`       | timed out                                                                                  | —                                                                       |
| `Interrupted`   | interrupted                                                                                | —                                                                       |

A contract violation becomes `SessionFailed` with detail `agent final response is invalid: <violation>` and the
session's stderr tail. Specification and verification-findings paths are not fields (A1).

## Flow of execution

1. `src/cli.ts` calls into `cli/` with `process.argv`.
2. `CLI` parses options. Help wins over everything. Invalid input prints commander's message or
   `[afk] input error: …` and returns exit code 2.
3. `CLI` resolves the `LaunchPrompt` and gets the adapter from `AgentRegistry`. It registers SIGINT/SIGTERM/SIGHUP to
   abort one `AbortController`, and builds `WorkflowOptions`, `SessionExecutorFactory` and `ConsoleReporter(stderr)`.
4. `CLI` creates the `WorkflowExecutor`, subscribes the reporter and awaits `run()`. It maps the returned terminal
   event to an exit code.
5. Each iteration, `WorkflowExecutor` creates a `SessionExecutor` (from the factory) and a `CodingStep` constructed
   with it, executes the step and applies the policy.
6. `CodingStep` builds the prompt with a fresh nonce, calls its `SessionExecutor`, and converts the
   `SessionResult` or parsed block into a `WorkflowStepResult`.

### Event sequence

Published synchronously, in this order, to every subscribed observer:

- `WorkflowStarted` (once; carries the iteration limit).
- Per iteration:
  - `IterationStarted` (iteration, limit, and whether it is a retry);
  - on a retry iteration, `StepExecutionRetried` (iteration, limit, previous error detail);
  - `StepExecutionStarted` (iteration, step name);
  - then, by outcome:
    - `Continue` / `Finished` → `StepExecutionFinished` (task metadata);
    - `StepFailed` → `StepExecutionFailed` (failure summary, task metadata);
    - `Blocked` → `StepExecutionBlocked` (blocker text, task metadata);
    - `SessionFailed` → `SessionExecutionErrorOccurred` (detail, stderr tail);
    - `Timeout` / `Interrupted` → no step-level event;
  - `IterationFinished` (iteration, outcome). Every `IterationStarted` gets a matching `IterationFinished`.
- At most one terminal event, which is also the value `run()` returns:
  - `WorkflowFinished` (task metadata);
  - `WorkflowBlocked` (blocker text, task metadata);
  - `WorkflowFailed` (detail and stderr tail of the second consecutive session failure);
  - `WorkflowTimedOut` (configured timeout seconds);
  - `WorkflowInterrupted`;
  - `MaxIterationsReached` (limit).

  A session failure on the last iteration with no previous error ends as `MaxIterationsReached`, after its
  `SessionExecutionErrorOccurred`.

### ConsoleReporter output (identical to today)

| Event                                           | stderr                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `IterationStarted`, not a retry                 | `[afk] Iteration <i>/<limit>: starting agent session`                                                |
| `StepExecutionRetried`                          | `[afk] Iteration <i>/<limit>: retrying agent session after execution error` (limit = configured max) |
| `StepExecutionFailed`                           | `[afk] Task failure: <summary>`                                                                     |
| `SessionExecutionErrorOccurred`                 | `[afk] Execution error: <detail>` then each stderr-tail line                                        |
| `WorkflowFinished`                              | `[afk] Run complete: feature complete`                                                              |
| `WorkflowBlocked`                               | `[afk] Run blocked: <blocker text>`                                                                 |
| `MaxIterationsReached`                          | `[afk] Run stopped: iteration limit of <limit> reached without reported completion`                 |
| `WorkflowTimedOut`                              | `[afk] Run stopped: agent session timed out after <seconds> seconds`                                |
| `WorkflowInterrupted`                           | `[afk] Run interrupted by user`                                                                     |
| everything else, incl. `WorkflowFailed`         | nothing                                                                                             |

Exit codes (in `cli/`, unchanged): Finished 0, Blocked 1, input error 2, Failed 3, MaxIterationsReached 4,
TimedOut 5, Interrupted 130.

## Key decisions

- **Bottom-up strangler migration.** The order is agents → session → step → executor + events + reporter →
  CLI → layering guard → docs → validation. Each task moves one layer into its package. Callers that are not
  migrated yet are adapted, and the replaced flat module and its unit test are deleted in the same task. After every
  task, the integration suite and the coverage gate are green. The workflow executor and the console reporter land
  together, because stderr is only identical once the reporter consumes events.
- **Classification split (A3).** `SessionExecutor` owns everything it can see from the process and the adapter. It
  keeps today's order: signal → agent-reported error → non-zero exit → adapter-invalid → missing. `CodingStep` owns
  the nonce and the result block. This keeps the "a message from a failed process is never trusted" rule in the
  session layer.
- **`run()` returns the terminal event (D2).** The terminal event value is both published and returned, so the CLI
  maps it to an exit code without observing events, and the observer and return paths cannot disagree.
- **Retry iterations publish both `IterationStarted` and `StepExecutionRetried` (D3).** `IterationStarted` says
  whether it is a retry, so `ConsoleReporter` stays stateless and prints only the retry line.
- **The reporter gets its output sink by injection.** `ConsoleReporter` is constructed with the stream it writes to,
  so `reporting/` imports nothing but workflow event and observer types, and unit tests capture output without spying
  on `process.stderr`.
- **Launch-prompt resolution stays in `cli/`.** It reads files and stdin, which are CLI inputs. `workflow/LaunchPrompt`
  is only the resolved value. The rules and messages are unchanged.
- **Exit codes live in `cli/`** together with their help text, because the CLI sets the exit code.
  `EXIT_CODES` keeps its name and numbers.
- **`code.md` location.** `src/code.md` and `dist/code.md` do not move. The module that reads it resolves the file
  relative to its own location (`../code.md` from `src/workflow/`), which works in both `src/` (unit tests) and
  `dist/` (built CLI).
- **`package.json` version lookup.** If the code that reads the version moves into `src/cli/`, its relative path
  must still resolve to the repository's `package.json` from `dist/cli/` (pinned by `afk --version` in the tracer-bullet
  integration test).
- **Entry point stays thin and covered.** `src/cli.ts` keeps its run-on-import behavior. It is unit-tested by mocking
  `src/cli/`, as `test/unit/cli.test.ts` does today.
- **Layering is enforced by a unit test.** The test reads every `import` in `src/`. Node built-ins and npm packages
  are ignored. Only relative imports between packages are checked.
- **Step collaborators are injected; step inputs are parameters.** `CodingStep` is constructed with the
  `SessionExecutor` it runs, because it cannot execute without one. `execute` takes only the launch prompt and a
  `WorkflowStepOptions` (`cwd`, `model?`, `effort?`). `WorkflowOptions` is deliberately not handed to a step: it
  also carries the adapter, the iteration limit and the session timeout, which belong to the session layer, the run
  policy and the factory respectively. Keeping the step's view narrow keeps agent identity out of `workflow/` (AC-007).
- **Classes are allowed (D1)** where a component has collaborators or state (`WorkflowExecutor`,
  `SessionExecutor`, the factory, `ConsoleReporter`, `CodingStep`, `AgentRegistry`). Results and events stay
  discriminated unions, following `doc/CONVENTIONS.md`.

## Risks

- **Interim states.** Old modules are adapted to new types before they are deleted, for example `runner.ts`
  consuming the new `SessionResult` or `CodingStep`. Each task must leave them fully covered or delete them.
- **Missed edge cases when unit tests move.** `runner.test.ts` and `protocol.test.ts` hold classification and parser
  cases that AC-015 requires to be preserved. Every case must have an equivalent in the new tests before the old file
  is deleted.
- **Stale `dist/` files.** The build does not clean `dist/`, so old `dist/runner.js` and similar files may linger
  locally. They are harmless because nothing imports them. Do not rely on them.
- **`SessionExecutor` lifetime is unresolved.** The flow above creates one per iteration, but every setting the
  factory holds (interruption signal, session timeout, grace period) is run-wide, and no per-session mutable state has
  been identified. If it is stateless per run it can be created once, and `CodingStep` becomes a run-scoped object
  whose `execute` takes only run-wide values. Per-iteration is the conservative default here; confirm when the session
  layer lands.
