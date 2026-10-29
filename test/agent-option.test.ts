import { describe, expect, it } from "vitest";
import { agentNames, agents, DEFAULT_AGENT } from "../src/agents/registry.js";
import { createFakeCodexEnvironment, startAfk, type Step } from "./helpers.js";

const COMPLETE: Step[] = [{ finalMessage: '{"outcome":"complete"}' }, { exit: 0 }];
const CRASH: Step[] = [{ exit: 7 }];

describe("afk --agent", () => {
  it("defaults to codex for every session, including a retry", async () => {
    const fake = createFakeCodexEnvironment({ sessions: [CRASH, COMPLETE] });
    const run = await startAfk({ args: ["build X"], cwd: fake.workspace, env: fake.env }).done;

    expect(DEFAULT_AGENT).toBe("codex");
    expect(run.exitCode).toBe(0);
    expect(fake.invocations()).toHaveLength(2);
  });

  it("accepts --agent codex", async () => {
    const fake = createFakeCodexEnvironment(COMPLETE);
    const run = await startAfk({ args: ["--agent", "codex", "build X"], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(0);
    expect(fake.invocations()).toHaveLength(1);
  });

  it.each([["nope"], [""]])("rejects the value %j with the supported names, exit 2, and no session", async (value) => {
    const fake = createFakeCodexEnvironment(COMPLETE);
    const run = await startAfk({ args: ["--agent", value, "build X"], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("--agent");
    for (const name of agentNames()) expect(run.stderr).toContain(name);
    expect(fake.invocations()).toHaveLength(0);
  });

  for (const flag of ["--help", "-h"]) {
    it(`${flag} documents --agent, lists the registry names, and states the default`, async () => {
      const fake = createFakeCodexEnvironment(COMPLETE);
      const run = await startAfk({ args: [flag], cwd: fake.workspace, env: fake.env }).done;

      expect(run.stdout).toContain("--agent <name>");
      for (const name of agentNames()) expect(run.stdout).toContain(name);
      expect(run.stdout).toContain("default: codex");
    });
  }

  it("help takes precedence over an invalid --agent value", async () => {
    const fake = createFakeCodexEnvironment(COMPLETE);
    const run = await startAfk({ args: ["--agent", "nope", "--help"], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("--agent <name>");
    expect(fake.invocations()).toHaveLength(0);
  });

  it("derives the accepted names from the registry keys", () => {
    expect(agentNames()).toEqual(Object.keys(agents));
    for (const [key, adapter] of Object.entries(agents)) expect(adapter.name).toBe(key);
  });
});
