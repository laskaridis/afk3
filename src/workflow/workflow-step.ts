import type { WorkflowStepResult } from "./workflow-step-result.js";

/** The per-step subset of the run options: where to run and with which model. */
export interface WorkflowStepOptions {
  cwd: string;
  model?: string;
  effort?: string;
}

export interface WorkflowStep {
  readonly name: string;
  execute(launchPrompt: string, options: WorkflowStepOptions): Promise<WorkflowStepResult>;
}
