import type { WorkflowExecutor } from "../workflow-executor.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";
import type { WorkflowStepHandler } from "./workflow-step-handler.js";
import { taskOf } from "./task-of.js";

/** The task is done but the feature is not: reports the step as finished and lets the run go on. */
export class WorkflowStepContinueHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, { type: "Continue" }>
> {
  /** @inheritdoc */
  handle(result: Extract<WorkflowStepResult, { type: "Continue" }>, executor: WorkflowExecutor): void {
    executor.publish({
      type: "StepExecutionFinished",
      iteration: executor.iteration,
      task: taskOf(result),
    });
    executor.continueWorkflow();
  }
}
