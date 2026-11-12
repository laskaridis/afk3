import type { SessionExecutorFactory } from "../session/session-executor-factory.js";
import { CodingStep } from "./steps/coding-step.js";
import type { WorkflowStepHandler } from "./step-handlers/workflow-step-handler.js";
import type { WorkflowStepHandlerContext } from "./step-handlers/workflow-step-handler-context.js";
import { STEP_HANDLERS } from "./step-handlers/workflow-step-handlers.js";
import type { TerminalWorkflowEvent, WorkflowEvent } from "./workflow-event.js";
import type { WorkflowObserver } from "./workflow-observer.js";
import type { LaunchPrompt } from "./launch-prompt.js";
import type { WorkflowOptions } from "./workflow-options.js";
import type { WorkflowStep } from "./workflow-step.js";
import type { WorkflowStepResult } from "./workflow-step-result.js";

/** Iteration limit used when the user does not set one. */
export const DEFAULT_MAX_ITERATIONS = 10;

/** How many times in a row a failed step is retried before the run fails. Internal: not user-configurable yet. */
const MAX_RETRIES = 1;

/**
 * Runs the workflow loop and owns its policy.
 *
 * Each iteration runs one fresh `CodingStep` in a new session and hands its result to the `WorkflowStepHandler` for
 * that result type. The handler publishes the step-level events and tells the executor, through `continueWorkflow()`, `retryLastStep()` or `endWorkflow()`,
 * what the result means for the run:
 *
 * - `Continue` and `StepFailed` end the iteration and the loop moves on to the next one.
 * - `Finished`, `Blocked`, `Timeout` and `Interrupted` end the run immediately.
 * - `SessionFailed` is retried up to `MAX_RETRIES` times in a row: the next consecutive failure ends the
 *   run, and any other result resets the allowance. Retries count toward the iteration limit.
 * - Reaching `maxIterations` without a terminal outcome ends the run as `MaxIterationsReached`.
 *
 * Everything that happens is published as a frozen `WorkflowEvent` to the subscribed observers, and the run resolves
 * with the single terminal event. The executor reports nothing itself: output is up to the observers.
 */
export class WorkflowExecutor implements WorkflowStepHandlerContext {
  private readonly observers: WorkflowObserver[] = [];
  private currentIteration = 0;
  private currentStep: WorkflowStep | undefined;
  /** Set by `endWorkflow()` during the current iteration. */
  private pendingTerminal: TerminalWorkflowEvent | undefined;
  /** Set by `retryLastStep()` during the current iteration: the detail of the session failure. */
  private currentError: string | undefined;
  /** The session failure of the previous iteration, which makes the current one a retry. */
  private previousError: string | undefined;
  /** Retries already used by the current streak of consecutive session failures. */
  private retriesUsed = 0;

  /**
   * @param options Run configuration: the agent adapter, the iteration limit, and the working directory, model, effort
   *   and session timeout passed to each step. Readable by step handlers.
   * @param launchPrompt The user's prompt, given to every step.
   * @param sessions Creates the session executor for each iteration's step.
   */
  constructor(
    readonly options: WorkflowOptions,
    private readonly launchPrompt: LaunchPrompt,
    private readonly sessions: SessionExecutorFactory,
  ) {}

  /** The iteration being run, counting from 1; 0 before the run starts. */
  get iteration(): number {
    return this.currentIteration;
  }

  /** Timeout information exposed to handlers without exposing full workflow options. */
  get sessionTimeoutSeconds(): number | undefined {
    return this.options.sessionTimeoutSeconds;
  }

  /** Registers an observer for all later events. Observers are notified in subscription order. */
  subscribe(observer: WorkflowObserver): void {
    this.observers.push(observer);
  }

  /** Freezes the event, delivers it to every observer in order, and returns it so callers can return terminal events. */
  publish<T extends WorkflowEvent>(event: T): T {
    const frozen = Object.freeze(event) as T;
    for (const observer of this.observers) observer.onEvent(frozen);
    return frozen;
  }

  /**
   * Asks for the current iteration to be repeated because its session failed. The executor owns the allowance: up to
   * `MAX_RETRIES` retries per streak of consecutive failures; a failure after that ends the run as `WorkflowFailed`.
   * Meant to be called by a step handler while it handles a result.
   */
  retryLastStep(failure: { detail: string; stderrTail: readonly string[] }): void {
    if (this.retriesUsed >= MAX_RETRIES) {
      this.endWorkflow({ type: "WorkflowFailed", detail: failure.detail, stderrTail: failure.stderrTail });
    } else {
      this.currentError = failure.detail;
    }
  }

  /**
   * Notifies the executor that the run goes on with the next iteration. A no-op: continuing is the default outcome of an
   * iteration, and this call makes a handler say so explicitly. Meant to be called by a step handler while it handles a
   * result.
   */
  continueWorkflow(): void {}

  /**
   * Asks for the run to end with `terminal`. The executor publishes it once the iteration's `IterationFinished` event
   * is out. Meant to be called by a step handler while it handles a result.
   */
  endWorkflow(terminal: TerminalWorkflowEvent): void {
    this.pendingTerminal = terminal;
  }

  /**
   * Runs iterations until a terminal outcome and returns the terminal event, which is also the last event published.
   * Subscribe observers first: events published before they subscribe are not replayed.
   */
  async run(): Promise<TerminalWorkflowEvent> {
    const { maxIterations } = this.options;
    this.publish({ type: "WorkflowStarted", maxIterations });
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      this.beginIteration(iteration);
      this.publish({ type: "IterationStarted", iteration, limit: maxIterations, retry: this.hasPreviousError() });
      if (this.hasPreviousError()) {
        this.publish({
          type: "StepExecutionRetried",
          iteration,
          limit: maxIterations,
          previousError: this.previousError as string, // guaranteed by hasPreviousError()
        });
      }
      this.currentStep = new CodingStep(this.sessions.create(this.options.adapter));
      this.publish({ type: "StepExecutionStarted", iteration, stepName: this.currentStep.name });
      const result = await this.currentStep.execute(this.launchPrompt.text, {
        cwd: this.options.cwd,
        model: this.options.model,
        effort: this.options.effort,
      });

      this.handle(result);
      this.publish({ type: "IterationFinished", iteration, outcome: result.type });
      if (this.pendingTerminal !== undefined) {
        return this.publish(this.pendingTerminal);
      }
      // Only a session failure carries over: it makes the next iteration a retry.
      this.previousError = this.currentError;
      this.retriesUsed = this.hasCurrentError() ? this.retriesUsed + 1 : 0;
    }
    return this.publish({ type: "MaxIterationsReached", limit: maxIterations });
  }

  /** Whether the previous iteration ended in a session failure, which makes the current iteration a retry. */
  private hasPreviousError(): boolean {
    return this.previousError !== undefined;
  }

  /** Whether the current iteration ended in a session failure that was accepted for retry. */
  private hasCurrentError(): boolean {
    return this.currentError !== undefined;
  }

  private beginIteration(iteration: number): void {
    this.currentIteration = iteration;
    this.pendingTerminal = undefined;
    this.currentError = undefined;
  }

  private handle(result: WorkflowStepResult): void {
    const handler = STEP_HANDLERS[result.type] as WorkflowStepHandler;
    handler.handle(result, this);
  }
}
