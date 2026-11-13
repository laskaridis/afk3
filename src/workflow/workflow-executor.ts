import type { SessionExecutorFactory } from "../session/session-executor-factory.js";
import { CodingStep } from "./steps/coding-step.js";
import type { WorkflowStepHandler } from "./step-handlers/workflow-step-handler.js";
import type { WorkflowStepHandlerContext } from "./step-handlers/workflow-step-handler-context.js";
import { STEP_HANDLERS } from "./step-handlers/workflow-step-handlers.js";
import type { TerminalWorkflowEvent, WorkflowEvent } from "./workflow-event.js";
import type { WorkflowObserver } from "./workflow-observer.js";
import type { LaunchPrompt } from "./launch-prompt.js";
import type { WorkflowOptions } from "./workflow-options.js";
import type { WorkflowStepResult } from "./workflow-step-result.js";

/** Iteration limit used when the user does not set one. */
export const DEFAULT_MAX_ITERATIONS = 10;

/** Verification attempt limit used when the user does not set one. */
export const DEFAULT_MAX_VERIFICATION_ATTEMPTS = 2;

/** How many times in a row a failed step is retried before the run fails. Internal: not user-configurable yet. */
const MAX_RETRIES = 1;

/**
 * Runs the workflow loop and owns its policy.
 *
 * Serially re-entrant, not parallelizable: the same executor may run again after the previous run settles,
 * but overlapping calls to run() are rejected. Each invocation has independent retry, iteration, and terminal state.
 * Every iteration uses a fresh CodingStep and session.
 *
 * - Continue and StepFailed advance to the next iteration.
 * - Finished, Blocked, Timeout and Interrupted end the invocation.
 * - SessionFailed is retried up to MAX_RETRIES times in a row; another outcome resets the retry allowance.
 * - Reaching maxIterations without a terminal outcome returns MaxIterationsReached.
 *
 * All events are frozen before being published, and the terminal event is published after IterationFinished.
 */
export class WorkflowExecutor {
  private readonly observers: WorkflowObserver[] = [];
  private running = false;

  constructor(
    readonly options: WorkflowOptions,
    private readonly launchPrompt: LaunchPrompt,
    private readonly sessions: SessionExecutorFactory,
  ) {}

  /** Registers an observer for events from this executor's sequential runs. */
  subscribe(observer: WorkflowObserver): void {
    this.observers.push(observer);
  }

  /** Freezes the event and delivers it to every observer in subscription order. */
  publish<T extends WorkflowEvent>(event: T): T {
    const frozen = Object.freeze(event) as T;
    for (const observer of this.observers) observer.onEvent(frozen);
    return frozen;
  }

  /**
   * Executes the workflow. Serially re-entrant but not parallelizable: call again only after the prior
   * invocation settles. Overlapping calls reject with an error. The guard is released on success or failure.
   */
  async run(): Promise<TerminalWorkflowEvent> {
    if (this.running) {
      throw new Error("WorkflowExecutor is already running");
    }
    this.running = true;
    try {
      return await this.executeWorkflow();
    } finally {
      this.running = false;
    }
  }

  private async executeWorkflow(): Promise<TerminalWorkflowEvent> {
    const { maxIterations } = this.options;
    // Each invocation starts with fresh iteration, retry, and terminal state.
    let previousError: string | undefined;
    let retriesUsed = 0;
    let iteration = 0;
    let currentStepName = "";
    let currentError: string | undefined;
    let pendingTerminalWorkflowEvent: TerminalWorkflowEvent | undefined;

    const context: WorkflowStepHandlerContext = {
      get iteration() {
        return iteration;
      },
      get stepName() {
        return currentStepName;
      },
      sessionTimeoutSeconds: this.options.sessionTimeoutSeconds,
      publish: <T extends WorkflowEvent>(event: T): T => this.publish(event),
      continueWorkflow: () => {},
      retryLastStep: (failure) => {
        if (retriesUsed >= MAX_RETRIES) {
          pendingTerminalWorkflowEvent = {
            type: "WorkflowFailed",
            detail: failure.detail,
            stderrTail: failure.stderrTail,
          };
        } else {
          currentError = failure.detail;
        }
      },
      endWorkflow: (terminal) => {
        pendingTerminalWorkflowEvent = terminal;
      },
    };

    this.publish({ type: "WorkflowStarted", maxIterations });
    for (iteration = 1; iteration <= maxIterations; iteration++) {
      currentError = undefined;
      pendingTerminalWorkflowEvent = undefined;
      this.publish({ type: "IterationStarted", iteration, limit: maxIterations, retry: previousError !== undefined });
      const step = new CodingStep(this.sessions.create(this.options.adapter));
      currentStepName = step.name;
      if (previousError !== undefined) {
        this.publish({
          type: "StepExecutionRetried",
          iteration,
          stepName: currentStepName,
          limit: maxIterations,
          previousError,
        });
      }
      this.publish({ type: "StepExecutionStarted", iteration, stepName: currentStepName });
      const result = await step.execute(this.launchPrompt.text, {
        cwd: this.options.cwd,
        model: this.options.model,
        effort: this.options.effort,
      });

      this.handle(result, context);
      this.publish({ type: "IterationFinished", iteration, outcome: result.type });
      if (pendingTerminalWorkflowEvent !== undefined) {
        return this.publish(pendingTerminalWorkflowEvent);
      }
      // Only an accepted session failure carries over and consumes retry allowance.
      previousError = currentError;
      retriesUsed = currentError !== undefined ? retriesUsed + 1 : 0;
    }
    return this.publish({ type: "MaxIterationsReached", limit: maxIterations });
  }

  private handle(result: WorkflowStepResult, context: WorkflowStepHandlerContext): void {
    const handler = STEP_HANDLERS[result.type] as WorkflowStepHandler;
    handler.handle(result, context);
  }
}
