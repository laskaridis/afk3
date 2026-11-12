import { describe, expect, it } from "vitest";
import { WorkflowStepBlockedHandler } from "../../../../src/workflow/step-handlers/workflow-step-blocked-handler.js";
import { WorkflowStepContinueHandler } from "../../../../src/workflow/step-handlers/workflow-step-continue-handler.js";
import { WorkflowStepFailedHandler } from "../../../../src/workflow/step-handlers/workflow-step-failed-handler.js";
import { WorkflowStepFinishedHandler } from "../../../../src/workflow/step-handlers/workflow-step-finished-handler.js";
import { WorkflowStepInterruptedHandler } from "../../../../src/workflow/step-handlers/workflow-step-interrupted-handler.js";
import { WorkflowStepSessionFailedHandler } from "../../../../src/workflow/step-handlers/workflow-step-session-failed-handler.js";
import { WorkflowStepTimeoutHandler } from "../../../../src/workflow/step-handlers/workflow-step-timeout-handler.js";
import type { WorkflowStepHandlerContext } from "../../../../src/workflow/step-handlers/workflow-step-handler-context.js";
import type { WorkflowEvent } from "../../../../src/workflow/workflow-event.js";

/** Record the handler's output without depending on the concrete workflow executor. */
function setup(sessionTimeoutSeconds?: number) {
  const events: WorkflowEvent[] = [];
  const ended: unknown[] = [];
  const retried: unknown[] = [];
  const continued: unknown[] = [];
  const context: WorkflowStepHandlerContext = {
    iteration: 0,
    sessionTimeoutSeconds,
    publish: (event) => {
      events.push(event);
      return event;
    },
    continueWorkflow: () => void continued.push(true),
    endWorkflow: (terminal) => void ended.push(terminal),
    retryLastStep: (failure) => void retried.push(failure),
  };
  return { context, events, ended, retried, continued };
}

const task = { task_id: "T-1", task_plan_file: "p.json" };

describe("workflow step handlers", () => {
  it("Continue reports the step finished and leaves the run going", () => {
    const { context, events, ended, retried, continued } = setup();
    new WorkflowStepContinueHandler().handle({ type: "Continue", ...task }, context);
    expect(events).toEqual([{ type: "StepExecutionFinished", iteration: 0, task }]);
    expect(ended).toEqual([]);
    expect(retried).toEqual([]);
    expect(continued).toHaveLength(1);
  });

  it("Finished reports the step finished and ends the run", () => {
    const { context, events, ended } = setup();
    new WorkflowStepFinishedHandler().handle({ type: "Finished", ...task }, context);
    expect(events).toEqual([{ type: "StepExecutionFinished", iteration: 0, task }]);
    expect(ended).toEqual([{ type: "WorkflowFinished", task }]);
  });

  it("StepFailed reports the failure and leaves the run going", () => {
    const { context, events, ended, retried, continued } = setup();
    new WorkflowStepFailedHandler().handle({ type: "StepFailed", failureSummary: "broke", ...task }, context);
    expect(events).toEqual([{ type: "StepExecutionFailed", iteration: 0, failureSummary: "broke", task }]);
    expect(ended).toEqual([]);
    expect(retried).toEqual([]);
    expect(continued).toHaveLength(1);
  });

  it("Blocked reports the blocker and ends the run", () => {
    const { context, events, ended } = setup();
    new WorkflowStepBlockedHandler().handle({ type: "Blocked", blockerText: "need key", ...task }, context);
    expect(events).toEqual([{ type: "StepExecutionBlocked", iteration: 0, blockerText: "need key", task }]);
    expect(ended).toEqual([{ type: "WorkflowBlocked", blockerText: "need key", task }]);
  });

  it("SessionFailed reports the error and asks the executor to retry", () => {
    const { context, events, ended, retried } = setup();
    new WorkflowStepSessionFailedHandler().handle(
      { type: "SessionFailed", detail: "exit 1", stderrTail: ["tail"] },
      context,
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
    const { context, events, ended } = setup(sessionTimeoutSeconds);
    new WorkflowStepTimeoutHandler().handle({ type: "Timeout" }, context);
    expect(events).toEqual([]);
    expect(ended).toEqual([{ type: "WorkflowTimedOut", seconds }]);
  });

  it("Interrupted ends the run", () => {
    const { context, events, ended } = setup();
    new WorkflowStepInterruptedHandler().handle({ type: "Interrupted" }, context);
    expect(events).toEqual([]);
    expect(ended).toEqual([{ type: "WorkflowInterrupted" }]);
  });
});
