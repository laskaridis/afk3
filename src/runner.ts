import type { WorkflowStepResult } from "./workflow/workflow-step-result.js";

export const DEFAULT_MAX_ITERATIONS = 10;

export type RunResult =
  | { kind: "complete" }
  | { kind: "blocked"; blockerText: string }
  | { kind: "execution-error"; detail: string }
  | { kind: "iteration-limit"; limit: number }
  | { kind: "timeout"; seconds: number }
  | { kind: "interrupted" };

/** Runs one workflow step for the launch prompt. */
export type StepRunner = (launchPrompt: string) => Promise<WorkflowStepResult>;

export interface RunReporter {
  iterationStarted?(iteration: number, limit: number): void;
  retryStarted?(iteration: number, limit: number, reason: string): void;
  failureSurfaced?(failureSummary: string): void;
  /** Called for every execution error, including the one that leads to a retry; the stderr tail is the agent's last lines. */
  executionError?(detail: string, stderrTail: string[]): void;
}

export interface RunConfig {
  launchPrompt: string;
  maxIterations: number;
  /** Per-session timeout; only used to report a timeout. */
  sessionTimeoutSeconds?: number;
}

/** Run fresh steps until a terminal outcome, deciding only from step results. */
export async function runAfk(config: RunConfig, runStep: StepRunner, reporter: RunReporter = {}): Promise<RunResult> {
  let previousError: string | undefined;
  for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
    if (previousError === undefined) reporter.iterationStarted?.(iteration, config.maxIterations);
    else reporter.retryStarted?.(iteration, config.maxIterations, previousError);
    const step = await runStep(config.launchPrompt);

    switch (step.type) {
      case "Interrupted":
        return { kind: "interrupted" };
      case "Timeout":
        return { kind: "timeout", seconds: config.sessionTimeoutSeconds ?? 0 };
      case "SessionFailed": {
        reporter.executionError?.(step.detail, step.stderrTail);
        // One retry per consecutive error; a second consecutive error stops the run.
        if (previousError !== undefined) return { kind: "execution-error", detail: step.detail };
        if (iteration === config.maxIterations) return { kind: "iteration-limit", limit: config.maxIterations };
        previousError = step.detail;
        continue;
      }
      case "Finished":
        return { kind: "complete" };
      case "Blocked":
        return { kind: "blocked", blockerText: step.blockerText };
      case "StepFailed":
        reporter.failureSurfaced?.(step.failureSummary);
        break;
      case "Continue":
        break;
    }
    previousError = undefined;
  }
  return { kind: "iteration-limit", limit: config.maxIterations };
}
