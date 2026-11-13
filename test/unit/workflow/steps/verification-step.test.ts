import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SessionExecutor } from "../../../../src/session/session-executor.js";
import type { SessionInput } from "../../../../src/session/session-input.js";
import type { SessionResult } from "../../../../src/session/session-result.js";
import type { VerificationAssignment } from "../../../../src/workflow/assignment.js";
import { VerificationStep } from "../../../../src/workflow/steps/verification-step.js";

const harness = readFileSync(new URL("../../../../src/workflow/steps/verification-step.md", import.meta.url), "utf8");
const OPTIONS = { cwd: "/work", model: "m", effort: "high" };
const ASSIGNMENT: VerificationAssignment = {
  taskId: "TASK-003",
  taskPlanFile: "specs/f.plan.json",
  revision: "9f3c2ab",
};

/** A stubbed SessionExecutor that answers with the result built from the session's nonce. */
function stub(result: (nonce: string) => SessionResult, assignment: VerificationAssignment = ASSIGNMENT) {
  const inputs: SessionInput[] = [];
  const nonces: string[] = [];
  const executor = {
    execute: async (input: SessionInput) => {
      inputs.push(input);
      const nonce = /<afk-harness-result nonce="([0-9a-f]+)">/.exec(input.prompt)![1]!;
      nonces.push(nonce);
      return result(nonce);
    },
  } as unknown as SessionExecutor;
  return { step: new VerificationStep(executor, assignment), inputs, nonces };
}

const reply = (message: object) => (nonce: string) =>
  ({
    kind: "success",
    finalMessage: `<afk-harness-result nonce="${nonce}">\n${JSON.stringify(message)}\n</afk-harness-result>`,
    stderrTail: [],
  }) satisfies SessionResult;

const META = { task_id: "TASK-003", task_plan_file: "specs/f.plan.json" };

describe("VerificationStep session prompt", () => {
  it("is the launch prompt, the assignment, ---, then verification-step.md with the nonce and a trailing newline", async () => {
    const { step, inputs, nonces } = stub(reply({ outcome: "verification_passed", ...META }));
    await step.execute("build X", OPTIONS);
    expect(inputs[0]!.prompt).toBe(
      [
        "build X",
        "",
        "Verification Assignment:",
        "- task_id: TASK-003",
        "- task_plan_file: specs/f.plan.json",
        "- revision: 9f3c2ab",
        "---",
        `${harness.replaceAll("{{NONCE}}", nonces[0]!)}\n`,
      ].join("\n"),
    );
    expect(inputs[0]).toMatchObject({ cwd: "/work", model: "m", effort: "high" });
  });

  it.each([undefined, null])("omits the revision line when the revision is %s", async (revision) => {
    const { step, inputs } = stub(reply({ outcome: "verification_passed", ...META }), { ...ASSIGNMENT, revision });
    await step.execute("p", OPTIONS);
    expect(inputs[0]!.prompt.split("\n---\n")[0]).toBe(
      "p\n\nVerification Assignment:\n- task_id: TASK-003\n- task_plan_file: specs/f.plan.json",
    );
  });

  it("passes the assignment paths through verbatim", async () => {
    const { step, inputs } = stub(
      reply({ outcome: "verification_passed", task_id: "T 1", task_plan_file: "../a b/p" }),
      {
        taskId: "T 1",
        taskPlanFile: "../a b/p",
      },
    );
    await step.execute("p", OPTIONS);
    expect(inputs[0]!.prompt).toContain("- task_plan_file: ../a b/p\n---\n");
  });

  it("generates a fresh nonce on every execution and is named verification", async () => {
    const { step, nonces } = stub(reply({ outcome: "verification_passed", ...META }));
    await step.execute("p", OPTIONS);
    await step.execute("p", OPTIONS);
    expect(nonces[0]).not.toBe(nonces[1]);
    expect(step.name).toBe("verification");
  });
});

describe("VerificationStep result mapping", () => {
  const run = (message: object) => stub(reply(message)).step.execute("p", OPTIONS);

  it("maps verification_passed", async () => {
    expect(await run({ outcome: "verification_passed", ...META })).toEqual({ type: "VerificationPassed", ...META });
  });

  it("maps workflow_finished", async () => {
    expect(await run({ outcome: "workflow_finished", ...META })).toEqual({ type: "FeatureVerified", ...META });
  });

  it("maps verification_failed with its summary and findings file", async () => {
    expect(
      await run({ outcome: "verification_failed", failure_summary: "bad", findings_file: "f.verify.md", ...META }),
    ).toEqual({ type: "VerificationFailed", failureSummary: "bad", findingsFile: "f.verify.md", ...META });
  });

  it("maps blocked, including a blocked response with a null task", async () => {
    expect(await run({ outcome: "blocked", blocker_text: "x", ...META })).toEqual({
      type: "Blocked",
      blockerText: "x",
      ...META,
    });
    const none = { task_id: null, task_plan_file: null };
    expect(await run({ outcome: "blocked", blocker_text: "x", ...none })).toEqual({
      type: "Blocked",
      blockerText: "x",
      ...none,
    });
  });

  it.each(["task_implemented", "no_more_tasks", "repeat", "complete", "fail"])(
    "reports the coding or former outcome %s as an invalid response",
    async (outcome) => {
      expect(await run({ outcome, ...META })).toMatchObject({ type: "SessionFailed" });
    },
  );

  it("reports findings_file on a pass and a missing findings_file on a rejection as invalid", async () => {
    expect(await run({ outcome: "verification_passed", findings_file: "f.md", ...META })).toMatchObject({
      type: "SessionFailed",
    });
    expect(await run({ outcome: "verification_failed", failure_summary: "bad", ...META })).toMatchObject({
      type: "SessionFailed",
    });
  });

  it("reports a different task id as invalid, except for blocked with a null task_id", async () => {
    expect(await run({ outcome: "verification_passed", task_id: "TASK-004", task_plan_file: "p" })).toMatchObject({
      type: "SessionFailed",
      detail: 'agent final response is invalid: "task_id" is "TASK-004" but the assigned task is "TASK-003"',
    });
  });

  it("maps session problems like the coding step does", async () => {
    const step = (session: SessionResult) => stub(() => session).step.execute("p", OPTIONS);
    expect(await step({ kind: "timed-out" })).toEqual({ type: "Timeout" });
    expect(await step({ kind: "interrupted" })).toEqual({ type: "Interrupted" });
    expect(await step({ kind: "launch-failed", detail: "ENOENT" })).toEqual({
      type: "SessionFailed",
      detail: "ENOENT",
      stderrTail: [],
    });
    expect(await step({ kind: "exited-unsuccessfully", detail: "d", stderrTail: ["t"] })).toEqual({
      type: "SessionFailed",
      detail: "d",
      stderrTail: ["t"],
    });
    expect(await step({ kind: "success", finalMessage: "no block", stderrTail: ["t"] })).toMatchObject({
      type: "SessionFailed",
      stderrTail: ["t"],
    });
  });
});
