import type { WorkflowEvent } from "./workflow-event.js";

/** A one-way listener: its return value is ignored and it cannot change the run. */
export interface WorkflowObserver {
  onEvent(event: WorkflowEvent): unknown;
}
