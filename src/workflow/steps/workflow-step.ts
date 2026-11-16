import {randomBytes} from 'node:crypto';
import type {SessionExecutor} from '../../session/session-executor.js';
import type {WorkflowStepOptions} from '../workflow-step-options.js';
import type {WorkflowStepResult} from './workflow-step-result.js';

/**
 * One session of work in the workflow. Subclasses supply the prompt and interpretation of a valid result block;
 * the executor owns the policy built on top of the result (retries, limits, events).
 */
export abstract class WorkflowStep {
  /** Short, stable identifier of the step (e.g. `coding`). */
  abstract readonly name: string;

  /** Runs the agent process for this step. */
  constructor(protected readonly sessions: SessionExecutor) {}

  /** Builds the session prompt for this step and nonce. */
  protected abstract buildPrompt(launchPrompt: string, nonce: string): string;

  /** Parses the agent's final message into this step's result or a contract violation. */
  protected abstract parseFinalAgentMessage(
    finalMessage: string,
    nonce: string,
  ): WorkflowStepResult | {violation: string};

  /**
   * Runs the step once, in a fresh session. Expected failures (a failed session, timeout, interruption, or invalid
   * response) are returned as the matching `WorkflowStepResult` rather than thrown.
   *
   * @param launchPrompt The user's prompt, the same for every iteration.
   * @param options Where to run and with which model and effort.
   * @returns What the step ended as, for the executor to act on.
   */
  async execute(
    launchPrompt: string,
    options: WorkflowStepOptions,
  ): Promise<WorkflowStepResult> {
    const nonce = randomBytes(4).toString('hex');
    const session = await this.sessions.execute({
      prompt: this.buildPrompt(launchPrompt, nonce),
      cwd: options.cwd,
      model: options.model,
      effort: options.effort,
    });
    switch (session.kind) {
      case 'interrupted':
        return {type: 'Interrupted'};
      case 'timed-out':
        return {type: 'Timeout'};
      case 'launch-failed':
        return {type: 'SessionFailed', detail: session.detail, stderrTail: []};
      case 'exited-unsuccessfully':
      case 'missing-final-message':
      case 'invalid-final-message':
        return {
          type: 'SessionFailed',
          detail: session.detail,
          stderrTail: session.stderrTail,
        };
      case 'success': {
        const result = this.parseFinalAgentMessage(session.finalMessage, nonce);

        if ('violation' in result) {
          return {
            type: 'SessionFailed',
            detail: `agent final response is invalid: ${result.violation}`,
            stderrTail: session.stderrTail,
          };
        }

        return result;
      }
    }
  }
}
