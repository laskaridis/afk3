import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SessionExecutor } from "../../../../src/session/session-executor.js";
import type { SessionInput } from "../../../../src/session/session-input.js";
import type { SessionResult } from "../../../../src/session/session-result.js";
import { CodingStep } from "../../../../src/workflow/steps/coding-step.js";

const harness = readFileSync(new URL("../../../../src/workflow/steps/code-step.md", import.meta.url), "utf8");
const OPTIONS = { cwd: "/work", model: "m", effort: "high" };

type Scripted = SessionResult | ((nonce: string) => SessionResult);

/** A stubbed SessionExecutor that records inputs and recovers the session's nonce from the prompt. */
function stub(...results: Scripted[]) {
  const inputs: SessionInput[] = [];
  const nonces: string[] = [];
  const executor = {
    execute: async (input: SessionInput) => {
      inputs.push(input);
      const nonce = /<afk-harness-result nonce="([0-9a-f]+)">/.exec(input.prompt)![1]!;
      nonces.push(nonce);
      const result = results[Math.min(inputs.length, results.length) - 1]!;
      return typeof result === "function" ? result(nonce) : result;
    },
  } as unknown as SessionExecutor;
  return { step: new CodingStep(executor), inputs, nonces };
}

const reply =
  (message: object): Scripted =>
  (nonce) => ({
    kind: "success",
    finalMessage: `<afk-harness-result nonce="${nonce}">\n${JSON.stringify(message)}\n</afk-harness-result>`,
    stderrTail: [],
  });

describe("CodingStep session prompt", () => {
  it("passes the launch prompt, a blank line, ---, code-step.md with the nonce and a trailing newline", async () => {
    const { step, inputs, nonces } = stub(reply({ outcome: "repeat" }));
    await step.execute("  build X\nnow ", OPTIONS);
    expect(inputs[0]!.prompt).toBe(`  build X\nnow \n\n---\n${harness.replaceAll("{{NONCE}}", nonces[0]!)}\n`);
    expect(inputs[0]!.prompt).not.toContain("{{NONCE}}");
    expect(inputs[0]).toMatchObject({ cwd: "/work", model: "m", effort: "high" });
  });

  it("generates a fresh nonce on every execution", async () => {
    const { step, nonces } = stub(reply({ outcome: "repeat" }));
    await step.execute("p", OPTIONS);
    await step.execute("p", OPTIONS);
    await step.execute("p", OPTIONS);
    expect(new Set(nonces).size).toBe(3);
  });

  it("is named coding", () => {
    expect(stub().step.name).toBe("coding");
  });
});

describe("CodingStep result mapping", () => {
  const META = { task_id: "TASK-011", task_plan_file: "specs/feature.plan.json" };
  const mapped: Array<[string, object, object]> = [
    ["repeat", { outcome: "repeat" }, { type: "Continue" }],
    ["complete", { outcome: "complete" }, { type: "Finished" }],
    ["fail", { outcome: "fail", failure_summary: "broke" }, { type: "StepFailed", failureSummary: "broke" }],
    ["blocked", { outcome: "blocked", blocker_text: "need key" }, { type: "Blocked", blockerText: "need key" }],
  ];

  it.each(mapped)("maps a %s block, carrying task metadata as parsed", async (_name, block, expected) => {
    expect(await stub(reply(block)).step.execute("p", OPTIONS)).toEqual(expected);
    expect(await stub(reply({ ...block, ...META })).step.execute("p", OPTIONS)).toEqual({ ...expected, ...META });
    const nulls = { ...block, task_id: null, task_plan_file: null };
    if (_name === "blocked") {
      expect(await stub(reply(nulls)).step.execute("p", OPTIONS)).toEqual({
        ...expected,
        task_id: null,
        task_plan_file: null,
      });
    }
  });

  it("maps timed out and interrupted sessions", async () => {
    expect(await stub({ kind: "timed-out" }).step.execute("p", OPTIONS)).toEqual({ type: "Timeout" });
    expect(await stub({ kind: "interrupted" }).step.execute("p", OPTIONS)).toEqual({ type: "Interrupted" });
  });

  it("maps a launch failure to SessionFailed with an empty stderr tail", async () => {
    const session: SessionResult = { kind: "launch-failed", detail: "failed to launch agent: ENOENT" };
    expect(await stub(session).step.execute("p", OPTIONS)).toEqual({
      type: "SessionFailed",
      detail: "failed to launch agent: ENOENT",
      stderrTail: [],
    });
  });

  it.each(["exited-unsuccessfully", "missing-final-message", "invalid-final-message"] as const)(
    "maps %s to SessionFailed with its detail and stderr tail",
    async (kind) => {
      const session: SessionResult = { kind, detail: "some detail", stderrTail: ["a", "b"] };
      expect(await stub(session).step.execute("p", OPTIONS)).toEqual({
        type: "SessionFailed",
        detail: "some detail",
        stderrTail: ["a", "b"],
      });
    },
  );

  it("turns a contract violation into SessionFailed with the session's stderr tail", async () => {
    const session: SessionResult = { kind: "success", finalMessage: "no block here", stderrTail: ["last"] };
    const result = await stub(session).step.execute("p", OPTIONS);
    expect(result).toMatchObject({ type: "SessionFailed", stderrTail: ["last"] });
    expect((result as { detail: string }).detail).toMatch(
      /^agent final response is invalid: the final message has no <afk-harness-result nonce="[0-9a-f]+"> block$/,
    );
  });

  it("treats an empty final message as a contract violation", async () => {
    const session: SessionResult = { kind: "success", finalMessage: " ", stderrTail: [] };
    expect(await stub(session).step.execute("p", OPTIONS)).toEqual({
      type: "SessionFailed",
      detail: "agent final response is invalid: the final message is missing or empty",
      stderrTail: [],
    });
  });

  it("ignores a block carrying another nonce", async () => {
    const stale: SessionResult = {
      kind: "success",
      finalMessage: '<afk-harness-result nonce="cafebabe">\n{"outcome":"complete"}\n</afk-harness-result>',
      stderrTail: [],
    };
    expect(await stub(stale).step.execute("p", OPTIONS)).toMatchObject({ type: "SessionFailed" });
  });

  it("uses only the last block with its own nonce", async () => {
    const result = (nonce: string): SessionResult => ({
      kind: "success",
      finalMessage: [
        `<afk-harness-result nonce="${nonce}">\n{"outcome":"repeat"}\n</afk-harness-result>`,
        `<afk-harness-result nonce="deadbeef">\n{"outcome":"complete"}\n</afk-harness-result>`,
        `<afk-harness-result nonce="${nonce}">\n{"outcome":"complete"}\n</afk-harness-result>`,
      ].join("\n"),
      stderrTail: [],
    });
    expect(await stub(result).step.execute("p", OPTIONS)).toEqual({ type: "Finished" });
  });
});
