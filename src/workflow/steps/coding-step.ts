import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SessionExecutor } from "../../session/session-executor.js";
import type { CorrectionAssignment } from "../assignment.js";
import { parseResultBlock, type CodingResultBlock } from "../result-block.js";
import type { WorkflowStep } from "../workflow-step.js";
import type { WorkflowStepOptions } from "../workflow-step-options.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";
import { executeStepSession } from "./step-session.js";

// Copied next to the compiled `workflow/steps/` folder by the build script.
const HARNESS = readFileSync(new URL("./coding-step.md", import.meta.url), "utf8");

const NONCE_PLACEHOLDER = "{{NONCE}}";

const CORRECTION_INSTRUCTION = "Fix the issues the verification agent found for this task.";

function buildSessionPrompt(launchPrompt: string, correction: CorrectionAssignment | undefined, nonce: string) {
  const instructions = HARNESS.replaceAll(NONCE_PLACEHOLDER, nonce);
  if (correction === undefined) return `${launchPrompt}\n\n---\n${instructions}\n`;
  return [
    "Correction Assignment:",
    `- task_id: ${correction.taskId}`,
    `- task_plan_file: ${correction.taskPlanFile}`,
    `- findings_file: ${correction.findingsFile}`,
    `- failure_summary: ${correction.failureSummary}`,
    CORRECTION_INSTRUCTION,
    "---",
    `${instructions}\n`,
  ].join("\n");
}

function toStepResult(block: CodingResultBlock): WorkflowStepResult {
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

/** One coding session: fresh nonce, session prompt, run, and the agent's result block as a step result. */
export class CodingStep implements WorkflowStep {
  readonly name = "coding";

  /**
   * @param sessions Runs the agent process for this step.
   * @param correction The rejected candidate this session must fix; without it the session is autonomous.
   */
  constructor(
    private readonly sessions: SessionExecutor,
    private readonly correction?: CorrectionAssignment,
  ) {}

  /**
   * Builds the session prompt (the launch prompt, or the correction assignment alone, then the harness instructions),
   * runs one session and reads the agent's result block.
   * Session problems and contract violations come back as `SessionFailed`, not as exceptions.
   */
  async execute(launchPrompt: string, options: WorkflowStepOptions): Promise<WorkflowStepResult> {
    return executeStepSession<CodingResultBlock>(
      {
        sessions: this.sessions,
        buildPrompt: (nonce) => buildSessionPrompt(launchPrompt, this.correction, nonce),
        options,
        parse: (text, nonce) => parseResultBlock(text, nonce, "coding"),
        assignedTaskId: this.correction?.taskId,
        toResult: toStepResult,
      },
      randomBytes(4).toString("hex"),
    );
  }
}
