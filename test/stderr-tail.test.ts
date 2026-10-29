import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, startAfk, type Step } from "./helpers.js";

const lines = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `err ${from + i}`).join("\n") + "\n";

async function run(sessions: Step[][], args: string[] = []) {
  const fake = createFakeCodexEnvironment({ sessions });
  const result = await startAfk({ args: ["build X", ...args], cwd: fake.workspace, env: fake.env }).done;
  return result.stderr.split("\n");
}

describe("agent stderr tail", () => {
  it("prints the last 20 stderr lines in order after the execution-error line, even when retried", async () => {
    const out = await run([[{ stderr: lines(1, 30) }, { exit: 7 }]]);
    const tail = Array.from({ length: 20 }, (_, i) => `err ${11 + i}`);
    const errorLines = out.flatMap((line, i) => (line.startsWith("[afk] Execution error:") ? [i] : []));
    expect(errorLines).toHaveLength(2);
    for (const i of errorLines) {
      expect(out.slice(i + 1, i + 21)).toEqual(tail);
      expect(out[i]).toBe("[afk] Execution error: agent exited unsuccessfully with exit code 7");
    }
    expect(out.indexOf("[afk] Iteration 2/10: retrying agent session after execution error")).toBe(errorLines[0]! + 21);
    expect(out).not.toContain("err 10");
  });

  it("prints nothing extra when stderr is empty", async () => {
    const out = await run([[{ exit: 7 }]]);
    const first = out.findIndex((line) => line.startsWith("[afk] Execution error:"));
    expect(out[first + 1]).toMatch(/^\[afk\] Iteration 2\/10: retrying/);
  });

  it("never shows stderr for a valid response, a timeout, or an interruption", async () => {
    const complete = await run([[{ stderr: lines(1, 3) }, { finalMessage: '{"outcome":"complete"}' }, { exit: 0 }]]);
    expect(complete.join("\n")).not.toContain("err 1");
    const timeout = await run([[{ stderr: lines(1, 3) }, { sleepMs: 30000 }]], ["--session-timeout", "1"]);
    expect(timeout.join("\n")).not.toContain("err 1");
  });
});
