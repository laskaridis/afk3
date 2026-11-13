import type { WorkflowStepHandlerContext } from "./workflow-step-handler-context.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";
import type { WorkflowStepHandler } from "./workflow-step-handler.js";
import { taskOf } from "./task-of.js";

/** The candidate was rejected: reports the step as finished and asks for a correction iteration. */
export class WorkflowStepVerificationFailedHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, { type: "VerificationFailed" }>
> {
  /** @inheritdoc */
  handle(
    result: Extract<WorkflowStepResult, { type: "VerificationFailed" }>,
    context: WorkflowStepHandlerContext,
  ): void {
    context.publish({
      type: "StepExecutionFinished",
      iteration: context.iteration,
      stepName: context.stepName,
      task: taskOf(result),
    });
    context.requestCorrection({
      taskId: result.task_id,
      taskPlanFile: result.task_plan_file,
      findingsFile: result.findingsFile,
      failureSummary: result.failureSummary,
    });
  }
}
