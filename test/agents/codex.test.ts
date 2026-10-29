import { describe, expect, it } from "vitest";
import { codexAdapter } from "../../src/agents/codex.js";
import { DEFAULT_AGENT, agentNames, agents } from "../../src/agents/registry.js";

describe("codex adapter", () => {
  it("is registered as the default agent", () => {
    expect(agents.codex).toBe(codexAdapter);
    expect(DEFAULT_AGENT).toBe("codex");
    expect(agentNames()).toContain("codex");
    expect(codexAdapter.executable).toBe("codex");
  });

  describe("buildArgs", () => {
    it("runs exec with automatic approval review, the workspace, and the prompt from stdin", () => {
      expect(codexAdapter.buildArgs({ cwd: "/w" })).toEqual(["exec", "--approve-for-me", "-C", "/w", "-"]);
    });

    it("adds model and reasoning-effort overrides only when supplied", () => {
      const args = codexAdapter.buildArgs({ cwd: "/w", model: "gpt-x", effort: "high" });
      expect(args[args.indexOf("-m") + 1]).toBe("gpt-x");
      expect(args[args.indexOf("-c") + 1]).toBe('model_reasoning_effort="high"');
      expect(codexAdapter.buildArgs({ cwd: "/w", model: "gpt-x" })).not.toContain("-c");
      expect(codexAdapter.buildArgs({ cwd: "/w", effort: "low" })).not.toContain("-m");
    });

    it("passes no output-file option", () => {
      const args = codexAdapter.buildArgs({ cwd: "/w", model: "m", effort: "e" });
      expect(args).not.toContain("-o");
      expect(args).not.toContain("--output-last-message");
    });
  });

  describe("extractFinalMessage", () => {
    it("returns the stdout text", () => {
      expect(codexAdapter.extractFinalMessage('{"outcome":"complete"}\n')).toEqual({
        message: '{"outcome":"complete"}\n',
      });
    });

    it.each(["", "  \n\t\n"])("reports missing for empty or whitespace-only stdout (%j)", (stdout) => {
      expect(codexAdapter.extractFinalMessage(stdout)).toEqual({ missing: true });
    });
  });
});
