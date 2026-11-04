import type { TaskMetadata } from "./result-block.js";

/** Immutable notifications published by the WorkflowExecutor, discriminated by `type`. */
export type WorkflowEvent =
  | { readonly type: "WorkflowStarted"; readonly maxIterations: number }
  | { readonly type: "IterationStarted"; readonly iteration: number; readonly limit: number; readonly retry: boolean }
  | { readonly type: "StepExecutionStarted"; readonly iteration: number; readonly stepName: string }
  | { readonly type: "StepExecutionFinished"; readonly iteration: number; readonly task: Readonly<TaskMetadata> }
  | {
      readonly type: "StepExecutionFailed";
      readonly iteration: number;
      readonly failureSummary: string;
      readonly task: Readonly<TaskMetadata>;
    }
  | {
      readonly type: "StepExecutionBlocked";
      readonly iteration: number;
      readonly blockerText: string;
      readonly task: Readonly<TaskMetadata>;
    }
  | {
      readonly type: "StepExecutionRetried";
      readonly iteration: number;
      readonly limit: number;
      readonly previousError: string;
    }
  | {
      readonly type: "SessionExecutionErrorOccurred";
      readonly iteration: number;
      readonly detail: string;
      readonly stderrTail: readonly string[];
    }
  | { readonly type: "IterationFinished"; readonly iteration: number; readonly outcome: string }
  | TerminalWorkflowEvent;

/** The one event that ends a run; it is both published and returned by `WorkflowExecutor.run()`. */
export type TerminalWorkflowEvent =
  | { readonly type: "WorkflowFinished"; readonly task: Readonly<TaskMetadata> }
  | { readonly type: "WorkflowBlocked"; readonly blockerText: string; readonly task: Readonly<TaskMetadata> }
  | { readonly type: "WorkflowFailed"; readonly detail: string; readonly stderrTail: readonly string[] }
  | { readonly type: "WorkflowTimedOut"; readonly seconds: number }
  | { readonly type: "WorkflowInterrupted" }
  | { readonly type: "MaxIterationsReached"; readonly limit: number };
