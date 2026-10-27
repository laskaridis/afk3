import { describe, expect, it } from "vitest";
import { buildSessionPrompt, parseFinalResponse } from "../src/protocol.js";

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

describe("parseFinalResponse", () => {
  const valid: Array<[string, unknown]> = [
    ['{"outcome":"repeat"}', { outcome: "repeat" }],
    ['{"outcome":"complete"}', { outcome: "complete" }],
    ['{"outcome":"blocked","blocker_text":"x"}', { outcome: "blocked", blocker_text: "x" }],
    ['{"outcome":"fail","failure_summary":"y"}', { outcome: "fail", failure_summary: "y" }],
  ];

  for (const [text, expected] of valid) {
    it(`accepts ${text}, with and without surrounding whitespace`, () => {
      expect(parseFinalResponse(text)).toEqual(expected);
      expect(parseFinalResponse(`\n  ${text}\t\n`)).toEqual(expected);
    });
  }

  const invalid: Array<[string, string | undefined]> = [
    ["prose before", 'Done. {"outcome":"complete"}'],
    ["prose after", '{"outcome":"complete"} thanks'],
    ["markdown fence", '```json\n{"outcome":"complete"}\n```'],
    ["JSON array", '[{"outcome":"complete"}]'],
    ["JSON string", '"complete"'],
    ["JSON number", "42"],
    ["malformed JSON", '{"outcome":'],
    ["two objects", '{"outcome":"repeat"}{"outcome":"repeat"}'],
    ["missing outcome", '{"status":"complete"}'],
    ["unsupported outcome", '{"outcome":"done"}'],
    ["extra field on repeat", '{"outcome":"repeat","note":"a"}'],
    ["extra field on complete", '{"outcome":"complete","note":"a"}'],
    ["missing blocker_text", '{"outcome":"blocked"}'],
    ["empty blocker_text", '{"outcome":"blocked","blocker_text":""}'],
    ["whitespace blocker_text", '{"outcome":"blocked","blocker_text":"  \\n"}'],
    ["non-string blocker_text", '{"outcome":"blocked","blocker_text":5}'],
    ["blocker_text alias", '{"outcome":"blocked","reason":"x"}'],
    ["missing failure_summary", '{"outcome":"fail"}'],
    ["empty failure_summary", '{"outcome":"fail","failure_summary":""}'],
    ["whitespace failure_summary", '{"outcome":"fail","failure_summary":" "}'],
    ["non-string failure_summary", '{"outcome":"fail","failure_summary":["y"]}'],
    ["empty message", ""],
    ["whitespace-only message", " \n "],
    ["absent message", undefined],
  ];

  for (const [name, text] of invalid) {
    it(`rejects ${name} with a readable reason`, () => {
      const result = parseFinalResponse(text);
      expect(result).toHaveProperty("violation");
      expect((result as { violation: string }).violation.length).toBeGreaterThan(10);
    });
  }
});
