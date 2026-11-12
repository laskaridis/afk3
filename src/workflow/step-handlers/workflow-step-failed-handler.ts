import type { WorkflowExecutor } from "../workflow-executor.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";
import type { WorkflowStepHandler } from "./workflow-step-handler.js";
import { taskOf } from "./task-of.js";

/** The agent reported the task failed: reports the failure and lets the run go on. */
export class WorkflowStepFailedHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, { type: "StepFailed" }>
> {
  /** @inheritdoc */
  handle(result: Extract<WorkflowStepResult, { type: "StepFailed" }>, executor: WorkflowExecutor): void {
    executor.publish({
      type: "StepExecutionFailed",
      iteration: executor.iteration,
      failureSummary: result.failureSummary,
      task: taskOf(result),
    });
    executor.continueWorkflow();
  }
}
