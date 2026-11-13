import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, startAfk, withoutNonce, type Step } from "./support/helpers.js";

const say = (message: object): Step[] => [{ finalMessage: JSON.stringify(message) }, { exit: 0 }];
const REPEAT = say({ outcome: "repeat" });

describe("afk run loop", () => {
  it("launches repeat, fail, complete as three separate identical codex exec processes", async () => {
    const fake = createFakeCodexEnvironment({
      sessions: [REPEAT, say({ outcome: "fail", failure_summary: "tests broke" }), say({ outcome: "complete" })],
    });

    const run = await startAfk({ args: ["build X"], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(0);
    const invocations = fake.invocations();
    expect(invocations).toHaveLength(3);
    for (const { argv, cwd, stdin } of invocations) {
      expect(argv[0]).toBe("exec");
      expect(argv).not.toContain("resume");
      expect(argv).not.toContain("fork");
      expect(cwd).toBe(fake.workspace);
      expect(withoutNonce(stdin)).toBe(withoutNonce(invocations[0]!.stdin));
    }
    expect(run.stderr).toContain("tests broke");
  });

  it("prints the blocker and exits 1 after exactly one launch", async () => {
    const fake = createFakeCodexEnvironment({
      sessions: [say({ outcome: "blocked", blocker_text: "need API key" }), say({ outcome: "complete" })],
    });

    const run = await startAfk({ args: ["build X"], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("need API key");
    expect(fake.invocations()).toHaveLength(1);
  });

  it.each(["0", "-1", "1.5", "abc"])("rejects --max-iterations %s with exit 2 and no launch", async (value) => {
    const fake = createFakeCodexEnvironment(say({ outcome: "complete" }));

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
    const fake = createFakeCodexEnvironment(say({ outcome: "complete" }));

    const run = await startAfk({ args: ["build X", option, value], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(option);
    expect(fake.invocations()).toHaveLength(0);
  });

  it("accepts the verification options and runs", async () => {
    const fake = createFakeCodexEnvironment(say({ outcome: "complete" }));
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
    const fake = createFakeCodexEnvironment(REPEAT);
    const args = ["build X", "--max-iterations", "2"];

    const first = await startAfk({ args, cwd: fake.workspace, env: fake.env }).done;
    expect(fake.invocations()).toHaveLength(2);
    const second = await startAfk({ args, cwd: fake.workspace, env: fake.env }).done;

    expect(fake.invocations()).toHaveLength(4);
    for (const run of [first, second]) {
      expect(run.exitCode).toBe(4);
      expect(run.stderr).toMatch(/iteration limit.*2/i);
    }
  });
});
