import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, startAfk, type Step } from "./support/helpers.js";

const AGENT_NAMES = ["codex", "claude"];

const complete: Step[] = [
  { finalMessage: '{"outcome":"no_more_tasks","task_id":null,"task_plan_file":"p.json"}' },
  { exit: 0 },
];

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

function start(agent: string, sessions: Step[][], args: string[] = []) {
  const fake = createFakeCodexEnvironment({ sessions }, agent);
  const afk = startAfk({
    args: ["--agent", agent, ...args, "build X"],
    cwd: fake.workspace,
    env: { ...fake.env, AFK_TERMINATION_GRACE_MS: "300" },
  });
  return { fake, afk };
}

describe.each(AGENT_NAMES)("timeout escalation: %s", (agent) => {
  it("sends SIGINT then SIGTERM to an agent that ignores signals, leaves no process, exits 5", async () => {
    const { fake, afk } = start(
      agent,
      [[{ ignoreSignals: true }, { sleepMs: 30000 }], complete],
      ["--session-timeout", "1"],
    );
    const run = await afk.done;

    expect(fake.signals()).toEqual(["SIGINT", "SIGTERM"]);
    expect(run.exitCode).toBe(5);
    expect(fake.invocations()).toHaveLength(1);
    expect(isRunning(fake.invocations()[0]!.pid)).toBe(false);
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe(
      "[afk] Iteration 1/10: starting agent session\n" + "[afk] Run stopped: agent session timed out after 1 seconds\n",
    );
  }, 15000);
});

describe.each(AGENT_NAMES)("agent stderr visibility: %s", (agent) => {
  const tail = "err one\nerr two\n";

  it("does not show the agent's stderr when the run is interrupted", async () => {
    const { fake, afk } = start(agent, [[{ stderr: tail }, { sleepMs: 30000 }], complete]);
    await until(() => fake.invocations().length === 1);
    await new Promise((r) => setTimeout(r, 200));
    afk.child.kill("SIGINT");
    const run = await afk.done;

    expect(run.exitCode).toBe(130);
    expect(run.stdout).toBe("");
    expect(run.stderr).not.toContain("err one");
    expect(run.stderr).not.toContain("err two");
    expect(run.stderr).toBe("[afk] Iteration 1/10: starting agent session\n[afk] Run interrupted by user\n");
  });

  const kinds: { name: string; steps: Step[]; reason: string }[] = [
    {
      name: "non-zero exit",
      steps: [{ stderr: tail }, { exit: 7 }],
      reason: "agent exited unsuccessfully with exit code 7",
    },
    {
      name: "missing final response",
      steps: [{ stderr: tail }, { exit: 0 }],
      reason: "",
    },
    {
      name: "invalid final response",
      steps: [{ stderr: tail }, { rawFinalMessage: "no block here" }, { exit: 0 }],
      reason: "",
    },
  ];

  it.each(kinds)("shows the stderr tail after the execution-error line: $name", async ({ steps }) => {
    const { afk } = start(agent, [steps, complete]);
    const lines = (await afk.done).stderr.split("\n");
    const first = lines.findIndex((line) => line.startsWith("[afk] Execution error:"));

    expect(first).toBeGreaterThan(0);
    expect(lines.slice(first + 1, first + 3)).toEqual(["err one", "err two"]);
    expect(lines[first + 3]).toBe("[afk] Iteration 2/10: retrying agent session after execution error");
  });
});

describe.each(AGENT_NAMES)("termination signals sent to afk: %s", (agent) => {
  it.each(["SIGTERM", "SIGHUP"] as const)("%s ends the session, exits 130 and starts nothing more", async (signal) => {
    const { fake, afk } = start(agent, [[{ ignoreSignals: true }, { sleepMs: 30000 }], complete]);
    await until(() => fake.invocations().length === 1);
    const { pid } = fake.soleInvocation();
    afk.child.kill(signal);
    const run = await afk.done;

    expect(run.exitCode).toBe(130);
    expect(fake.invocations()).toHaveLength(1);
    expect(isRunning(pid)).toBe(false);
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe("[afk] Iteration 1/10: starting agent session\n[afk] Run interrupted by user\n");
  });
});
