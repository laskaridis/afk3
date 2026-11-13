import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SessionExecutor } from "../../session/session-executor.js";
import type { VerificationAssignment } from "../assignment.js";
import { parseResultBlock, type VerificationResultBlock } from "../result-block.js";
import type { WorkflowStep } from "../workflow-step.js";
import type { WorkflowStepOptions } from "../workflow-step-options.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";
import { executeStepSession } from "./step-session.js";

// Copied next to the compiled `workflow/steps/` folder by the build script.
const HARNESS = readFileSync(new URL("./verification-step.md", import.meta.url), "utf8");

const NONCE_PLACEHOLDER = "{{NONCE}}";

function buildSessionPrompt(launchPrompt: string, assignment: VerificationAssignment, nonce: string): string {
  const lines = [
    "Verification Assignment:",
    `- task_id: ${assignment.taskId}`,
    `- task_plan_file: ${assignment.taskPlanFile}`,
  ];
  if (assignment.revision) lines.push(`- revision: ${assignment.revision}`);
  return `${launchPrompt}\n\n${lines.join("\n")}\n---\n${HARNESS.replaceAll(NONCE_PLACEHOLDER, nonce)}\n`;
}

function toStepResult(block: VerificationResultBlock): WorkflowStepResult {
  switch (block.outcome) {
    case "verification_passed":
      return { type: "VerificationPassed", task_id: block.task_id, task_plan_file: block.task_plan_file };
    case "workflow_finished":
      return { type: "FeatureVerified", task_id: block.task_id, task_plan_file: block.task_plan_file };
    case "verification_failed":
      return {
        type: "VerificationFailed",
        failureSummary: block.failure_summary,
        findingsFile: block.findings_file,
        task_id: block.task_id,
        task_plan_file: block.task_plan_file,
      };
    case "blocked":
      return {
        type: "Blocked",
        blockerText: block.blocker_text,
        task_id: block.task_id,
        task_plan_file: block.task_plan_file,
      };
  }
}

/** One verification session: fresh nonce, session prompt for one candidate, run, and the verdict as a step result. */
export class VerificationStep implements WorkflowStep {
  readonly name = "verification";

  /**
   * @param sessions Runs the agent process for this step.
   * @param assignment The candidate to verify, as the coding session reported it.
   */
  constructor(
    private readonly sessions: SessionExecutor,
    private readonly assignment: VerificationAssignment,
  ) {}

  /**
   * Builds the session prompt (the launch prompt, the verification assignment, then the harness instructions), runs
   * one session and reads the verdict. Session problems and contract violations come back as `SessionFailed`.
   */
  async execute(launchPrompt: string, options: WorkflowStepOptions): Promise<WorkflowStepResult> {
    return executeStepSession<VerificationResultBlock>(
      {
        sessions: this.sessions,
        buildPrompt: (nonce) => buildSessionPrompt(launchPrompt, this.assignment, nonce),
        options,
        parse: (text, nonce) => parseResultBlock(text, nonce, "verification"),
        assignedTaskId: this.assignment.taskId,
        toResult: toStepResult,
      },
      randomBytes(4).toString("hex"),
    );
  }
}
