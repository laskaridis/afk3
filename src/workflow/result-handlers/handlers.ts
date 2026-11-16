import type {WorkflowStepResult} from '../steps/result.js';
import {WorkflowStepBlockedHandler} from './blocked-handler.js';
import type {WorkflowStepHandler} from './handler.js';
import {WorkflowStepFeatureVerifiedHandler} from './feature-verified-handler.js';
import {WorkflowStepInterruptedHandler} from './interrupted-handler.js';
import {WorkflowStepNoMoreTasksHandler} from './no-more-tasks-handler.js';
import {WorkflowStepSessionFailedHandler} from './session-failed-handler.js';
import {WorkflowStepTaskImplementedHandler} from './task-implemented-handler.js';
import {WorkflowStepTimeoutHandler} from './timeout-handler.js';
import {WorkflowStepVerificationFailedHandler} from './verification-failed-handler.js';
import {WorkflowStepVerificationPassedHandler} from './verification-passed-handler.js';

/** One handler per step result type, keyed by `WorkflowStepResult["type"]`; the compiler checks every type is covered. */
export const STEP_HANDLERS: {
  [K in WorkflowStepResult['type']]: WorkflowStepHandler<
    Extract<WorkflowStepResult, {type: K}>
  >;
} = {
  TaskImplemented: new WorkflowStepTaskImplementedHandler(),
  NoMoreTasks: new WorkflowStepNoMoreTasksHandler(),
  VerificationPassed: new WorkflowStepVerificationPassedHandler(),
  FeatureVerified: new WorkflowStepFeatureVerifiedHandler(),
  VerificationFailed: new WorkflowStepVerificationFailedHandler(),
  Blocked: new WorkflowStepBlockedHandler(),
  VerificationBlocked: new WorkflowStepBlockedHandler(),
  SessionFailed: new WorkflowStepSessionFailedHandler(),
  Timeout: new WorkflowStepTimeoutHandler(),
  Interrupted: new WorkflowStepInterruptedHandler(),
};
