import type { WorkflowStepHandlerContext } from "./workflow-step-handler-context.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";
import type { WorkflowStepHandler } from "./workflow-step-handler.js";

/** The session produced no valid result: reports the error and asks the executor to retry the iteration. */
export class WorkflowStepSessionFailedHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, { type: "SessionFailed" }>
> {
  /** @inheritdoc */
  handle(result: Extract<WorkflowStepResult, { type: "SessionFailed" }>, context: WorkflowStepHandlerContext): void {
    context.publish({
      type: "SessionExecutionErrorOccurred",
      iteration: context.iteration,
      detail: result.detail,
      stderrTail: result.stderrTail,
    });
    context.retryLastStep({
      detail: result.detail,
      stderrTail: result.stderrTail,
    });
  }
}
