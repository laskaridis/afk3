import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, startAfk, type Step } from "./helpers.js";

const COMPLETE: Step[] = [{ finalMessage: '{"outcome":"complete"}' }, { exit: 0 }];
const CRASH: Step[] = [{ exit: 7 }];

describe("afk model and reasoning-effort overrides", () => {
  it("passes no model or reasoning-effort override by default", async () => {
    const fake = createFakeCodexEnvironment(COMPLETE);
    await startAfk({ args: ["build X"], cwd: fake.workspace, env: fake.env }).done;

    const { argv } = fake.soleInvocation();
    expect(argv).not.toContain("-m");
    expect(argv).not.toContain("--model");
    expect(argv).not.toContain("-c");
    expect(argv).not.toContain("--config");
    expect(argv.join(" ")).not.toContain("model_reasoning_effort");
  });

  it("passes the overrides to every launch, including a retry", async () => {
    const fake = createFakeCodexEnvironment({ sessions: [CRASH, COMPLETE] });
    const run = await startAfk({
      args: ["--model", "gpt-x", "--reasoning-effort", "high", "build X"],
      cwd: fake.workspace,
      env: fake.env,
    }).done;

    expect(run.exitCode).toBe(0);
    const invocations = fake.invocations();
    expect(invocations).toHaveLength(2);
    for (const { argv } of invocations) {
      expect(argv[argv.indexOf("--model") + 1]).toBe("gpt-x");
      expect(argv[argv.indexOf("--config") + 1]).toBe('model_reasoning_effort="high"');
      expect(argv.filter((a) => a === "--model" || a === "--config")).toHaveLength(2);
    }
  });

  it.each([["--model"], ["--reasoning-effort"]])("rejects an empty %s value without launching", async (option) => {
    const fake = createFakeCodexEnvironment(COMPLETE);
    const run = await startAfk({ args: [option, "", "build X"], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(2);
    expect(fake.invocations()).toHaveLength(0);
  });

  it("leaves the Codex configuration untouched", async () => {
    const fake = createFakeCodexEnvironment(COMPLETE);
    const codexHome = join(fake.workspace, "..", "codex-home");
    mkdirSync(codexHome);
    const config = join(codexHome, "config.toml");
    const original = 'model = "mine"\n';
    writeFileSync(config, original);
    const env = { ...fake.env, HOME: join(fake.workspace, ".."), CODEX_HOME: codexHome };
    await startAfk({
      args: ["--model", "gpt-x", "--reasoning-effort", "high", "build X"],
      cwd: fake.workspace,
      env,
    }).done;

    expect(readFileSync(config, "utf8")).toBe(original);
  });
});
