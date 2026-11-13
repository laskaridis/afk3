import { describe, expect, it } from "vitest";
import {
  createFakeCodexEnvironment,
  expectedCorrectionPrompt,
  expectedSessionPrompt,
  expectedVerificationPrompt,
  IMPLEMENTED,
  PASSED,
  REJECTED,
  reply,
  rounds,
  startAfk,
  type Step,
} from "./support/helpers.js";

const AGENT_NAMES = ["codex", "claude"];

const NO_MORE = reply({ outcome: "no_more_tasks", task_id: null, task_plan_file: "p.json" });
const FINISHED = reply({ outcome: "workflow_finished", task_id: "T-1", task_plan_file: "p.json" });
const WITH_REVISION = reply({
  outcome: "task_implemented",
  task_id: "T-1",
  task_plan_file: "p.json",
  revision: "9f3c2ab",
});

async function run(agent: string, sessions: Step[][], args: string[] = []) {
  const fake = createFakeCodexEnvironment({ sessions }, agent);
  const result = await startAfk({
    args: ["--agent", agent, ...args, "build X"],
    cwd: fake.workspace,
    env: fake.env,
  }).done;
  return { result, invocations: fake.invocations() };
}

const lines = (stderr: string) => stderr.split("\n").filter(Boolean);

describe.each(AGENT_NAMES)("two-phase loop: %s", (agent) => {
  it("verifies the candidate with the exact verification prompt, then resumes autonomous coding", async () => {
    const { result, invocations } = await run(agent, [WITH_REVISION, PASSED, NO_MORE]);

    expect(result.exitCode).toBe(0);
    expect(invocations).toHaveLength(3);
    expect(invocations[0]!.stdin).toBe(expectedSessionPrompt("build X", invocations[0]!.stdin));
    expect(invocations[1]!.stdin).toBe(
      expectedVerificationPrompt(
        "build X",
        { taskId: "T-1", taskPlanFile: "p.json", revision: "9f3c2ab" },
        invocations[1]!.stdin,
      ),
    );
    expect(invocations[2]!.stdin).toBe(expectedSessionPrompt("build X", invocations[2]!.stdin));
    expect(lines(result.stderr)).toEqual([
      "[afk] Iteration 1/10: starting agent session",
      "[afk] Iteration 1/10: starting verification session",
      "[afk] Verification passed",
      "[afk] Iteration 2/10: starting agent session",
      "[afk] Run complete: no more tasks",
    ]);
  });

  it("omits the revision line when none was reported", async () => {
    const { invocations } = await run(agent, [IMPLEMENTED, PASSED, NO_MORE]);
    expect(invocations[1]!.stdin).toBe(
      expectedVerificationPrompt("build X", { taskId: "T-1", taskPlanFile: "p.json" }, invocations[1]!.stdin),
    );
    expect(invocations[1]!.stdin).not.toContain("- revision:");
  });

  it("never resumes or forks, and runs every session in the same workspace", async () => {
    const { invocations } = await run(agent, [IMPLEMENTED, PASSED, NO_MORE]);
    expect(new Set(invocations.map((invocation) => invocation.cwd)).size).toBe(1);
    for (const { argv } of invocations) {
      expect(argv).not.toContain("resume");
      expect(argv).not.toContain("fork");
    }
  });

  it("workflow_finished completes the run with exit 0 and no further session", async () => {
    const { result, invocations } = await run(agent, [IMPLEMENTED, FINISHED, NO_MORE]);
    expect(result.exitCode).toBe(0);
    expect(invocations).toHaveLength(2);
    expect(lines(result.stderr)).toEqual([
      "[afk] Iteration 1/10: starting agent session",
      "[afk] Iteration 1/10: starting verification session",
      "[afk] Verification passed",
      "[afk] Run complete: feature complete",
    ]);
  });

  it("sends a rejection back as a correction iteration with the exact correction prompt", async () => {
    const { result, invocations } = await run(agent, [IMPLEMENTED, REJECTED, IMPLEMENTED, PASSED, NO_MORE]);

    expect(result.exitCode).toBe(0);
    expect(invocations).toHaveLength(5);
    expect(invocations[2]!.stdin).toBe(
      expectedCorrectionPrompt(
        { taskId: "T-1", taskPlanFile: "p.json", findingsFile: "p.verify.md", failureSummary: "AC-1 not met" },
        invocations[2]!.stdin,
      ),
    );
    expect(invocations[2]!.stdin).not.toContain("build X");
    expect(invocations[4]!.stdin).toBe(expectedSessionPrompt("build X", invocations[4]!.stdin));
    expect(lines(result.stderr)).toEqual([
      "[afk] Iteration 1/10: starting agent session",
      "[afk] Iteration 1/10: starting verification session",
      "[afk] Verification failed (attempt 1/2): AC-1 not met",
      "[afk] Iteration 2/10: starting agent session",
      "[afk] Iteration 2/10: starting verification session",
      "[afk] Verification passed",
      "[afk] Iteration 3/10: starting agent session",
      "[afk] Run complete: no more tasks",
    ]);
  });

  it("counts a correction iteration against --max-iterations and still verifies the last candidate", async () => {
    const { result, invocations } = await run(
      agent,
      [IMPLEMENTED, REJECTED, IMPLEMENTED, PASSED],
      ["--max-iterations", "2"],
    );
    expect(result.exitCode).toBe(4);
    expect(invocations).toHaveLength(4);
    expect(lines(result.stderr).at(-1)).toBe(
      "[afk] Run stopped: iteration limit of 2 reached without reported completion",
    );
  });

  it("ends with exit 4 when the last allowed iteration is rejected below the attempt limit", async () => {
    const { result, invocations } = await run(agent, [IMPLEMENTED, REJECTED], ["--max-iterations", "1"]);
    expect(result.exitCode).toBe(4);
    expect(invocations).toHaveLength(2);
  });

  it("ends with exit 0 when the last allowed iteration is verified as the finished feature", async () => {
    const { result } = await run(agent, [IMPLEMENTED, FINISHED], ["--max-iterations", "1"]);
    expect(result.exitCode).toBe(0);
  });

  it("prints the blocker of a blocked verification and exits 1 without another session", async () => {
    const { result, invocations } = await run(agent, [
      IMPLEMENTED,
      reply({ outcome: "blocked", blocker_text: "plan unreadable", task_id: "T-1", task_plan_file: "p.json" }),
      NO_MORE,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("[afk] Run blocked: plan unreadable");
    expect(invocations).toHaveLength(2);
  });

  it("retries a verification execution error once with the same assignment and a new nonce", async () => {
    const { result, invocations } = await run(agent, [IMPLEMENTED, [{ exit: 7 }], PASSED, NO_MORE]);
    expect(result.exitCode).toBe(0);
    expect(invocations).toHaveLength(4);
    const nonce = (prompt: string) => /nonce="([^"]+)"/.exec(prompt)![1]!;
    const mask = (prompt: string) => prompt.replaceAll(nonce(prompt), "<nonce>");
    expect(mask(invocations[2]!.stdin)).toBe(mask(invocations[1]!.stdin));
    expect(nonce(invocations[2]!.stdin)).not.toBe(nonce(invocations[1]!.stdin));
    expect(lines(result.stderr)).toContain("[afk] Iteration 1/10: retrying verification session after execution error");
    expect(lines(result.stderr).filter((line) => line.includes("starting verification session"))).toHaveLength(1);
  });

  it("ends the run with exit 3 after two consecutive verification execution errors", async () => {
    const { result, invocations } = await run(agent, [IMPLEMENTED, [{ exit: 7 }]]);
    expect(result.exitCode).toBe(3);
    expect(invocations).toHaveLength(3);
  });

  it.each([
    ["a coding outcome in the verification phase", IMPLEMENTED],
    ["a former outcome", reply({ outcome: "complete", task_id: "T-1", task_plan_file: "p.json" })],
    [
      "another task than the assigned one",
      reply({ outcome: "verification_passed", task_id: "T-9", task_plan_file: "p.json" }),
    ],
  ])("treats %s as an invalid verification response", async (_name, bad) => {
    const { result, invocations } = await run(agent, [IMPLEMENTED, bad, bad]);
    expect(result.exitCode).toBe(3);
    expect(invocations).toHaveLength(3);
    expect(result.stderr).toContain("agent final response is invalid");
  });

  it("treats a correction answer for another task as an invalid response", async () => {
    const other = reply({ outcome: "task_implemented", task_id: "T-9", task_plan_file: "p.json" });
    const { result, invocations } = await run(agent, [IMPLEMENTED, REJECTED, other, other]);
    expect(result.exitCode).toBe(3);
    expect(invocations).toHaveLength(4);
    expect(result.stderr).toContain('but the assigned task is "T-1"');
  });

  it("repeats the correction assignment with a new nonce after an execution error", async () => {
    const { result, invocations } = await run(agent, [
      IMPLEMENTED,
      REJECTED,
      [{ exit: 7 }],
      IMPLEMENTED,
      PASSED,
      NO_MORE,
    ]);
    expect(result.exitCode).toBe(0);
    const nonce = (prompt: string) => /nonce="([^"]+)"/.exec(prompt)![1]!;
    const mask = (prompt: string) => prompt.replaceAll(nonce(prompt), "<nonce>");
    expect(mask(invocations[3]!.stdin)).toBe(mask(invocations[2]!.stdin));
    expect(nonce(invocations[3]!.stdin)).not.toBe(nonce(invocations[2]!.stdin));
  });

  it("counts verification_failed per task", async () => {
    const second = reply({ outcome: "task_implemented", task_id: "T-2", task_plan_file: "p.json" });
    const rejectSecond = reply({
      outcome: "verification_failed",
      failure_summary: "no",
      findings_file: "p.verify.md",
      task_id: "T-2",
      task_plan_file: "p.json",
    });
    const { result } = await run(
      agent,
      [
        IMPLEMENTED,
        REJECTED,
        IMPLEMENTED,
        REJECTED,
        IMPLEMENTED,
        PASSED,
        second,
        rejectSecond,
        second,
        PASSED,
        NO_MORE,
      ],
      ["--max-verification-attempts", "5"],
    );
    const attempts = lines(result.stderr).filter((line) => line.startsWith("[afk] Verification failed"));
    expect(attempts).toEqual([
      "[afk] Verification failed (attempt 1/5): AC-1 not met",
      "[afk] Verification failed (attempt 2/5): AC-1 not met",
      "[afk] Verification failed (attempt 1/5): no",
    ]);
  });

  it("verifies on every iteration of a long loop", async () => {
    const { result, invocations } = await run(agent, rounds(IMPLEMENTED, PASSED, 3), ["--max-iterations", "3"]);
    expect(result.exitCode).toBe(4);
    expect(invocations).toHaveLength(6);
  });
});
