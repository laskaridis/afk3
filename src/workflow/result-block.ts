/** Which task the agent worked on. Field names are the wire names of the result block. */
export type TaskMetadata = {
  /** Identifier of the task; `null` when no task could be selected. */
  task_id?: string | null;
  /** Path of the file holding the task's plan; `null` when there is none. */
  task_plan_file?: string | null;
};

/** The phase of the loop a session runs in; each phase has its own outcome vocabulary. */
export type ResultPhase = "coding" | "verification";

/** The task a session reports on, as the result block names it. */
type ReportedTask = {
  /** Identifier of the task the session worked on. */
  task_id: string;
  /** Path of the file holding the task's plan. */
  task_plan_file: string;
};

/** The validated JSON object a coding session reports at the end of a session, discriminated by `outcome`. */
export type CodingResultBlock =
  /** A candidate was committed and is ready for verification; `revision` optionally names its commit. */
  | ({ outcome: "task_implemented"; revision?: string | null } & ReportedTask)
  /** No pending task exists; nothing was implemented. */
  | { outcome: "no_more_tasks"; task_id: null; task_plan_file: string }
  /** No progress is possible without outside help; `blocker_text` says why. */
  | { outcome: "blocked"; blocker_text: string; task_id: string | null; task_plan_file: string | null };

/** The validated JSON object a verification session reports at the end of a session, discriminated by `outcome`. */
export type VerificationResultBlock =
  /** The candidate passed and tasks remain. */
  | ({ outcome: "verification_passed" } & ReportedTask)
  /** The candidate passed and no tasks remain. */
  | ({ outcome: "workflow_finished" } & ReportedTask)
  /** The candidate was rejected; `findings_file` names the verification agent's notes. */
  | ({ outcome: "verification_failed"; failure_summary: string; findings_file: string } & ReportedTask)
  /** No progress is possible without outside help; `blocker_text` says why. */
  | { outcome: "blocked"; blocker_text: string; task_id: string | null; task_plan_file: string | null };

/** Why a final message does not satisfy the result-block contract, as a user-facing fragment. */
export type ContractViolation = { violation: string };

/** Per phase, each valid outcome with the extra fields it accepts. Every one is a required string except `revision`. */
const VOCABULARY: Record<ResultPhase, Record<string, readonly string[]>> = {
  coding: { task_implemented: ["revision"], no_more_tasks: [], blocked: ["blocker_text"] },
  verification: {
    verification_passed: [],
    workflow_finished: [],
    verification_failed: ["failure_summary", "findings_file"],
    blocked: ["blocker_text"],
  },
};

/** Per phase, the outcomes that may carry a null `task_id`. */
const NULL_TASK_ID_OUTCOMES: Record<ResultPhase, readonly string[]> = {
  coding: ["no_more_tasks", "blocked"],
  verification: ["blocked"],
};

/** "a", "a or b" or "a, b, or c". */
function listOf(items: readonly string[]): string {
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items.at(-1)}`;
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

function isTextOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.trim() !== "");
}

/** The contract violation for how `task_id` and `task_plan_file` combine with the outcome, if there is one. */
function taskMetadataViolation(
  phase: ResultPhase,
  outcome: string,
  taskId: string | null,
  taskPlanFile: string | null,
) {
  const nullable = NULL_TASK_ID_OUTCOMES[phase];
  if (taskId === null && !nullable.includes(outcome)) {
    const names = listOf(nullable.map((name) => `"${name}"`));
    return `a null "task_id" requires outcome ${names} because no task was ${phase === "coding" ? "implemented" : "verified"}`;
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
 * Finds and validates the result block in a session's final message, against the vocabulary of `phase` only.
 *
 * Only the last complete block carrying `nonce` counts. Never throws: a missing message, a missing block, malformed
 * JSON, an outcome of the other phase or a field that breaks the contract is returned as a `ContractViolation`.
 *
 * @param text The agent's final message, if it produced one.
 * @param nonce The session nonce the block must carry.
 * @param phase Whose vocabulary the block must use.
 */
export function parseResultBlock(
  text: string | undefined,
  nonce: string,
  phase: "coding",
): CodingResultBlock | ContractViolation;
export function parseResultBlock(
  text: string | undefined,
  nonce: string,
  phase: "verification",
): VerificationResultBlock | ContractViolation;
export function parseResultBlock(
  text: string | undefined,
  nonce: string,
  phase: ResultPhase,
): CodingResultBlock | VerificationResultBlock | ContractViolation {
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
  const vocabulary = VOCABULARY[phase];
  for (const key of ["task_id", "task_plan_file"] as const) {
    if (!Object.hasOwn(fields, key)) return { violation: `"${key}" is required` };
    if (!isTextOrNull(fields[key])) return { violation: `"${key}" must be a non-empty string or null` };
  }
  const { outcome } = fields;
  if (typeof outcome !== "string" || !Object.hasOwn(vocabulary, outcome)) {
    return { violation: `missing or unsupported "outcome" (expected ${listOf(Object.keys(vocabulary))})` };
  }
  const metadataViolation = taskMetadataViolation(
    phase,
    outcome,
    fields.task_id as string | null,
    fields.task_plan_file as string | null,
  );
  if (metadataViolation !== undefined) return { violation: metadataViolation };

  const outcomeFields = vocabulary[outcome]!;
  const allowed = ["outcome", "task_id", "task_plan_file", ...outcomeFields];
  const extra = Object.keys(fields).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    return { violation: `outcome "${outcome}" has unsupported fields: ${extra.join(", ")}` };
  }

  if (fields.revision !== undefined && !isTextOrNull(fields.revision)) {
    return { violation: '"revision" must be a non-empty string or null' };
  }
  for (const key of outcomeFields.filter((name) => name !== "revision")) {
    const text = fields[key];
    if (typeof text !== "string" || text.trim() === "") {
      return { violation: `outcome "${outcome}" requires a non-empty string "${key}"` };
    }
  }
  // Every field was validated above, so the object has the shape of the matching block type.
  return fields as CodingResultBlock | VerificationResultBlock;
}
