import type { WorkflowStepHandlerContext } from "./workflow-step-handler-context.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";
import type { WorkflowStepHandler } from "./workflow-step-handler.js";
import { taskOf } from "./task-of.js";

/** The candidate passed and tasks remain: reports the verdict and lets the run go on. */
export class WorkflowStepVerificationPassedHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, { type: "VerificationPassed" }>
> {
  /** @inheritdoc */
  handle(
    result: Extract<WorkflowStepResult, { type: "VerificationPassed" }>,
    context: WorkflowStepHandlerContext,
  ): void {
    context.publish({
      type: "StepExecutionFinished",
      iteration: context.iteration,
      stepName: context.stepName,
      task: taskOf(result),
    });
    context.publish({ type: "VerificationPassed", iteration: context.iteration, task: taskOf(result) });
    context.continueWorkflow();
  }
}
