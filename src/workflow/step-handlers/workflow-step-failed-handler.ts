import type { WorkflowStepHandlerContext } from "./workflow-step-handler-context.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";
import type { WorkflowStepHandler } from "./workflow-step-handler.js";
import { taskOf } from "./task-of.js";

/** The agent reported the task failed: reports the failure and lets the run go on. */
export class WorkflowStepFailedHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, { type: "StepFailed" }>
> {
  /** @inheritdoc */
  handle(result: Extract<WorkflowStepResult, { type: "StepFailed" }>, context: WorkflowStepHandlerContext): void {
    context.publish({
      type: "StepExecutionFailed",
      iteration: context.iteration,
      failureSummary: result.failureSummary,
      task: taskOf(result),
    });
    context.continueWorkflow();
  }
}
