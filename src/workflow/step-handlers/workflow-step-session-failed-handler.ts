import type { WorkflowExecutor } from "../workflow-executor.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";
import type { WorkflowStepHandler } from "./workflow-step-handler.js";

/** The session produced no valid result: reports the error and asks the executor to retry the iteration. */
export class WorkflowStepSessionFailedHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, { type: "SessionFailed" }>
> {
  /** @inheritdoc */
  handle(result: Extract<WorkflowStepResult, { type: "SessionFailed" }>, executor: WorkflowExecutor): void {
    executor.publish({
      type: "SessionExecutionErrorOccurred",
      iteration: executor.iteration,
      detail: result.detail,
      stderrTail: result.stderrTail,
    });
    executor.retryLastStep({
      detail: result.detail,
      stderrTail: result.stderrTail,
    });
  }
}
