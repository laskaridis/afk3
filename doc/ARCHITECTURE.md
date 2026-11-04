# Architecture

This project follows a strict layering architecture: `[User] -> [CLI]-> [Workflow Execution] -> [Step Execution] -> [SessionExecution] -> [Coding Agent]`. Dependencies are stricly from upper to lower layers, the inverse is not allowed. Workflow Execution layer publishes events to notify external observers (i.e. CLI and Reporter).

## Tech stack

- TypeScript compiled by `tsc`
- `vitest` for testing
- `pnpm` package manager
- GitHub Actions for CICD with CodeQL static scanning and Dependabot

## Components

### `cli/CLI` (concrete class)

**Responsibilities:**
- Acts as the main user interface and trigger point for the workflow.
- Uses `agent/AgentRegistry` to retrieve the concrete `agent/AgentAdapter` for the agent specified by the user.
- Parses user's input options and provided launch prompt into runtime components, `workflow/WorkflowOptions`, `workflow/LaunchPrompt` and `reporter/Reporter`. 
- Instantiates `workflow/WorfklowExecutor` and wires all its dependencies.
- Observes `workflow/WorfklowExecutor`.
- Instantiates a concrete `reporter/Reporter` that observes `workflow/WorkflowExecutor`.
- Executes the workflow lifecycle.

**Collaborators:**
- Creates `workflow/WorkflowOptions` 
- Creates concrete `reporter/Reporter`
- Creates `workflow/LaunchPrompt`
- Creates `session/SessionExecutorFactory`
- Retrieves concrete `agent/AgentAdapter` from `agent/AgentRegistry`
- Creates, executes and observes `workflow/WorfklowExecutor` 

### `workflow/LaunchPrompt` (concerete class)

**Responsibilities:**
- Builds the initial launch prompt for the workflow.

**Collaborators:**
- Created by `cli/CLI`
- Used by `workflow/WorfklowExecutor`

### `workflow/WorkflowOptions` (value class)

**Responsibiltiies:**
- Encapsulates the condiguration of a specific run as indicated by the user command line, such as: concrete `adapter/AgentAdapter` and model selected, max number of iterations, reasoning effort, current working directory.

**Collaborators:** 
- Created by `cli/CLI`
- Uses `adapter/AgentAdapter`
- Used by `workflow/WorfklowExecutor`

### `workflow/WorfklowExecutor` (concrete class)

**Responsibilities:**
- Controls the entire workflow execution as a sequence of iterative steps.
- Executes `workflow/WorkflowStep`s in the correct order using a `session/SessionExecutor`
- Inspects `workflow/WorkflowStepResult`s and handles workflow completion, step failures blocking conditions and iteration policy enforcement. 
- Publishes `workflow/WorkflowEvent`s:
  * `WorkflowStarted`
  * `IterationStarted`
  * `StepExecutionStarted`
  * `StepExecutionFinished` 
  * `StepExecutionFailed`
  * `StepExecutionBlocked`
  * `StepExecutionRetried`
  * `SessionExecutionErrorOccured`
  * `IterationFinished`
  * `WorkflowFinished`
  * `WorkflowInterrupted`
  * `WorkflowBlocked`
  * `WorfklowFailed`
  * `WorkflowTimedOut`
  * `MaxIterationsReached`

**Collaboarators:**
- Creates `workflow/WorkflowStep`s.
- Creates `session/SessionExecutor`s with the appropriate `agent/AgentAdapter` and uses them to execute `workflow/WorkflowStep`s.
- Uses `workflow/WorkflowStepResult`s to decides control.
- Uses `workflow/WorkflowOptions`

### `workflow/WorkflowStep` (interface)

**Responsibilities:**
- Controls the execution of a single step in the workflow, including prompt markdown, the `<afk-harness-result>`
  block format and nonce generation.
- Builds the agent prompt for the specific step.
- Executes the step using the specified `session/SessionExecutor` providing the neccessary prompt.
- Parsing the final result of the `session/SessionExecutor` into a `workflow/WorkflowStepResult`

**Collaborators:**
- Created by `workflow/WorfklowExecutor`
- Uses `session/SessionExecutor`
- Creates `workflow/WorkflowStepResult` and passes it back to `workflow/WorfklowExecutor`

**Concrete implementations:**
- `CodingStep`

### `workflow/WorkflowStepResult` (value class)

**Responsibilities:**
- Communicates the result of a step execution back the workflow executor to handle next action.
- Encapsulates the step execution outcome details:
  - Outcome:
    * Continue - successful execution of the step and workflow should proceed.
    * Finished - successful execution of the step and the workflow should terminate.
    * StepFailed - unsuccessful execution of the step but progress may be possible.
    * SessionFailed - unsuccessful execution of the steb because of an underlying session execution failure. 
    * Blocked - unuccessful execution of the step and progress is not possible.
    * Timeout - undefined execution of the step as process timed out.
    * Interrupted - undefined execution of the step because of a user interruption.
  - Failure details - if Failed
  - Unblocking condintion - if Blocked.
  - Task ID
  - Specification file path.
  - Task list plan file path.
  - Verification findings file path

**Colaborators:**
- Created by concrete `workflow/WorkflowExecutionStep`
- Used by `workflow/WorfklowExecutor`

### `workflow/WorkflowObserver` (interface)

**Responsibiities:**
- Interface implemented from all classes observing workflows for events.

**Collaborators:**
- Implemented by `cli/CLI`
- Implemented by `reporter/Reporter`
- Used by `workflow/WorkflowExecutor` to notify observers about `workflow/WorkflowEvent`s.

### `workflow/WorkflowEvent` (value class)

**Responsibilities:**
- Immutable notification that something happened during a workflow execution. It carries data only and has no behavior.
- Identified by a discriminating `type`, one per event listed under `workflow/WorfklowExecutor`
  (e.g. `WorkflowStarted`, `IterationStarted`, `StepExecutionFinished`, `WorkflowBlocked`, `MaxIterationsReached`).
- Carries everything observers need to react without calling back into the executor, as relevant to the event type:
  - Iteration number and the configured iteration limit.
  - Name of the step being executed.
  - Step outcome details from the `workflow/WorkflowStepResult`: task ID, failure details, unblocking condition,
    and the specification, task list plan and verification findings file paths.
  - Session failure details, for `SessionExecutionErrorOccured`.
  - Timeout and interruption details, for `WorkflowTimedOut` and `WorkflowInterrupted`.
- Is a one-way notification: observers cannot change workflow control flow through an event.

**Collaborators:**
- Created and published by `workflow/WorfklowExecutor`
- Delivered to `workflow/WorkflowObserver`s
- Carries data taken from `workflow/WorkflowStepResult`

### `session/SessionExecutorFactory` (concrete class)

**Responsibilities:**
- Creates `sesison/SessionExecutor` instances 
- Ensures correct propagation of the `AbortSignal` from `cli/CLI` to created `cli/SessionExecutor`s.
- Ensures timeout is correctly and consistently configured to `cli/SessionExecutor`s.

**Collaborators:**
- Created by `cli/CLI`
- Used by `workflow/WorfklowExecutor` to create `session/SessionExecutor` instances.

### `session/SessionExecutor` (concrete class)

**Responsibilities:**
- Abstracts the execution of a `workflow/WorfklowStep`s prompt aganst a physical coding agent
- Encapsulates all the implmentation details surrounding the agent's execution, such as forking the system process, running the appropriate coding agent based on the selected `agent/AgentAdapter` with the correct arguments, managing stdio streams including any buffering, temp files used by agents, handling timeouts, SIGTERM and SIGKILL.

**Collaborators:**
- Created by `workflow/WorfklowExecutor` via `session/SessionExecutorFactory`
- Used by `workflow/WorkflowExecutionStep`
- Uses `agent/AgentAdapter` to understand which agent to invoke and retrieve the final message.

### `session/SessionResult` (value class)

**Responsibilties:**
- Communicate back to the caller the result of a session's execution:
  * `LaunchFailed`
  * `TimedOut`
  * `Interruped`
  * `FailMissingResponse`
  * `FaileInvalidResponse`
  * `Success`
- Encapsulates all neccessary state that the call needs to interpret correctly the result of an execution.

**Collaborators:**
- Created by `session/SessionExecutor`
- Used by concrete `workflow/WorkflowExecutionStep`

### `adapter/AgentAdapter` (interface)

**Responsibilities:** 
- Defines an common interface for all coding agents that `session/SessionExecutor` can use without knowing any agent specific details
- Knows how to launch the specific agent, including building the command executable with the command line arguments from cwd, model and effort.
- Knows how to retrieve the final message from the captured executor.

**Collaborators:**
- Retrieved by `cli/CLI`
- Concrete instance used by `session/SessionExecutor` to launche the specific coding agent and retrieve 

**Concrete implementations:**
- `adapter/CodexAdapter`
- `adapter/ClaudeAdapter`

### `agent/AgentRegistry` (concrete class)

**Responsibilities**:
- Placeholder of all supported concrete `agent/AgentRegistry` adapter implementations.

**Collaborators:**
- Used by `CLI` to retrieve the concrete `agent/AgentAdapter` specified from the user by name 

## `reporter/Reporter` (interface)

**Responsibilities:**
- Reports harness progress and useful information back to the user.

**Collaborators:**
- Concrete instance created by `cli/CLI`
- Subscribes to events published by `workflow/WorfklowExecutor` to report back to the user.

**Concrete implementations**:
- `reporter/ConsoleReporter` to report harness progrees in the console.

## Top-level module packages

- `cli` includes code related to CLI layer.
- `agents` includes code related to concrete `agent/AgentAdapter`s and `agent/AgentRegistry`.
- `worfklow` includes code related to worklfow execution layer, including concrete `workflow/WorkflowExecutionStep`s and their prompts.
- `session` includes code related to session execution layer.
- `reporting` includes code related to progress reporting layer.

## Out of scope

### Modelling the `WorkflowDefinition` independently of the `WorkflowExecutor`

`workflow/WorfklowExecutor` currently specifies both what the workflow is and how it should be executed. We could separate further this responsibilities by introducing a `workflow/WorfklowDefinition` abstraction to define the workflow structure (i.e. which task comes first, which comes next) and inject that into the `workflow/WorfklowExecutor`. Althought his may be a point to refactor in the future as the workflow becomes more complicated, for now we will intentionally keep it as is.
