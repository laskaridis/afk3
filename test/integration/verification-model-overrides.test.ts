import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, IMPLEMENTED, PASSED, reply, startAfk } from "./support/helpers.js";

const NO_MORE = reply({ outcome: "no_more_tasks", task_id: null, task_plan_file: "p.json" });

/** How each agent receives a model and a reasoning effort on its command line. */
const AGENTS = {
  codex: {
    model: (argv: string[]) => argv[argv.indexOf("--model") + 1],
    effort: (argv: string[]) => argv[argv.indexOf("--config") + 1],
    expectedEffort: (level: string) => `model_reasoning_effort=${JSON.stringify(level)}`,
  },
  claude: {
    model: (argv: string[]) => argv[argv.indexOf("--model") + 1],
    effort: (argv: string[]) => argv[argv.indexOf("--effort") + 1],
    expectedEffort: (level: string) => level,
  },
} as const;

const COMBINATIONS: Array<{ name: string; flags: Record<string, string> }> = [];
const OPTIONS = ["--model", "--reasoning-effort", "--verify-model", "--verify-reasoning-effort"];
for (let mask = 0; mask < 16; mask++) {
  const flags: Record<string, string> = {};
  OPTIONS.forEach((option, index) => {
    if (mask & (1 << index)) flags[option] = option.replace(/^--/, "") + "-value";
  });
  COMBINATIONS.push({ name: Object.keys(flags).join(" ") || "no options", flags });
}

describe.each(Object.entries(AGENTS))("verification model and effort overrides: %s", (agent, argv) => {
  it.each(COMBINATIONS)("resolves each phase's model and effort with: $name", async ({ flags }) => {
    const fake = createFakeCodexEnvironment({ sessions: [IMPLEMENTED, PASSED, NO_MORE] }, agent);
    const args = Object.entries(flags).flat();
    const run = await startAfk({
      args: ["--agent", agent, ...args, "build X"],
      cwd: fake.workspace,
      env: fake.env,
    }).done;

    expect(run.exitCode).toBe(0);
    const [coding, verification, resumed] = fake.invocations().map((invocation) => invocation.argv);
    const codingModel = flags["--model"];
    const codingEffort = flags["--reasoning-effort"];
    const verifyModel = flags["--verify-model"] ?? codingModel;
    const verifyEffort = flags["--verify-reasoning-effort"] ?? codingEffort;
    const effortOf = (level: string | undefined) => (level === undefined ? undefined : argv.expectedEffort(level));
    const hasModel = (a: string[]) => a.includes("--model");

    for (const [a, model, effort] of [
      [coding!, codingModel, codingEffort],
      [verification!, verifyModel, verifyEffort],
      [resumed!, codingModel, codingEffort],
    ] as const) {
      expect(hasModel(a) ? argv.model(a) : undefined).toBe(model);
      expect(effortOf(effort) === undefined ? undefined : argv.effort(a)).toBe(effortOf(effort));
      if (effort === undefined) {
        expect(a.join(" ")).not.toMatch(/model_reasoning_effort|--effort/);
      }
    }
  });
});
