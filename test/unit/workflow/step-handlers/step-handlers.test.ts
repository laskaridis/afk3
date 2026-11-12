import { describe, expect, it } from "vitest";
import type { AgentAdapter } from "../../../../src/agents/adapter.js";
import type { SessionExecutorFactory } from "../../../../src/session/session-executor-factory.js";
import { WorkflowStepBlockedHandler } from "../../../../src/workflow/step-handlers/workflow-step-blocked-handler.js";
import { WorkflowStepContinueHandler } from "../../../../src/workflow/step-handlers/workflow-step-continue-handler.js";
import { WorkflowStepFailedHandler } from "../../../../src/workflow/step-handlers/workflow-step-failed-handler.js";
import { WorkflowStepFinishedHandler } from "../../../../src/workflow/step-handlers/workflow-step-finished-handler.js";
import { WorkflowStepInterruptedHandler } from "../../../../src/workflow/step-handlers/workflow-step-interrupted-handler.js";
import { WorkflowStepSessionFailedHandler } from "../../../../src/workflow/step-handlers/workflow-step-session-failed-handler.js";
import { WorkflowStepTimeoutHandler } from "../../../../src/workflow/step-handlers/workflow-step-timeout-handler.js";
import type { WorkflowEvent } from "../../../../src/workflow/workflow-event.js";
import { WorkflowExecutor } from "../../../../src/workflow/workflow-executor.js";
import type { WorkflowOptions } from "../../../../src/workflow/workflow-options.js";

/** A real executor with a recording observer; the handlers' calls back into it are spied on. */
function setup(overrides: Partial<WorkflowOptions> = {}) {
  const executor = new WorkflowExecutor(
    { adapter: {} as AgentAdapter, maxIterations: 5, cwd: "/work", ...overrides },
    { text: "launch" },
    {} as SessionExecutorFactory,
  );
  const events: WorkflowEvent[] = [];
  executor.subscribe({ onEvent: (event) => void events.push(event) });
  const ended: unknown[] = [];
  const retried: unknown[] = [];
  const continued: unknown[] = [];
  executor.continueWorkflow = () => void continued.push(true);
  executor.endWorkflow = (terminal) => void ended.push(terminal);
  executor.retryLastStep = (failure) => void retried.push(failure);
  return { executor, events, ended, retried, continued };
}

const task = { task_id: "T-1", task_plan_file: "p.json" };

describe("workflow step handlers", () => {
  it("Continue reports the step finished and leaves the run going", () => {
    const { executor, events, ended, retried, continued } = setup();
    new WorkflowStepContinueHandler().handle({ type: "Continue", ...task }, executor);
    expect(events).toEqual([{ type: "StepExecutionFinished", iteration: 0, task }]);
    expect(ended).toEqual([]);
    expect(retried).toEqual([]);
    expect(continued).toHaveLength(1);
  });

  it("Finished reports the step finished and ends the run", () => {
    const { executor, events, ended } = setup();
    new WorkflowStepFinishedHandler().handle({ type: "Finished", ...task }, executor);
    expect(events).toEqual([{ type: "StepExecutionFinished", iteration: 0, task }]);
    expect(ended).toEqual([{ type: "WorkflowFinished", task }]);
  });

  it("StepFailed reports the failure and leaves the run going", () => {
    const { executor, events, ended, retried, continued } = setup();
    new WorkflowStepFailedHandler().handle({ type: "StepFailed", failureSummary: "broke", ...task }, executor);
    expect(events).toEqual([{ type: "StepExecutionFailed", iteration: 0, failureSummary: "broke", task }]);
    expect(ended).toEqual([]);
    expect(retried).toEqual([]);
    expect(continued).toHaveLength(1);
  });

  it("Blocked reports the blocker and ends the run", () => {
    const { executor, events, ended } = setup();
    new WorkflowStepBlockedHandler().handle({ type: "Blocked", blockerText: "need key", ...task }, executor);
    expect(events).toEqual([{ type: "StepExecutionBlocked", iteration: 0, blockerText: "need key", task }]);
    expect(ended).toEqual([{ type: "WorkflowBlocked", blockerText: "need key", task }]);
  });

  it("SessionFailed reports the error and asks the executor to retry", () => {
    const { executor, events, ended, retried } = setup();
    new WorkflowStepSessionFailedHandler().handle(
      { type: "SessionFailed", detail: "exit 1", stderrTail: ["tail"] },
      executor,
    );
    expect(events).toEqual([
      { type: "SessionExecutionErrorOccurred", iteration: 0, detail: "exit 1", stderrTail: ["tail"] },
    ]);
    expect(retried).toEqual([{ detail: "exit 1", stderrTail: ["tail"] }]);
    expect(ended).toEqual([]);
  });

  it.each([
    [30, 30],
    [undefined, 0],
  ])("Timeout with session timeout %s ends the run reporting %s seconds", (sessionTimeoutSeconds, seconds) => {
    const { executor, events, ended } = setup({ sessionTimeoutSeconds });
    new WorkflowStepTimeoutHandler().handle({ type: "Timeout" }, executor);
    expect(events).toEqual([]);
    expect(ended).toEqual([{ type: "WorkflowTimedOut", seconds }]);
  });

  it("Interrupted ends the run", () => {
    const { executor, events, ended } = setup();
    new WorkflowStepInterruptedHandler().handle({ type: "Interrupted" }, executor);
    expect(events).toEqual([]);
    expect(ended).toEqual([{ type: "WorkflowInterrupted" }]);
  });
});
