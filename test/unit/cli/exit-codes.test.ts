import { describe, expect, it } from "vitest";
import { EXIT_CODES, exitCodeFor, formatExitCodeHelp } from "../../../src/cli/exit-codes.js";
import type { TerminalWorkflowEvent } from "../../../src/workflow/workflow-event.js";

describe("exit codes", () => {
  const results: Array<[TerminalWorkflowEvent, number]> = [
    [{ type: "WorkflowFinished", task: {} }, EXIT_CODES.complete],
    [{ type: "WorkflowBlocked", blockerText: "need key", task: {} }, EXIT_CODES.blocked],
    [{ type: "WorkflowFailed", detail: "failed", stderrTail: [] }, EXIT_CODES.executionError],
    [{ type: "MaxIterationsReached", limit: 3 }, EXIT_CODES.iterationLimit],
    [{ type: "WorkflowTimedOut", seconds: 7 }, EXIT_CODES.timeout],
    [{ type: "WorkflowInterrupted" }, EXIT_CODES.interrupted],
  ];

  it.each(results)("maps %j to exit code %i", (result, code) => {
    expect(exitCodeFor(result)).toBe(code);
  });

  it("pins the numbers", () => {
    expect(EXIT_CODES).toEqual({
      complete: 0,
      blocked: 1,
      inputError: 2,
      executionError: 3,
      iterationLimit: 4,
      timeout: 5,
      interrupted: 130,
    });
  });

  it("documents every exit code", () => {
    const help = formatExitCodeHelp();
    for (const code of Object.values(EXIT_CODES)) expect(help).toContain(`  ${code}`);
    expect(help).toContain("Exit codes:");
  });
});
