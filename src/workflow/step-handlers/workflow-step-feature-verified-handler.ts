import type {WorkflowStepHandlerContext} from './workflow-step-handler-context.js';
import type {WorkflowStepResult} from '../steps/workflow-step-result.js';
import type {WorkflowStepHandler} from './workflow-step-handler.js';
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
