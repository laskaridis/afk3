import type { WorkflowStepHandlerContext } from "./workflow-step-handler-context.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";
import type { WorkflowStepHandler } from "./workflow-step-handler.js";
import { taskOf } from "./task-of.js";

/** The feature is complete: reports the step as finished and ends the run. */
export class WorkflowStepFinishedHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, { type: "Finished" }>
> {
  /** @inheritdoc */
  handle(result: Extract<WorkflowStepResult, { type: "Finished" }>, context: WorkflowStepHandlerContext): void {
    context.publish({
      type: "StepExecutionFinished",
      iteration: context.iteration,
      stepName: context.stepName,
      task: taskOf(result),
    });
    context.endWorkflow({
      type: "WorkflowFinished",
      task: taskOf(result),
    });
  }
}
