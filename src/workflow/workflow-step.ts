import type { WorkflowStepResult } from "./workflow-step-result.js";

/** The per-step subset of the run options: where to run and with which model. */
export interface WorkflowStepOptions {
  /** Working directory the step's agent session runs in. */
  cwd: string;
  /** Model the agent should use; when omitted, the agent's own default applies. */
  model?: string;
  /** Reasoning effort the agent should use; when omitted, the agent's own default applies. */
  effort?: string;
}

/**
 * One unit of work the `WorkflowExecutor` runs in each iteration of the loop.
 *
 * A step owns how its work is carried out and how the outcome is interpreted, and reports that outcome as a
 * `WorkflowStepResult`. The executor owns the policy built on top of it (retries, limits, events).
 */
export interface WorkflowStep {
  /** Short, stable identifier of the step (e.g. `coding`). */
  readonly name: string;
  /**
   * Runs the step once, in a fresh session.
   *
   * Expected failures (a failed session, a timeout, an interruption, an invalid agent response) are returned as the
   * matching `WorkflowStepResult` rather than thrown.
   *
   * @param launchPrompt The user's prompt, the same for every iteration.
   * @param options Where to run and with which model and effort.
   * @returns What the step ended as, for the executor to act on.
   */
  execute(launchPrompt: string, options: WorkflowStepOptions): Promise<WorkflowStepResult>;
}
