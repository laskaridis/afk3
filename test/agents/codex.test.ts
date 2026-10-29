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
      expect(args[args.indexOf("--model") + 1]).toBe("gpt-x");
      expect(args[args.indexOf("--config") + 1]).toBe('model_reasoning_effort="high"');
      expect(codexAdapter.buildArgs({ cwd: "/w", model: "gpt-x" })).not.toContain("-c");
      expect(codexAdapter.buildArgs({ cwd: "/w", effort: "low" })).not.toContain("-m");
    });

    it("asks for the final message in the output file when one is supplied", () => {
      const args = codexAdapter.buildArgs({ cwd: "/w", outputFile: "/t/out.txt" });
      expect(args[args.indexOf("--output-last-message") + 1]).toBe("/t/out.txt");
      expect(codexAdapter.buildArgs({ cwd: "/w" })).not.toContain("-o");
    });
  });

  describe("extractFinalMessage", () => {
    it("returns the output file content and ignores stdout", () => {
      expect(codexAdapter.extractFinalMessage("progress noise\n", '{"outcome":"complete"}\n')).toEqual({
        message: '{"outcome":"complete"}\n',
      });
    });

    it.each([undefined, "", "  \n\t\n"])(
      "reports missing for an absent, empty or whitespace-only output file (%j)",
      (file) => {
        expect(codexAdapter.extractFinalMessage("text on stdout\n", file)).toEqual({ missing: true });
      },
    );
  });
});
