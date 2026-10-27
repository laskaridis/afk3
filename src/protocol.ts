export type AgentOutcome =
  | { outcome: "repeat" }
  | { outcome: "complete" }
  | { outcome: "blocked"; blocker_text: string }
  | { outcome: "fail"; failure_summary: string };

export type ContractViolation = { violation: string };

const SESSION_INSTRUCTIONS = [
  "Use the available code skill to implement exactly one task, then follow its response protocol.",
  "Your final message must be only the code skill's JSON protocol response: a single JSON object, with no surrounding prose and no Markdown fences.",
].join("\n");

export function buildSessionPrompt(launchPrompt: string): string {
  return `${launchPrompt}\n\n---\n${SESSION_INSTRUCTIONS}\n`;
}

const TEXT_FIELD_BY_OUTCOME = {
  blocked: "blocker_text",
  fail: "failure_summary",
} as const;

export function parseFinalResponse(text: string | undefined): AgentOutcome | ContractViolation {
  if (text === undefined || text.trim() === "") {
    return { violation: "the final message is missing or empty" };
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      violation: "the final message is not a single JSON object (found prose, Markdown fences, malformed JSON, or several values)",
    };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { violation: "the final message is valid JSON but not a JSON object" };
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
    return outcome === "blocked"
      ? { outcome, blocker_text: detail }
      : { outcome, failure_summary: detail };
  }
  return {
    violation: `missing or unsupported "outcome" (expected repeat, complete, blocked, or fail)`,
  };
}
