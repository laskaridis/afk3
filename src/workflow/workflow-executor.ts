import type { SessionExecutorFactory } from "../session/session-executor-factory.js";
import type { CorrectionAssignment, VerificationAssignment } from "./assignment.js";
import { CodingStep } from "./steps/coding-step.js";
import { VerificationStep } from "./steps/verification-step.js";
import type { WorkflowStep } from "./workflow-step.js";
import type { WorkflowStepOptions } from "./workflow-step-options.js";
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
 * Two phases: every TaskImplemented candidate is verified, inside its iteration, by a fresh VerificationStep.
 *
 * - VerificationPassed advances to the next iteration, which starts a fresh autonomous coding session.
 * - VerificationFailed makes the next iteration a correction iteration for the same task, unless the task has
 *   been rejected maxVerificationAttempts times, which ends the run with VerificationLimitReached (taking
 *   precedence over the iteration limit).
 * - FeatureVerified, NoMoreTasks, Blocked, Timeout and Interrupted end the invocation.
 * - SessionFailed is retried up to MAX_RETRIES times in a row, in either phase; another outcome resets the retry
 *   allowance. A coding retry uses an iteration; a verification retry re-runs inside the same one.
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
    // Each invocation starts with fresh iteration, retry, attempt, and terminal state.
    let previousError: string | undefined;
    let retriesUsed = 0;
    let iteration = 0;
    let currentStepName = "";
    let currentError: string | undefined;
    let pendingTerminalWorkflowEvent: TerminalWorkflowEvent | undefined;
    let correction: CorrectionAssignment | undefined;
    let attempts: { taskId: string; count: number } | undefined;

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
      requestCorrection: (assignment) => {
        // Counts are per task: a different task id starts a fresh count.
        attempts = {
          taskId: assignment.taskId,
          count: (attempts?.taskId === assignment.taskId ? attempts.count : 0) + 1,
        };
        this.publish({
          type: "VerificationFailed",
          iteration,
          attempt: attempts.count,
          limit: this.options.maxVerificationAttempts,
          failureSummary: assignment.failureSummary,
          findingsFile: assignment.findingsFile,
          task: Object.freeze({ task_id: assignment.taskId, task_plan_file: assignment.taskPlanFile }),
        });
        if (attempts.count >= this.options.maxVerificationAttempts) {
          pendingTerminalWorkflowEvent = {
            type: "VerificationLimitReached",
            limit: this.options.maxVerificationAttempts,
            taskId: assignment.taskId,
          };
        } else {
          correction = assignment;
        }
      },
      endWorkflow: (terminal) => {
        pendingTerminalWorkflowEvent = terminal;
      },
    };

    /**
     * Runs one session of `step` and applies its result through the handlers. `retry` is true when it repeats the
     * previous session of the same iteration after an execution error. Returns the result.
     */
    const runStep = async (step: WorkflowStep, options: WorkflowStepOptions, retry: boolean) => {
      currentError = undefined;
      currentStepName = step.name;
      if (retry) {
        this.publish({
          type: "StepExecutionRetried",
          iteration,
          stepName: currentStepName,
          limit: maxIterations,
          previousError: previousError!,
        });
      }
      this.publish({ type: "StepExecutionStarted", iteration, stepName: currentStepName, limit: maxIterations, retry });
      const result = await step.execute(this.launchPrompt.text, options);
      // Observing a different task than the one being counted starts a fresh count.
      if ("task_id" in result && result.task_id && attempts?.taskId !== result.task_id) attempts = undefined;
      this.handle(result, context);
      // Only an accepted session failure carries over and consumes retry allowance; a valid outcome resets it.
      previousError = currentError;
      retriesUsed = currentError !== undefined ? retriesUsed + 1 : 0;
      return result;
    };

    /** Verifies the candidate of this iteration; an execution error re-runs the session without using an iteration. */
    const verify = async (candidate: Extract<WorkflowStepResult, { type: "TaskImplemented" }>) => {
      const assignment: VerificationAssignment = {
        taskId: candidate.task_id,
        taskPlanFile: candidate.task_plan_file,
        revision: candidate.revision,
      };
      const options: WorkflowStepOptions = {
        cwd: this.options.cwd,
        model: this.options.model,
        effort: this.options.effort,
      };
      correction = undefined;
      let result: WorkflowStepResult;
      let retry = false;
      do {
        result = await runStep(
          new VerificationStep(this.sessions.create(this.options.adapter), assignment),
          options,
          retry,
        );
        retry = currentError !== undefined;
      } while (retry && pendingTerminalWorkflowEvent === undefined);
      return result;
    };

    this.publish({ type: "WorkflowStarted", maxIterations });
    for (iteration = 1; iteration <= maxIterations; iteration++) {
      pendingTerminalWorkflowEvent = undefined;
      this.publish({ type: "IterationStarted", iteration, limit: maxIterations });
      const step = new CodingStep(this.sessions.create(this.options.adapter), correction);
      let result = await runStep(
        step,
        { cwd: this.options.cwd, model: this.options.model, effort: this.options.effort },
        previousError !== undefined,
      );
      if (result.type === "TaskImplemented" && pendingTerminalWorkflowEvent === undefined) {
        result = await verify(result);
      }

      this.publish({ type: "IterationFinished", iteration, outcome: result.type });
      if (pendingTerminalWorkflowEvent !== undefined) {
        return this.publish(pendingTerminalWorkflowEvent);
      }
    }
    return this.publish({ type: "MaxIterationsReached", limit: maxIterations });
  }

  private handle(result: WorkflowStepResult, context: WorkflowStepHandlerContext): void {
    const handler = STEP_HANDLERS[result.type] as WorkflowStepHandler;
    handler.handle(result, context);
  }
}
