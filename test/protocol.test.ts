import { describe, expect, it } from "vitest";
import { buildSessionPrompt } from "../src/protocol.js";

describe("buildSessionPrompt", () => {
  it("starts with the launch prompt verbatim", () => {
    const launchPrompt = "  build feature X\nwith details  ";
    expect(buildSessionPrompt(launchPrompt).startsWith(launchPrompt)).toBe(true);
  });

  it("instructs use of the code skill for one task and a JSON-only final response", () => {
    const prompt = buildSessionPrompt("build feature X");
    expect(prompt).toMatch(/code skill/i);
    expect(prompt).toMatch(/one task/i);
    expect(prompt).toMatch(/only.*JSON/i);
  });

  it("is identical for the same launch prompt across calls", () => {
    expect(buildSessionPrompt("build feature X")).toBe(buildSessionPrompt("build feature X"));
  });
});
