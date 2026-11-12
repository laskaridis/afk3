import type { WorkflowStepHandlerContext } from "./workflow-step-handler-context.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";
import type { WorkflowStepHandler } from "./workflow-step-handler.js";

/** The session exceeded its time limit: ends the run. */
export class WorkflowStepTimeoutHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, { type: "Timeout" }>
> {
  /** @inheritdoc */
  handle(result: Extract<WorkflowStepResult, { type: "Timeout" }>, context: WorkflowStepHandlerContext): void {
    context.endWorkflow({
      type: "WorkflowTimedOut",
      seconds: context.sessionTimeoutSeconds ?? 0,
    });
  }
}
