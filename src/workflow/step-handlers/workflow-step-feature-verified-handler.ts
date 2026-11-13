import type { WorkflowStepHandlerContext } from "./workflow-step-handler-context.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";
import type { WorkflowStepHandler } from "./workflow-step-handler.js";
import { taskOf } from "./task-of.js";

/** The candidate passed and no tasks remain: reports the verdict and ends the run successfully. */
export class WorkflowStepFeatureVerifiedHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, { type: "FeatureVerified" }>
> {
  /** @inheritdoc */
  handle(result: Extract<WorkflowStepResult, { type: "FeatureVerified" }>, context: WorkflowStepHandlerContext): void {
    context.publish({
      type: "StepExecutionFinished",
      iteration: context.iteration,
      stepName: context.stepName,
      task: taskOf(result),
    });
    context.publish({ type: "VerificationPassed", iteration: context.iteration, task: taskOf(result) });
    context.endWorkflow({ type: "WorkflowCompleted", task: taskOf(result) });
  }
}
