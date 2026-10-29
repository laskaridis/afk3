import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentNames } from "../src/agents/registry.js";
import { createFakeCodexEnvironment, startAfk } from "./helpers.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

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

  it("README documents --agent and a Supported agents section for every agent", () => {
    const readme = read("../README.md");
    expect(readme).toContain("--agent");
    expect(readme).toContain("## Supported agents");
    for (const name of agentNames()) expect(readme.toLowerCase()).toContain(name);
    expect(readme).toContain("--approve-for-me");
    expect(readme).toContain("auto");
    expect(readme).toContain(".claude/skills");
  });

  it("package description does not name Codex as the only agent", () => {
    const { description } = JSON.parse(read("../package.json")) as { description: string };
    expect(description).not.toMatch(/codex/i);
  });
});
