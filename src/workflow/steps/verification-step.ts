import { readFileSync } from "node:fs";
import type { SessionExecutor } from "../../session/session-executor.js";
import type { VerificationAssignment } from "../assignment.js";
import { parseResultBlock, type VerificationResultBlock } from "../result-block.js";
import { WorkflowStep } from "../workflow-step.js";
import type { WorkflowStepResult } from "../workflow-step-result.js";

// Copied next to the compiled `workflow/steps/` folder by the build script.
const HARNESS = readFileSync(new URL("./verification-step.md", import.meta.url), "utf8");

const NONCE_PLACEHOLDER = "{{NONCE}}";

/** One verification session: fresh nonce, session prompt for one candidate, run, and the verdict as a step result. */
export class VerificationStep extends WorkflowStep<VerificationResultBlock> {
  readonly name = "verification";

  /**
   * @param sessions Runs the agent process for this step.
   * @param assignment The candidate to verify, as the coding session reported it.
   */
  constructor(
    sessions: SessionExecutor,
    private readonly assignment: VerificationAssignment,
  ) {
    super(sessions);
  }

  /** Builds the session prompt from the launch prompt, verification assignment, and harness instructions. */
  protected buildPrompt(launchPrompt: string, nonce: string): string {
    const lines = [
      "Verification Assignment:",
      `- task_id: ${this.assignment.taskId}`,
      `- task_plan_file: ${this.assignment.taskPlanFile}`,
    ];
    if (this.assignment.revision) lines.push(`- revision: ${this.assignment.revision}`);
    return `${launchPrompt}\n\n${lines.join("\n")}\n---\n${HARNESS.replaceAll(NONCE_PLACEHOLDER, nonce)}\n`;
  }

  protected parse(text: string | undefined, nonce: string) {
    return parseResultBlock(text, nonce, "verification");
  }

  protected get assignedTaskId(): string {
    return this.assignment.taskId;
  }

  protected toResult(block: VerificationResultBlock): WorkflowStepResult {
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
}
