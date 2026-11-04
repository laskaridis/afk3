import { describe, expect, it } from "vitest";
import { CodexAdapter } from "../../../src/agents/codex.js";

describe("CodexAdapter", () => {
  const codexAdapter = new CodexAdapter();

  it("identifies itself as codex and launches the codex executable", () => {
    expect(codexAdapter.name).toBe("codex");
    expect(codexAdapter.executable).toBe("codex");
  });

  describe("buildArgs", () => {
    it("runs exec with automatic approval review, the workspace, and the prompt from stdin", () => {
      expect(codexAdapter.buildArgs({ cwd: "/w" })).toEqual(["exec", "--approve-for-me", "-C", "/w", "-"]);
    });

    it.each([
      [{}, ["exec", "--approve-for-me", "-C", "/w", "-"]],
      [{ model: "m" }, ["exec", "--approve-for-me", "-C", "/w", "--model", "m", "-"]],
      [{ effort: "high" }, ["exec", "--approve-for-me", "-C", "/w", "--config", 'model_reasoning_effort="high"', "-"]],
      [
        { model: "m", effort: "high" },
        ["exec", "--approve-for-me", "-C", "/w", "--model", "m", "--config", 'model_reasoning_effort="high"', "-"],
      ],
      [
        { outputFile: "/t/o", model: "m", effort: "low" },
        [
          "exec",
          "--approve-for-me",
          "-C",
          "/w",
          "--output-last-message",
          "/t/o",
          "--model",
          "m",
          "--config",
          'model_reasoning_effort="low"',
          "-",
        ],
      ],
    ])("builds the exact arguments for %j", (input, expected) => {
      expect(codexAdapter.buildArgs({ cwd: "/w", ...input })).toEqual(expected);
    });

    it("adds model and reasoning-effort overrides only when supplied", () => {
      const args = codexAdapter.buildArgs({ cwd: "/w", model: "gpt-x", effort: "high" });
      expect(args[args.indexOf("--model") + 1]).toBe("gpt-x");
      expect(args[args.indexOf("--config") + 1]).toBe('model_reasoning_effort="high"');
      expect(codexAdapter.buildArgs({ cwd: "/w", model: "gpt-x" })).not.toContain("--config");
      expect(codexAdapter.buildArgs({ cwd: "/w", effort: "low" })).not.toContain("--model");
    });

    it("asks for the final message in the output file when one is supplied", () => {
      const args = codexAdapter.buildArgs({ cwd: "/w", outputFile: "/t/out.txt" });
      expect(args[args.indexOf("--output-last-message") + 1]).toBe("/t/out.txt");
      expect(codexAdapter.buildArgs({ cwd: "/w" })).not.toContain("--output-last-message");
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
