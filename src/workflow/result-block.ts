/** Which task the agent worked on. Field names are the wire names of the result block. */
export type TaskMetadata = {
  /** Identifier of the task; `null` when no task could be selected. */
  task_id?: string | null;
  /** Path of the file holding the task's plan; `null` when there is none. */
  task_plan_file?: string | null;
};

/** The validated JSON object an agent reports at the end of a session, discriminated by `outcome`. */
export type ResultBlock = TaskMetadata &
  /** The task is done but the feature is not: run another session. */
  (
    | { outcome: "repeat" }
    /** The feature is complete. */
    | { outcome: "complete" }
    /** No progress is possible without outside help; `blocker_text` says why. */
    | { outcome: "blocked"; blocker_text: string }
    /** The task failed; `failure_summary` says how. */
    | { outcome: "fail"; failure_summary: string }
  );

/** Why a final message does not satisfy the result-block contract, as a user-facing fragment. */
export type ContractViolation = { violation: string };

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

/**
 * Finds and validates the result block in an agent's final message.
 *
 * Only the last complete block carrying `nonce` counts. Never throws: a missing message, a missing block, malformed
 * JSON or a field that breaks the contract is returned as a `ContractViolation`.
 *
 * @param text The agent's final message, if it produced one.
 * @param nonce The session nonce the block must carry.
 */
export function parseResultBlock(text: string | undefined, nonce: string): ResultBlock | ContractViolation {
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
  const metadata: TaskMetadata = {};
  for (const key of ["task_id", "task_plan_file"] as const) {
    if (!Object.hasOwn(fields, key)) continue;
    const detail = fields[key];
    if (detail !== null && (typeof detail !== "string" || detail.trim() === "")) {
      return { violation: `"${key}" must be a non-empty string or null` };
    }
    metadata[key] = detail;
  }
  const outcomeKeys = Object.keys(fields).filter((key) => key !== "task_id" && key !== "task_plan_file");
  const outcome = fields.outcome;
  if (metadata.task_id === null && outcome !== "blocked") {
    return { violation: 'a null "task_id" requires outcome "blocked" because no task could be selected' };
  }
  if (outcome === "repeat" || outcome === "complete") {
    const extra = outcomeKeys.filter((key) => key !== "outcome");
    if (extra.length > 0) {
      return { violation: `outcome "${outcome}" must have no additional fields, found: ${extra.join(", ")}` };
    }
    return { outcome, ...metadata };
  }
  if (outcome === "blocked" || outcome === "fail") {
    const field = TEXT_FIELD_BY_OUTCOME[outcome];
    const extra = outcomeKeys.filter((key) => key !== "outcome" && key !== field);
    if (extra.length > 0) {
      return { violation: `outcome "${outcome}" has unsupported fields: ${extra.join(", ")}` };
    }
    const detail = fields[field];
    if (typeof detail !== "string" || detail.trim() === "") {
      return { violation: `outcome "${outcome}" requires a non-empty string "${field}"` };
    }
    return outcome === "blocked"
      ? { outcome, blocker_text: detail, ...metadata }
      : { outcome, failure_summary: detail, ...metadata };
  }
  return {
    violation: `missing or unsupported "outcome" (expected repeat, complete, blocked, or fail)`,
  };
}
