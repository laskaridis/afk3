import {describe, expect, it} from 'vitest';
import type {SessionExecutor} from '../../../../src/session/executor.js';
import type {SessionInput} from '../../../../src/session/input.js';
import type {SessionResult} from '../../../../src/session/result.js';
import {CodingStep} from '../../../../src/workflow/steps/coding-step.js';
import {VerificationStep} from '../../../../src/workflow/steps/verification-step.js';
import type {WorkflowStepResult} from '../../../../src/workflow/steps/result.js';

const PLAN = 'specs/feature.plan.json';
const TASK = {task_id: 'TASK-011', task_plan_file: PLAN};
const IMPLEMENTED = {outcome: 'task_implemented', ...TASK};
const PASSED = {outcome: 'verification_passed', ...TASK};
type Phase = 'coding' | 'verification';

const block = (body: string, nonce: string) =>
  `<afk-harness-result nonce="${nonce}">\n${body}\n</afk-harness-result>`;

async function run(
  phase: Phase,
  message: (nonce: string) => string,
): Promise<WorkflowStepResult> {
  const sessions = {
    execute: async (input: SessionInput): Promise<SessionResult> => {
      const nonce = /<afk-harness-result nonce="([0-9a-f]+)">/.exec(
        input.prompt,
      )![1]!;
      return {kind: 'success', finalMessage: message(nonce), stderrTail: []};
    },
  } as SessionExecutor;
  const step =
    phase === 'coding'
      ? new CodingStep(sessions)
      : new VerificationStep(sessions, {
          taskId: TASK.task_id,
          taskPlanFile: PLAN,
        });
  return step.execute('p', {cwd: '/work'});
}

const respond = (phase: Phase, value: object) =>
  run(phase, nonce => block(JSON.stringify(value), nonce));

async function violation(phase: Phase, value: object): Promise<string> {
  const result = await respond(phase, value);
  expect(result.type).toBe('SessionFailed');
  return (
    result as Extract<WorkflowStepResult, {type: 'SessionFailed'}>
  ).detail.replace('agent final response is invalid: ', '');
}

describe.each(['coding', 'verification'] as const)(
  '%s step result contract',
  phase => {
    const valid = phase === 'coding' ? IMPLEMENTED : PASSED;

    it('reads the last complete block with the matching nonce amid surrounding text', async () => {
      const result = await run(phase, nonce =>
        [
          'banner',
          block(JSON.stringify({...valid, task_id: 'wrong'}), nonce),
          block(JSON.stringify(valid), 'other-nonce'),
          block(`  ${JSON.stringify(valid)}\t`, nonce),
          'trailing noise',
        ].join('\n'),
      );
      expect(result.type).toBe(
        phase === 'coding' ? 'TaskImplemented' : 'VerificationPassed',
      );
    });

    it.each(['', ' \n '])('rejects a blank final message %j', async message => {
      const result = await run(phase, () => message);
      expect(result).toMatchObject({
        type: 'SessionFailed',
        detail:
          'agent final response is invalid: the final message is missing or empty',
      });
    });

    it.each([
      ['missing block', (nonce: string) => JSON.stringify({...valid, nonce})],
      [
        'wrong nonce',
        (nonce: string) => block(JSON.stringify(valid), `${nonce}0`),
      ],
      [
        'unclosed block',
        (nonce: string) =>
          `<afk-harness-result nonce="${nonce}">${JSON.stringify(valid)}`,
      ],
    ])('rejects a %s', async (_name, message) => {
      expect(await run(phase, message)).toMatchObject({
        type: 'SessionFailed',
        detail: expect.stringContaining('has no <afk-harness-result'),
      });
    });

    it.each(['{', '```json\n{}\n```'])(
      'rejects malformed JSON %j',
      async body => {
        expect(await run(phase, nonce => block(body, nonce))).toMatchObject({
          type: 'SessionFailed',
          detail: expect.stringContaining('not a single JSON object'),
        });
      },
    );

    it.each(['null', '[]', '"text"', '42'])(
      'rejects a non-object JSON body %j',
      async body => {
        expect(await run(phase, nonce => block(body, nonce))).toMatchObject({
          type: 'SessionFailed',
          detail: expect.stringContaining('not a JSON object'),
        });
      },
    );

    it.each(['task_id', 'task_plan_file'])('requires %s', async field => {
      const value: Record<string, unknown> = {...valid};
      delete value[field];
      expect(await violation(phase, value)).toBe(`"${field}" is required`);
    });

    it.each(['task_id', 'task_plan_file'])(
      'requires a non-empty string or null for %s',
      async field => {
        for (const bad of ['', '  ', 42, false, [], {}]) {
          expect(await violation(phase, {...valid, [field]: bad})).toBe(
            `"${field}" must be a non-empty string or null`,
          );
        }
      },
    );

    it('rejects unsupported outcomes and extra fields', async () => {
      expect(await violation(phase, {...valid, outcome: 'unknown'})).toContain(
        'missing or unsupported "outcome"',
      );
      expect(await violation(phase, {...valid, outcome: null})).toContain(
        'missing or unsupported "outcome"',
      );
      expect(await violation(phase, {...valid, unexpected: 'x'})).toContain(
        'unsupported fields: unexpected',
      );
    });

    it('requires a non-null task and plan for a successful outcome', async () => {
      expect(await violation(phase, {...valid, task_id: null})).toContain(
        'a null "task_id" requires outcome',
      );
      expect(
        await violation(phase, {...valid, task_plan_file: null}),
      ).toContain('a null "task_plan_file" requires outcome');
    });

    it('requires a non-empty blocker_text on blocked', async () => {
      expect(
        await violation(phase, {
          outcome: 'blocked',
          blocker_text: ' ',
          ...TASK,
        }),
      ).toBe('outcome "blocked" requires a non-empty string "blocker_text"');
    });
  },
);

describe('coding step result fields', () => {
  it('requires no_more_tasks to have a null task id', async () => {
    expect(
      await violation('coding', {outcome: 'no_more_tasks', ...TASK}),
    ).toContain('"no_more_tasks" requires a null "task_id"');
  });

  it.each(['', '  ', 5, ['a'], false])(
    'rejects invalid revision %j',
    async revision => {
      expect(await violation('coding', {...IMPLEMENTED, revision})).toBe(
        '"revision" must be a non-empty string or null',
      );
    },
  );

  it('rejects revision on another outcome and verification fields', async () => {
    expect(
      await violation('coding', {
        outcome: 'no_more_tasks',
        task_id: null,
        task_plan_file: PLAN,
        revision: 'r',
      }),
    ).toContain('unsupported fields: revision');
    expect(
      await violation('coding', {...IMPLEMENTED, findings_file: 'f'}),
    ).toContain('unsupported fields: findings_file');
    expect(await violation('coding', PASSED)).toContain(
      'expected task_implemented, no_more_tasks, or blocked',
    );
  });
});

describe('verification step result fields', () => {
  it.each(['failure_summary', 'findings_file'])(
    'requires non-empty %s on rejection',
    async field => {
      const failed = {
        outcome: 'verification_failed',
        failure_summary: 'bad',
        findings_file: 'f',
        ...TASK,
      };

      for (const bad of [undefined, '', '  ', 5]) {
        const value: Record<string, unknown> = {...failed, [field]: bad};

        if (bad === undefined) {
          delete value[field];
        }

        expect(await violation('verification', value)).toBe(
          `outcome "verification_failed" requires a non-empty string "${field}"`,
        );
      }
    },
  );

  it('rejects fields on other outcomes and a coding outcome', async () => {
    expect(
      await violation('verification', {...PASSED, findings_file: 'f'}),
    ).toContain('unsupported fields: findings_file');
    expect(
      await violation('verification', {...PASSED, revision: 'r'}),
    ).toContain('unsupported fields: revision');
    expect(await violation('verification', IMPLEMENTED)).toContain(
      'expected verification_passed, workflow_finished',
    );
  });
});
