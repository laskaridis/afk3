import type {WorkflowStepHandlerContext} from './handler-context.js';
import type {WorkflowStepResult} from '../steps/result.js';
import type {WorkflowStepHandler} from './handler.js';
import {taskOf} from './helpers.js';

export class WorkflowStepFeatureVerifiedHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, {type: 'FeatureVerified'}>
> {
  handle(
    result: Extract<WorkflowStepResult, {type: 'FeatureVerified'}>,
    context: WorkflowStepHandlerContext,
  ): void {
    context.publish({
      type: 'StepExecutionFinished',
      iteration: context.iteration,
      stepName: context.stepName,
      task: taskOf(result),
    });
    context.publish({
      type: 'VerificationPassed',
      iteration: context.iteration,
      task: taskOf(result),
    });
    context.endWorkflow({type: 'WorkflowFinished', task: taskOf(result)});
  }
}
