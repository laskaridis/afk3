import { readFileSync } from "node:fs";
import type { SessionExecutor } from "../../session/session-executor.js";
import type { CorrectionAssignment } from "../assignment.js";
import { WorkflowStep } from "./workflow-step.js";
import type { WorkflowStepResult } from "./workflow-step-result.js";

// Copied next to the compiled `workflow/steps/` folder by the build script.
const HARNESS = readFileSync(new URL("./coding-step.md", import.meta.url), "utf8");

const NONCE_PLACEHOLDER = "{{NONCE}}";
const CORRECTION_INSTRUCTION = "Fix the issues the verification agent found for this task.";
const OUTCOME_FIELDS: Record<string, readonly string[]> = {
  task_implemented: ["revision"],
  no_more_tasks: [],
  blocked: ["blocker_text"],
};

type CodingResultBlock =
  | { outcome: "task_implemented"; revision?: string | null; task_id: string; task_plan_file: string }
  | { outcome: "no_more_tasks"; task_id: null; task_plan_file: string }
  | { outcome: "blocked"; blocker_text: string; task_id: string | null; task_plan_file: string | null };

/** One coding session: fresh nonce, session prompt, run, and the agent's result block as a step result. */
export class CodingStep extends WorkflowStep {
  readonly name = "coding";

  /**
   * @param sessions Runs the agent process for this step.
   * @param correction The rejected candidate this session must fix; without it the session is autonomous.
   */
  constructor(
    sessions: SessionExecutor,
    private readonly correction?: CorrectionAssignment,
  ) {
    super(sessions);
  }

  /** Builds the session prompt from the launch prompt or correction assignment and the harness instructions. */
  protected buildPrompt(launchPrompt: string, nonce: string): string {
    const instructions = HARNESS.replaceAll(NONCE_PLACEHOLDER, nonce);
    if (this.correction === undefined) return `${launchPrompt}\n\n---\n${instructions}\n`;
    return [
      "Correction Assignment:",
      `- task_id: ${this.correction.taskId}`,
      `- task_plan_file: ${this.correction.taskPlanFile}`,
      `- findings_file: ${this.correction.findingsFile}`,
      `- failure_summary: ${this.correction.failureSummary}`,
      CORRECTION_INSTRUCTION,
      "---",
      `${instructions}\n`,
    ].join("\n");
  }

  /** Validates and interprets the coding session's result block. */
  protected parseFinalAgentMessage(text: string, nonce: string): WorkflowStepResult | { violation: string } {
    const block = this.parseBlock(text, nonce);
    if ("violation" in block) return block;

    const assigned = this.correction?.taskId;
    if (
      assigned !== undefined &&
      block.task_id !== assigned &&
      !(block.outcome === "blocked" && block.task_id === null)
    ) {
      return {
        violation: `"task_id" is ${JSON.stringify(block.task_id)} but the assigned task is ${JSON.stringify(assigned)}`,
      };
    }

    switch (block.outcome) {
      case "task_implemented":
        return block.revision === undefined
          ? { type: "TaskImplemented", task_id: block.task_id, task_plan_file: block.task_plan_file }
          : {
              type: "TaskImplemented",
              revision: block.revision,
              task_id: block.task_id,
              task_plan_file: block.task_plan_file,
            };
      case "no_more_tasks":
        return { type: "NoMoreTasks", task_id: block.task_id, task_plan_file: block.task_plan_file };
      case "blocked":
        return {
          type: "Blocked",
          blockerText: block.blocker_text,
          task_id: block.task_id,
          task_plan_file: block.task_plan_file,
        };
    }
  }

  private parseBlock(text: string, nonce: string): CodingResultBlock | { violation: string } {
    if (text.trim() === "") return { violation: "the final message is missing or empty" };

    const open = `<afk-harness-result nonce="${nonce}">`;
    const close = "</afk-harness-result>";
    let body: string | undefined;
    for (let start = text.indexOf(open); start !== -1; start = text.indexOf(open, start + open.length)) {
      const end = text.indexOf(close, start + open.length);
      if (end === -1) break;
      body = text.slice(start + open.length, end);
    }
    if (body === undefined)
      return { violation: `the final message has no <afk-harness-result nonce="${nonce}"> block` };

    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      return {
        violation:
          "the result block body is not a single JSON object (found prose, Markdown fences, or malformed JSON)",
      };
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { violation: "the result block is valid JSON but not a JSON object" };
    }

    const fields = value as Record<string, unknown>;
    for (const key of ["task_id", "task_plan_file"] as const) {
      if (!Object.hasOwn(fields, key)) return { violation: `"${key}" is required` };
      if (!this.isTextOrNull(fields[key])) return { violation: `"${key}" must be a non-empty string or null` };
    }
    const { outcome } = fields;
    if (typeof outcome !== "string" || !Object.hasOwn(OUTCOME_FIELDS, outcome)) {
      return { violation: 'missing or unsupported "outcome" (expected task_implemented, no_more_tasks, or blocked)' };
    }
    if (fields.task_id === null && outcome !== "no_more_tasks" && outcome !== "blocked") {
      return {
        violation: 'a null "task_id" requires outcome "no_more_tasks" or "blocked" because no task was implemented',
      };
    }
    if (fields.task_id !== null && outcome === "no_more_tasks") {
      return { violation: 'outcome "no_more_tasks" requires a null "task_id" because no task was selected' };
    }
    if (fields.task_plan_file === null && outcome !== "blocked") {
      return { violation: 'a null "task_plan_file" requires outcome "blocked" because no task list was available' };
    }

    const outcomeFields = OUTCOME_FIELDS[outcome]!;
    const allowed = ["outcome", "task_id", "task_plan_file", ...outcomeFields];
    const extra = Object.keys(fields).filter((key) => !allowed.includes(key));
    if (extra.length > 0) return { violation: `outcome "${outcome}" has unsupported fields: ${extra.join(", ")}` };

    if (fields.revision !== undefined && !this.isTextOrNull(fields.revision)) {
      return { violation: '"revision" must be a non-empty string or null' };
    }
    if (outcome === "blocked" && (typeof fields.blocker_text !== "string" || fields.blocker_text.trim() === "")) {
      return { violation: 'outcome "blocked" requires a non-empty string "blocker_text"' };
    }
    return fields as CodingResultBlock;
  }

  private isTextOrNull(value: unknown): value is string | null {
    return value === null || (typeof value === "string" && value.trim() !== "");
  }
}
