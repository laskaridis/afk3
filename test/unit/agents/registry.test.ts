import { describe, expect, it } from "vitest";
import type { AgentAdapter } from "../../../src/agents/adapter.js";
import { ClaudeAdapter } from "../../../src/agents/claude.js";
import { CodexAdapter } from "../../../src/agents/codex.js";
import { AgentRegistry } from "../../../src/agents/registry.js";

describe("AgentRegistry", () => {
  const registry = new AgentRegistry();

  it("returns the matching adapter for a supported name", () => {
    expect(registry.get("codex")).toBeInstanceOf(CodexAdapter);
    expect(registry.get("claude")).toBeInstanceOf(ClaudeAdapter);
  });

  it("returns undefined for an unsupported name", () => {
    expect(registry.get("gemini")).toBeUndefined();
  });

  it("lists supported names in registration order", () => {
    expect(registry.names()).toEqual(["codex", "claude"]);
  });

  it("names codex as the default agent, and the default is supported", () => {
    expect(registry.defaultName).toBe("codex");
    expect(registry.get(registry.defaultName)).toBeDefined();
  });

  it("keys adapters by their own name when given a custom list", () => {
    const custom: AgentAdapter = {
      name: "custom",
      executable: "x",
      buildArgs: () => [],
      extractFinalMessage: () => ({ missing: true }),
    };
    const only = new AgentRegistry([custom]);
    expect(only.names()).toEqual(["custom"]);
    expect(only.get("custom")).toBe(custom);
  });
});
