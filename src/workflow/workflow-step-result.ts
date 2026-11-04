import type { TaskMetadata } from "./result-block.js";

/** What one workflow step ended as, for the executor. Task metadata is carried as parsed. */
export type WorkflowStepResult =
  | ({ type: "Continue" } & TaskMetadata)
  | ({ type: "Finished" } & TaskMetadata)
  | ({ type: "StepFailed"; failureSummary: string } & TaskMetadata)
  | ({ type: "Blocked"; blockerText: string } & TaskMetadata)
  | { type: "SessionFailed"; detail: string; stderrTail: string[] }
  | { type: "Timeout" }
  | { type: "Interrupted" };
