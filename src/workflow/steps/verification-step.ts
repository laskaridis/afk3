import {readFileSync} from 'node:fs';
import type {SessionExecutor} from '../../session/session-executor.js';
import type {VerificationAssignment} from '../assignment.js';
import {WorkflowStep} from './workflow-step.js';
import type {WorkflowStepResult} from './workflow-step-result.js';

// Copied next to the compiled `workflow/steps/` folder by the build script.
const HARNESS = readFileSync(
  new URL('./verification-step.md', import.meta.url),
  'utf8',
);

const NONCE_PLACEHOLDER = '{{NONCE}}';
const OUTCOME_FIELDS: Record<string, readonly string[]> = {
  verification_passed: [],
  workflow_finished: [],
  verification_failed: ['failure_summary', 'findings_file'],
  blocked: ['blocker_text'],
};

type VerificationResultBlock =
  | {
      outcome: 'verification_passed' | 'workflow_finished';
      task_id: string;
      task_plan_file: string;
    }
  | {
      outcome: 'verification_failed';
      failure_summary: string;
      findings_file: string;
      task_id: string;
      task_plan_file: string;
    }
  | {
      outcome: 'blocked';
      blocker_text: string;
      task_id: string | null;
      task_plan_file: string | null;
    };

/** One verification session: fresh nonce, session prompt for one candidate, run, and the verdict as a step result. */
export class VerificationStep extends WorkflowStep {
  readonly name = 'verification';

  /**
   * @param sessions Runs the agent process for this step.
   * @param assignment The candidate to verify, as the coding session reported it.
   */
  constructor(
    sessions: SessionExecutor,
    private readonly assignment: VerificationAssignment,
  ) {
    super(sessions);
  }

  /** Builds the session prompt from the launch prompt, verification assignment, and harness instructions. */
  protected buildPrompt(launchPrompt: string, nonce: string): string {
    const lines = [
      'Verification Assignment:',
      `- task_id: ${this.assignment.taskId}`,
      `- task_plan_file: ${this.assignment.taskPlanFile}`,
    ];

    if (this.assignment.revision) {
      lines.push(`- revision: ${this.assignment.revision}`);
    }

    return `${launchPrompt}\n\n${lines.join('\n')}\n---\n${HARNESS.replaceAll(NONCE_PLACEHOLDER, nonce)}\n`;
  }

  /** Validates and interprets the verification session's result block. */
  protected parseFinalAgentMessage(
    text: string,
    nonce: string,
  ): WorkflowStepResult | {violation: string} {
    const block = this.parseBlock(text, nonce);

    if ('violation' in block) {
      return block;
    }

    if (
      block.task_id !== this.assignment.taskId &&
      !(block.outcome === 'blocked' && block.task_id === null)
    ) {
      return {
        violation: `"task_id" is ${JSON.stringify(block.task_id)} but the assigned task is ${JSON.stringify(this.assignment.taskId)}`,
      };
    }

    switch (block.outcome) {
      case 'verification_passed':
        return {
          type: 'VerificationPassed',
          task_id: block.task_id,
          task_plan_file: block.task_plan_file,
        };
      case 'workflow_finished':
        return {
          type: 'FeatureVerified',
          task_id: block.task_id,
          task_plan_file: block.task_plan_file,
        };
      case 'verification_failed':
        return {
          type: 'VerificationFailed',
          failureSummary: block.failure_summary,
          findingsFile: block.findings_file,
          task_id: block.task_id,
          task_plan_file: block.task_plan_file,
        };
      case 'blocked':
        return {
          type: 'VerificationBlocked',
          blockerText: block.blocker_text,
          task_id: block.task_id,
          task_plan_file: block.task_plan_file,
        };
    }
  }

  private parseBlock(
    text: string,
    nonce: string,
  ): VerificationResultBlock | {violation: string} {
    if (text.trim() === '') {
      return {violation: 'the final message is missing or empty'};
    }

    const open = `<afk-harness-result nonce="${nonce}">`;
    const close = '</afk-harness-result>';
    let body: string | undefined;

    for (
      let start = text.indexOf(open);
      start !== -1;
      start = text.indexOf(open, start + open.length)
    ) {
      const end = text.indexOf(close, start + open.length);

      if (end === -1) {
        break;
      }

      body = text.slice(start + open.length, end);
    }

    if (body === undefined) {
      return {
        violation: `the final message has no <afk-harness-result nonce="${nonce}"> block`,
      };
    }

    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      return {
        violation:
          'the result block body is not a single JSON object (found prose, Markdown fences, or malformed JSON)',
      };
    }

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return {
        violation: 'the result block is valid JSON but not a JSON object',
      };
    }

    const fields = value as Record<string, unknown>;

    for (const key of ['task_id', 'task_plan_file'] as const) {
      if (!Object.hasOwn(fields, key)) {
        return {violation: `"${key}" is required`};
      }

      if (!this.isTextOrNull(fields[key])) {
        return {violation: `"${key}" must be a non-empty string or null`};
      }
    }

    const {outcome} = fields;

    if (
      typeof outcome !== 'string' ||
      !Object.hasOwn(OUTCOME_FIELDS, outcome)
    ) {
      return {
        violation:
          'missing or unsupported "outcome" (expected verification_passed, workflow_finished, verification_failed, or blocked)',
      };
    }

    if (fields.task_id === null && outcome !== 'blocked') {
      return {
        violation:
          'a null "task_id" requires outcome "blocked" because no task was verified',
      };
    }

    if (fields.task_plan_file === null && outcome !== 'blocked') {
      return {
        violation:
          'a null "task_plan_file" requires outcome "blocked" because no task list was available',
      };
    }

    const outcomeFields = OUTCOME_FIELDS[outcome]!;
    const allowed = ['outcome', 'task_id', 'task_plan_file', ...outcomeFields];
    const extra = Object.keys(fields).filter(key => !allowed.includes(key));

    if (extra.length > 0) {
      return {
        violation: `outcome "${outcome}" has unsupported fields: ${extra.join(', ')}`,
      };
    }

    for (const key of outcomeFields) {
      if (typeof fields[key] !== 'string' || fields[key].trim() === '') {
        return {
          violation: `outcome "${outcome}" requires a non-empty string "${key}"`,
        };
      }
    }

    return fields as VerificationResultBlock;
  }

  private isTextOrNull(value: unknown): value is string | null {
    return value === null || (typeof value === 'string' && value.trim() !== '');
  }
}
