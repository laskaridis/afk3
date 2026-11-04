import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SessionExecutor } from "../session/session-executor.js";
import { parseResultBlock, type ResultBlock, type TaskMetadata } from "./result-block.js";
import type { WorkflowStep, WorkflowStepOptions } from "./workflow-step.js";
import type { WorkflowStepResult } from "./workflow-step-result.js";

// Copied next to the compiled `workflow/` folder by the build script.
const HARNESS = readFileSync(new URL("../code.md", import.meta.url), "utf8");

const NONCE_PLACEHOLDER = "{{NONCE}}";

function buildSessionPrompt(launchPrompt: string, nonce: string): string {
  return `${launchPrompt}\n\n---\n${HARNESS.replaceAll(NONCE_PLACEHOLDER, nonce)}\n`;
}

function toStepResult(block: ResultBlock): WorkflowStepResult {
  const metadata: TaskMetadata = {};
  if (block.task_id !== undefined) metadata.task_id = block.task_id;
  if (block.task_plan_file !== undefined) metadata.task_plan_file = block.task_plan_file;
  switch (block.outcome) {
    case "repeat":
      return { type: "Continue", ...metadata };
    case "complete":
      return { type: "Finished", ...metadata };
    case "fail":
      return { type: "StepFailed", failureSummary: block.failure_summary, ...metadata };
    case "blocked":
      return { type: "Blocked", blockerText: block.blocker_text, ...metadata };
  }
}

/** One coding session: fresh nonce, session prompt, run, and the agent's result block as a step result. */
export class CodingStep implements WorkflowStep {
  readonly name = "coding";

  constructor(private readonly sessions: SessionExecutor) {}

  async execute(launchPrompt: string, options: WorkflowStepOptions): Promise<WorkflowStepResult> {
    const nonce = randomBytes(4).toString("hex");
    const session = await this.sessions.execute({
      prompt: buildSessionPrompt(launchPrompt, nonce),
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
        const block = parseResultBlock(session.finalMessage, nonce);
        if ("violation" in block) {
          return {
            type: "SessionFailed",
            detail: `agent final response is invalid: ${block.violation}`,
            stderrTail: session.stderrTail,
          };
        }
        return toStepResult(block);
      }
    }
  }
}
