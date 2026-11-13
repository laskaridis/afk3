import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, PASSED, rounds, startAfk, withoutNonce, type Step } from "./support/helpers.js";

const say = (message: object): Step[] => [{ finalMessage: JSON.stringify(message) }, { exit: 0 }];
const REPEAT = say({ outcome: "task_implemented", task_id: "T-1", task_plan_file: "p.json" });

describe("afk run loop", () => {
  it("launches coding and verification sessions as separate codex exec processes, each coding session identical", async () => {
    const fake = createFakeCodexEnvironment({
      sessions: [
        REPEAT,
        PASSED,
        REPEAT,
        PASSED,
        say({ outcome: "no_more_tasks", task_id: null, task_plan_file: "p.json" }),
      ],
    });

    const run = await startAfk({ args: ["build X"], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(0);
    const invocations = fake.invocations();
    expect(invocations).toHaveLength(5);
    for (const { argv, cwd } of invocations) {
      expect(argv[0]).toBe("exec");
      expect(argv).not.toContain("resume");
      expect(argv).not.toContain("fork");
      expect(cwd).toBe(fake.workspace);
    }
    for (const index of [0, 2, 4]) {
      expect(withoutNonce(invocations[index]!.stdin)).toBe(withoutNonce(invocations[0]!.stdin));
    }
    expect(invocations[1]!.stdin).toContain("Verification Assignment:");
    expect(run.stderr).toContain("Run complete: no more tasks");
  });

  it("prints the blocker and exits 1 after exactly one launch", async () => {
    const fake = createFakeCodexEnvironment({
      sessions: [
        say({ outcome: "blocked", blocker_text: "need API key", task_id: "T-1", task_plan_file: "p.json" }),
        say({ outcome: "no_more_tasks", task_id: null, task_plan_file: "p.json" }),
      ],
    });

    const run = await startAfk({ args: ["build X"], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("need API key");
    expect(fake.invocations()).toHaveLength(1);
  });

  it.each(["0", "-1", "1.5", "abc"])("rejects --max-iterations %s with exit 2 and no launch", async (value) => {
    const fake = createFakeCodexEnvironment(say({ outcome: "no_more_tasks", task_id: null, task_plan_file: "p.json" }));

    const run = await startAfk({ args: ["build X", "--max-iterations", value], cwd: fake.workspace, env: fake.env })
      .done;

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toMatch(/max-iterations/);
    expect(fake.invocations()).toHaveLength(0);
  });

  it.each([
    ["--max-verification-attempts", "0"],
    ["--max-verification-attempts", "1.5"],
    ["--max-verification-attempts", "abc"],
    ["--verify-model", ""],
    ["--verify-reasoning-effort", "  "],
  ])("rejects %s %j with exit 2 and no launch", async (option, value) => {
    const fake = createFakeCodexEnvironment(say({ outcome: "no_more_tasks", task_id: null, task_plan_file: "p.json" }));

    const run = await startAfk({ args: ["build X", option, value], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(option);
    expect(fake.invocations()).toHaveLength(0);
  });

  it("accepts the verification options and runs", async () => {
    const fake = createFakeCodexEnvironment(say({ outcome: "no_more_tasks", task_id: null, task_plan_file: "p.json" }));
    const args = [
      "build X",
      "--max-verification-attempts",
      "3",
      "--verify-model",
      "m",
      "--verify-reasoning-effort",
      "high",
    ];

    const run = await startAfk({ args, cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(0);
    expect(fake.invocations()).toHaveLength(1);
  });

  it("gives each run a fresh budget and stops with the iteration limit (exit 4)", async () => {
    const fake = createFakeCodexEnvironment({ sessions: rounds(REPEAT, PASSED, 4) });
    const args = ["build X", "--max-iterations", "2"];

    const first = await startAfk({ args, cwd: fake.workspace, env: fake.env }).done;
    expect(fake.invocations()).toHaveLength(4);
    const second = await startAfk({ args, cwd: fake.workspace, env: fake.env }).done;

    expect(fake.invocations()).toHaveLength(8);
    for (const run of [first, second]) {
      expect(run.exitCode).toBe(4);
      expect(run.stderr).toMatch(/iteration limit.*2/i);
    }
  });
});
