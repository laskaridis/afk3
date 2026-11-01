import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSessionPrompt, parseFinalResponse } from "../src/protocol.js";

const NONCE = "7f3a9c21";
const block = (body: string, nonce = NONCE) => `<afk-harness-result nonce="${nonce}">\n${body}\n</afk-harness-result>`;

describe("buildSessionPrompt", () => {
  it("starts with the launch prompt verbatim", () => {
    const launchPrompt = "  build feature X\nwith details  ";
    expect(buildSessionPrompt(launchPrompt, NONCE).startsWith(launchPrompt)).toBe(true);
  });

  it("appends the harness instructions for one task and a result block carrying the nonce", () => {
    const prompt = buildSessionPrompt("build feature X", NONCE);
    const harness = readFileSync(new URL("../src/code.md", import.meta.url), "utf8");
    expect(prompt).toBe(`build feature X\n\n---\n${harness.replaceAll("{{NONCE}}", NONCE)}\n`);
    expect(prompt).toMatch(/one task/i);
    expect(prompt).toContain(`<afk-harness-result nonce="${NONCE}">`);
    expect(prompt).not.toContain("{{NONCE}}");
  });

  it("is identical for the same launch prompt and nonce, and differs by nonce", () => {
    expect(buildSessionPrompt("build feature X", NONCE)).toBe(buildSessionPrompt("build feature X", NONCE));
    expect(buildSessionPrompt("build feature X", NONCE)).not.toBe(buildSessionPrompt("build feature X", "other"));
  });
});

describe("parseFinalResponse", () => {
  const valid: Array<[string, unknown]> = [
    ['{"outcome":"repeat"}', { outcome: "repeat" }],
    ['{"outcome":"complete"}', { outcome: "complete" }],
    ['{"outcome":"blocked","blocker_text":"x"}', { outcome: "blocked", blocker_text: "x" }],
    ['{"outcome":"fail","failure_summary":"y"}', { outcome: "fail", failure_summary: "y" }],
  ];

  for (const [body, expected] of valid) {
    it(`accepts ${body}, with and without surrounding whitespace and noise`, () => {
      expect(parseFinalResponse(block(body), NONCE)).toEqual(expected);
      expect(
        parseFinalResponse(`<afk-harness-result nonce="${NONCE}">\n  ${body}\t\n</afk-harness-result>`, NONCE),
      ).toEqual(expected);
      expect(parseFinalResponse(`banner\nDone.\n${block(body)}\ntrailing noise\n`, NONCE)).toEqual(expected);
    });
  }

  it("takes the last block with the matching nonce", () => {
    const text = [
      block('{"outcome":"repeat"}'),
      block('{"outcome":"fail","failure_summary":"echo"}', "deadbeef"),
      block('{"outcome":"complete"}'),
      block('{"outcome":"blocked","blocker_text":"echo"}', "deadbeef"),
    ].join("\n");
    expect(parseFinalResponse(text, NONCE)).toEqual({ outcome: "complete" });
  });

  const invalid: Array<[string, string | undefined]> = [
    ["no block", '{"outcome":"complete"}'],
    ["block with another nonce", block('{"outcome":"complete"}', "deadbeef")],
    ["unclosed block", `<afk-harness-result nonce="${NONCE}">\n{"outcome":"complete"}`],
    ["markdown fence in block", block('```json\n{"outcome":"complete"}\n```')],
    ["prose in block", block('Done. {"outcome":"complete"}')],
    ["JSON array", block('[{"outcome":"complete"}]')],
    ["JSON string", block('"complete"')],
    ["JSON number", block("42")],
    ["malformed JSON", block('{"outcome":')],
    ["two objects", block('{"outcome":"repeat"}{"outcome":"repeat"}')],
    ["missing outcome", block('{"status":"complete"}')],
    ["unsupported outcome", block('{"outcome":"done"}')],
    ["extra field on repeat", block('{"outcome":"repeat","note":"a"}')],
    ["extra field on complete", block('{"outcome":"complete","note":"a"}')],
    ["missing blocker_text", block('{"outcome":"blocked"}')],
    ["empty blocker_text", block('{"outcome":"blocked","blocker_text":""}')],
    ["whitespace blocker_text", block('{"outcome":"blocked","blocker_text":"  \\n"}')],
    ["non-string blocker_text", block('{"outcome":"blocked","blocker_text":5}')],
    ["blocker_text alias", block('{"outcome":"blocked","reason":"x"}')],
    ["missing failure_summary", block('{"outcome":"fail"}')],
    ["empty failure_summary", block('{"outcome":"fail","failure_summary":""}')],
    ["whitespace failure_summary", block('{"outcome":"fail","failure_summary":" "}')],
    ["non-string failure_summary", block('{"outcome":"fail","failure_summary":["y"]}')],
    ["empty message", ""],
    ["whitespace-only message", " \n "],
    ["absent message", undefined],
  ];

  for (const [name, text] of invalid) {
    it(`rejects ${name} with a readable reason`, () => {
      const result = parseFinalResponse(text, NONCE);
      expect(result).toHaveProperty("violation");
      expect((result as { violation: string }).violation.length).toBeGreaterThan(10);
    });
  }
});
