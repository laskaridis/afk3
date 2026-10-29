import { describe, expect, it } from "vitest";
import { agentNames } from "../src/agents/registry.js";
import { createFakeCodexEnvironment, startAfk, type Step } from "./helpers.js";

/** `finalMessage` is rendered by each agent's fake in that agent's own output format. */
const say = (message: object): Step[] => [{ finalMessage: JSON.stringify(message) }, { exit: 0 }];
const COMPLETE = say({ outcome: "complete" });
const stderrLines = (n: number) => Array.from({ length: n }, (_, i) => `err ${i + 1}`).join("\n") + "\n";

async function until(condition: () => boolean, timeoutMs = 5000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 20));
  }
}

interface Scenario {
  name: string;
  sessions: Step[][];
  args?: string[];
  interrupt?: boolean;
  exitCode: number;
  invocations: number;
  stderr: string[];
}

const scenarios: Scenario[] = [
  { name: "complete", sessions: [COMPLETE], exitCode: 0, invocations: 1, stderr: ["feature complete"] },
  {
    name: "blocked",
    sessions: [say({ outcome: "blocked", blocker_text: "need key" })],
    exitCode: 1,
    invocations: 1,
    stderr: ["need key"],
  },
  {
    name: "fail then complete",
    sessions: [say({ outcome: "fail", failure_summary: "tests broke" }), COMPLETE],
    exitCode: 0,
    invocations: 2,
    stderr: ["tests broke"],
  },
  {
    name: "iteration limit",
    sessions: [say({ outcome: "repeat" })],
    args: ["--max-iterations", "2"],
    exitCode: 4,
    invocations: 2,
    stderr: ["iteration limit"],
  },
  {
    name: "retry recovers",
    sessions: [[{ stderr: stderrLines(3) }, { exit: 7 }], COMPLETE],
    exitCode: 0,
    invocations: 2,
    stderr: ["Execution error: agent exited unsuccessfully with exit code 7", "err 3", "retrying agent session"],
  },
  {
    name: "two consecutive execution errors",
    sessions: [[{ stderr: stderrLines(30) }, { exit: 7 }]],
    exitCode: 3,
    invocations: 2,
    stderr: ["err 11", "err 30"],
  },
  {
    name: "missing final response",
    sessions: [[{ exit: 0 }]],
    exitCode: 3,
    invocations: 2,
    stderr: ["agent exited without a final response"],
  },
  {
    name: "protocol violation",
    sessions: [[{ finalMessage: "all done!" }, { exit: 0 }]],
    exitCode: 3,
    invocations: 2,
    stderr: ["agent final response is invalid: "],
  },
  {
    name: "timeout",
    sessions: [[{ sleepMs: 30000 }], COMPLETE],
    args: ["--session-timeout", "1"],
    exitCode: 5,
    invocations: 1,
    stderr: ["timed out after 1 seconds"],
  },
  {
    name: "interruption",
    sessions: [[{ sleepMs: 30000 }], COMPLETE],
    interrupt: true,
    exitCode: 130,
    invocations: 1,
    stderr: ["interrupted by user"],
  },
];

async function runScenario(agent: string, scenario: Scenario) {
  const fake = createFakeCodexEnvironment({ sessions: scenario.sessions }, agent);
  const afk = startAfk({
    args: ["--agent", agent, ...(scenario.args ?? []), "build X"],
    cwd: fake.workspace,
    env: { ...fake.env, AFK_TERMINATION_GRACE_MS: "300" },
  });
  if (scenario.interrupt) {
    await until(() => fake.invocations().length >= 1);
    afk.child.kill("SIGINT");
  }
  const run = await afk.done;
  return { run, invocations: fake.invocations() };
}

describe.each(agentNames())("shared harness behavior: %s", (agent) => {
  it.each(scenarios)("$name", async (scenario) => {
    const { run, invocations } = await runScenario(agent, scenario);
    expect(run.exitCode).toBe(scenario.exitCode);
    expect(invocations).toHaveLength(scenario.invocations);
    for (const text of scenario.stderr) expect(run.stderr).toContain(text);
    expect(run.stdout).toBe("");
    for (const { cwd, stdin } of invocations) {
      expect(cwd).toBe(invocations[0]!.cwd);
      expect(stdin).toContain("build X");
    }
  });
});

describe("identical behavior across agents", () => {
  it.each(scenarios)("$name", async (scenario) => {
    const results = await Promise.all(agentNames().map((agent) => runScenario(agent, scenario)));
    const [first, ...rest] = results;
    for (const other of rest) {
      expect(other.run.exitCode).toBe(first!.run.exitCode);
      expect(other.run.stderr).toBe(first!.run.stderr);
      expect(other.run.stdout).toBe(first!.run.stdout);
    }
  });
});
