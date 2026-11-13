import { describe, expect, it } from "vitest";
import type { AgentAdapter } from "../../../src/agents/adapter.js";
import type { SessionExecutorFactory } from "../../../src/session/session-executor-factory.js";
import type { SessionExecutor } from "../../../src/session/session-executor.js";
import type { SessionResult } from "../../../src/session/session-result.js";
import type { WorkflowEvent } from "../../../src/workflow/workflow-event.js";
import { WorkflowExecutor } from "../../../src/workflow/workflow-executor.js";
import type { WorkflowOptions } from "../../../src/workflow/workflow-options.js";

const ADAPTER = { name: "fake" } as unknown as AgentAdapter;

/** A scripted session: a raw session result, or the agent's result block (the nonce is read from the prompt). */
type Script = SessionResult | { block: Record<string, unknown> };

const CONTINUE: Script = { block: { outcome: "task_implemented", task_id: "T-1", task_plan_file: "p.json" } };
const PASSED: Script = { block: { outcome: "verification_passed", task_id: "T-1", task_plan_file: "p.json" } };
const VERIFIED_ALL: Script = { block: { outcome: "workflow_finished", task_id: "T-1", task_plan_file: "p.json" } };
const REJECTED: Script = {
  block: {
    outcome: "verification_failed",
    failure_summary: "AC-1 not met",
    findings_file: "f.verify.md",
    task_id: "T-1",
    task_plan_file: "p.json",
  },
};
const FINISHED: Script = { block: { outcome: "no_more_tasks", task_id: null, task_plan_file: "p.json" } };
const BLOCKED: Script = {
  block: { outcome: "blocked", blocker_text: "need key", task_id: "T-2", task_plan_file: "p.json" },
};
const INVALID: Script = {
  block: { outcome: "fail", failure_summary: "tests broke", task_id: "T-1", task_plan_file: "p.json" },
};
const ERROR: Script = { kind: "exited-unsuccessfully", detail: "exit 1", stderrTail: ["tail"] };
const TIMED_OUT: Script = { kind: "timed-out" };
const INTERRUPTED: Script = { kind: "interrupted" };

function toSessionResult(script: Script, prompt: string): SessionResult {
  if ("kind" in script) return script;
  const nonce = /nonce="([^"]+)"/.exec(prompt)![1];
  const finalMessage = `<afk-harness-result nonce="${nonce}">${JSON.stringify(script.block)}</afk-harness-result>`;
  return { kind: "success", finalMessage, stderrTail: [] };
}

function setup(scripts: Script[], overrides: Partial<WorkflowOptions> = {}) {
  const calls: Array<{ prompt: string; cwd: string; model?: string; effort?: string }> = [];
  const created: unknown[] = [];
  const executors: SessionExecutor[] = [];
  const sessions = {
    create: (adapter: unknown) => {
      created.push(adapter);
      const executor = {
        execute: async (request: (typeof calls)[number]) => {
          calls.push(request);
          return toSessionResult(scripts[Math.min(calls.length, scripts.length) - 1]!, request.prompt);
        },
      } as unknown as SessionExecutor;
      executors.push(executor);
      return executor;
    },
  } as unknown as SessionExecutorFactory;
  const workflow = new WorkflowExecutor(
    {
      adapter: ADAPTER,
      model: "m",
      effort: "high",
      maxIterations: 10,
      maxVerificationAttempts: 2,
      cwd: "/work",
      ...overrides,
    },
    { text: "launch" },
    sessions,
  );
  const events: WorkflowEvent[] = [];
  workflow.subscribe({ onEvent: (event) => void events.push(event) });
  return { workflow, events, calls, created, executors };
}

const types = (events: WorkflowEvent[]) => events.map((event) => event.type);

describe("WorkflowExecutor policy and events", () => {
  it("creates one session executor per session for the adapter and runs the step with the run options", async () => {
    const { workflow, calls, created, executors } = setup([CONTINUE, PASSED, FINISHED]);
    await workflow.run();
    expect(created).toEqual([ADAPTER, ADAPTER, ADAPTER]);
    expect(new Set(executors).size).toBe(3);
    expect(calls.map(({ cwd, model, effort }) => ({ cwd, model, effort }))).toEqual([
      { cwd: "/work", model: "m", effort: "high" },
      { cwd: "/work", model: "m", effort: "high" },
      { cwd: "/work", model: "m", effort: "high" },
    ]);
    expect(calls.every((call) => call.prompt.startsWith("launch"))).toBe(true);
  });

  it("creates a new step for each iteration without leaking step identity", async () => {
    const { workflow, events, executors } = setup([CONTINUE, PASSED, FINISHED]);
    await workflow.run();
    expect(executors).toHaveLength(3);
    expect(events.filter((event) => event.type === "StepExecutionStarted")).toEqual([
      { type: "StepExecutionStarted", iteration: 1, stepName: "coding", limit: 10, retry: false },
      { type: "StepExecutionStarted", iteration: 1, stepName: "verification", limit: 10, retry: false },
      { type: "StepExecutionStarted", iteration: 2, stepName: "coding", limit: 10, retry: false },
    ]);
  });

  it("no_more_tasks: task_implemented, verification_passed, then no_more_tasks", async () => {
    const { workflow, events } = setup([CONTINUE, PASSED, FINISHED]);
    const result = await workflow.run();
    expect(result).toEqual({ type: "WorkflowFinished", task: { task_id: null, task_plan_file: "p.json" } });
    expect(events.at(-1)).toBe(result);
    expect(types(events)).toEqual([
      "WorkflowStarted",
      "IterationStarted",
      "StepExecutionStarted",
      "StepExecutionFinished",
      "StepExecutionStarted",
      "StepExecutionFinished",
      "VerificationPassed",
      "IterationFinished",
      "IterationStarted",
      "StepExecutionStarted",
      "StepExecutionFinished",
      "IterationFinished",
      "WorkflowFinished",
    ]);
    expect(events[0]).toEqual({ type: "WorkflowStarted", maxIterations: 10 });
    expect(events[1]).toEqual({ type: "IterationStarted", iteration: 1, limit: 10 });
    expect(events[2]).toEqual({
      type: "StepExecutionStarted",
      iteration: 1,
      stepName: "coding",
      limit: 10,
      retry: false,
    });
    expect(events[3]).toEqual({
      type: "StepExecutionFinished",
      iteration: 1,
      stepName: "coding",
      task: { task_id: "T-1", task_plan_file: "p.json" },
    });
    expect(events[7]).toEqual({ type: "IterationFinished", iteration: 1, outcome: "VerificationPassed" });
    expect(events[10]).toMatchObject({ type: "StepExecutionFinished", stepName: "coding" });
  });

  it("blocked: stops immediately with the blocker text", async () => {
    const { workflow, events, calls } = setup([BLOCKED, FINISHED]);
    expect(await workflow.run()).toEqual({
      type: "WorkflowBlocked",
      blockerText: "need key",
      task: { task_id: "T-2", task_plan_file: "p.json" },
    });
    expect(calls).toHaveLength(1);
    expect(types(events).slice(3)).toEqual(["StepExecutionBlocked", "IterationFinished", "WorkflowBlocked"]);
    expect(events[3]).toMatchObject({ stepName: "coding", blockerText: "need key", task: { task_id: "T-2" } });
  });

  it("a former outcome is an invalid response and is retried once", async () => {
    const { workflow, events, calls } = setup([INVALID, FINISHED]);
    expect((await workflow.run()).type).toBe("WorkflowFinished");
    expect(calls).toHaveLength(2);
    expect(events[3]).toMatchObject({ type: "SessionExecutionErrorOccurred", iteration: 1 });
    expect((events[3] as { detail: string }).detail).toContain("agent final response is invalid");
  });

  it("no_more_tasks on the last allowed iteration still ends the run successfully", async () => {
    const { workflow } = setup([FINISHED], { maxIterations: 1 });
    expect((await workflow.run()).type).toBe("WorkflowFinished");
  });

  it("iteration limit: ends with MaxIterationsReached after the last iteration, which is still verified", async () => {
    const { workflow, events, calls } = setup([CONTINUE, PASSED, CONTINUE, PASSED, CONTINUE, PASSED], {
      maxIterations: 3,
    });
    const result = await workflow.run();
    expect(result).toEqual({ type: "MaxIterationsReached", limit: 3 });
    expect(calls).toHaveLength(6);
    expect(events.filter((e) => e.type === "IterationStarted")).toHaveLength(3);
    expect(events.filter((e) => e.type === "IterationFinished")).toHaveLength(3);
    expect(events.at(-1)).toBe(result);
  });

  it("retry recovers: publishes IterationStarted, StepExecutionRetried and a retry start on the retry iteration", async () => {
    const { workflow, events, calls } = setup([ERROR, FINISHED]);
    expect((await workflow.run()).type).toBe("WorkflowFinished");
    expect(calls).toHaveLength(2);
    expect(types(events)).toEqual([
      "WorkflowStarted",
      "IterationStarted",
      "StepExecutionStarted",
      "SessionExecutionErrorOccurred",
      "IterationFinished",
      "IterationStarted",
      "StepExecutionRetried",
      "StepExecutionStarted",
      "StepExecutionFinished",
      "IterationFinished",
      "WorkflowFinished",
    ]);
    expect(events[3]).toEqual({
      type: "SessionExecutionErrorOccurred",
      iteration: 1,
      detail: "exit 1",
      stderrTail: ["tail"],
    });
    expect(events[5]).toEqual({ type: "IterationStarted", iteration: 2, limit: 10 });
    expect(events[6]).toEqual({
      type: "StepExecutionRetried",
      iteration: 2,
      stepName: "coding",
      limit: 10,
      previousError: "exit 1",
    });
    expect(events[7]).toMatchObject({ type: "StepExecutionStarted", iteration: 2, retry: true });
  });

  it("two consecutive session failures end with WorkflowFailed carrying the second detail and tail", async () => {
    const second: Script = { kind: "exited-unsuccessfully", detail: "second", stderrTail: ["t2"] };
    const { workflow, events, calls } = setup([ERROR, second]);
    const result = await workflow.run();
    expect(result).toEqual({ type: "WorkflowFailed", detail: "second", stderrTail: ["t2"] });
    expect(calls).toHaveLength(2);
    expect(events.filter((e) => e.type === "SessionExecutionErrorOccurred")).toHaveLength(2);
    expect(types(events).slice(-3)).toEqual(["SessionExecutionErrorOccurred", "IterationFinished", "WorkflowFailed"]);
  });

  it("any other outcome resets the retry allowance, and retries count toward the limit", async () => {
    const { workflow, calls } = setup([ERROR, CONTINUE, PASSED, ERROR, ERROR]);
    expect((await workflow.run()).type).toBe("WorkflowFailed");
    expect(calls).toHaveLength(5);
    const limited = setup([CONTINUE, PASSED, ERROR, ERROR], { maxIterations: 3 });
    expect(await limited.workflow.run()).toMatchObject({ type: "WorkflowFailed" });
  });

  it("a session failure on the last iteration with no previous error ends as MaxIterationsReached", async () => {
    const { workflow, events, calls } = setup([ERROR], { maxIterations: 1 });
    const result = await workflow.run();
    expect(result).toEqual({ type: "MaxIterationsReached", limit: 1 });
    expect(calls).toHaveLength(1);
    expect(types(events)).toEqual([
      "WorkflowStarted",
      "IterationStarted",
      "StepExecutionStarted",
      "SessionExecutionErrorOccurred",
      "IterationFinished",
      "MaxIterationsReached",
    ]);
  });

  it("timeout: stops at once with the configured seconds and no step-level event", async () => {
    const { workflow, events, calls } = setup([TIMED_OUT, FINISHED], { sessionTimeoutSeconds: 7 });
    expect(await workflow.run()).toEqual({ type: "WorkflowTimedOut", seconds: 7 });
    expect(calls).toHaveLength(1);
    expect(types(events)).toEqual([
      "WorkflowStarted",
      "IterationStarted",
      "StepExecutionStarted",
      "IterationFinished",
      "WorkflowTimedOut",
    ]);
  });

  it("timeout without a configured timeout reports zero seconds", async () => {
    expect(await setup([TIMED_OUT]).workflow.run()).toEqual({ type: "WorkflowTimedOut", seconds: 0 });
  });

  it("interruption: stops at once without retrying", async () => {
    const { workflow, events, calls } = setup([INTERRUPTED, FINISHED]);
    expect(await workflow.run()).toEqual({ type: "WorkflowInterrupted" });
    expect(calls).toHaveLength(1);
    expect(types(events).slice(-3)).toEqual(["StepExecutionStarted", "IterationFinished", "WorkflowInterrupted"]);
  });

  it("publishes the same terminal event to every observer, exactly once", async () => {
    const { workflow, events } = setup([FINISHED]);
    const other: WorkflowEvent[] = [];
    workflow.subscribe({ onEvent: (event) => void other.push(event) });
    const result = await workflow.run();
    expect(other).toEqual(events);
    expect(other.filter((e) => e === result)).toHaveLength(1);
    const terminal = ["WorkflowFinished", "WorkflowCompleted", "WorkflowBlocked", "WorkflowFailed", "WorkflowTimedOut"];
    expect(events.filter((e) => terminal.includes(e.type))).toEqual([result]);
  });

  it("publishes immutable events", async () => {
    const { workflow, events } = setup([ERROR, FINISHED]);
    await workflow.run();
    expect(events.every((event) => Object.isFrozen(event))).toBe(true);
  });

  it("ignores observers: return values and mutation attempts do not change the run", async () => {
    const { workflow, calls } = setup([CONTINUE, PASSED, FINISHED]);
    workflow.subscribe({
      onEvent: (event) => {
        try {
          (event as { type: string }).type = "WorkflowInterrupted";
        } catch {
          // frozen events reject mutation in strict mode
        }
        return { type: "WorkflowInterrupted" };
      },
    });
    expect((await workflow.run()).type).toBe("WorkflowFinished");
    expect(calls).toHaveLength(3);
  });

  it("restarts with a fresh retry allowance after a successful earlier run", async () => {
    const { workflow, events, calls } = setup([ERROR, FINISHED, ERROR, FINISHED]);
    expect((await workflow.run()).type).toBe("WorkflowFinished");
    const boundary = events.length;
    expect((await workflow.run()).type).toBe("WorkflowFinished");
    expect(calls).toHaveLength(4);
    expect(types(events.slice(boundary))).toEqual([
      "WorkflowStarted",
      "IterationStarted",
      "StepExecutionStarted",
      "SessionExecutionErrorOccurred",
      "IterationFinished",
      "IterationStarted",
      "StepExecutionRetried",
      "StepExecutionStarted",
      "StepExecutionFinished",
      "IterationFinished",
      "WorkflowFinished",
    ]);
    expect(events[boundary + 1]).toEqual({ type: "IterationStarted", iteration: 1, limit: 10 });
    expect(events[boundary + 5]).toEqual({ type: "IterationStarted", iteration: 2, limit: 10 });
  });

  it("restarts cleanly after reaching the iteration limit", async () => {
    const { workflow, events } = setup([ERROR, FINISHED], { maxIterations: 1 });
    expect(await workflow.run()).toEqual({ type: "MaxIterationsReached", limit: 1 });
    const boundary = events.length;
    expect((await workflow.run()).type).toBe("WorkflowFinished");
    expect(events[boundary + 1]).toEqual({ type: "IterationStarted", iteration: 1, limit: 1 });
  });

  it("rejects overlapping runs without disturbing the active run, then allows reuse", async () => {
    const { workflow, events, calls } = setup([FINISHED, FINISHED]);
    const first = workflow.run();
    await expect(workflow.run()).rejects.toThrow("WorkflowExecutor is already running");
    expect(await first).toMatchObject({ type: "WorkflowFinished" });
    expect(await workflow.run()).toMatchObject({ type: "WorkflowFinished" });
    expect(calls).toHaveLength(2);
    expect(events.filter((event) => event.type === "WorkflowStarted")).toHaveLength(2);
  });
});

describe("WorkflowExecutor verification model and effort", () => {
  const phaseOptions = async (overrides: Partial<WorkflowOptions>) => {
    const { workflow, calls } = setup([CONTINUE, PASSED, FINISHED], overrides);
    await workflow.run();
    return calls.map(({ model, effort }) => ({ model, effort }));
  };

  it("uses --verify-model and --verify-reasoning-effort for verification only", async () => {
    expect(await phaseOptions({ model: "m", effort: "low", verifyModel: "vm", verifyEffort: "high" })).toEqual([
      { model: "m", effort: "low" },
      { model: "vm", effort: "high" },
      { model: "m", effort: "low" },
    ]);
  });

  it("resolves each verification override independently, falling back to the coding value", async () => {
    expect(await phaseOptions({ model: "m", effort: "low", verifyModel: "vm" })).toEqual([
      { model: "m", effort: "low" },
      { model: "vm", effort: "low" },
      { model: "m", effort: "low" },
    ]);
    expect(await phaseOptions({ model: undefined, effort: "low", verifyEffort: "high" })).toEqual([
      { model: undefined, effort: "low" },
      { model: undefined, effort: "high" },
      { model: undefined, effort: "low" },
    ]);
  });

  it("verification resolves like a coding session when no override is supplied", async () => {
    expect(await phaseOptions({ model: "m", effort: "low" })).toEqual([
      { model: "m", effort: "low" },
      { model: "m", effort: "low" },
      { model: "m", effort: "low" },
    ]);
  });
});

describe("WorkflowExecutor two-phase loop", () => {
  const prompts = (calls: Array<{ prompt: string }>) => calls.map((call) => call.prompt);

  it("verifies a candidate before any further coding session, with the reported task and revision", async () => {
    const withRevision: Script = {
      block: { outcome: "task_implemented", task_id: "T-1", task_plan_file: "p.json", revision: "abc123" },
    };
    const { workflow, calls } = setup([withRevision, PASSED, FINISHED]);
    await workflow.run();
    expect(calls).toHaveLength(3);
    expect(calls[1]!.prompt).toMatch(
      /^launch\n\nVerification Assignment:\n- task_id: T-1\n- task_plan_file: p.json\n- revision: abc123\n---\n/,
    );
    expect(calls[2]!.prompt.startsWith("launch\n\n---\n")).toBe(true);
    expect(calls[2]!.prompt).not.toContain("Assignment");
  });

  it("omits the revision line when the coding session reported none", async () => {
    const { workflow, calls } = setup([CONTINUE, PASSED, FINISHED]);
    await workflow.run();
    expect(calls[1]!.prompt).not.toContain("- revision:");
  });

  it("workflow_finished ends the run as completed with exit-0 semantics and no further session", async () => {
    const { workflow, events, calls } = setup([CONTINUE, VERIFIED_ALL, FINISHED]);
    const result = await workflow.run();
    expect(result).toEqual({ type: "WorkflowCompleted", task: { task_id: "T-1", task_plan_file: "p.json" } });
    expect(calls).toHaveLength(2);
    expect(events.at(-2)).toEqual({ type: "IterationFinished", iteration: 1, outcome: "FeatureVerified" });
  });

  it("verification_failed starts a correction iteration for the same task, without the launch prompt", async () => {
    const { workflow, events, calls } = setup([CONTINUE, REJECTED, CONTINUE, PASSED, FINISHED]);
    expect((await workflow.run()).type).toBe("WorkflowFinished");
    expect(calls).toHaveLength(5);
    expect(calls[2]!.prompt).toMatch(
      /^Correction Assignment:\n- task_id: T-1\n- task_plan_file: p.json\n- findings_file: f.verify.md\n- failure_summary: AC-1 not met\nFix the issues the verification agent found for this task.\n---\n/,
    );
    expect(calls[2]!.prompt).not.toContain("launch");
    expect(events.find((event) => event.type === "VerificationFailed")).toEqual({
      type: "VerificationFailed",
      iteration: 1,
      attempt: 1,
      limit: 2,
      failureSummary: "AC-1 not met",
      findingsFile: "f.verify.md",
      task: { task_id: "T-1", task_plan_file: "p.json" },
    });
  });

  it("a correction iteration counts against the iteration limit and its candidate is verified", async () => {
    const { workflow, calls } = setup([CONTINUE, REJECTED, CONTINUE, PASSED], { maxIterations: 2 });
    expect(await workflow.run()).toEqual({ type: "MaxIterationsReached", limit: 2 });
    expect(calls).toHaveLength(4);
  });

  it("a rejection after the last allowed iteration ends the run with the iteration limit", async () => {
    const { workflow, calls } = setup([CONTINUE, REJECTED], { maxIterations: 1 });
    expect(await workflow.run()).toEqual({ type: "MaxIterationsReached", limit: 1 });
    expect(calls).toHaveLength(2);
  });

  it("workflow_finished after the last allowed iteration still completes", async () => {
    const { workflow } = setup([CONTINUE, VERIFIED_ALL], { maxIterations: 1 });
    expect((await workflow.run()).type).toBe("WorkflowCompleted");
  });

  it("a blocked verification ends the run without another session", async () => {
    const blocked: Script = {
      block: { outcome: "blocked", blocker_text: "no plan", task_id: "T-1", task_plan_file: "p.json" },
    };
    const { workflow, events, calls } = setup([CONTINUE, blocked, FINISHED]);
    expect(await workflow.run()).toMatchObject({ type: "WorkflowBlocked", blockerText: "no plan" });
    expect(calls).toHaveLength(2);
    expect(events.find((event) => event.type === "StepExecutionBlocked")).toMatchObject({ stepName: "verification" });
  });

  it("retries a verification execution error immediately inside the same iteration, with the same assignment", async () => {
    const { workflow, events, calls } = setup([CONTINUE, ERROR, PASSED, FINISHED], { maxIterations: 2 });
    expect((await workflow.run()).type).toBe("WorkflowFinished");
    expect(calls).toHaveLength(4);
    const nonce = (prompt: string) => /nonce="([^"]+)"/.exec(prompt)![1];
    expect(nonce(calls[1]!.prompt)).not.toBe(nonce(calls[2]!.prompt));
    const strip = (prompt: string) => prompt.replaceAll(nonce(prompt)!, "<nonce>");
    expect(strip(calls[2]!.prompt)).toBe(strip(calls[1]!.prompt));
    expect(events.filter((event) => event.type === "IterationStarted")).toHaveLength(2);
    expect(events.find((event) => event.type === "StepExecutionRetried")).toEqual({
      type: "StepExecutionRetried",
      iteration: 1,
      stepName: "verification",
      limit: 2,
      previousError: "exit 1",
    });
    expect(events.filter((event) => event.type === "StepExecutionStarted")[2]).toMatchObject({
      stepName: "verification",
      retry: true,
    });
  });

  it("a second consecutive verification execution error ends the run", async () => {
    const { workflow, calls } = setup([CONTINUE, ERROR, ERROR, PASSED]);
    expect(await workflow.run()).toMatchObject({ type: "WorkflowFailed", detail: "exit 1" });
    expect(calls).toHaveLength(3);
  });

  it("a valid verification outcome resets the retry budget", async () => {
    const { workflow, calls } = setup([CONTINUE, ERROR, REJECTED, ERROR, CONTINUE, PASSED, FINISHED]);
    expect((await workflow.run()).type).toBe("WorkflowFinished");
    expect(calls).toHaveLength(7);
  });

  it("an invalid verification response (a coding outcome) is retried once, never consuming an iteration", async () => {
    const { workflow, events, calls } = setup([CONTINUE, CONTINUE, PASSED, FINISHED], { maxIterations: 2 });
    expect((await workflow.run()).type).toBe("WorkflowFinished");
    expect(calls).toHaveLength(4);
    expect(events.find((event) => event.type === "SessionExecutionErrorOccurred")).toMatchObject({
      detail: expect.stringContaining("agent final response is invalid"),
    });
  });

  it("a correction iteration retried after an execution error repeats the same assignment with a new nonce", async () => {
    const { workflow, calls } = setup([CONTINUE, REJECTED, ERROR, CONTINUE, PASSED, FINISHED]);
    expect((await workflow.run()).type).toBe("WorkflowFinished");
    const nonce = (prompt: string) => /nonce="([^"]+)"/.exec(prompt)![1]!;
    expect(calls[2]!.prompt).toContain("Correction Assignment");
    expect(calls[3]!.prompt.replaceAll(nonce(calls[3]!.prompt), "N")).toBe(
      calls[2]!.prompt.replaceAll(nonce(calls[2]!.prompt), "N"),
    );
    expect(nonce(calls[3]!.prompt)).not.toBe(nonce(calls[2]!.prompt));
  });

  it("after a pass, the next coding session is autonomous again", async () => {
    const { workflow, calls } = setup([CONTINUE, REJECTED, CONTINUE, PASSED, FINISHED]);
    await workflow.run();
    expect(prompts(calls)[4]!.startsWith("launch\n\n---\n")).toBe(true);
  });

  it("rejects a coding session that answers another task than the assigned one", async () => {
    const other: Script = {
      block: { outcome: "task_implemented", task_id: "T-9", task_plan_file: "p.json" },
    };
    const { workflow, events } = setup([CONTINUE, REJECTED, other, CONTINUE, PASSED, FINISHED]);
    await workflow.run();
    expect(events.find((event) => event.type === "SessionExecutionErrorOccurred")).toMatchObject({
      detail: expect.stringContaining('"task_id" is "T-9" but the assigned task is "T-1"'),
    });
  });

  it("rejects a verification session that answers another task than the assigned one", async () => {
    const other: Script = { block: { outcome: "verification_passed", task_id: "T-9", task_plan_file: "p.json" } };
    const { workflow, events } = setup([CONTINUE, other, PASSED, FINISHED]);
    await workflow.run();
    expect(events.find((event) => event.type === "SessionExecutionErrorOccurred")).toMatchObject({
      detail: expect.stringContaining("the assigned task"),
    });
  });

  it("accepts a blocked response with a null task_id from an assigned session", async () => {
    const blocked: Script = { block: { outcome: "blocked", blocker_text: "?", task_id: null, task_plan_file: null } };
    const { workflow } = setup([CONTINUE, blocked]);
    expect((await workflow.run()).type).toBe("WorkflowBlocked");
  });

  it("counts verification_failed per task, restarting the count for a different task", async () => {
    const second: Script = { block: { outcome: "task_implemented", task_id: "T-2", task_plan_file: "p.json" } };
    const rejectedSecond: Script = {
      block: {
        outcome: "verification_failed",
        failure_summary: "nope",
        findings_file: "f.verify.md",
        task_id: "T-2",
        task_plan_file: "p.json",
      },
    };
    const { workflow, events } = setup(
      [CONTINUE, REJECTED, CONTINUE, REJECTED, CONTINUE, PASSED, second, rejectedSecond, second, PASSED, FINISHED],
      { maxVerificationAttempts: 5 },
    );
    await workflow.run();
    const attempts = events.flatMap((event) => (event.type === "VerificationFailed" ? [event.attempt] : []));
    expect(attempts).toEqual([1, 2, 1]);
  });

  it("stops with VerificationLimitReached, without a correction, once the attempt limit is reached", async () => {
    const { workflow, events, calls } = setup([CONTINUE, REJECTED, CONTINUE, REJECTED, CONTINUE]);
    const result = await workflow.run();
    expect(result).toEqual({ type: "VerificationLimitReached", limit: 2, taskId: "T-1" });
    expect(calls).toHaveLength(4);
    expect(events.at(-1)).toBe(result);
  });

  it("honours a configured attempt limit of 1", async () => {
    const { workflow, calls } = setup([CONTINUE, REJECTED, CONTINUE], { maxVerificationAttempts: 1 });
    expect(await workflow.run()).toEqual({ type: "VerificationLimitReached", limit: 1, taskId: "T-1" });
    expect(calls).toHaveLength(2);
  });

  it("prefers the verification limit over the iteration limit when both are reached at once", async () => {
    const { workflow } = setup([CONTINUE, REJECTED, CONTINUE, REJECTED], { maxIterations: 2 });
    expect(await workflow.run()).toMatchObject({ type: "VerificationLimitReached" });
  });

  it("neither a blocked outcome nor an execution error increments the attempt count", async () => {
    const { workflow, events } = setup([CONTINUE, ERROR, REJECTED, CONTINUE, ERROR, REJECTED, FINISHED]);
    await workflow.run();
    const attempts = events.flatMap((event) => (event.type === "VerificationFailed" ? [event.attempt] : []));
    expect(attempts).toEqual([1, 2]);
  });

  it("starts every run with a fresh attempt count", async () => {
    const { workflow, events } = setup([
      CONTINUE,
      REJECTED,
      CONTINUE,
      PASSED,
      FINISHED,
      CONTINUE,
      REJECTED,
      CONTINUE,
      PASSED,
      FINISHED,
    ]);
    await workflow.run();
    await workflow.run();
    const attempts = events.flatMap((event) => (event.type === "VerificationFailed" ? [event.attempt] : []));
    expect(attempts).toEqual([1, 1]);
  });

  it("resets the attempt count when a different task is observed, even without a rejection", async () => {
    const other = (outcome: string): Script => ({ block: { outcome, task_id: "T-2", task_plan_file: "p.json" } });
    const { workflow, events } = setup(
      [
        CONTINUE,
        REJECTED,
        CONTINUE,
        PASSED,
        other("task_implemented"),
        other("verification_passed"),
        CONTINUE,
        REJECTED,
        FINISHED,
      ],
      { maxVerificationAttempts: 5 },
    );
    await workflow.run();
    const attempts = events.flatMap((event) => (event.type === "VerificationFailed" ? [event.attempt] : []));
    expect(attempts).toEqual([1, 1]);
  });
});
