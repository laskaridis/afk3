import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, startAfk, type Step } from "./helpers.js";

const complete: Step[] = [{ finalMessage: '{"outcome":"complete"}' }, { exit: 0 }];

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(condition: () => boolean, timeoutMs = 5000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 20));
  }
}

function startInterruptible(sessions: Step[][], extraEnv: Record<string, string> = {}) {
  const fake = createFakeCodexEnvironment({ sessions });
  const afk = startAfk({
    args: ["do it"],
    cwd: fake.workspace,
    env: { ...fake.env, AFK_TERMINATION_GRACE_MS: "300", ...extraEnv },
  });
  return { fake, afk };
}

describe("interruption", () => {
  it("forwards SIGINT to codex, exits 130 with a status, and launches nothing more", async () => {
    const { fake, afk } = startInterruptible([[{ writeFile: "partial.txt" }, { sleepMs: 30000 }], complete]);
    await until(() => fake.invocations().length === 1);
    afk.child.kill("SIGINT");
    const run = await afk.done;

    expect(fake.signals()).toContain("SIGINT");
    expect(run.exitCode).toBe(130);
    expect(run.stderr).toContain("interrupted by user");
    expect(fake.invocations()).toHaveLength(1);
    // Workspace changes are preserved.
    expect(existsSync(join(fake.workspace, "partial.txt"))).toBe(true);
  });

  it("escalates when codex ignores SIGINT and leaves no child behind", async () => {
    const { fake, afk } = startInterruptible([[{ ignoreSignals: true }, { sleepMs: 30000 }], complete]);
    await until(() => fake.invocations().length === 1);
    const { pid } = fake.soleInvocation();
    afk.child.kill("SIGINT");
    const run = await afk.done;

    expect(fake.signals()).toEqual(expect.arrayContaining(["SIGINT", "SIGTERM"]));
    expect(run.exitCode).toBe(130);
    expect(isRunning(pid)).toBe(false);
  });

  it("does not retry or iterate when interrupted again while terminating, even if codex fails", async () => {
    const { fake, afk } = startInterruptible([[{ ignoreSignals: true }, { sleepMs: 30000 }], complete]);
    await until(() => fake.invocations().length === 1);
    afk.child.kill("SIGINT");
    await until(() => fake.signals().length > 0);
    afk.child.kill("SIGINT");
    const run = await afk.done;

    expect(run.exitCode).toBe(130);
    expect(fake.invocations()).toHaveLength(1);
    expect(run.stderr).not.toContain("retrying");
  });

  it("does not retry when the interrupted codex exits non-zero without a final message", async () => {
    const { fake, afk } = startInterruptible([[{ sleepMs: 30000 }], complete]);
    await until(() => fake.invocations().length === 1);
    afk.child.kill("SIGINT"); // fake exits 130 with no final message
    const run = await afk.done;

    expect(run.exitCode).toBe(130);
    expect(fake.invocations()).toHaveLength(1);
    expect(run.stderr).not.toContain("retrying");
  });

  it("only exits after the codex child is gone", async () => {
    const { fake, afk } = startInterruptible([[{ ignoreSignals: true }, { sleepMs: 30000 }]]);
    await until(() => fake.invocations().length === 1);
    const { pid } = fake.soleInvocation();
    afk.child.kill("SIGINT");
    await afk.done;
    expect(isRunning(pid)).toBe(false);
  });
});
