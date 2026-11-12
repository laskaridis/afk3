# Architecture

This project follows a strict layering architecture: `[User] -> [CLI]-> [Workflow Execution] -> [Step Execution] -> [SessionExecution] -> [Coding Agent]`. Dependencies are strictly from upper to lower layers, the inverse is not allowed. Workflow Execution layer publishes events to notify external observers (i.e. the Reporter). `WorkflowExecutor.run()` also returns the terminal event, which the CLI maps to the exit code.

## Tech stack

- TypeScript compiled by `tsc`
- `vitest` for testing
- `pnpm` package manager
- GitHub Actions for CICD with CodeQL static scanning and Dependabot
- `dependency-cruiser` for architecture fitness functions

## Modules

Dependencies point only downwards: `cli/` -> `reporting/` -> `workflow/` -> `session/` -> `agents/` (enforced by `pnpm depcheck`, see `.dependency-cruiser.cjs`). Afferent dependencies are the modules that import a module; efferent dependencies are the modules it imports.

### `cli/`

**Responsibilities:**

- Parses and validates command-line options, resolves the launch prompt (argument, `--prompt-file` or stdin) and owns the exit codes.
- Wires the runtime components together (`workflow/`, `session/`, `reporting/`, `agents/`), runs the workflow and maps its terminal result to the process exit code.
- Handles process signals (SIGINT, SIGTERM, SIGHUP) and turns them into an abort signal.

**Afferent dependencies:**

- None (the `src/cli.ts` entry point only runs it)

**Efferent dependencies:**

- `workflow/`
- `session/`
- `reporting/`
- `agents/`

### `workflow/`

**Responsibilities:**

- Controls the iterative workflow: iteration policy, retries, limits, and interpretation of each step's result.
- Builds the agent prompt for each step and parses the agent's final response (`<afk-harness-result>` block) into a step result.
- Publishes `WorkflowEvent`s to `WorkflowObserver`s and returns the terminal event.

**Afferent dependencies:**

- `cli/`
- `reporting/` (only the event and observer types)

**Efferent dependencies:**

- `session/`
- `agents/`

### `session/`

**Responsibilities:**

- Runs one non-interactive agent process for a prompt: spawns it, captures stdio and the final message, and enforces timeouts and termination (SIGTERM, then SIGKILL).
- Reports the outcome of the process as a `SessionResult`.
- Creates `SessionExecutor`s with consistent timeout and abort-signal configuration.

**Afferent dependencies:**

- `cli/`
- `workflow/`

**Efferent dependencies:**

- `agents/`

### `reporting/`

**Responsibilities:**

- Turns workflow events into the `[afk]` status lines written to the output sink (stderr).
- Knows nothing about sessions or agents and only observes the workflow through the `WorkflowObserver` contract.

**Afferent dependencies:**

- `cli/`

**Efferent dependencies:**

- `workflow/` (only the event and observer types)

### `agents/`

**Responsibilities:**

- Holds everything specific to a coding agent: how to launch Codex and Claude Code, and how to retrieve each one's final message.
- Exposes the `AgentAdapter` contract and the `AgentRegistry`; the concrete adapters are private to the module.

**Afferent dependencies:**

- `cli/`
- `workflow/`
- `session/`

**Efferent dependencies:**

- None

## Components

### `cli/CLI` (concrete class)

**Responsibilities:**

- Acts as the main user interface and trigger point for the workflow.
- Uses `agents/AgentRegistry` to retrieve the concrete `agents/AgentAdapter` for the agent specified by the user.
- Parses user's input options and provided launch prompt into runtime components, `workflow/WorkflowOptions`, `workflow/LaunchPrompt` and `reporting/Reporter`.
- Instantiates `workflow/WorkflowExecutor` and wires all its dependencies.
- Instantiates a concrete `reporting/Reporter` and subscribes it to `workflow/WorkflowExecutor`.
- Runs the workflow with `WorkflowExecutor.run()` and maps the terminal result it returns (a terminal `workflow/WorkflowEvent`) to the process exit code. The CLI is not a `workflow/WorkflowObserver`.

**Collaborators:**

- Creates `workflow/WorkflowOptions`
- Creates concrete `reporting/Reporter`
- Creates `workflow/LaunchPrompt`
- Creates `session/SessionExecutorFactory`
- Retrieves concrete `agents/AgentAdapter` from `agents/AgentRegistry`
- Creates and runs `workflow/WorkflowExecutor`, and uses the terminal result returned by `run()`

### `workflow/LaunchPrompt` (concrete class)

**Responsibilities:**

- Builds the initial launch prompt for the workflow.

**Collaborators:**

- Created by `cli/CLI`
- Used by `workflow/WorkflowExecutor`

### `workflow/WorkflowOptions` (value class)

**Responsibilities:**

- Encapsulates the configuration of a specific run as indicated by the user command line, such as: concrete `agents/AgentAdapter` and model selected, max number of iterations, reasoning effort, current working directory.

**Collaborators:**

- Created by `cli/CLI`
- Uses `agents/AgentAdapter`
- Used by `workflow/WorkflowExecutor`

### `workflow/WorkflowExecutor` (concrete class)

**Responsibilities:**

- Controls the entire workflow execution as a sequence of iterative steps.
- Executes `workflow/WorkflowStep`s in the correct order using a `session/SessionExecutor`
- Dispatches each `workflow/WorkflowStepResult` to the `workflow/WorkflowStepHandler` for its type, and enforces the iteration policy (iteration limit, one retry per consecutive session failure) on what the handlers ask for.
- Implements `workflow/step-handlers/WorkflowStepHandlerContext`, exposing only iteration, timeout information, event publishing and transition requests to handlers; full workflow options remain internal.
- Publishes `workflow/WorkflowEvent`s:
  - `WorkflowStarted`
  - `IterationStarted`
  - `StepExecutionStarted`
  - `StepExecutionFinished`
  - `StepExecutionFailed`
  - `StepExecutionBlocked`
  - `StepExecutionRetried`
  - `SessionExecutionErrorOccurred`
  - `IterationFinished`
  - `WorkflowFinished`
  - `WorkflowInterrupted`
  - `WorkflowBlocked`
  - `WorkflowFailed`
  - `WorkflowTimedOut`
  - `MaxIterationsReached`

**Collaborators:**

- Creates `workflow/WorkflowStep`s.
- Creates `session/SessionExecutor`s with the appropriate `agents/AgentAdapter` and uses them to execute `workflow/WorkflowStep`s.
- Uses `workflow/WorkflowStepHandler`s to handle `workflow/WorkflowStepResult`s.
- Uses `workflow/WorkflowOptions`

### `workflow/WorkflowStep` (interface)

**Responsibilities:**

- Controls the execution of a single step in the workflow, including prompt markdown, the `<afk-harness-result>`
  block format and nonce generation.
- Builds the agent prompt for the specific step.
- Executes the step using the specified `session/SessionExecutor` providing the necessary prompt.
- Parsing the final result of the `session/SessionExecutor` into a `workflow/WorkflowStepResult`

**Collaborators:**

- Created by `workflow/WorkflowExecutor`
- Uses `session/SessionExecutor`
- Creates `workflow/WorkflowStepResult` and passes it back to `workflow/WorkflowExecutor`

**Concrete implementations:**

- `CodingStep`

### `workflow/WorkflowStepHandler` (interface)

**Responsibilities:**

- Handles a `workflow/WorkflowStepResult`.
- Is independent of any specific step. It never decides what comes next, just notifies `workflow/WorkflowExecutor` through `continueWorkflow()`, `retryLastStep()` or `endWorkflow()`.

**Collaborators:**

- Receives `workflow/step-handlers/WorkflowStepHandlerContext` instead of the concrete executor. The dependency-cruiser rules reject handler-to-executor dependencies and all circular imports, including type-only cycles.
- Used by `workflow/WorkflowExecutor`

**Concrete implementations (`workflow/step-handlers/`):**

- `WorkflowStepContinueHandler`,
- `WorkflowStepFinishedHandler`
- `WorkflowStepFailedHandler`
- `WorkflowStepBlockedHandler`
- `WorkflowStepSessionFailedHandler`
- `WorkflowStepTimeoutHandler`
- `WorkflowStepInterruptedHandler`

### `workflow/step-handlers/WorkflowStepHandlerContext` (interface)

**Responsibilities:**

- Exposes only iteration, configured session timeout, event publication, and continue/retry/end transition requests to step-result handlers.
- Keeps handlers independent of the concrete executor and its internal state.

**Collaborators:**

- Implemented by `workflow/WorkflowExecutor`.
- Used by `workflow/step-handlers/WorkflowStepHandler` implementations.

### `workflow/WorkflowStepResult` (value class)

**Responsibilities:**

- Communicates the result of a step execution back the workflow executor to handle next action.
- Encapsulates the step execution outcome details:
  - Outcome:
    - Continue - successful execution of the step and workflow should proceed.
    - Finished - successful execution of the step and the workflow should terminate.
    - StepFailed - unsuccessful execution of the step but progress may be possible.
    - SessionFailed - unsuccessful execution of the step because of an underlying session execution failure.
    - Blocked - unsuccessful execution of the step and progress is not possible.
    - Timeout - undefined execution of the step as process timed out.
    - Interrupted - undefined execution of the step because of a user interruption.
  - Failure summary - if StepFailed
  - Failure detail and stderr tail - if SessionFailed
  - Blocker text (the unblocking condition) - if Blocked.
  - Task ID and task list plan file path, carried as parsed from the result block (Continue, Finished, StepFailed, Blocked).
- The specification file path and the verification findings file path are intentionally left out: adding them would change the `<afk-harness-result>` block contract in `src/workflow/steps/coding-step.md`.

**Collaborators:**

- Created by concrete `workflow/WorkflowStep`
- Used by `workflow/WorkflowExecutor`

### `workflow/WorkflowObserver` (interface)

**Responsibilities:**

- Interface implemented from all classes observing workflows for events.

**Collaborators:**

- Implemented by `reporting/Reporter`
- Used by `workflow/WorkflowExecutor` to notify observers about `workflow/WorkflowEvent`s.

### `workflow/WorkflowEvent` (value class)

**Responsibilities:**

- Immutable notification that something happened during a workflow execution. It carries data only and has no behavior.
- Identified by a discriminating `type`, one per event listed under `workflow/WorkflowExecutor`
  (e.g. `WorkflowStarted`, `IterationStarted`, `StepExecutionFinished`, `WorkflowBlocked`, `MaxIterationsReached`).
- Carries everything observers need to react without calling back into the executor, as relevant to the event type:
  - Iteration number and the configured iteration limit.
  - Name of the step being executed.
  - Step outcome details from the `workflow/WorkflowStepResult`: task ID, failure details, unblocking condition,
    and the task list plan file path.
  - Session failure details, for `SessionExecutionErrorOccurred`.
  - Timeout and interruption details, for `WorkflowTimedOut` and `WorkflowInterrupted`.
- Is a one-way notification: observers cannot change workflow control flow through an event.

**Collaborators:**

- Created and published by `workflow/WorkflowExecutor`
- Delivered to `workflow/WorkflowObserver`s
- Carries data taken from `workflow/WorkflowStepResult`

### `session/SessionExecutorFactory` (concrete class)

**Responsibilities:**

- Creates `session/SessionExecutor` instances
- Ensures correct propagation of the `AbortSignal` from `cli/CLI` to created `session/SessionExecutor`s.
- Ensures timeout is correctly and consistently configured to `session/SessionExecutor`s.

**Collaborators:**

- Created by `cli/CLI`
- Used by `workflow/WorkflowExecutor` to create `session/SessionExecutor` instances.

### `session/SessionExecutor` (concrete class)

**Responsibilities:**

- Abstracts the execution of a `workflow/WorkflowStep`s prompt against a physical coding agent
- Encapsulates all the implementation details surrounding the agent's execution, such as forking the system process, running the appropriate coding agent based on the selected `agents/AgentAdapter` with the correct arguments, managing stdio streams including any buffering, temp files used by agents, handling timeouts, SIGTERM and SIGKILL.

**Collaborators:**

- Created by `workflow/WorkflowExecutor` via `session/SessionExecutorFactory`
- Used by `workflow/WorkflowStep`
- Uses `agents/AgentAdapter` to understand which agent to invoke and retrieve the final message.

### `session/SessionResult` (value class)

**Responsibilities:**

- Communicate back to the caller the result of a session's execution:
  - launch failed (`launch-failed`)
  - timed out (`timed-out`)
  - interrupted (`interrupted`)
  - exited unsuccessfully (`exited-unsuccessfully`): terminated by a signal, an agent-reported error or a non-zero exit code
  - missing final message (`missing-final-message`)
  - invalid final message (`invalid-final-message`)
  - success (`success`)
- Every kind except launch failed, timed out and interrupted carries the stderr tail; the failure kinds carry the failure detail.
- Encapsulates all necessary state that the call needs to interpret correctly the result of an execution.

**Collaborators:**

- Created by `session/SessionExecutor`
- Used by concrete `workflow/WorkflowStep`

### `agents/AgentAdapter` (interface)

**Responsibilities:**

- Defines an common interface for all coding agents that `session/SessionExecutor` can use without knowing any agent specific details
- Knows how to launch the specific agent, including building the command executable with the command line arguments from cwd, model and effort.
- Knows how to retrieve the final message from the captured executor.

**Collaborators:**

- Retrieved by `cli/CLI`
- Concrete instance used by `session/SessionExecutor` to launch the specific coding agent and retrieve its final message

**Concrete implementations:**

- `agents/CodexAdapter`
- `agents/ClaudeAdapter`

### `agents/AgentRegistry` (concrete class)

**Responsibilities**:

- Holds all supported concrete `agents/AgentAdapter` implementations, lists their names and names the default agent.

**Collaborators:**

- Used by `CLI` to retrieve the concrete `agents/AgentAdapter` specified from the user by name

## `reporting/Reporter` (interface)

**Responsibilities:**

- Reports harness progress and useful information back to the user.

**Collaborators:**

- Concrete instance created by `cli/CLI`
- Subscribes to events published by `workflow/WorkflowExecutor` to report back to the user.

**Concrete implementations**:

- `reporting/ConsoleReporter` to report harness progress in the console.

## Top-level module packages

- `cli` includes code related to the CLI layer: option parsing, launch-prompt resolution, wiring, signal handling and exit codes (`src/cli.ts` is the thin entry point that imports only `src/cli/`).
- `agents` includes code related to concrete `agents/AgentAdapter`s and `agents/AgentRegistry`.
- `workflow` includes code related to workflow execution layer, including concrete `workflow/WorkflowStep`s and their prompts.
- `session` includes code related to session execution layer.
- `reporting` includes code related to progress reporting layer.

## Out of scope

### Modelling the `WorkflowDefinition` independently of the `WorkflowExecutor`

`workflow/WorkflowExecutor` currently specifies both what the workflow is and how it should be executed. We could separate further this responsibilities by introducing a `workflow/WorkflowDefinition` abstraction to define the workflow structure (i.e. which task comes first, which comes next) and inject that into the `workflow/WorkflowExecutor`. Although this may be a point to refactor in the future as the workflow becomes more complicated, for now we will intentionally keep it as is.
