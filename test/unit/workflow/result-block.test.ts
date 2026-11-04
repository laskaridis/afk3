import { describe, expect, it } from "vitest";
import { parseResultBlock } from "../../../src/workflow/result-block.js";

const NONCE = "7f3a9c21";
const block = (body: string, nonce = NONCE) => `<afk-harness-result nonce="${nonce}">\n${body}\n</afk-harness-result>`;

describe("parseResultBlock", () => {
  const valid: Array<[string, unknown]> = [
    ['{"outcome":"repeat"}', { outcome: "repeat" }],
    ['{"outcome":"complete"}', { outcome: "complete" }],
    ['{"outcome":"blocked","blocker_text":"x"}', { outcome: "blocked", blocker_text: "x" }],
    ['{"outcome":"fail","failure_summary":"y"}', { outcome: "fail", failure_summary: "y" }],
  ];

  for (const [body, expected] of valid) {
    it(`accepts ${body}, with and without surrounding whitespace and noise`, () => {
      expect(parseResultBlock(block(body), NONCE)).toEqual(expected);
      expect(
        parseResultBlock(`<afk-harness-result nonce="${NONCE}">\n  ${body}\t\n</afk-harness-result>`, NONCE),
      ).toEqual(expected);
      expect(parseResultBlock(`banner\nDone.\n${block(body)}\ntrailing noise\n`, NONCE)).toEqual(expected);
    });
  }

  it("takes the last block with the matching nonce", () => {
    const text = [
      block('{"outcome":"repeat"}'),
      block('{"outcome":"fail","failure_summary":"echo"}', "deadbeef"),
      block('{"outcome":"complete"}'),
      block('{"outcome":"blocked","blocker_text":"echo"}', "deadbeef"),
    ].join("\n");
    expect(parseResultBlock(text, NONCE)).toEqual({ outcome: "complete" });
  });

  it.each(valid)("preserves task metadata for %s", (body, expected) => {
    const metadata = { task_id: "TASK-011", task_plan_file: "specs/feature.plan.json" };
    const response = { ...JSON.parse(body), ...metadata };
    expect(parseResultBlock(block(JSON.stringify(response)), NONCE)).toEqual({
      ...(expected as object),
      ...metadata,
    });
  });

  it("accepts null metadata when no task could be identified and no plan was available", () => {
    const response = { outcome: "blocked", blocker_text: "Provide a task plan", task_id: null, task_plan_file: null };
    expect(parseResultBlock(block(JSON.stringify(response)), NONCE)).toEqual(response);
  });

  it("accepts a blocked response when a plan was available but no task could be selected", () => {
    const response = {
      outcome: "blocked",
      blocker_text: "Resolve task dependencies so a task can be selected",
      task_id: null,
      task_plan_file: "specs/feature.plan.json",
    };
    expect(parseResultBlock(block(JSON.stringify(response)), NONCE)).toEqual(response);
  });

  it.each(["repeat", "complete", "fail"])("rejects a null task_id for %s", (outcome) => {
    const response = {
      outcome,
      task_id: null,
      task_plan_file: "specs/feature.plan.json",
      ...(outcome === "fail" ? { failure_summary: "Validation found a defect" } : {}),
    };
    expect(parseResultBlock(block(JSON.stringify(response)), NONCE)).toHaveProperty("violation");
  });

  it.each(["task_id", "task_plan_file"])("rejects invalid %s values", (field) => {
    for (const value of ["", "   ", 42, false, [], {}]) {
      expect(parseResultBlock(block(JSON.stringify({ outcome: "repeat", [field]: value })), NONCE)).toHaveProperty(
        "violation",
      );
    }
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
      const result = parseResultBlock(text, NONCE);
      expect(result).toHaveProperty("violation");
      expect((result as { violation: string }).violation.length).toBeGreaterThan(10);
    });
  }
});
