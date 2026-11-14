import { readFileSync } from "node:fs";
import type { SessionExecutor } from "../../session/session-executor.js";
import type { CorrectionAssignment } from "../assignment.js";
import { parseResultBlock, type CodingResultBlock } from "../result-block.js";
import { WorkflowStep } from "../workflow-step.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";

// Copied next to the compiled `workflow/steps/` folder by the build script.
const HARNESS = readFileSync(new URL("./coding-step.md", import.meta.url), "utf8");

const NONCE_PLACEHOLDER = "{{NONCE}}";

const CORRECTION_INSTRUCTION = "Fix the issues the verification agent found for this task.";

/** One coding session: fresh nonce, session prompt, run, and the agent's result block as a step result. */
export class CodingStep extends WorkflowStep<CodingResultBlock> {
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

  protected parse(text: string | undefined, nonce: string) {
    return parseResultBlock(text, nonce, "coding");
  }

  protected get assignedTaskId(): string | undefined {
    return this.correction?.taskId;
  }

  protected toResult(block: CodingResultBlock): WorkflowStepResult {
    const { task_id, task_plan_file } = block;
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
        return { type: "NoMoreTasks", task_id, task_plan_file };
      case "blocked":
        return { type: "Blocked", blockerText: block.blocker_text, task_id, task_plan_file };
    }
  }
}
