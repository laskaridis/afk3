import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SessionExecutor } from "../../../../src/session/session-executor.js";
import type { SessionInput } from "../../../../src/session/session-input.js";
import type { SessionResult } from "../../../../src/session/session-result.js";
import { CodingStep } from "../../../../src/workflow/steps/coding-step.js";

const harness = readFileSync(new URL("../../../../src/workflow/steps/coding-step.md", import.meta.url), "utf8");
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

const IMPLEMENTED = { outcome: "task_implemented", task_id: "TASK-011", task_plan_file: "p.json" };

const reply =
  (message: object): Scripted =>
  (nonce) => ({
    kind: "success",
    finalMessage: `<afk-harness-result nonce="${nonce}">\n${JSON.stringify(message)}\n</afk-harness-result>`,
    stderrTail: [],
  });

describe("CodingStep session prompt", () => {
  it("passes the launch prompt, a blank line, ---, coding-step.md with the nonce and a trailing newline", async () => {
    const { step, inputs, nonces } = stub(reply(IMPLEMENTED));
    await step.execute("  build X\nnow ", OPTIONS);
    expect(inputs[0]!.prompt).toBe(`  build X\nnow \n\n---\n${harness.replaceAll("{{NONCE}}", nonces[0]!)}\n`);
    expect(inputs[0]!.prompt).not.toContain("{{NONCE}}");
    expect(inputs[0]).toMatchObject({ cwd: "/work", model: "m", effort: "high" });
  });

  it("generates a fresh nonce on every execution", async () => {
    const { step, nonces } = stub(reply(IMPLEMENTED));
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

  it("maps task_implemented, carrying task metadata", async () => {
    expect(await stub(reply({ outcome: "task_implemented", ...META })).step.execute("p", OPTIONS)).toEqual({
      type: "TaskImplemented",
      ...META,
    });
  });

  it.each(["9f3c2ab", null])("maps task_implemented carrying the revision %j", async (revision) => {
    expect(await stub(reply({ outcome: "task_implemented", revision, ...META })).step.execute("p", OPTIONS)).toEqual({
      type: "TaskImplemented",
      revision,
      ...META,
    });
  });

  it("maps no_more_tasks, carrying task metadata", async () => {
    const meta = { task_id: null, task_plan_file: META.task_plan_file };
    expect(await stub(reply({ outcome: "no_more_tasks", ...meta })).step.execute("p", OPTIONS)).toEqual({
      type: "NoMoreTasks",
      ...meta,
    });
  });

  it.each([META, { task_id: null, task_plan_file: null }])("maps blocked, carrying task metadata %j", async (meta) => {
    expect(
      await stub(reply({ outcome: "blocked", blocker_text: "need key", ...meta })).step.execute("p", OPTIONS),
    ).toEqual({ type: "Blocked", blockerText: "need key", ...meta });
  });

  it.each(["repeat", "complete", "fail", "workflow_finished"])(
    "reports the former or foreign outcome %s as an invalid response",
    async (outcome) => {
      const result = await stub(reply({ outcome, ...META })).step.execute("p", OPTIONS);
      expect(result).toMatchObject({ type: "SessionFailed" });
      expect((result as { detail: string }).detail).toContain(
        "agent final response is invalid: missing or unsupported",
      );
    },
  );

  it("reports a block omitting task_id as an invalid response", async () => {
    const result = await stub(reply({ outcome: "task_implemented", task_plan_file: "p.json" })).step.execute(
      "p",
      OPTIONS,
    );
    expect(result).toMatchObject({
      type: "SessionFailed",
      detail: 'agent final response is invalid: "task_id" is required',
    });
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
      finalMessage: `<afk-harness-result nonce="cafebabe">\n${JSON.stringify(IMPLEMENTED)}\n</afk-harness-result>`,
      stderrTail: [],
    };
    expect(await stub(stale).step.execute("p", OPTIONS)).toMatchObject({ type: "SessionFailed" });
  });

  it("uses only the last block with its own nonce", async () => {
    const result = (nonce: string): SessionResult => ({
      kind: "success",
      finalMessage: [
        `<afk-harness-result nonce="${nonce}">\n${JSON.stringify(IMPLEMENTED)}\n</afk-harness-result>`,
        `<afk-harness-result nonce="deadbeef">\n${JSON.stringify(IMPLEMENTED)}\n</afk-harness-result>`,
        `<afk-harness-result nonce="${nonce}">\n${JSON.stringify({ ...IMPLEMENTED, task_id: "TASK-012" })}\n</afk-harness-result>`,
      ].join("\n"),
      stderrTail: [],
    });
    expect(await stub(result).step.execute("p", OPTIONS)).toEqual({
      type: "TaskImplemented",
      task_id: "TASK-012",
      task_plan_file: "p.json",
    });
  });
});

describe("coding-step.md contract", () => {
  it("documents the coding vocabulary only, in its example block, rules and stop conditions", () => {
    for (const outcome of ["task_implemented", "no_more_tasks", "blocked"]) expect(harness).toContain(`"${outcome}"`);
    for (const former of ["repeat", "complete", "fail", "workflow_finished", "verification_passed"]) {
      expect(harness).not.toContain(`\`${former}\``);
      expect(harness).not.toContain(`"outcome":"${former}"`);
    }
    expect(harness).not.toContain("failure_summary");
    expect(harness).toContain('<afk-harness-result nonce="{{NONCE}}">');
  });

  it("states that a session commits a candidate, never marks a task complete, and documents revision", () => {
    expect(harness).toContain("Do NOT mark the task as complete");
    expect(harness).toContain("Commit the candidate");
    expect(harness).toContain("`revision`");
  });

  it("requires a progress entry for every committed candidate and keeps the findings file out of the notes", () => {
    expect(harness).toContain("Every committed candidate must have a matching progress entry");
    expect(harness).toContain("including a candidate committed in a correction iteration");
    expect(harness).toContain("Never rely on the verification agent's findings file for your own notes");
  });

  it("extends explicit-assignment rules to a harness-supplied assignment and drops the delegated review", () => {
    expect(harness).toContain("harness-supplied assignment");
    expect(harness).toContain("`findings_file`");
    expect(harness).toContain("`spec_path`");
    expect(harness).not.toContain("delegate a read-only review");
  });

  it("keeps a validation task that finds a defect recording a follow-up and reporting task_implemented", () => {
    expect(harness).toContain("record a follow-up fix task");
    expect(harness).toMatch(/follow-up fix task[^\n]*`task_implemented`/);
  });
});
