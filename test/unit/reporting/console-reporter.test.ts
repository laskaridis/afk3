import { describe, expect, it } from "vitest";
import { ConsoleReporter } from "../../../src/reporting/console-reporter.js";
import type { WorkflowEvent } from "../../../src/workflow/workflow-event.js";

function render(event: WorkflowEvent): string {
  let out = "";
  new ConsoleReporter({
    write: (text) => {
      out += text;
      return true;
    },
  }).onEvent(event);
  return out;
}

describe("ConsoleReporter", () => {
  const cases: Array<[WorkflowEvent, string]> = [
    [
      { type: "IterationStarted", iteration: 2, limit: 5, retry: false },
      "[afk] Iteration 2/5: starting agent session\n",
    ],
    [{ type: "IterationStarted", iteration: 2, limit: 5, retry: true }, ""],
    [
      { type: "StepExecutionRetried", iteration: 2, stepName: "coding", limit: 5, previousError: "boom" },
      "[afk] Iteration 2/5: retrying agent session after execution error\n",
    ],
    [
      { type: "SessionExecutionErrorOccurred", iteration: 1, detail: "bad status", stderrTail: ["first", "last"] },
      "[afk] Execution error: bad status\nfirst\nlast\n",
    ],
    [
      { type: "SessionExecutionErrorOccurred", iteration: 1, detail: "bad status", stderrTail: [] },
      "[afk] Execution error: bad status\n",
    ],
    [{ type: "WorkflowFinished", task: {} }, "[afk] Run complete: no more tasks\n"],
    [{ type: "WorkflowBlocked", blockerText: "need key", task: {} }, "[afk] Run blocked: need key\n"],
    [
      { type: "MaxIterationsReached", limit: 3 },
      "[afk] Run stopped: iteration limit of 3 reached without reported completion\n",
    ],
    [{ type: "WorkflowTimedOut", seconds: 7 }, "[afk] Run stopped: agent session timed out after 7 seconds\n"],
    [{ type: "WorkflowInterrupted" }, "[afk] Run interrupted by user\n"],
    [{ type: "WorkflowFailed", detail: "bad", stderrTail: ["t"] }, ""],
    [{ type: "WorkflowStarted", maxIterations: 3 }, ""],
    [{ type: "StepExecutionStarted", iteration: 1, stepName: "coding" }, ""],
    [{ type: "StepExecutionFinished", iteration: 1, stepName: "coding", task: {} }, ""],
    [{ type: "StepExecutionBlocked", iteration: 1, stepName: "coding", blockerText: "x", task: {} }, ""],
    [{ type: "IterationFinished", iteration: 1, outcome: "TaskImplemented" }, ""],
  ];

  it.each(cases)("renders %j", (event, expected) => {
    expect(render(event)).toBe(expected);
  });
});
