import type {WorkflowStepHandlerContext} from './handler-context.js';
import type {WorkflowStepResult} from '../steps/result.js';
import type {WorkflowStepHandler} from './handler.js';
import {taskOf} from './helpers.js';

type BlockedResult = Extract<
  WorkflowStepResult,
  {type: 'Blocked' | 'VerificationBlocked'}
>;

export class WorkflowStepBlockedHandler implements WorkflowStepHandler<BlockedResult> {
  /** @inheritdoc */
  handle(result: BlockedResult, context: WorkflowStepHandlerContext): void {
    context.publish({
      type: 'StepExecutionBlocked',
      iteration: context.iteration,
      stepName: context.stepName,
      blockerText: result.blockerText,
      task: taskOf(result),
    });
    context.endWorkflow({
      type: 'WorkflowBlocked',
      blockerText: result.blockerText,
      task: taskOf(result),
    });
  }
}
