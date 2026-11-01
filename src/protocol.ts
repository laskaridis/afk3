import { readFileSync } from "node:fs";

export type AgentOutcome =
  | { outcome: "repeat" }
  | { outcome: "complete" }
  | { outcome: "blocked"; blocker_text: string }
  | { outcome: "fail"; failure_summary: string };

export type ContractViolation = { violation: string };

// Copied next to the compiled module by the build script.
const HARNESS = readFileSync(new URL("./code.md", import.meta.url), "utf8");

const NONCE_PLACEHOLDER = "{{NONCE}}";

export function buildSessionPrompt(launchPrompt: string, nonce: string): string {
  return `${launchPrompt}\n\n---\n${HARNESS.replaceAll(NONCE_PLACEHOLDER, nonce)}\n`;
}

/** The body of the last complete result block carrying this session's nonce, so echoed examples and noise are ignored. */
function extractResultBody(text: string, nonce: string): string | undefined {
  const open = `<afk-harness-result nonce="${nonce}">`;
  const close = "</afk-harness-result>";
  let body: string | undefined;
  for (let start = text.indexOf(open); start !== -1; start = text.indexOf(open, start + open.length)) {
    const end = text.indexOf(close, start + open.length);
    if (end === -1) break;
    body = text.slice(start + open.length, end);
  }
  return body;
}

const TEXT_FIELD_BY_OUTCOME = {
  blocked: "blocker_text",
  fail: "failure_summary",
} as const;

export function parseFinalResponse(text: string | undefined, nonce: string): AgentOutcome | ContractViolation {
  if (text === undefined || text.trim() === "") {
    return { violation: "the final message is missing or empty" };
  }

  const body = extractResultBody(text, nonce);
  if (body === undefined) {
    return { violation: `the final message has no <afk-harness-result nonce="${nonce}"> block` };
  }

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return {
      violation: "the result block body is not a single JSON object (found prose, Markdown fences, or malformed JSON)",
    };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { violation: "the result block is valid JSON but not a JSON object" };
  }

  const fields = value as Record<string, unknown>;
  const outcome = fields.outcome;
  if (outcome === "repeat" || outcome === "complete") {
    const extra = Object.keys(fields).filter((key) => key !== "outcome");
    if (extra.length > 0) {
      return { violation: `outcome "${outcome}" must have no additional fields, found: ${extra.join(", ")}` };
    }
    return { outcome };
  }
  if (outcome === "blocked" || outcome === "fail") {
    const field = TEXT_FIELD_BY_OUTCOME[outcome];
    const extra = Object.keys(fields).filter((key) => key !== "outcome" && key !== field);
    if (extra.length > 0) {
      return { violation: `outcome "${outcome}" has unsupported fields: ${extra.join(", ")}` };
    }
    const detail = fields[field];
    if (typeof detail !== "string" || detail.trim() === "") {
      return { violation: `outcome "${outcome}" requires a non-empty string "${field}"` };
    }
    return outcome === "blocked" ? { outcome, blocker_text: detail } : { outcome, failure_summary: detail };
  }
  return {
    violation: `missing or unsupported "outcome" (expected repeat, complete, blocked, or fail)`,
  };
}
