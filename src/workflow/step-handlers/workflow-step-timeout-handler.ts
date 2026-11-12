import type { WorkflowExecutor } from "../workflow-executor.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";
import type { WorkflowStepHandler } from "./workflow-step-handler.js";

/** The session exceeded its time limit: ends the run. */
export class WorkflowStepTimeoutHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, { type: "Timeout" }>
> {
  /** @inheritdoc */
  handle(result: Extract<WorkflowStepResult, { type: "Timeout" }>, executor: WorkflowExecutor): void {
    executor.endWorkflow({
      type: "WorkflowTimedOut",
      seconds: executor.options.sessionTimeoutSeconds ?? 0,
    });
  }
}
