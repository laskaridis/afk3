import { randomBytes } from "node:crypto";
import type { SessionExecutor } from "../session/session-executor.js";
import type { ContractViolation } from "./result-block.js";
import type { WorkflowStepOptions } from "./workflow-step-options.js";
import type { WorkflowStepResult } from "./workflow-step-result.js";

/**
 * One session of work in the workflow. Subclasses supply the prompt and interpretation of a valid result block;
 * the executor owns the policy built on top of the result (retries, limits, events).
 */
export abstract class WorkflowStep<Block extends { outcome: string; task_id: string | null }> {
  /** Short, stable identifier of the step (e.g. `coding`). */
  abstract readonly name: string;

  /** Runs the agent process for this step. */
  constructor(protected readonly sessions: SessionExecutor) {}

  /** Builds the session prompt for this step and nonce. */
  protected abstract buildPrompt(launchPrompt: string, nonce: string): string;

  /** Validates the final message against this step's outcome vocabulary. */
  protected abstract parse(finalMessage: string | undefined, nonce: string): Block | ContractViolation;

  /** The task assigned to this session, if any. */
  protected abstract get assignedTaskId(): string | undefined;

  /** Maps a valid result block to the outcome the workflow executor handles. */
  protected abstract toResult(block: Block): WorkflowStepResult;

  /**
   * Runs the step once, in a fresh session. Expected failures (a failed session, timeout, interruption, or invalid
   * response) are returned as the matching `WorkflowStepResult` rather than thrown.
   *
   * @param launchPrompt The user's prompt, the same for every iteration.
   * @param options Where to run and with which model and effort.
   * @returns What the step ended as, for the executor to act on.
   */
  async execute(launchPrompt: string, options: WorkflowStepOptions): Promise<WorkflowStepResult> {
    const nonce = randomBytes(4).toString("hex");
    const session = await this.sessions.execute({
      prompt: this.buildPrompt(launchPrompt, nonce),
      cwd: options.cwd,
      model: options.model,
      effort: options.effort,
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
        const block = this.parse(session.finalMessage, nonce);
        const violation = "violation" in block ? block.violation : this.wrongTask(block);
        if (violation !== undefined) {
          return {
            type: "SessionFailed",
            detail: `agent final response is invalid: ${violation}`,
            stderrTail: session.stderrTail,
          };
        }
        return this.toResult(block as Block);
      }
    }
  }

  /** The contract violation for a block naming another task; blocked with a null id is exempt. */
  private wrongTask(block: Block): string | undefined {
    const assigned = this.assignedTaskId;
    if (assigned === undefined || block.task_id === assigned) return undefined;
    if (block.outcome === "blocked" && block.task_id === null) return undefined;
    return `"task_id" is ${JSON.stringify(block.task_id)} but the assigned task is ${JSON.stringify(assigned)}`;
  }
}
