import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, startAfk, type Step } from "./helpers.js";

const say = (message: object): Step[] => [{ finalMessage: JSON.stringify(message) }, { exit: 0 }];
const COMPLETE = say({ outcome: "complete" });

function runClaude(sessions: Step[][], extraArgs: string[] = [], env: Record<string, string> = {}) {
  const fake = createFakeCodexEnvironment({ sessions }, "claude");
  const afk = startAfk({
    args: ["--agent", "claude", ...extraArgs, "build X"],
    cwd: fake.workspace,
    env: { ...fake.env, AFK_TERMINATION_GRACE_MS: "300", ...env },
  });
  return { fake, afk, done: afk.done };
}

describe("afk --agent claude", () => {
  it("is listed in help and in the --agent error", async () => {
    const fake = createFakeCodexEnvironment(COMPLETE, "claude");
    const help = await startAfk({ args: ["--help"], cwd: fake.workspace, env: fake.env }).done;
    const bad = await startAfk({ args: ["--agent", "x", "y"], cwd: fake.workspace, env: fake.env }).done;
    expect(help.stdout).toContain("claude");
    expect(bad.stderr).toContain("claude");
  });

  it("launches the fake claude for every session, including retries, with the prompt on stdin", async () => {
    const { fake, done } = runClaude([[{ exit: 7 }], COMPLETE], ["--model", "m", "--reasoning-effort", "high"]);
    const run = await done;

    expect(run.exitCode).toBe(0);
    const invocations = fake.invocations();
    expect(invocations).toHaveLength(2);
    for (const { argv, cwd, stdin } of invocations) {
      expect(argv).toEqual(expect.arrayContaining(["-p", "--output-format", "json", "--permission-mode", "auto"]));
      expect(argv[argv.indexOf("--model") + 1]).toBe("m");
      expect(argv[argv.indexOf("--effort") + 1]).toBe("high");
      expect(cwd).toBe(fake.workspace);
      expect(stdin).toContain("build X");
    }
    expect(run.stdout).toBe("");
  });

  describe("protocol outcomes", () => {
    it.each([
      ["complete", say({ outcome: "complete" }), 0, "feature complete"],
      ["blocked", say({ outcome: "blocked", blocker_text: "need key" }), 1, "need key"],
      ["repeat", say({ outcome: "repeat" }), 4, "iteration limit"],
    ])("%s", async (_name, steps, exitCode, text) => {
      const { done } = runClaude([steps], ["--max-iterations", "2"]);
      const run = await done;
      expect(run.exitCode).toBe(exitCode);
      expect(run.stderr).toContain(text);
    });

    it("fail surfaces the summary and continues", async () => {
      const { fake, done } = runClaude([say({ outcome: "fail", failure_summary: "tests broke" }), COMPLETE]);
      const run = await done;
      expect(run.exitCode).toBe(0);
      expect(run.stderr).toContain("tests broke");
      expect(fake.invocations()).toHaveLength(2);
    });
  });

  describe("execution errors (two consecutive sessions)", () => {
    const rows: [string, Step[], string, string][] = [
      ["non-zero exit without structured result", [{ exit: 7 }], "exit-status", "exit status 7"],
      ["non-zero exit with non-error JSON", [{ json: { result: "x" } }, { exit: 2 }], "exit-status", "exit status 2"],
      ["non-zero exit with unparseable stdout", [{ stdout: "boom" }, { exit: 2 }], "exit-status", "exit status 2"],
      ["stdout not valid JSON", [{ stdout: "not json" }, { exit: 0 }], "invalid-response", "could not be parsed"],
      [
        "is_error on exit 0",
        [{ json: { is_error: true, subtype: "error_max_turns", result: "x" } }, { exit: 0 }],
        "exit-status",
        "error_max_turns",
      ],
      [
        "is_error on non-zero exit",
        [{ json: { is_error: true, subtype: "error_during_execution" } }, { exit: 1 }],
        "exit-status",
        "exit status 1 (agent reported an error: error_during_execution)",
      ],
      ["empty stdout", [{ exit: 0 }], "missing-response", "missing-response"],
      ["no result field", [{ json: { is_error: false } }, { exit: 0 }], "missing-response", "missing-response"],
      [
        "empty result",
        [{ json: { is_error: false, result: "" } }, { exit: 0 }],
        "missing-response",
        "missing-response",
      ],
      ["protocol violation", [{ finalMessage: "all done!" }, { exit: 0 }], "invalid-response", "invalid-response"],
    ];
    it.each(rows)("%s", async (_name, steps, kind, text) => {
      const { fake, done } = runClaude([steps]);
      const run = await done;
      expect(run.exitCode).toBe(3);
      expect(fake.invocations()).toHaveLength(2);
      expect(run.stderr).toContain(kind);
      expect(run.stderr).toContain(text);
    });

    it("non-zero exit without a structured result reports only the exit code", async () => {
      const { done } = runClaude([[{ stdout: "junk" }, { exit: 9 }]]);
      const run = await done;
      expect(run.stderr).toContain("exit status 9");
      expect(run.stderr).not.toContain("agent reported an error");
    });

    it("reports a launch failure when claude is not on PATH", async () => {
      const { done } = runClaude([COMPLETE], [], { PATH: "/nonexistent" });
      const run = await done;
      expect(run.exitCode).toBe(3);
      expect(run.stderr).toContain("launch-failed");
    });
  });

  it("timeout ends the run with exit 5, no retry", async () => {
    const { fake, done } = runClaude([[{ sleepMs: 30000 }], COMPLETE], ["--session-timeout", "1"]);
    const run = await done;
    expect(run.exitCode).toBe(5);
    expect(run.stderr).toContain("timed out after 1 seconds");
    expect(fake.invocations()).toHaveLength(1);
  });

  it("Ctrl+C ends the run with exit 130, no retry", async () => {
    const { fake, afk, done } = runClaude([[{ sleepMs: 30000 }], COMPLETE]);
    const start = Date.now();
    while (fake.invocations().length < 1 && Date.now() - start < 5000) await new Promise((r) => setTimeout(r, 20));
    afk.child.kill("SIGINT");
    const run = await done;
    expect(run.exitCode).toBe(130);
    expect(run.stderr).toContain("interrupted by user");
    expect(fake.invocations()).toHaveLength(1);
  });
});
