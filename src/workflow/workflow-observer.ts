import type { WorkflowEvent } from "./workflow-event.js";

/**
 * A one-way listener for the events published by the `WorkflowExecutor`.
 *
 * Observers are registered with `WorkflowExecutor.subscribe()` and only watch the run (for example to report progress);
 * they cannot influence it.
 */
export interface WorkflowObserver {
  /**
   * Called once for every event the executor publishes, in the order the events occur.
   *
   * The call is synchronous and the executor waits for it to return, so implementations should be quick. The event is
   * frozen and must not be mutated. Nothing is returned, and errors thrown here are not caught by the executor.
   */
  onEvent(event: WorkflowEvent): void;
}
