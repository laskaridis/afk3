import type { TaskMetadata } from "./result-block.js";

/** The task a step reports on; both fields are always present for the outcomes that carry it. */
type ReportedTask = { task_id: string; task_plan_file: string };

/** What one workflow step ended as, for the executor. Task metadata is carried as parsed. */
export type WorkflowStepResult =
  /** A candidate was committed; `revision` is its commit identifier, if the agent reported one. */
  | ({ type: "TaskImplemented"; revision?: string | null } & ReportedTask)
  /** The agent found no pending task; the run ends. */
  | ({ type: "NoMoreTasks" } & TaskMetadata)
  /** The verification agent accepted the candidate and tasks remain. */
  | ({ type: "VerificationPassed" } & ReportedTask)
  /** The verification agent accepted the candidate and no tasks remain; the run ends. */
  | ({ type: "FeatureVerified" } & ReportedTask)
  /** The verification agent rejected the candidate; `findingsFile` holds its notes. */
  | ({ type: "VerificationFailed"; failureSummary: string; findingsFile: string } & ReportedTask)
  /** The agent cannot proceed without outside help; the run ends. */
  | ({ type: "Blocked"; blockerText: string } & TaskMetadata)
  /** The session did not produce a valid result; `stderrTail` holds the last stderr lines, if any. */
  | { type: "SessionFailed"; detail: string; stderrTail: string[] }
  /** The session exceeded its time limit. */
  | { type: "Timeout" }
  /** The user interrupted the session. */
  | { type: "Interrupted" };
