import type { WorkflowExecutor } from "../workflow-executor.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";
import type { WorkflowStepHandler } from "./workflow-step-handler.js";

/** The user interrupted the session: ends the run. */
export class WorkflowStepInterruptedHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, { type: "Interrupted" }>
> {
  /** @inheritdoc */
  handle(result: Extract<WorkflowStepResult, { type: "Interrupted" }>, executor: WorkflowExecutor): void {
    executor.endWorkflow({ type: "WorkflowInterrupted" });
  }
}
