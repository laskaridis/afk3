import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AgentRegistry } from "../../src/agents/registry.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("agent-neutral documentation", () => {
  it("README documents --agent and a Supported agents section for every agent", () => {
    const readme = read("../../README.md");
    expect(readme).toContain("--agent");
    expect(readme).toContain("## Supported agents");
    for (const name of new AgentRegistry().names()) expect(readme.toLowerCase()).toContain(name);
    expect(readme).toContain("--approve-for-me");
    expect(readme).toContain("auto");
    expect(readme).toContain(".claude/skills");
  });

  it("package description does not name Codex as the only agent", () => {
    const { description } = JSON.parse(read("../../package.json")) as { description: string };
    expect(description).not.toMatch(/codex/i);
  });
});
