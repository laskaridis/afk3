import { describe, expect, it } from "vitest";
import { runAfk, type StepRunner } from "../../src/runner.js";
import type { WorkflowStepResult } from "../../src/workflow/workflow-step-result.js";

function scripted(...results: WorkflowStepResult[]) {
  const prompts: string[] = [];
  const runner: StepRunner = async (prompt) => {
    prompts.push(prompt);
    return results[Math.min(prompts.length, results.length) - 1]!;
  };
  return { runner, prompts };
}

const REPEAT: WorkflowStepResult = { type: "Continue" };
const COMPLETE: WorkflowStepResult = { type: "Finished" };
const BLOCKED: WorkflowStepResult = { type: "Blocked", blockerText: "need API key" };
const FAIL: WorkflowStepResult = { type: "StepFailed", failureSummary: "tests broke" };

describe("runAfk", () => {
  it("starts another session after repeat and ends successfully on complete", async () => {
    const { runner, prompts } = scripted(REPEAT, COMPLETE);
    expect(await runAfk({ launchPrompt: "p", maxIterations: 10 }, runner)).toEqual({
      kind: "complete",
    });
    expect(prompts).toEqual(["p", "p"]);
  });

  it("ends blocked with the blocker_text and starts no further session", async () => {
    const { runner, prompts } = scripted(BLOCKED, COMPLETE);
    expect(await runAfk({ launchPrompt: "p", maxIterations: 10 }, runner)).toEqual({
      kind: "blocked",
      blockerText: "need API key",
    });
    expect(prompts).toHaveLength(1);
  });

  it("surfaces the failure_summary and starts another session after fail", async () => {
    const { runner, prompts } = scripted(FAIL, COMPLETE);
    const surfaced: string[] = [];
    const result = await runAfk({ launchPrompt: "p", maxIterations: 10 }, runner, {
      failureSurfaced: (summary) => surfaced.push(summary),
    });
    expect(result).toEqual({ kind: "complete" });
    expect(surfaced).toEqual(["tests broke"]);
    expect(prompts).toHaveLength(2);
  });

  it("allows 10 launches by default budget and honours a smaller limit", async () => {
    const ten = scripted(REPEAT);
    expect(await runAfk({ launchPrompt: "p", maxIterations: 10 }, ten.runner)).toEqual({
      kind: "iteration-limit",
      limit: 10,
    });
    expect(ten.prompts).toHaveLength(10);

    const three = scripted(REPEAT);
    expect(await runAfk({ launchPrompt: "p", maxIterations: 3 }, three.runner)).toEqual({
      kind: "iteration-limit",
      limit: 3,
    });
    expect(three.prompts).toHaveLength(3);
  });

  it("on the last allowed iteration: fail hits the limit, complete succeeds, blocked reports the blocker", async () => {
    const config = { launchPrompt: "p", maxIterations: 1 };
    expect(await runAfk(config, scripted(FAIL).runner)).toEqual({ kind: "iteration-limit", limit: 1 });
    expect(await runAfk(config, scripted(COMPLETE).runner)).toEqual({ kind: "complete" });
    expect(await runAfk(config, scripted(BLOCKED).runner)).toEqual({ kind: "blocked", blockerText: "need API key" });
  });
});

describe("runAfk execution-error retry", () => {
  const ERROR: WorkflowStepResult = {
    type: "SessionFailed",
    detail: "agent exited unsuccessfully with exit code 1",
    stderrTail: [],
  };
  const cfg = { launchPrompt: "p", maxIterations: 10 };

  it("a valid response resets the allowance: error, repeat, error, complete succeeds", async () => {
    const { runner, prompts } = scripted(ERROR, REPEAT, ERROR, COMPLETE);
    expect(await runAfk(cfg, runner)).toEqual({ kind: "complete" });
    expect(prompts).toHaveLength(4);
  });

  it("fail resets the allowance and is not an error: error, fail, error, error stops after four launches", async () => {
    const { runner, prompts } = scripted(ERROR, FAIL, ERROR, ERROR);
    expect(await runAfk(cfg, runner)).toEqual({
      kind: "execution-error",
      detail: "agent exited unsuccessfully with exit code 1",
    });
    expect(prompts).toHaveLength(4);
  });

  it("two consecutive errors stop after two launches, identifying the last error kind", async () => {
    const { runner, prompts } = scripted(ERROR, {
      type: "SessionFailed",
      detail: "failed to launch agent: ENOENT",
      stderrTail: [],
    });
    expect(await runAfk(cfg, runner)).toEqual({ kind: "execution-error", detail: "failed to launch agent: ENOENT" });
    expect(prompts).toHaveLength(2);
  });

  it("announces a retry distinctly and consumes an iteration", async () => {
    const { runner } = scripted(ERROR, COMPLETE);
    const events: string[] = [];
    await runAfk(cfg, runner, {
      iterationStarted: (i, n) => events.push(`start ${i}/${n}`),
      retryStarted: (i, n, reason) => events.push(`retry ${i}/${n} ${reason}`),
    });
    expect(events).toEqual(["start 1/10", "retry 2/10 agent exited unsuccessfully with exit code 1"]);
  });

  it("an error on the last allowed iteration yields iteration-limit, not a retry", async () => {
    const { runner, prompts } = scripted(ERROR);
    expect(await runAfk({ ...cfg, maxIterations: 1 }, runner)).toEqual({ kind: "iteration-limit", limit: 1 });
    expect(prompts).toHaveLength(1);
    const two = scripted(REPEAT, ERROR);
    expect(await runAfk({ ...cfg, maxIterations: 2 }, two.runner)).toEqual({ kind: "iteration-limit", limit: 2 });
  });
});

describe("runAfk interruption", () => {
  it("stops with interrupted without retrying or iterating", async () => {
    const calls: string[] = [];
    const result = await runAfk({ launchPrompt: "p", maxIterations: 5 }, async () => {
      calls.push("x");
      return { type: "Interrupted" };
    });
    expect(result).toEqual({ kind: "interrupted" });
    expect(calls).toHaveLength(1);
  });
});

describe("timed-out session", () => {
  it("stops the run as a timeout without retrying", async () => {
    let launches = 0;
    const result = await runAfk({ launchPrompt: "p", maxIterations: 5, sessionTimeoutSeconds: 7 }, async () => {
      launches++;
      return { type: "Timeout" };
    });
    expect(result).toEqual({ kind: "timeout", seconds: 7 });
    expect(launches).toBe(1);
  });

  it("uses zero seconds when no timeout was configured", async () => {
    expect(await runAfk({ launchPrompt: "p", maxIterations: 1 }, async () => ({ type: "Timeout" as const }))).toEqual({
      kind: "timeout",
      seconds: 0,
    });
  });
});

describe("runAfk error reporting", () => {
  it("reports every session failure with its stderr tail, including the one that leads to a retry", async () => {
    const failed: WorkflowStepResult = { type: "SessionFailed", detail: "bad", stderrTail: ["t"] };
    const errors: Array<[string, string[]]> = [];
    const result = await runAfk({ launchPrompt: "p", maxIterations: 2 }, scripted(failed).runner, {
      executionError: (d, tail) => errors.push([d, tail]),
    });
    expect(result).toEqual({ kind: "execution-error", detail: "bad" });
    expect(errors).toEqual([
      ["bad", ["t"]],
      ["bad", ["t"]],
    ]);
  });
});
