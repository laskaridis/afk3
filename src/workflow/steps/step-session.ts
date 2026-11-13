import type { SessionExecutor } from "../../session/session-executor.js";
import type { ContractViolation } from "../result-block.js";
import type { WorkflowStepOptions } from "../workflow-step-options.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";

/** What a step needs to run one session and read its result block. */
export interface StepSession<Block extends { outcome: string; task_id: string | null }> {
  /** Runs the agent process for this step. */
  sessions: SessionExecutor;
  /** The session prompt for a session carrying `nonce`. */
  buildPrompt(nonce: string): string;
  /** Where to run and with which model and effort. */
  options: WorkflowStepOptions;
  /** Validates the agent's final message against the step's outcome vocabulary. */
  parse(finalMessage: string | undefined, nonce: string): Block | ContractViolation;
  /** The task id the harness assigned to the session, if any; the block must then name that task. */
  assignedTaskId?: string;
  /** Maps a valid block to the step result. */
  toResult(block: Block): WorkflowStepResult;
}

/**
 * Runs one session with a fresh nonce and classifies how it ended. Session problems, contract violations and a block
 * naming another task than the assigned one come back as `SessionFailed`, never as exceptions.
 */
export async function executeStepSession<Block extends { outcome: string; task_id: string | null }>(
  step: StepSession<Block>,
  nonce: string,
): Promise<WorkflowStepResult> {
  const session = await step.sessions.execute({
    prompt: step.buildPrompt(nonce),
    cwd: step.options.cwd,
    model: step.options.model,
    effort: step.options.effort,
  });
  switch (session.kind) {
    case "interrupted":
      return { type: "Interrupted" };
    case "timed-out":
      return { type: "Timeout" };
    case "launch-failed":
      return { type: "SessionFailed", detail: session.detail, stderrTail: [] };
    case "exited-unsuccessfully":
    case "missing-final-message":
    case "invalid-final-message":
      return { type: "SessionFailed", detail: session.detail, stderrTail: session.stderrTail };
    case "success": {
      const block = step.parse(session.finalMessage, nonce);
      const violation = "violation" in block ? block.violation : wrongTask(block, step.assignedTaskId);
      if (violation !== undefined) {
        return {
          type: "SessionFailed",
          detail: `agent final response is invalid: ${violation}`,
          stderrTail: session.stderrTail,
        };
      }
      return step.toResult(block as Block);
    }
  }
}

/** The contract violation for a block that names another task than the assigned one; `blocked` with a null id is exempt. */
function wrongTask(block: { outcome: string; task_id: string | null }, assigned: string | undefined) {
  if (assigned === undefined || block.task_id === assigned) return undefined;
  if (block.outcome === "blocked" && block.task_id === null) return undefined;
  return `"task_id" is ${JSON.stringify(block.task_id)} but the assigned task is ${JSON.stringify(assigned)}`;
}
