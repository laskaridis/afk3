import type { SessionExecutorFactory } from "../session/session-executor-factory.js";
import type { SessionExecutor } from "../session/session-executor.js";
import { CodingStep } from "./coding-step.js";
import type { TaskMetadata } from "./result-block.js";
import type { TerminalWorkflowEvent, WorkflowEvent } from "./workflow-event.js";
import type { WorkflowObserver } from "./workflow-observer.js";
import type { LaunchPrompt, WorkflowOptions } from "./workflow-options.js";
import type { WorkflowStep } from "./workflow-step.js";

export const DEFAULT_MAX_ITERATIONS = 10;

function taskOf(result: TaskMetadata): TaskMetadata {
  return Object.freeze({ task_id: result.task_id, task_plan_file: result.task_plan_file });
}

/** Run policy: fresh steps until a terminal outcome, retrying one session failure, publishing every event. */
export class WorkflowExecutor {
  private readonly observers: WorkflowObserver[] = [];

  constructor(
    private readonly options: WorkflowOptions,
    private readonly launchPrompt: LaunchPrompt,
    private readonly sessions: SessionExecutorFactory,
    private readonly createStep: (executor: SessionExecutor) => WorkflowStep = (executor) => new CodingStep(executor),
  ) {}

  subscribe(observer: WorkflowObserver): void {
    this.observers.push(observer);
  }

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
      const step = this.createStep(this.sessions.create(this.options.adapter));
      this.publish({ type: "StepExecutionStarted", iteration, stepName: step.name });
      const result = await step.execute(this.launchPrompt.text, {
        cwd: this.options.cwd,
        model: this.options.model,
        effort: this.options.effort,
      });

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
      previousError = result.type === "SessionFailed" ? result.detail : undefined;
    }
    return this.publish({ type: "MaxIterationsReached", limit: maxIterations });
  }

  private publish<T extends WorkflowEvent>(event: T): T {
    const frozen = Object.freeze(event) as T;
    for (const observer of this.observers) observer.onEvent(frozen);
    return frozen;
  }
}
