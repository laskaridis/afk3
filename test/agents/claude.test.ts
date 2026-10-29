import { describe, expect, it } from "vitest";
import { claudeAdapter } from "../../src/agents/claude.js";
import { agentNames, agents } from "../../src/agents/registry.js";

describe("claude adapter", () => {
  it("is registered", () => {
    expect(agents.claude).toBe(claudeAdapter);
    expect(agentNames()).toContain("claude");
    expect(claudeAdapter.executable).toBe("claude");
  });

  describe("buildArgs", () => {
    it("selects print mode, JSON output, and the auto permission mode", () => {
      const args = claudeAdapter.buildArgs({ cwd: "/w" });
      expect(args).toEqual(["-p", "--output-format", "json", "--permission-mode", "auto"]);
    });

    it("adds --model and --effort only when supplied", () => {
      const args = claudeAdapter.buildArgs({ cwd: "/w", model: "m", effort: "high" });
      expect(args[args.indexOf("--model") + 1]).toBe("m");
      expect(args[args.indexOf("--effort") + 1]).toBe("high");
      expect(claudeAdapter.buildArgs({ cwd: "/w", model: "m" })).not.toContain("--effort");
      expect(claudeAdapter.buildArgs({ cwd: "/w", effort: "low" })).not.toContain("--model");
    });

    it("never selects a full-access permission mode", () => {
      const args = claudeAdapter.buildArgs({ cwd: "/w", model: "m", effort: "e" }).join(" ");
      expect(args).not.toContain("bypassPermissions");
      expect(args).not.toContain("--dangerously-skip-permissions");
    });
  });

  describe("extractFinalMessage", () => {
    const json = (value: unknown) => JSON.stringify(value);

    it("returns a valid result string", () => {
      expect(claudeAdapter.extractFinalMessage(json({ is_error: false, result: "hello" }))).toEqual({
        message: "hello",
      });
    });

    it("reports invalid for invalid JSON or a non-object", () => {
      for (const stdout of ["nope", "[1]", "null", "3"]) {
        expect(claudeAdapter.extractFinalMessage(stdout)).toEqual({
          invalid: true,
          reason: "agent output could not be parsed",
        });
      }
    });

    it("reports missing for empty stdout", () => {
      expect(claudeAdapter.extractFinalMessage("  \n")).toEqual({ missing: true });
    });

    it.each([[{}], [{ result: "" }], [{ result: "  " }], [{ result: 3 }], [{ is_error: false }]])(
      "reports missing for a missing or empty result (%j)",
      (value) => {
        expect(claudeAdapter.extractFinalMessage(json(value))).toEqual({ missing: true });
      },
    );

    it("reports an agent error with the subtype when is_error is true", () => {
      expect(
        claudeAdapter.extractFinalMessage(json({ is_error: true, subtype: "error_max_turns", result: "x" })),
      ).toEqual({ agentError: true, detail: "error_max_turns" });
      expect(claudeAdapter.extractFinalMessage(json({ is_error: true }))).toEqual({
        agentError: true,
        detail: "unknown",
      });
    });
  });
});
