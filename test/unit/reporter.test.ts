import { describe, expect, it } from "vitest";
import {
  EXIT_CODES,
  exitCodeFor,
  formatExecutionError,
  formatExitCodeHelp,
  formatFinalStatus,
} from "../../src/reporter.js";
import type { RunResult } from "../../src/runner.js";

describe("reporter", () => {
  const results: Array<[RunResult, number, string | undefined]> = [
    [{ kind: "complete" }, EXIT_CODES.complete, "Run complete: feature complete"],
    [{ kind: "blocked", blockerText: "need key" }, EXIT_CODES.blocked, "Run blocked: need key"],
    [{ kind: "execution-error", errorKind: "launch-failed", detail: "failed" }, EXIT_CODES.executionError, undefined],
    [
      { kind: "iteration-limit", limit: 3 },
      EXIT_CODES.iterationLimit,
      "Run stopped: iteration limit of 3 reached without reported completion",
    ],
    [{ kind: "timeout", seconds: 7 }, EXIT_CODES.timeout, "Run stopped: agent session timed out after 7 seconds"],
    [{ kind: "interrupted" }, EXIT_CODES.interrupted, "Run interrupted by user"],
  ];

  it.each(results)("maps %j to the exit code and final status", (result, code, status) => {
    expect(exitCodeFor(result)).toBe(code);
    expect(formatFinalStatus(result)).toBe(status);
  });

  it("documents every exit code", () => {
    const help = formatExitCodeHelp();
    for (const code of Object.values(EXIT_CODES)) expect(help).toContain(`  ${code}`);
    expect(help).toContain("Exit codes:");
  });

  it("prints execution errors followed by each stderr tail line", () => {
    expect(formatExecutionError("bad status", ["first", "last"])).toBe(
      "[afk] Execution error: bad status\nfirst\nlast\n",
    );
    expect(formatExecutionError("bad status", [])).toBe("[afk] Execution error: bad status\n");
  });
});
