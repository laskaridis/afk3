import type {WorkflowStepHandlerContext} from './handler-context.js';
import type {WorkflowStepResult} from '../steps/result.js';
import type {WorkflowStepHandler} from './handler.js';
import {taskOf} from './helpers.js';

/** A candidate was committed: reports the step as finished and lets the run go on. */
export class WorkflowStepTaskImplementedHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, {type: 'TaskImplemented'}>
> {
  /** @inheritdoc */
  handle(
    result: Extract<WorkflowStepResult, {type: 'TaskImplemented'}>,
    context: WorkflowStepHandlerContext,
  ): void {
    context.publish({
      type: 'StepExecutionFinished',
      iteration: context.iteration,
      stepName: context.stepName,
      task: taskOf(result),
    });
    context.continueWorkflow();
  }
}
