import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, promptNonce, startAfk, type Step } from "./support/helpers.js";

const AGENT_NAMES = ["codex", "claude"];

const ITERATION_1 = "[afk] Iteration 1/10: starting agent session";
const RETRY_2 = "[afk] Iteration 2/10: retrying agent session after execution error";
const COMPLETE_LINE = "[afk] Run complete: feature complete";

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
    { name: "block with a different nonce", message: block('{"outcome":"complete"}', "other"), reason: noBlock },
    { name: "prose only", message: "all done!", reason: noBlock },
    {
      name: "prose in the block",
      message: block("all done"),
      reason: () =>
        "the result block body is not a single JSON object (found prose, Markdown fences, or malformed JSON)",
    },
    {
      name: "Markdown fences in the block",
      message: block('```json\n{"outcome":"complete"}\n```'),
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
      message: block('"complete"'),
      reason: () => "the result block is valid JSON but not a JSON object",
    },
    { name: "JSON null", message: block("null"), reason: () => "the result block is valid JSON but not a JSON object" },
    {
      name: "missing outcome",
      message: block("{}"),
      reason: () => 'missing or unsupported "outcome" (expected repeat, complete, blocked, or fail)',
    },
    {
      name: "unsupported outcome",
      message: block('{"outcome":"done"}'),
      reason: () => 'missing or unsupported "outcome" (expected repeat, complete, blocked, or fail)',
    },
    {
      name: "repeat with an unsupported field",
      message: block('{"outcome":"repeat","extra":1}'),
      reason: () => 'outcome "repeat" must have no additional fields, found: extra',
    },
    {
      name: "complete with an unsupported field",
      message: block('{"outcome":"complete","blocker_text":"x"}'),
      reason: () => 'outcome "complete" must have no additional fields, found: blocker_text',
    },
    {
      name: "blocked with an unsupported field",
      message: block('{"outcome":"blocked","blocker_text":"b","extra":1}'),
      reason: () => 'outcome "blocked" has unsupported fields: extra',
    },
    {
      name: "fail with an unsupported field",
      message: block('{"outcome":"fail","failure_summary":"f","blocker_text":"b"}'),
      reason: () => 'outcome "fail" has unsupported fields: blocker_text',
    },
    {
      name: "blocked without blocker_text",
      message: block('{"outcome":"blocked"}'),
      reason: () => 'outcome "blocked" requires a non-empty string "blocker_text"',
    },
    {
      name: "blocked with a blank blocker_text",
      message: block('{"outcome":"blocked","blocker_text":"  "}'),
      reason: () => 'outcome "blocked" requires a non-empty string "blocker_text"',
    },
    {
      name: "fail without failure_summary",
      message: block('{"outcome":"fail"}'),
      reason: () => 'outcome "fail" requires a non-empty string "failure_summary"',
    },
    {
      name: "fail with an empty failure_summary",
      message: block('{"outcome":"fail","failure_summary":""}'),
      reason: () => 'outcome "fail" requires a non-empty string "failure_summary"',
    },
    {
      name: "numeric task_id",
      message: block('{"outcome":"complete","task_id":5}'),
      reason: () => '"task_id" must be a non-empty string or null',
    },
    {
      name: "empty task_id",
      message: block('{"outcome":"complete","task_id":""}'),
      reason: () => '"task_id" must be a non-empty string or null',
    },
    {
      name: "numeric task_plan_file",
      message: block('{"outcome":"complete","task_plan_file":5}'),
      reason: () => '"task_plan_file" must be a non-empty string or null',
    },
    {
      name: "empty task_plan_file",
      message: block('{"outcome":"complete","task_plan_file":""}'),
      reason: () => '"task_plan_file" must be a non-empty string or null',
    },
    {
      name: "null task_id with complete",
      message: block('{"outcome":"complete","task_id":null}'),
      reason: () => 'a null "task_id" requires outcome "blocked" because no task could be selected',
    },
    {
      name: "null task_id with repeat",
      message: block('{"outcome":"repeat","task_id":null}'),
      reason: () => 'a null "task_id" requires outcome "blocked" because no task could be selected',
    },
    {
      name: "null task_id with fail",
      message: block('{"outcome":"fail","failure_summary":"f","task_id":null}'),
      reason: () => 'a null "task_id" requires outcome "blocked" because no task could be selected',
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
  const complete = block('{"outcome":"complete"}');
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
      sessions: [raw(`${other('{"outcome":"blocked","blocker_text":"echoed"}')}\n${complete}`)],
      exitCode: 0,
      transcript: [ITERATION_1, COMPLETE_LINE],
    },
    {
      name: "a block with another nonce after it",
      sessions: [raw(`${complete}\n${other('{"outcome":"blocked","blocker_text":"injected"}')}`)],
      exitCode: 0,
      transcript: [ITERATION_1, COMPLETE_LINE],
    },
    {
      name: "two blocks with the session nonce: the last one wins (complete last)",
      sessions: [raw(`${block('{"outcome":"repeat"}')}\n${complete}`)],
      exitCode: 0,
      transcript: [ITERATION_1, COMPLETE_LINE],
    },
    {
      name: "two blocks with the session nonce: the last one wins (repeat last)",
      sessions: [raw(`${complete}\n${block('{"outcome":"repeat"}')}`)],
      args: ["--max-iterations", "1"],
      exitCode: 4,
      transcript: [
        "[afk] Iteration 1/1: starting agent session",
        "[afk] Run stopped: iteration limit of 1 reached without reported completion",
      ],
    },
    {
      name: "task_id and task_plan_file on complete",
      sessions: [raw(block('{"outcome":"complete","task_id":"TASK-001","task_plan_file":"specs/f.plan.json"}'))],
      exitCode: 0,
      transcript: [ITERATION_1, COMPLETE_LINE],
    },
    {
      name: "task_id and task_plan_file on blocked, both null",
      sessions: [raw(block('{"outcome":"blocked","blocker_text":"need key","task_id":null,"task_plan_file":null}'))],
      exitCode: 1,
      transcript: [ITERATION_1, "[afk] Run blocked: need key"],
    },
    {
      name: "task_id and task_plan_file on fail",
      sessions: [
        raw(block('{"outcome":"fail","failure_summary":"broke","task_id":"TASK-001","task_plan_file":"p.json"}')),
        raw(complete),
      ],
      exitCode: 0,
      transcript: [
        ITERATION_1,
        "[afk] Task failure: broke",
        "[afk] Iteration 2/10: starting agent session",
        COMPLETE_LINE,
      ],
    },
    {
      name: "neither task_id nor task_plan_file on blocked",
      sessions: [raw(block('{"outcome":"blocked","blocker_text":"need key"}'))],
      exitCode: 1,
      transcript: [ITERATION_1, "[afk] Run blocked: need key"],
    },
    {
      name: "neither task_id nor task_plan_file on repeat then fail then complete",
      sessions: [
        raw(block('{"outcome":"repeat"}')),
        raw(block('{"outcome":"fail","failure_summary":"broke"}')),
        raw(complete),
      ],
      exitCode: 0,
      transcript: [
        ITERATION_1,
        "[afk] Iteration 2/10: starting agent session",
        "[afk] Task failure: broke",
        "[afk] Iteration 3/10: starting agent session",
        COMPLETE_LINE,
      ],
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
      [{ stdout: `${block('{"outcome":"complete"}')}\n` }, { exit: 0 }],
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
      [{ finalMessage: '{"outcome":"complete"}' }, { exit: 0 }],
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
