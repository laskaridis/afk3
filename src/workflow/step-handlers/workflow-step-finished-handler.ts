import type { WorkflowExecutor } from "../workflow-executor.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";
import type { WorkflowStepHandler } from "./workflow-step-handler.js";
import { taskOf } from "./task-of.js";

/** The feature is complete: reports the step as finished and ends the run. */
export class WorkflowStepFinishedHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, { type: "Finished" }>
> {
  /** @inheritdoc */
  handle(result: Extract<WorkflowStepResult, { type: "Finished" }>, executor: WorkflowExecutor): void {
    executor.publish({
      type: "StepExecutionFinished",
      iteration: executor.iteration,
      task: taskOf(result),
    });
    executor.endWorkflow({
      type: "WorkflowFinished",
      task: taskOf(result),
    });
  }
}
