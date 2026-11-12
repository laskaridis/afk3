import type { WorkflowStepResult } from "../workflow-step-result.js";
import { WorkflowStepBlockedHandler } from "./workflow-step-blocked-handler.js";
import { WorkflowStepContinueHandler } from "./workflow-step-continue-handler.js";
import { WorkflowStepFailedHandler } from "./workflow-step-failed-handler.js";
import { WorkflowStepFinishedHandler } from "./workflow-step-finished-handler.js";
import type { WorkflowStepHandler } from "./workflow-step-handler.js";
import { WorkflowStepInterruptedHandler } from "./workflow-step-interrupted-handler.js";
import { WorkflowStepSessionFailedHandler } from "./workflow-step-session-failed-handler.js";
import { WorkflowStepTimeoutHandler } from "./workflow-step-timeout-handler.js";

/** One handler per step result type, keyed by `WorkflowStepResult["type"]`; the compiler checks every type is covered. */
export const STEP_HANDLERS: {
  [K in WorkflowStepResult["type"]]: WorkflowStepHandler<Extract<WorkflowStepResult, { type: K }>>;
} = {
  Continue: new WorkflowStepContinueHandler(),
  Finished: new WorkflowStepFinishedHandler(),
  StepFailed: new WorkflowStepFailedHandler(),
  Blocked: new WorkflowStepBlockedHandler(),
  SessionFailed: new WorkflowStepSessionFailedHandler(),
  Timeout: new WorkflowStepTimeoutHandler(),
  Interrupted: new WorkflowStepInterruptedHandler(),
};
