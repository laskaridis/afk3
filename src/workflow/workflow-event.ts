import type { TaskMetadata } from "./result-block.js";

export type WorkflowStarted = {
  readonly type: "WorkflowStarted";
  readonly maxIterations: number;
};

export type IterationStarted = {
  readonly type: "IterationStarted";
  readonly iteration: number;
  readonly limit: number;
  readonly retry: boolean;
};

export type StepExecutionStarted = {
  readonly type: "StepExecutionStarted";
  readonly iteration: number;
  readonly stepName: string;
};

export type StepExecutionFinished = {
  readonly type: "StepExecutionFinished";
  readonly iteration: number;
  readonly task: Readonly<TaskMetadata>;
};

export type StepExecutionFailed = {
  readonly type: "StepExecutionFailed";
  readonly iteration: number;
  readonly failureSummary: string;
  readonly task: Readonly<TaskMetadata>;
};

export type StepExecutionBlocked = {
  readonly type: "StepExecutionBlocked";
  readonly iteration: number;
  readonly blockerText: string;
  readonly task: Readonly<TaskMetadata>;
};

export type StepExecutionRetried = {
  readonly type: "StepExecutionRetried";
  readonly iteration: number;
  readonly limit: number;
  readonly previousError: string;
};

export type SessionExecutionErrorOccurred = {
  readonly type: "SessionExecutionErrorOccurred";
  readonly iteration: number;
  readonly detail: string;
  readonly stderrTail: readonly string[];
};

export type IterationFinished = {
  readonly type: "IterationFinished";
  readonly iteration: number;
  readonly outcome: string;
};

export type WorkflowFinished = {
  readonly type: "WorkflowFinished";
  readonly task: Readonly<TaskMetadata>;
};

export type WorkflowBlocked = {
  readonly type: "WorkflowBlocked";
  readonly blockerText: string;
  readonly task: Readonly<TaskMetadata>;
};

export type WorkflowFailed = {
  readonly type: "WorkflowFailed";
  readonly detail: string;
  readonly stderrTail: readonly string[];
};

export type WorkflowTimedOut = {
  readonly type: "WorkflowTimedOut";
  readonly seconds: number;
};

export type WorkflowInterrupted = {
  readonly type: "WorkflowInterrupted";
};

export type MaxIterationsReached = {
  readonly type: "MaxIterationsReached";
  readonly limit: number;
};

/** The one event that ends a run; it is both published and returned by `WorkflowExecutor.run()`. */
export type TerminalWorkflowEvent =
  WorkflowFinished | WorkflowBlocked | WorkflowFailed | WorkflowTimedOut | WorkflowInterrupted | MaxIterationsReached;

/** Immutable notifications published by the WorkflowExecutor, discriminated by `type`. */
export type WorkflowEvent =
  | WorkflowStarted
  | IterationStarted
  | StepExecutionStarted
  | StepExecutionFinished
  | StepExecutionFailed
  | StepExecutionBlocked
  | StepExecutionRetried
  | SessionExecutionErrorOccurred
  | IterationFinished
  | TerminalWorkflowEvent;
