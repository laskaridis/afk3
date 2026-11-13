import type { WorkflowStepResult } from "../workflow-step-result.js";
import { WorkflowStepBlockedHandler } from "./workflow-step-blocked-handler.js";
import type { WorkflowStepHandler } from "./workflow-step-handler.js";
import { WorkflowStepInterruptedHandler } from "./workflow-step-interrupted-handler.js";
import { WorkflowStepNoMoreTasksHandler } from "./workflow-step-no-more-tasks-handler.js";
import { WorkflowStepSessionFailedHandler } from "./workflow-step-session-failed-handler.js";
import { WorkflowStepTaskImplementedHandler } from "./workflow-step-task-implemented-handler.js";
import { WorkflowStepTimeoutHandler } from "./workflow-step-timeout-handler.js";

/** One handler per step result type, keyed by `WorkflowStepResult["type"]`; the compiler checks every type is covered. */
export const STEP_HANDLERS: {
  [K in WorkflowStepResult["type"]]: WorkflowStepHandler<Extract<WorkflowStepResult, { type: K }>>;
} = {
  TaskImplemented: new WorkflowStepTaskImplementedHandler(),
  NoMoreTasks: new WorkflowStepNoMoreTasksHandler(),
  Blocked: new WorkflowStepBlockedHandler(),
  SessionFailed: new WorkflowStepSessionFailedHandler(),
  Timeout: new WorkflowStepTimeoutHandler(),
  Interrupted: new WorkflowStepInterruptedHandler(),
};
