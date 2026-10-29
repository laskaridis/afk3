import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, startAfk, type Step } from "./helpers.js";

const complete: Step[] = [{ finalMessage: '{"outcome":"complete"}' }, { exit: 0 }];
const repeat: Step[] = [{ sleepMs: 1000 }, { finalMessage: '{"outcome":"repeat"}' }, { exit: 0 }];

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function run(sessions: Step[][], args: string[]) {
  const fake = createFakeCodexEnvironment({ sessions });
  const afk = startAfk({
    args: ["do it", ...args],
    cwd: fake.workspace,
    env: { ...fake.env, AFK_TERMINATION_GRACE_MS: "300" },
  });
  return { fake, done: afk.done };
}

describe("--session-timeout", () => {
  it("terminates a hung session, reports the duration, exits 5 and launches nothing more", async () => {
    const { fake, done } = run(
      [[{ writeFile: "partial.txt" }, { sleepMs: 30000 }], complete],
      ["--session-timeout", "1"],
    );
    const result = await done;

    expect(result.exitCode).toBe(5);
    expect(result.stderr).toContain("timed out after 1 seconds");
    expect(result.stderr).not.toContain("retrying");
    expect(fake.signals()).toContain("SIGINT");
    expect(fake.invocations()).toHaveLength(1);
    expect(existsSync(join(fake.workspace, "partial.txt"))).toBe(true);
    expect(isRunning(fake.invocations()[0]!.pid)).toBe(false);
  }, 15000);

  it("applies the timeout to each session separately", async () => {
    const { fake, done } = run([repeat, repeat, [{ sleepMs: 1000 }, ...complete]], ["--session-timeout", "2"]);
    const result = await done;

    expect(result.exitCode).toBe(0);
    expect(fake.invocations()).toHaveLength(3);
  }, 15000);

  it("does not interrupt a slow session without the option", async () => {
    const { fake, done } = run([[{ sleepMs: 3000 }, ...complete]], []);
    const result = await done;

    expect(result.exitCode).toBe(0);
    expect(fake.signals()).toEqual([]);
  }, 15000);

  it.each(["0", "-5", "abc"])("rejects --session-timeout %s without launching codex", async (value) => {
    const { fake, done } = run([complete], [`--session-timeout=${value}`]);
    const result = await done;

    expect(result.exitCode).toBe(2);
    expect(fake.invocations()).toHaveLength(0);
  });
});
