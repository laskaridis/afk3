import type {WorkflowStepHandlerContext} from './handler-context.js';
import type {WorkflowStepResult} from '../steps/result.js';
import type {WorkflowStepHandler} from './handler.js';
import {taskOf} from './helpers.js';

/** The candidate was rejected: reports the step as finished and asks for a correction iteration. */
export class WorkflowStepVerificationFailedHandler implements WorkflowStepHandler<
  Extract<WorkflowStepResult, {type: 'VerificationFailed'}>
> {
  /** @inheritdoc */
  handle(
    result: Extract<WorkflowStepResult, {type: 'VerificationFailed'}>,
    context: WorkflowStepHandlerContext,
  ): void {
    context.publish({
      type: 'StepExecutionFinished',
      iteration: context.iteration,
      stepName: context.stepName,
      task: taskOf(result),
    });
    context.fixVerificationFindings({
      taskId: result.task_id,
      taskPlanFile: result.task_plan_file,
      findingsFile: result.findingsFile,
      failureSummary: result.failureSummary,
    });
  }
}
