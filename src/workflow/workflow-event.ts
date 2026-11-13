import type { TaskMetadata } from "./result-block.js";

/** The run began. `maxIterations` is the iteration limit. */
export type WorkflowStarted = {
  readonly type: "WorkflowStarted";
  readonly maxIterations: number;
};

/** An iteration began (`iteration` of `limit`, counting from 1). Verification of its candidate happens inside it. */
export type IterationStarted = {
  readonly type: "IterationStarted";
  readonly iteration: number;
  readonly limit: number;
};

/** The step named `stepName` began in `iteration` (of `limit`). `retry` is true when it repeats the previous session after a failure. */
export type StepExecutionStarted = {
  readonly type: "StepExecutionStarted";
  readonly iteration: number;
  readonly stepName: string;
  readonly limit: number;
  readonly retry: boolean;
};

/** The step ended with a valid outcome that lets the run go on or ends it successfully; `task` is the task it reported. */
export type StepExecutionFinished = {
  readonly type: "StepExecutionFinished";
  readonly iteration: number;
  readonly stepName: string;
  readonly task: Readonly<TaskMetadata>;
};

/** The step reported a blocker, described in `blockerText`. */
export type StepExecutionBlocked = {
  readonly type: "StepExecutionBlocked";
  readonly iteration: number;
  readonly stepName: string;
  readonly blockerText: string;
  readonly task: Readonly<TaskMetadata>;
};

/** The session failed and `iteration` retries it; `previousError` is the earlier failure's detail. */
export type StepExecutionRetried = {
  readonly type: "StepExecutionRetried";
  readonly iteration: number;
  readonly stepName: string;
  readonly limit: number;
  readonly previousError: string;
};

/** A session failed; `detail` says how and `stderrTail` holds its last stderr lines, if any. */
export type SessionExecutionErrorOccurred = {
  readonly type: "SessionExecutionErrorOccurred";
  readonly iteration: number;
  readonly detail: string;
  readonly stderrTail: readonly string[];
};

/** The verification session accepted the candidate of `iteration`. */
export type VerificationPassed = {
  readonly type: "VerificationPassed";
  readonly iteration: number;
  readonly task: Readonly<TaskMetadata>;
};

/** The verification session rejected the candidate of `iteration`; this was verification attempt `attempt` of `limit` for the task. */
export type VerificationFailed = {
  readonly type: "VerificationFailed";
  readonly iteration: number;
  readonly attempt: number;
  readonly limit: number;
  readonly failureSummary: string;
  readonly findingsFile: string;
  readonly task: Readonly<TaskMetadata>;
};

/** An iteration ended; `outcome` names how. */
export type IterationFinished = {
  readonly type: "IterationFinished";
  readonly iteration: number;
  readonly outcome: string;
};

/** Terminal: the coding agent reported no pending task. */
export type WorkflowFinished = {
  readonly type: "WorkflowFinished";
  readonly task: Readonly<TaskMetadata>;
};

/** Terminal: the verification agent accepted the last candidate and reported that no task remains. */
export type WorkflowCompleted = {
  readonly type: "WorkflowCompleted";
  readonly task: Readonly<TaskMetadata>;
};

/** Terminal: the agent reported a blocker, described in `blockerText`. */
export type WorkflowBlocked = {
  readonly type: "WorkflowBlocked";
  readonly blockerText: string;
  readonly task: Readonly<TaskMetadata>;
};

/** Terminal: the session failed twice in a row; `detail` and `stderrTail` describe the last failure. */
export type WorkflowFailed = {
  readonly type: "WorkflowFailed";
  readonly detail: string;
  readonly stderrTail: readonly string[];
};

/** Terminal: a session exceeded its time limit of `seconds` (0 when unknown). */
export type WorkflowTimedOut = {
  readonly type: "WorkflowTimedOut";
  readonly seconds: number;
};

/** Terminal: the user interrupted the run. */
export type WorkflowInterrupted = {
  readonly type: "WorkflowInterrupted";
};

/** Terminal: `limit` iterations ran without a reported completion. */
export type MaxIterationsReached = {
  readonly type: "MaxIterationsReached";
  readonly limit: number;
};

/** Terminal: verification rejected `taskId` `limit` times, the configured maximum. */
export type VerificationLimitReached = {
  readonly type: "VerificationLimitReached";
  readonly limit: number;
  readonly taskId: string;
};

/** The one event that ends a run; it is both published and returned by `WorkflowExecutor.run()`. */
export type TerminalWorkflowEvent =
  | WorkflowFinished
  | WorkflowCompleted
  | WorkflowBlocked
  | WorkflowFailed
  | WorkflowTimedOut
  | WorkflowInterrupted
  | MaxIterationsReached
  | VerificationLimitReached;

/** Immutable notifications published by the WorkflowExecutor, discriminated by `type`. */
export type WorkflowEvent =
  | WorkflowStarted
  | IterationStarted
  | StepExecutionStarted
  | StepExecutionFinished
  | StepExecutionBlocked
  | StepExecutionRetried
  | SessionExecutionErrorOccurred
  | VerificationPassed
  | VerificationFailed
  | IterationFinished
  | TerminalWorkflowEvent;
