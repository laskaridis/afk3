import type { WorkflowExecutor } from "../workflow-executor.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";
import type { WorkflowStepHandler } from "./workflow-step-handler.js";
import { taskOf } from "./task-of.js";

/** The agent cannot proceed without outside help: reports the blocker and ends the run. */
export class WorkflowStepBlockedHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, { type: "Blocked" }>
> {
  /** @inheritdoc */
  handle(result: Extract<WorkflowStepResult, { type: "Blocked" }>, executor: WorkflowExecutor): void {
    executor.publish({
      type: "StepExecutionBlocked",
      iteration: executor.iteration,
      blockerText: result.blockerText,
      task: taskOf(result),
    });
    executor.endWorkflow({
      type: "WorkflowBlocked",
      blockerText: result.blockerText,
      task: taskOf(result),
    });
  }
}
