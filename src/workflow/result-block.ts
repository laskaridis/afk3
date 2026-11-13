/** Which task the agent worked on. Field names are the wire names of the result block. */
export type TaskMetadata = {
  /** Identifier of the task; `null` when no task could be selected. */
  task_id?: string | null;
  /** Path of the file holding the task's plan; `null` when there is none. */
  task_plan_file?: string | null;
};

/** The validated JSON object a coding session reports at the end of a session, discriminated by `outcome`. */
export type ResultBlock = {
  /** Identifier of the task the session worked on; `null` only with `no_more_tasks` or `blocked`. */
  task_id: string | null;
  /** Path of the file holding the task's plan; `null` only with `blocked`. */
  task_plan_file: string | null;
} &
  /** A candidate was committed and is ready for verification; `revision` optionally names its commit. */
  (
    | { outcome: "task_implemented"; revision?: string | null }
    /** No pending task exists; nothing was implemented. */
    | { outcome: "no_more_tasks" }
    /** No progress is possible without outside help; `blocker_text` says why. */
    | { outcome: "blocked"; blocker_text: string }
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

function isTextOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.trim() !== "");
}

/** The contract violation for how `task_id` and `task_plan_file` combine with the outcome, if there is one. */
function taskMetadataViolation(outcome: string, taskId: string | null, taskPlanFile: string | null) {
  if (taskId === null && outcome === "task_implemented") {
    return 'a null "task_id" requires outcome "no_more_tasks" or "blocked" because no task was implemented';
  }
  if (taskId !== null && outcome === "no_more_tasks") {
    return 'outcome "no_more_tasks" requires a null "task_id" because no task was selected';
  }
  if (taskPlanFile === null && outcome !== "blocked") {
    return 'a null "task_plan_file" requires outcome "blocked" because no task list was available';
  }
  return undefined;
}

/**
 * Finds and validates the result block in a coding session's final message.
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
  const { outcome } = fields;
  for (const key of ["task_id", "task_plan_file"] as const) {
    if (!Object.hasOwn(fields, key)) return { violation: `"${key}" is required` };
    if (!isTextOrNull(fields[key])) return { violation: `"${key}" must be a non-empty string or null` };
  }
  const taskId = fields.task_id as string | null;
  const taskPlanFile = fields.task_plan_file as string | null;
  if (outcome !== "task_implemented" && outcome !== "no_more_tasks" && outcome !== "blocked") {
    return { violation: 'missing or unsupported "outcome" (expected task_implemented, no_more_tasks, or blocked)' };
  }
  const metadataViolation = taskMetadataViolation(outcome, taskId, taskPlanFile);
  if (metadataViolation !== undefined) return { violation: metadataViolation };

  const allowed = ["outcome", "task_id", "task_plan_file"];
  if (outcome === "task_implemented") allowed.push("revision");
  if (outcome === "blocked") allowed.push("blocker_text");
  const extra = Object.keys(fields).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    return { violation: `outcome "${outcome}" has unsupported fields: ${extra.join(", ")}` };
  }

  const metadata = { task_id: taskId, task_plan_file: taskPlanFile };
  switch (outcome) {
    case "no_more_tasks":
      return { outcome, ...metadata };
    case "task_implemented": {
      const { revision } = fields;
      if (revision === undefined) return { outcome, ...metadata };
      if (!isTextOrNull(revision)) return { violation: '"revision" must be a non-empty string or null' };
      return { outcome, revision, ...metadata };
    }
    case "blocked": {
      const detail = fields.blocker_text;
      if (typeof detail !== "string" || detail.trim() === "") {
        return { violation: 'outcome "blocked" requires a non-empty string "blocker_text"' };
      }
      return { outcome, blocker_text: detail, ...metadata };
    }
  }
}
