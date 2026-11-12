import type { WorkflowStepResult } from "../workflow-step-result.js";
import type { WorkflowStepHandlerContext } from "./workflow-step-handler-context.js";

/**
 * Handles one kind of `WorkflowStepResult` using a limited workflow context.
 *
 * A handler owns everything that happens because of its result: the step-level events it publishes and the outcome it
 * asks for. It never decides what comes next on its own. It reports through `publish()`,
 * `retryLastStep()` or `endWorkflow()` (or by doing nothing, which moves on to the next iteration), and the executor applies the policy.
 */
export interface WorkflowStepHandler<R extends WorkflowStepResult = WorkflowStepResult> {
  /**
   * Handles `result`, the outcome of the iteration `context.iteration`.
   *
   * @param result The step result this handler is registered for.
   * @param context Limited workflow context for events and transition requests.
   */
  handle(result: R, context: WorkflowStepHandlerContext): void;
}
