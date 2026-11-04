import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, startAfk, type Step } from "./support/helpers.js";

const AGENT_NAMES = ["codex", "claude"];

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
  /** The complete expected stderr, one `[afk]` line (or agent stderr-tail line) per entry. */
  transcript: string[];
}

const ITERATION_1 = "[afk] Iteration 1/10: starting agent session";
const RETRY_2 = "[afk] Iteration 2/10: retrying agent session after execution error";
const COMPLETE_LINE = "[afk] Run complete: feature complete";
const MISSING = "[afk] Execution error: agent exited without a final response";
const INVALID =
  "[afk] Execution error: agent final response is invalid: the result block body is not a single JSON object (found prose, Markdown fences, or malformed JSON)";
const EXIT_7 = "[afk] Execution error: agent exited unsuccessfully with exit code 7";

const scenarios: Scenario[] = [
  { name: "complete", sessions: [COMPLETE], exitCode: 0, invocations: 1, transcript: [ITERATION_1, COMPLETE_LINE] },
  {
    name: "task metadata survives a full coding loop",
    sessions: [
      say({ outcome: "repeat", task_id: "TASK-011", task_plan_file: "specs/feature.plan.json" }),
      say({ outcome: "complete", task_id: "TASK-012", task_plan_file: "specs/feature.plan.json" }),
    ],
    exitCode: 0,
    invocations: 2,
    transcript: [ITERATION_1, "[afk] Iteration 2/10: starting agent session", COMPLETE_LINE],
  },
  {
    name: "blocked",
    sessions: [say({ outcome: "blocked", blocker_text: "need key" })],
    exitCode: 1,
    invocations: 1,
    transcript: [ITERATION_1, "[afk] Run blocked: need key"],
  },
  {
    name: "fail then complete",
    sessions: [say({ outcome: "fail", failure_summary: "tests broke" }), COMPLETE],
    exitCode: 0,
    invocations: 2,
    transcript: [
      ITERATION_1,
      "[afk] Task failure: tests broke",
      "[afk] Iteration 2/10: starting agent session",
      COMPLETE_LINE,
    ],
  },
  {
    name: "iteration limit",
    sessions: [say({ outcome: "repeat" })],
    args: ["--max-iterations", "2"],
    exitCode: 4,
    invocations: 2,
    transcript: [
      "[afk] Iteration 1/2: starting agent session",
      "[afk] Iteration 2/2: starting agent session",
      "[afk] Run stopped: iteration limit of 2 reached without reported completion",
    ],
  },
  {
    name: "retry recovers",
    sessions: [[{ stderr: stderrLines(3) }, { exit: 7 }], COMPLETE],
    exitCode: 0,
    invocations: 2,
    transcript: [ITERATION_1, EXIT_7, "err 1", "err 2", "err 3", RETRY_2, COMPLETE_LINE],
  },
  {
    name: "two consecutive execution errors",
    sessions: [[{ stderr: stderrLines(30) }, { exit: 7 }]],
    exitCode: 3,
    invocations: 2,
    transcript: [
      ITERATION_1,
      EXIT_7,
      "err 11",
      "err 12",
      "err 13",
      "err 14",
      "err 15",
      "err 16",
      "err 17",
      "err 18",
      "err 19",
      "err 20",
      "err 21",
      "err 22",
      "err 23",
      "err 24",
      "err 25",
      "err 26",
      "err 27",
      "err 28",
      "err 29",
      "err 30",
      RETRY_2,
      EXIT_7,
      "err 11",
      "err 12",
      "err 13",
      "err 14",
      "err 15",
      "err 16",
      "err 17",
      "err 18",
      "err 19",
      "err 20",
      "err 21",
      "err 22",
      "err 23",
      "err 24",
      "err 25",
      "err 26",
      "err 27",
      "err 28",
      "err 29",
      "err 30",
    ],
  },
  {
    name: "missing final response",
    sessions: [[{ exit: 0 }]],
    exitCode: 3,
    invocations: 2,
    transcript: [ITERATION_1, MISSING, RETRY_2, MISSING],
  },
  {
    name: "protocol violation",
    sessions: [[{ finalMessage: "all done!" }, { exit: 0 }]],
    exitCode: 3,
    invocations: 2,
    transcript: [ITERATION_1, INVALID, RETRY_2, INVALID],
  },
  {
    name: "timeout",
    sessions: [[{ sleepMs: 30000 }], COMPLETE],
    args: ["--session-timeout", "1"],
    exitCode: 5,
    invocations: 1,
    transcript: [ITERATION_1, "[afk] Run stopped: agent session timed out after 1 seconds"],
  },
  {
    name: "interruption",
    sessions: [[{ sleepMs: 30000 }], COMPLETE],
    interrupt: true,
    exitCode: 130,
    invocations: 1,
    transcript: [ITERATION_1, "[afk] Run interrupted by user"],
  },
];

const asStderr = (lines: string[]) => lines.join("\n") + "\n";

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

describe.each(AGENT_NAMES)("shared harness behavior: %s", (agent) => {
  it.each(scenarios)("$name", async (scenario) => {
    const { run, invocations } = await runScenario(agent, scenario);
    expect(run.exitCode).toBe(scenario.exitCode);
    expect(invocations).toHaveLength(scenario.invocations);
    expect(run.stderr).toBe(asStderr(scenario.transcript));
    expect(run.stdout).toBe("");
    for (const { cwd, stdin } of invocations) {
      expect(cwd).toBe(invocations[0]!.cwd);
      expect(stdin).toContain("build X");
    }
  });
});

describe.each(AGENT_NAMES)("launch failure: %s", (agent) => {
  it("reports two execution errors, one retry, and exit 3", async () => {
    const fake = createFakeCodexEnvironment({ sessions: [COMPLETE] }, agent);
    const emptyBin = join(fake.workspace, "empty-bin");
    mkdirSync(emptyBin);
    const run = await startAfk({
      args: ["--agent", agent, "build X"],
      cwd: fake.workspace,
      env: { ...fake.env, PATH: emptyBin },
    }).done;
    expect(run.exitCode).toBe(3);
    expect(fake.invocations()).toHaveLength(0);
    expect(run.stdout).toBe("");
    const lines = run.stderr.split("\n");
    expect(lines.pop()).toBe("");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(ITERATION_1);
    expect(lines[1]).toMatch(/^\[afk\] Execution error: failed to launch agent: /);
    expect(lines[2]).toBe(RETRY_2);
    expect(lines[3]).toMatch(/^\[afk\] Execution error: failed to launch agent: /);
  });
});

describe("identical behavior across agents", () => {
  it.each(scenarios)("$name", async (scenario) => {
    const results = await Promise.all(AGENT_NAMES.map((agent) => runScenario(agent, scenario)));
    const [first, ...rest] = results;
    for (const other of rest) {
      expect(other.run.exitCode).toBe(first!.run.exitCode);
      expect(other.run.stderr).toBe(first!.run.stderr);
      expect(other.run.stdout).toBe(first!.run.stdout);
    }
  });
});
