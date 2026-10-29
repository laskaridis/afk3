import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, startAfk, withoutNonce, type Step } from "./helpers.js";

const say = (message: object): Step[] => [{ finalMessage: JSON.stringify(message) }, { exit: 0 }];
const COMPLETE = say({ outcome: "complete" });
const CRASH: Step[] = [{ exit: 7 }];

describe("afk execution errors", () => {
  it("reports a non-zero exit, announces a retry, relaunches, and succeeds", async () => {
    const fake = createFakeCodexEnvironment({ sessions: [CRASH, COMPLETE] });
    const run = await startAfk({ args: ["build X"], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(0);
    expect(fake.invocations()).toHaveLength(2);
    expect(run.stderr).toContain("agent exited unsuccessfully with exit code 7");
    expect(run.stderr).toContain("retrying");
  });

  it("treats a valid complete response with exit status 1 as an execution error", async () => {
    const fake = createFakeCodexEnvironment({
      sessions: [[{ finalMessage: '{"outcome":"complete"}' }, { exit: 1 }]],
    });
    const run = await startAfk({ args: ["build X"], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(3);
    expect(fake.invocations()).toHaveLength(2);
    expect(run.stderr).not.toContain("feature complete");
    expect(run.stderr).toContain("agent exited unsuccessfully with exit code 1");
  });

  it.each([
    ["exit status", CRASH, "exit-status", "agent exited unsuccessfully with exit code 7"],
    ["missing response", [{ exit: 0 }] as Step[], "missing-response", "agent exited without a final response"],
    [
      "invalid response",
      [{ finalMessage: "all done!" }, { exit: 0 }] as Step[],
      "invalid-response",
      "agent final response is invalid: ",
    ],
  ])("stops after exactly two launches on two consecutive %s errors", async (_name, steps, _kind, text) => {
    const fake = createFakeCodexEnvironment({ sessions: [steps] });
    const run = await startAfk({ args: ["build X"], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(3);
    expect(fake.invocations()).toHaveLength(2);
    expect(run.stderr).toContain(text);
  });

  it("reports a launch failure, retries once, then stops when codex is not on PATH", async () => {
    const fake = createFakeCodexEnvironment([]);
    const emptyBin = mkdtempSync(join(tmpdir(), "afk-empty-"));
    const run = await startAfk({
      args: ["build X"],
      cwd: fake.workspace,
      env: { ...fake.env, PATH: emptyBin },
    }).done;

    expect(run.exitCode).toBe(3);
    expect(run.stderr).toContain("Execution error: failed to launch agent");
    expect(run.stderr.match(/retrying/g)).toHaveLength(1);
  });

  it("keeps workspace changes from the failed attempt and reuses the same prompt", async () => {
    const fake = createFakeCodexEnvironment({
      sessions: [[{ writeFile: "partial.txt" }, { exit: 1 }], COMPLETE],
    });
    const run = await startAfk({ args: ["build X"], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(0);
    const [first, second] = fake.invocations();
    expect(second!.files).toContain("partial.txt");
    expect(withoutNonce(second!.stdin)).toBe(withoutNonce(first!.stdin));
    expect(second!.stdin).toContain("build X");
    expect(second!.argv).not.toContain("resume");
    expect(second!.argv).not.toContain("fork");
  });
});
