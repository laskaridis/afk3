import { describe, expect, it } from "vitest";
import { parseResultBlock } from "../../../src/workflow/result-block.js";

const NONCE = "7f3a9c21";
const parseCoding = (text: string | undefined, nonce: string) => parseResultBlock(text, nonce, "coding");
const parseVerification = (text: string | undefined, nonce: string) => parseResultBlock(text, nonce, "verification");
const block = (body: string, nonce = NONCE) => `<afk-harness-result nonce="${nonce}">\n${body}\n</afk-harness-result>`;
const parse = (response: object) => parseCoding(block(JSON.stringify(response)), NONCE);
const violationOf = (response: object) => (parse(response) as { violation: string }).violation;

const PLAN = "specs/feature.plan.json";
const IMPLEMENTED = { outcome: "task_implemented", task_id: "TASK-011", task_plan_file: PLAN };
const NO_MORE = { outcome: "no_more_tasks", task_id: null, task_plan_file: PLAN };
const BLOCKED = { outcome: "blocked", blocker_text: "x", task_id: "TASK-011", task_plan_file: PLAN };

describe("parseResultBlock", () => {
  const valid: Array<[string, object]> = [
    ["task_implemented", IMPLEMENTED],
    ["task_implemented with a revision", { ...IMPLEMENTED, revision: "9f3c2ab" }],
    ["task_implemented with a null revision", { ...IMPLEMENTED, revision: null }],
    ["no_more_tasks", NO_MORE],
    ["blocked", BLOCKED],
    ["blocked without a task", { ...BLOCKED, task_id: null, task_plan_file: null }],
    ["blocked with a plan but no task", { ...BLOCKED, task_id: null }],
  ];

  for (const [name, response] of valid) {
    it(`accepts ${name}, with and without surrounding whitespace and noise`, () => {
      const body = JSON.stringify(response);
      expect(parseCoding(block(body), NONCE)).toEqual(response);
      expect(parseCoding(`<afk-harness-result nonce="${NONCE}">\n  ${body}\t\n</afk-harness-result>`, NONCE)).toEqual(
        response,
      );
      expect(parseCoding(`banner\nDone.\n${block(body)}\ntrailing noise\n`, NONCE)).toEqual(response);
    });
  }

  it("takes the last block with the matching nonce", () => {
    const text = [
      block(JSON.stringify(BLOCKED)),
      block(JSON.stringify({ ...BLOCKED, blocker_text: "echo" }), "deadbeef"),
      block(JSON.stringify(IMPLEMENTED)),
      block(JSON.stringify(NO_MORE), "deadbeef"),
    ].join("\n");
    expect(parseCoding(text, NONCE)).toEqual(IMPLEMENTED);
  });

  it.each(["repeat", "complete", "fail", "workflow_finished", "verification_passed", "verification_failed", "done"])(
    "rejects the outcome %s as outside the coding vocabulary",
    (outcome) => {
      expect(violationOf({ ...IMPLEMENTED, outcome })).toBe(
        'missing or unsupported "outcome" (expected task_implemented, no_more_tasks, or blocked)',
      );
    },
  );

  it.each(["task_id", "task_plan_file"])("requires %s in every block", (field) => {
    for (const response of [IMPLEMENTED, NO_MORE, BLOCKED]) {
      const without: Record<string, unknown> = { ...response };
      delete without[field];
      expect(violationOf(without)).toBe(`"${field}" is required`);
    }
  });

  it.each(["task_id", "task_plan_file"])("rejects invalid %s values", (field) => {
    for (const value of ["", "   ", 42, false, [], {}]) {
      expect(violationOf({ ...BLOCKED, [field]: value })).toBe(`"${field}" must be a non-empty string or null`);
    }
  });

  it("allows a null task_id only with no_more_tasks or blocked", () => {
    expect(violationOf({ ...IMPLEMENTED, task_id: null })).toContain('a null "task_id" requires');
  });

  it("requires no_more_tasks to carry a null task_id", () => {
    expect(violationOf({ ...NO_MORE, task_id: "TASK-011" })).toContain('"no_more_tasks" requires a null "task_id"');
  });

  it("allows a null task_plan_file only with blocked", () => {
    expect(violationOf({ ...IMPLEMENTED, task_plan_file: null })).toContain('a null "task_plan_file" requires');
    expect(violationOf({ ...NO_MORE, task_plan_file: null })).toContain('a null "task_plan_file" requires');
  });

  it.each(["", "  ", 5, ["a"], false])("rejects the revision %j", (revision) => {
    expect(violationOf({ ...IMPLEMENTED, revision })).toBe('"revision" must be a non-empty string or null');
  });

  it("rejects revision on any other outcome", () => {
    expect(violationOf({ ...NO_MORE, revision: "9f3c2ab" })).toBe(
      'outcome "no_more_tasks" has unsupported fields: revision',
    );
    expect(violationOf({ ...BLOCKED, revision: "9f3c2ab" })).toBe('outcome "blocked" has unsupported fields: revision');
  });

  it("rejects findings_file on every coding outcome", () => {
    for (const response of [IMPLEMENTED, NO_MORE, BLOCKED]) {
      expect(violationOf({ ...response, findings_file: "specs/f.verify.md" })).toBe(
        `outcome "${response.outcome}" has unsupported fields: findings_file`,
      );
    }
  });

  it("rejects fields that belong to no coding outcome", () => {
    expect(violationOf({ ...IMPLEMENTED, blocker_text: "x" })).toContain("unsupported fields: blocker_text");
    expect(violationOf({ ...NO_MORE, note: "a" })).toContain("unsupported fields: note");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace", "  \n"],
    ["non-string", 5],
  ])("rejects a %s blocker_text", (_name, blocker_text) => {
    const response: Record<string, unknown> = { ...BLOCKED, blocker_text };
    if (blocker_text === undefined) delete response.blocker_text;
    expect(violationOf(response)).toBe('outcome "blocked" requires a non-empty string "blocker_text"');
  });

  const invalid: Array<[string, string | undefined]> = [
    ["no block", JSON.stringify(IMPLEMENTED)],
    ["block with another nonce", block(JSON.stringify(IMPLEMENTED), "deadbeef")],
    ["unclosed block", `<afk-harness-result nonce="${NONCE}">\n${JSON.stringify(IMPLEMENTED)}`],
    ["markdown fence in block", block("```json\n" + JSON.stringify(IMPLEMENTED) + "\n```")],
    ["prose in block", block("Done. " + JSON.stringify(IMPLEMENTED))],
    ["JSON array", block(`[${JSON.stringify(IMPLEMENTED)}]`)],
    ["JSON string", block('"task_implemented"')],
    ["JSON number", block("42")],
    ["malformed JSON", block('{"outcome":')],
    ["two objects", block(JSON.stringify(IMPLEMENTED) + JSON.stringify(IMPLEMENTED))],
    ["missing outcome", block('{"task_id":"T","task_plan_file":"p"}')],
    ["empty message", ""],
    ["whitespace-only message", " \n "],
    ["absent message", undefined],
  ];

  for (const [name, text] of invalid) {
    it(`rejects ${name} with a readable reason`, () => {
      const result = parseCoding(text, NONCE);
      expect(result).toHaveProperty("violation");
      expect((result as { violation: string }).violation.length).toBeGreaterThan(10);
    });
  }
});

describe("parseResultBlock in the verification phase", () => {
  const verify = (response: object) => parseVerification(block(JSON.stringify(response)), NONCE);
  const verificationViolation = (response: object) => (verify(response) as { violation: string }).violation;
  const PASSED = { outcome: "verification_passed", task_id: "TASK-011", task_plan_file: PLAN };
  const FINISHED = { outcome: "workflow_finished", task_id: "TASK-011", task_plan_file: PLAN };
  const FAILED = {
    outcome: "verification_failed",
    failure_summary: "AC-002 not met",
    findings_file: "specs/feature.verify.md",
    task_id: "TASK-011",
    task_plan_file: PLAN,
  };

  it.each([
    ["verification_passed", PASSED],
    ["workflow_finished", FINISHED],
    ["verification_failed", FAILED],
    ["blocked", BLOCKED],
    ["blocked without a task", { ...BLOCKED, task_id: null, task_plan_file: null }],
  ])("accepts %s", (_name, response) => {
    expect(verify(response)).toEqual(response);
  });

  it.each(["task_implemented", "no_more_tasks", "repeat", "complete", "fail"])(
    "rejects the outcome %s as outside the verification vocabulary",
    (outcome) => {
      expect(verificationViolation({ ...PASSED, outcome })).toBe(
        'missing or unsupported "outcome" (expected verification_passed, workflow_finished, verification_failed, or blocked)',
      );
    },
  );

  it.each(["verification_passed", "workflow_finished", "verification_failed"])(
    "allows a null task_id only with blocked, not with %s",
    (outcome) => {
      const base = { ...FAILED, outcome };
      expect(verificationViolation({ ...base, task_id: null })).toBe(
        'a null "task_id" requires outcome "blocked" because no task was verified',
      );
    },
  );

  it("allows a null task_plan_file only with blocked", () => {
    expect(verificationViolation({ ...PASSED, task_plan_file: null })).toContain('a null "task_plan_file" requires');
  });

  it.each(["task_id", "task_plan_file"])("requires %s", (field) => {
    const without: Record<string, unknown> = { ...PASSED };
    delete without[field];
    expect(verificationViolation(without)).toBe(`"${field}" is required`);
  });

  it.each(["failure_summary", "findings_file"])("requires a non-empty %s on verification_failed", (field) => {
    for (const value of [undefined, "", "  ", 5]) {
      const response: Record<string, unknown> = { ...FAILED, [field]: value };
      if (value === undefined) delete response[field];
      expect(verificationViolation(response)).toBe(
        `outcome "verification_failed" requires a non-empty string "${field}"`,
      );
    }
  });

  it("rejects findings_file on every other verification outcome", () => {
    for (const response of [PASSED, FINISHED, BLOCKED]) {
      expect(verificationViolation({ ...response, findings_file: "f.md" })).toBe(
        `outcome "${response.outcome}" has unsupported fields: findings_file`,
      );
    }
  });

  it("rejects revision and failure_summary where they do not belong", () => {
    expect(verificationViolation({ ...PASSED, revision: "9f3c2ab" })).toContain("unsupported fields: revision");
    expect(verificationViolation({ ...PASSED, failure_summary: "x" })).toContain("unsupported fields: failure_summary");
  });

  it("requires a non-empty blocker_text on blocked", () => {
    expect(verificationViolation({ ...BLOCKED, blocker_text: "" })).toBe(
      'outcome "blocked" requires a non-empty string "blocker_text"',
    );
  });
});
