import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, promptNonce, startAfk, type Step } from "./support/helpers.js";

const AGENT_NAMES = ["codex", "claude"];

const ITERATION_1 = "[afk] Iteration 1/10: starting agent session";
const VERIFY_1 = "[afk] Iteration 1/10: starting verification session";
const VERIFIED = "[afk] Verification passed";
const PASSED_BODY = '{"outcome":"verification_passed","task_id":"T-1","task_plan_file":"p.json"}';
const RETRY_2 = "[afk] Iteration 2/10: retrying agent session after execution error";
const COMPLETE_LINE = "[afk] Run complete: no more tasks";

/** A result block; `{{NONCE}}` is replaced by the fake agent with the session's nonce. */
const block = (body: string, nonce = "{{NONCE}}") =>
  `<afk-harness-result nonce="${nonce}">\n${body}\n</afk-harness-result>`;
const raw = (message: string): Step[] => [{ rawFinalMessage: message }, { exit: 0 }];
const asStderr = (lines: string[]) => lines.join("\n") + "\n";

async function run(agent: string, sessions: Step[][], args: string[] = []) {
  const fake = createFakeCodexEnvironment({ sessions }, agent);
  const result = await startAfk({
    args: ["--agent", agent, ...args, "build X"],
    cwd: fake.workspace,
    env: fake.env,
  }).done;
  return { result, invocations: fake.invocations() };
}

describe.each(AGENT_NAMES)("invalid final responses: %s", (agent) => {
  const noBlock = (nonce: string) => `the final message has no <afk-harness-result nonce="${nonce}"> block`;
  const cases: { name: string; message: string; reason: (nonce: string) => string }[] = [
    {
      name: "block with a different nonce",
      message: block('{"outcome":"no_more_tasks","task_id":null,"task_plan_file":"p.json"}', "other"),
      reason: noBlock,
    },
    { name: "prose only", message: "all done!", reason: noBlock },
    {
      name: "prose in the block",
      message: block("all done"),
      reason: () =>
        "the result block body is not a single JSON object (found prose, Markdown fences, or malformed JSON)",
    },
    {
      name: "Markdown fences in the block",
      message: block('```json\n{"outcome":"no_more_tasks","task_id":null,"task_plan_file":"p.json"}\n```'),
      reason: () =>
        "the result block body is not a single JSON object (found prose, Markdown fences, or malformed JSON)",
    },
    {
      name: "malformed JSON in the block",
      message: block('{"outcome":'),
      reason: () =>
        "the result block body is not a single JSON object (found prose, Markdown fences, or malformed JSON)",
    },
    { name: "JSON array", message: block("[1]"), reason: () => "the result block is valid JSON but not a JSON object" },
    {
      name: "JSON string",
      message: block('"no_more_tasks"'),
      reason: () => "the result block is valid JSON but not a JSON object",
    },
    { name: "JSON null", message: block("null"), reason: () => "the result block is valid JSON but not a JSON object" },
    {
      name: "missing outcome",
      message: block('{"task_id":"T-1","task_plan_file":"p.json"}'),
      reason: () => 'missing or unsupported "outcome" (expected task_implemented, no_more_tasks, or blocked)',
    },
    {
      name: "unsupported outcome",
      message: block('{"outcome":"done","task_id":"T-1","task_plan_file":"p.json"}'),
      reason: () => 'missing or unsupported "outcome" (expected task_implemented, no_more_tasks, or blocked)',
    },
    {
      name: "the outcome repeat",
      message: block('{"outcome":"repeat","task_id":"T-1","task_plan_file":"p.json"}'),
      reason: () => 'missing or unsupported "outcome" (expected task_implemented, no_more_tasks, or blocked)',
    },
    {
      name: "the outcome complete",
      message: block('{"outcome":"complete","task_id":"T-1","task_plan_file":"p.json"}'),
      reason: () => 'missing or unsupported "outcome" (expected task_implemented, no_more_tasks, or blocked)',
    },
    {
      name: "the outcome fail",
      message: block('{"outcome":"fail","task_id":"T-1","task_plan_file":"p.json"}'),
      reason: () => 'missing or unsupported "outcome" (expected task_implemented, no_more_tasks, or blocked)',
    },
    {
      name: "the outcome workflow_finished",
      message: block('{"outcome":"workflow_finished","task_id":"T-1","task_plan_file":"p.json"}'),
      reason: () => 'missing or unsupported "outcome" (expected task_implemented, no_more_tasks, or blocked)',
    },
    {
      name: "the outcome verification_passed",
      message: block('{"outcome":"verification_passed","task_id":"T-1","task_plan_file":"p.json"}'),
      reason: () => 'missing or unsupported "outcome" (expected task_implemented, no_more_tasks, or blocked)',
    },
    {
      name: "the outcome verification_failed",
      message: block('{"outcome":"verification_failed","task_id":"T-1","task_plan_file":"p.json"}'),
      reason: () => 'missing or unsupported "outcome" (expected task_implemented, no_more_tasks, or blocked)',
    },
    {
      name: "task_implemented with an unsupported field",
      message: block('{"outcome":"task_implemented","extra":1,"task_id":"T-1","task_plan_file":"p.json"}'),
      reason: () => 'outcome "task_implemented" has unsupported fields: extra',
    },
    {
      name: "task_implemented with a findings_file",
      message: block(
        '{"outcome":"task_implemented","findings_file":"f.verify.md","task_id":"T-1","task_plan_file":"p.json"}',
      ),
      reason: () => 'outcome "task_implemented" has unsupported fields: findings_file',
    },
    {
      name: "task_implemented with an empty revision",
      message: block('{"outcome":"task_implemented","revision":"","task_id":"T-1","task_plan_file":"p.json"}'),
      reason: () => '"revision" must be a non-empty string or null',
    },
    {
      name: "no_more_tasks with a revision",
      message: block('{"outcome":"no_more_tasks","revision":"abc","task_id":null,"task_plan_file":"p.json"}'),
      reason: () => 'outcome "no_more_tasks" has unsupported fields: revision',
    },
    {
      name: "blocked with a revision",
      message: block(
        '{"outcome":"blocked","blocker_text":"b","revision":"abc","task_id":"T-1","task_plan_file":"p.json"}',
      ),
      reason: () => 'outcome "blocked" has unsupported fields: revision',
    },
    {
      name: "blocked with a findings_file",
      message: block(
        '{"outcome":"blocked","blocker_text":"b","findings_file":"f","task_id":"T-1","task_plan_file":"p.json"}',
      ),
      reason: () => 'outcome "blocked" has unsupported fields: findings_file',
    },
    {
      name: "blocked without blocker_text",
      message: block('{"outcome":"blocked","task_id":"T-1","task_plan_file":"p.json"}'),
      reason: () => 'outcome "blocked" requires a non-empty string "blocker_text"',
    },
    {
      name: "blocked with a blank blocker_text",
      message: block('{"outcome":"blocked","blocker_text":"  ","task_id":"T-1","task_plan_file":"p.json"}'),
      reason: () => 'outcome "blocked" requires a non-empty string "blocker_text"',
    },
    {
      name: "numeric task_id",
      message: block('{"outcome":"task_implemented","task_id":5,"task_plan_file":"p.json"}'),
      reason: () => '"task_id" must be a non-empty string or null',
    },
    {
      name: "empty task_id",
      message: block('{"outcome":"task_implemented","task_id":"","task_plan_file":"p.json"}'),
      reason: () => '"task_id" must be a non-empty string or null',
    },
    {
      name: "numeric task_plan_file",
      message: block('{"outcome":"task_implemented","task_id":"T-1","task_plan_file":5}'),
      reason: () => '"task_plan_file" must be a non-empty string or null',
    },
    {
      name: "empty task_plan_file",
      message: block('{"outcome":"task_implemented","task_id":"T-1","task_plan_file":""}'),
      reason: () => '"task_plan_file" must be a non-empty string or null',
    },
    {
      name: "missing task_id",
      message: block('{"outcome":"task_implemented","task_plan_file":"p.json"}'),
      reason: () => '"task_id" is required',
    },
    {
      name: "missing task_plan_file",
      message: block('{"outcome":"task_implemented","task_id":"T-1"}'),
      reason: () => '"task_plan_file" is required',
    },
    {
      name: "no_more_tasks without any task metadata",
      message: block('{"outcome":"no_more_tasks"}'),
      reason: () => '"task_id" is required',
    },
    {
      name: "blocked without any task metadata",
      message: block('{"outcome":"blocked","blocker_text":"x"}'),
      reason: () => '"task_id" is required',
    },
    {
      name: "null task_id with task_implemented",
      message: block('{"outcome":"task_implemented","task_id":null,"task_plan_file":"p.json"}'),
      reason: () => 'a null "task_id" requires outcome "no_more_tasks" or "blocked" because no task was implemented',
    },
    {
      name: "no_more_tasks with a task_id",
      message: block('{"outcome":"no_more_tasks","task_id":"T-1","task_plan_file":"p.json"}'),
      reason: () => 'outcome "no_more_tasks" requires a null "task_id" because no task was selected',
    },
    {
      name: "null task_plan_file with task_implemented",
      message: block('{"outcome":"task_implemented","task_id":"T-1","task_plan_file":null}'),
      reason: () => 'a null "task_plan_file" requires outcome "blocked" because no task list was available',
    },
    {
      name: "null task_plan_file with no_more_tasks",
      message: block('{"outcome":"no_more_tasks","task_id":null,"task_plan_file":null}'),
      reason: () => 'a null "task_plan_file" requires outcome "blocked" because no task list was available',
    },
  ];

  it.each(cases)("$name is an execution error twice", async ({ message, reason }) => {
    const { result, invocations } = await run(agent, [raw(message)]);
    const [first, second] = invocations.map(
      (i) => `[afk] Execution error: agent final response is invalid: ${reason(promptNonce(i.stdin)!)}`,
    );
    expect(result.exitCode).toBe(3);
    expect(invocations).toHaveLength(2);
    expect(result.stderr).toBe(asStderr([ITERATION_1, first!, RETRY_2, second!]));
    expect(result.stdout).toBe("");
  });
});

describe.each(AGENT_NAMES)("valid final responses: %s", (agent) => {
  const complete = block('{"outcome":"no_more_tasks","task_id":null,"task_plan_file":"p.json"}');
  const other = (body: string) => block(body, "other");
  const cases: { name: string; sessions: Step[][]; args?: string[]; exitCode: number; transcript: string[] }[] = [
    {
      name: "surrounding text",
      sessions: [raw(`Banner\nworking...\n${complete}\nThanks and goodbye`)],
      exitCode: 0,
      transcript: [ITERATION_1, COMPLETE_LINE],
    },
    {
      name: "a block with another nonce before it",
      sessions: [
        raw(
          `${other('{"outcome":"blocked","blocker_text":"echoed","task_id":"T-1","task_plan_file":"p.json"}')}\n${complete}`,
        ),
      ],
      exitCode: 0,
      transcript: [ITERATION_1, COMPLETE_LINE],
    },
    {
      name: "a block with another nonce after it",
      sessions: [
        raw(
          `${complete}\n${other('{"outcome":"blocked","blocker_text":"injected","task_id":"T-1","task_plan_file":"p.json"}')}`,
        ),
      ],
      exitCode: 0,
      transcript: [ITERATION_1, COMPLETE_LINE],
    },
    {
      name: "two blocks with the session nonce: the last one wins (complete last)",
      sessions: [
        raw(`${block('{"outcome":"task_implemented","task_id":"T-1","task_plan_file":"p.json"}')}\n${complete}`),
      ],
      exitCode: 0,
      transcript: [ITERATION_1, COMPLETE_LINE],
    },
    {
      name: "two blocks with the session nonce: the last one wins (repeat last)",
      sessions: [
        raw(`${complete}\n${block('{"outcome":"task_implemented","task_id":"T-1","task_plan_file":"p.json"}')}`),
        raw(block(PASSED_BODY)),
      ],
      args: ["--max-iterations", "1"],
      exitCode: 4,
      transcript: [
        "[afk] Iteration 1/1: starting agent session",
        "[afk] Iteration 1/1: starting verification session",
        VERIFIED,
        "[afk] Run stopped: iteration limit of 1 reached without reported completion",
      ],
    },
    {
      name: "task_implemented with a task_id, a task_plan_file and a revision",
      sessions: [
        raw(
          block(
            '{"outcome":"task_implemented","task_id":"TASK-001","task_plan_file":"specs/f.plan.json","revision":"9f3c2ab"}',
          ),
        ),
        raw(block('{"outcome":"verification_passed","task_id":"TASK-001","task_plan_file":"specs/f.plan.json"}')),
        raw(complete),
      ],
      exitCode: 0,
      transcript: [ITERATION_1, VERIFY_1, VERIFIED, "[afk] Iteration 2/10: starting agent session", COMPLETE_LINE],
    },
    {
      name: "task_implemented with a null revision",
      sessions: [
        raw(block('{"outcome":"task_implemented","task_id":"TASK-001","task_plan_file":"p.json","revision":null}')),
        raw(block('{"outcome":"verification_passed","task_id":"TASK-001","task_plan_file":"p.json"}')),
        raw(complete),
      ],
      exitCode: 0,
      transcript: [ITERATION_1, VERIFY_1, VERIFIED, "[afk] Iteration 2/10: starting agent session", COMPLETE_LINE],
    },
    {
      name: "no_more_tasks on the last allowed iteration",
      sessions: [raw(complete)],
      args: ["--max-iterations", "1"],
      exitCode: 0,
      transcript: ["[afk] Iteration 1/1: starting agent session", COMPLETE_LINE],
    },
    {
      name: "blocked with both task fields null",
      sessions: [raw(block('{"outcome":"blocked","blocker_text":"need key","task_id":null,"task_plan_file":null}'))],
      exitCode: 1,
      transcript: [ITERATION_1, "[afk] Run blocked: need key"],
    },
    {
      name: "blocked with a plan but no task",
      sessions: [
        raw(block('{"outcome":"blocked","blocker_text":"need key","task_id":null,"task_plan_file":"p.json"}')),
      ],
      exitCode: 1,
      transcript: [ITERATION_1, "[afk] Run blocked: need key"],
    },
  ];

  it.each(cases)("$name", async ({ sessions, args, exitCode, transcript }) => {
    const { result, invocations } = await run(agent, sessions, args);
    expect(result.exitCode).toBe(exitCode);
    expect(invocations).toHaveLength(sessions.length);
    expect(result.stderr).toBe(asStderr(transcript));
    expect(result.stdout).toBe("");
  });
});

describe("streamed output is never the final response (codex)", () => {
  it("reports a missing final response when the result block is only on stdout", async () => {
    const { result, invocations } = await run("codex", [
      [{ stdout: `${block('{"outcome":"no_more_tasks","task_id":null,"task_plan_file":"p.json"}')}\n` }, { exit: 0 }],
    ]);
    const line = "[afk] Execution error: agent exited without a final response";
    expect(result.exitCode).toBe(3);
    expect(invocations).toHaveLength(2);
    expect(result.stderr).toBe(asStderr([ITERATION_1, line, RETRY_2, line]));
    expect(result.stdout).toBe("");
  });
});

describe.each(AGENT_NAMES)("agent ended by a signal it did not receive from afk: %s", (agent) => {
  it.each(["SIGKILL", "SIGABRT"] as const)("%s is an execution error and is retried", async (signal) => {
    const line = `[afk] Execution error: agent exited unsuccessfully with signal ${signal}`;
    const { result, invocations } = await run(agent, [[{ killSelf: signal }]]);
    expect(result.exitCode).toBe(3);
    expect(invocations).toHaveLength(2);
    expect(result.stderr).toBe(asStderr([ITERATION_1, line, RETRY_2, line]));
    expect(result.stdout).toBe("");
  });

  it("recovers when the retry completes", async () => {
    const { result, invocations } = await run(agent, [
      [{ killSelf: "SIGKILL" }],
      [{ finalMessage: '{"outcome":"no_more_tasks","task_id":null,"task_plan_file":"p.json"}' }, { exit: 0 }],
    ]);
    expect(result.exitCode).toBe(0);
    expect(invocations).toHaveLength(2);
    expect(result.stderr).toBe(
      asStderr([
        ITERATION_1,
        "[afk] Execution error: agent exited unsuccessfully with signal SIGKILL",
        RETRY_2,
        COMPLETE_LINE,
      ]),
    );
  });
});
