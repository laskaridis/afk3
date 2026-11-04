import type { TaskMetadata } from "./result-block.js";

/** What one workflow step ended as, for the executor. Task metadata is carried as parsed. */
export type WorkflowStepResult =
  /** The task is done but the feature is not: run another iteration. */
  | ({ type: "Continue" } & TaskMetadata)
  /** The feature is complete. */
  | ({ type: "Finished" } & TaskMetadata)
  /** The agent reported the task failed; the run goes on. */
  | ({ type: "StepFailed"; failureSummary: string } & TaskMetadata)
  /** The agent cannot proceed without outside help; the run ends. */
  | ({ type: "Blocked"; blockerText: string } & TaskMetadata)
  /** The session did not produce a valid result; `stderrTail` holds the last stderr lines, if any. */
  | { type: "SessionFailed"; detail: string; stderrTail: string[] }
  /** The session exceeded its time limit. */
  | { type: "Timeout" }
  /** The user interrupted the session. */
  | { type: "Interrupted" };
