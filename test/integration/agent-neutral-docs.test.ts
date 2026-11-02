import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, startAfk } from "./support/helpers.js";

describe("agent-neutral documentation", () => {
  it("help refers to the coding agent and not to Codex", async () => {
    const fake = createFakeCodexEnvironment([{ exit: 0 }]);
    const { stdout } = await startAfk({ args: ["--help"], cwd: fake.workspace, env: fake.env }).done;

    expect(stdout).toContain("the coding agent");
    expect(stdout).not.toContain("Codex");
    const flat = stdout.replace(/\s+/g, " ");
    expect(flat).toMatch(/--model <name>.*passed to the agent unchanged/);
    expect(flat).toMatch(/--reasoning-effort <level>.*passed to the agent unchanged/);
  });
});
