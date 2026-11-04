import type { SessionExecutorFactory } from "../session/session-executor-factory.js";
import { CodingStep } from "./coding-step.js";
import type { TaskMetadata } from "./result-block.js";
import type { TerminalWorkflowEvent, WorkflowEvent } from "./workflow-event.js";
import type { WorkflowObserver } from "./workflow-observer.js";
import type { LaunchPrompt, WorkflowOptions } from "./workflow-options.js";

/** Iteration limit used when the user does not set one. */
export const DEFAULT_MAX_ITERATIONS = 10;

/** An immutable copy of just the task fields of a step result, safe to embed in published events. */
function taskOf(result: TaskMetadata): TaskMetadata {
  return Object.freeze({ task_id: result.task_id, task_plan_file: result.task_plan_file });
}

/**
 * Runs the workflow loop and owns its policy.
 *
 * Each iteration runs one fresh `CodingStep` in a new session and interprets its result:
 *
 * - `Continue` and `StepFailed` end the iteration and the loop moves on to the next one.
 * - `Finished`, `Blocked`, `Timeout` and `Interrupted` end the run immediately.
 * - `SessionFailed` is retried once: a second consecutive failure ends the run, and any other result resets the
 *   allowance. Retries count toward the iteration limit.
 * - Reaching `maxIterations` without a terminal outcome ends the run as `MaxIterationsReached`.
 *
 * Everything that happens is published as a frozen `WorkflowEvent` to the subscribed observers, and the run resolves
 * with the single terminal event. The executor reports nothing itself: output is up to the observers.
 */
export class WorkflowExecutor {
  private readonly observers: WorkflowObserver[] = [];

  /**
   * @param options Run configuration: the agent adapter, the iteration limit, and the working directory, model, effort
   *   and session timeout passed to each step.
   * @param launchPrompt The user's prompt, given to every step.
   * @param sessions Creates the session executor for each iteration's step.
   */
  constructor(
    private readonly options: WorkflowOptions,
    private readonly launchPrompt: LaunchPrompt,
    private readonly sessions: SessionExecutorFactory,
  ) {}

  /** Registers an observer for all later events. Observers are notified in subscription order. */
  subscribe(observer: WorkflowObserver): void {
    this.observers.push(observer);
  }

  /**
   * Runs iterations until a terminal outcome and returns the terminal event, which is also the last event published.
   * Subscribe observers first: events published before they subscribe are not replayed.
   */
  async run(): Promise<TerminalWorkflowEvent> {
    const { maxIterations } = this.options;
    this.publish({ type: "WorkflowStarted", maxIterations });
    let previousError: string | undefined;
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const retry = previousError !== undefined;
      this.publish({ type: "IterationStarted", iteration, limit: maxIterations, retry });
      if (previousError !== undefined) {
        this.publish({ type: "StepExecutionRetried", iteration, limit: maxIterations, previousError });
      }
      const step = new CodingStep(this.sessions.create(this.options.adapter));
      this.publish({ type: "StepExecutionStarted", iteration, stepName: step.name });
      const result = await step.execute(this.launchPrompt.text, {
        cwd: this.options.cwd,
        model: this.options.model,
        effort: this.options.effort,
      });

      // Set when this iteration ends the run. IterationFinished is published first, then the terminal event.
      let terminal: TerminalWorkflowEvent | undefined;
      switch (result.type) {
        case "Continue":
          this.publish({ type: "StepExecutionFinished", iteration, task: taskOf(result) });
          break;
        case "Finished":
          this.publish({ type: "StepExecutionFinished", iteration, task: taskOf(result) });
          terminal = { type: "WorkflowFinished", task: taskOf(result) };
          break;
        case "StepFailed":
          this.publish({
            type: "StepExecutionFailed",
            iteration,
            failureSummary: result.failureSummary,
            task: taskOf(result),
          });
          break;
        case "Blocked":
          this.publish({
            type: "StepExecutionBlocked",
            iteration,
            blockerText: result.blockerText,
            task: taskOf(result),
          });
          terminal = { type: "WorkflowBlocked", blockerText: result.blockerText, task: taskOf(result) };
          break;
        case "SessionFailed":
          this.publish({
            type: "SessionExecutionErrorOccurred",
            iteration,
            detail: result.detail,
            stderrTail: result.stderrTail,
          });
          // One retry per consecutive error; a second consecutive error stops the run.
          if (previousError !== undefined) {
            terminal = { type: "WorkflowFailed", detail: result.detail, stderrTail: result.stderrTail };
          } else if (iteration === maxIterations) {
            terminal = { type: "MaxIterationsReached", limit: maxIterations };
          }
          break;
        case "Timeout":
          terminal = { type: "WorkflowTimedOut", seconds: this.options.sessionTimeoutSeconds ?? 0 };
          break;
        case "Interrupted":
          terminal = { type: "WorkflowInterrupted" };
          break;
      }
      this.publish({ type: "IterationFinished", iteration, outcome: result.type });
      if (terminal !== undefined) return this.publish(terminal);
      // Only a session failure carries over: it makes the next iteration a retry.
      previousError = result.type === "SessionFailed" ? result.detail : undefined;
    }
    return this.publish({ type: "MaxIterationsReached", limit: maxIterations });
  }

  /** Freezes the event, delivers it to every observer in order, and returns it so callers can return terminal events. */
  private publish<T extends WorkflowEvent>(event: T): T {
    const frozen = Object.freeze(event) as T;
    for (const observer of this.observers) observer.onEvent(frozen);
    return frozen;
  }
}
