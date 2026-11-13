import type { TaskMetadata } from "./result-block.js";

/** What one workflow step ended as, for the executor. Task metadata is carried as parsed. */
export type WorkflowStepResult =
  /** A candidate was committed; `revision` is its commit identifier, if the agent reported one. */
  | ({ type: "TaskImplemented"; revision?: string | null } & TaskMetadata)
  /** The agent found no pending task; the run ends. */
  | ({ type: "NoMoreTasks" } & TaskMetadata)
  /** The agent cannot proceed without outside help; the run ends. */
  | ({ type: "Blocked"; blockerText: string } & TaskMetadata)
  /** The session did not produce a valid result; `stderrTail` holds the last stderr lines, if any. */
  | { type: "SessionFailed"; detail: string; stderrTail: string[] }
  /** The session exceeded its time limit. */
  | { type: "Timeout" }
  /** The user interrupted the session. */
  | { type: "Interrupted" };
