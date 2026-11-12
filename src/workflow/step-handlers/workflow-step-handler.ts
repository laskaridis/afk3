import type { WorkflowStepResult } from "../workflow-step-result.js";
import type { WorkflowExecutor } from "../workflow-executor.js";

/**
 * Handles one kind of `WorkflowStepResult` for the `WorkflowExecutor`.
 *
 * A handler owns everything that happens because of its result: the step-level events it publishes and the outcome it
 * asks for. It never decides what comes next on its own. It reports back to the executor through `publish()`,
 * `retryLastStep()` or `endWorkflow()` (or by doing nothing, which moves on to the next iteration), and the executor applies the policy.
 */
export interface WorkflowStepHandler<R extends WorkflowStepResult = WorkflowStepResult> {
  /**
   * Handles `result`, the outcome of the iteration `executor.iteration`.
   *
   * @param result The step result this handler is registered for.
   * @param executor The executor running the iteration: the context to inspect and to delegate decisions to.
   */
  handle(result: R, executor: WorkflowExecutor): void;
}
