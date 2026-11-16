import type {WorkflowStepHandlerContext} from './handler-context.js';
import type {WorkflowStepResult} from '../steps/result.js';
import type {WorkflowStepHandler} from './handler.js';

/** The user interrupted the session: ends the run. */
export class WorkflowStepInterruptedHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, {type: 'Interrupted'}>
> {
  /** @inheritdoc */
  handle(
    result: Extract<WorkflowStepResult, {type: 'Interrupted'}>,
    context: WorkflowStepHandlerContext,
  ): void {
    context.endWorkflow({type: 'WorkflowInterrupted'});
  }
}
