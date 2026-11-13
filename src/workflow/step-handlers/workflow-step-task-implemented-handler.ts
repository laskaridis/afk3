import type { WorkflowStepHandlerContext } from "./workflow-step-handler-context.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";
import type { WorkflowStepHandler } from "./workflow-step-handler.js";
import { taskOf } from "./task-of.js";

/** A candidate was committed: reports the step as finished and lets the run go on. */
export class WorkflowStepTaskImplementedHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, { type: "TaskImplemented" }>
> {
  /** @inheritdoc */
  handle(result: Extract<WorkflowStepResult, { type: "TaskImplemented" }>, context: WorkflowStepHandlerContext): void {
    context.publish({
      type: "StepExecutionFinished",
      iteration: context.iteration,
      stepName: context.stepName,
      task: taskOf(result),
    });
    context.continueWorkflow();
  }
}
