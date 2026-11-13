import type { CorrectionAssignment } from "../assignment.js";
import type { TerminalWorkflowEvent, WorkflowEvent } from "../workflow-event.js";

/** The limited workflow state and operations available to step-result handlers. */
export interface WorkflowStepHandlerContext {
  readonly iteration: number;
  readonly stepName: string;
  readonly sessionTimeoutSeconds: number | undefined;

  /** Publish a step-level event to workflow observers. */
  publish<T extends WorkflowEvent>(event: T): T;
  /** Continue to the next iteration (the default transition). */
  continueWorkflow(): void;
  /** Request a retry; the executor enforces the retry allowance. */
  retryLastStep(failure: { detail: string; stderrTail: readonly string[] }): void;
  /** Request a correction iteration for a rejected candidate; the executor counts the rejection and applies the limit. */
  requestCorrection(assignment: CorrectionAssignment): void;
  /** Request a terminal event, published after IterationFinished. */
  endWorkflow(terminal: TerminalWorkflowEvent): void;
}
