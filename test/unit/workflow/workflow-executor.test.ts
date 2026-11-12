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

const CONTINUE: Script = { block: { outcome: "repeat", task_id: "T-1", task_plan_file: "p.json" } };
const FINISHED: Script = { block: { outcome: "complete", task_id: "T-9", task_plan_file: "p.json" } };
const BLOCKED: Script = { block: { outcome: "blocked", blocker_text: "need key", task_id: "T-2" } };
const FAILED: Script = { block: { outcome: "fail", failure_summary: "tests broke" } };
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
    { adapter: ADAPTER, model: "m", effort: "high", maxIterations: 10, cwd: "/work", ...overrides },
    { text: "launch" },
    sessions,
  );
  const events: WorkflowEvent[] = [];
  workflow.subscribe({ onEvent: (event) => void events.push(event) });
  return { workflow, events, calls, created, executors };
}

const types = (events: WorkflowEvent[]) => events.map((event) => event.type);

describe("WorkflowExecutor policy and events", () => {
  it("creates one session executor per iteration for the adapter and runs the step with the run options", async () => {
    const { workflow, calls, created, executors } = setup([CONTINUE, FINISHED]);
    await workflow.run();
    expect(created).toEqual([ADAPTER, ADAPTER]);
    expect(executors[0]).not.toBe(executors[1]);
    expect(calls.map(({ cwd, model, effort }) => ({ cwd, model, effort }))).toEqual([
      { cwd: "/work", model: "m", effort: "high" },
      { cwd: "/work", model: "m", effort: "high" },
    ]);
    expect(calls.every((call) => call.prompt.startsWith("launch"))).toBe(true);
  });

  it("tracks the step of the current iteration, replacing it on the next", async () => {
    // The tracked step is private state; read it by bracket access since nothing else exposes it yet.
    const { workflow } = setup([CONTINUE, FINISHED]);
    expect(workflow["currentStep"]).toBeUndefined();
    const seen: unknown[] = [];
    workflow.subscribe({
      onEvent: (event) => {
        if (event.type === "StepExecutionStarted") seen.push(workflow["currentStep"]);
      },
    });
    await workflow.run();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ name: "coding" });
    expect(seen[1]).not.toBe(seen[0]);
    expect(workflow["currentStep"]).toBe(seen[1]);
  });

  it("complete: repeat then complete", async () => {
    const { workflow, events } = setup([CONTINUE, FINISHED]);
    const result = await workflow.run();
    expect(result).toEqual({ type: "WorkflowFinished", task: { task_id: "T-9", task_plan_file: "p.json" } });
    expect(events.at(-1)).toBe(result);
    expect(types(events)).toEqual([
      "WorkflowStarted",
      "IterationStarted",
      "StepExecutionStarted",
      "StepExecutionFinished",
      "IterationFinished",
      "IterationStarted",
      "StepExecutionStarted",
      "StepExecutionFinished",
      "IterationFinished",
      "WorkflowFinished",
    ]);
    expect(events[0]).toEqual({ type: "WorkflowStarted", maxIterations: 10 });
    expect(events[1]).toEqual({ type: "IterationStarted", iteration: 1, limit: 10, retry: false });
    expect(events[2]).toEqual({ type: "StepExecutionStarted", iteration: 1, stepName: "coding" });
    expect(events[3]).toEqual({
      type: "StepExecutionFinished",
      iteration: 1,
      task: { task_id: "T-1", task_plan_file: "p.json" },
    });
    expect(events[4]).toEqual({ type: "IterationFinished", iteration: 1, outcome: "Continue" });
  });

  it("blocked: stops immediately with the blocker text", async () => {
    const { workflow, events, calls } = setup([BLOCKED, FINISHED]);
    expect(await workflow.run()).toEqual({
      type: "WorkflowBlocked",
      blockerText: "need key",
      task: { task_id: "T-2", task_plan_file: undefined },
    });
    expect(calls).toHaveLength(1);
    expect(types(events).slice(3)).toEqual(["StepExecutionBlocked", "IterationFinished", "WorkflowBlocked"]);
    expect(events[3]).toMatchObject({ blockerText: "need key", task: { task_id: "T-2" } });
  });

  it("fail then complete: the failure is published and the run continues", async () => {
    const { workflow, events, calls } = setup([FAILED, FINISHED]);
    expect((await workflow.run()).type).toBe("WorkflowFinished");
    expect(calls).toHaveLength(2);
    expect(events[3]).toMatchObject({ type: "StepExecutionFailed", iteration: 1, failureSummary: "tests broke" });
    expect(events[4]).toEqual({ type: "IterationFinished", iteration: 1, outcome: "StepFailed" });
  });

  it("iteration limit: ends with MaxIterationsReached after the last iteration", async () => {
    const { workflow, events, calls } = setup([CONTINUE], { maxIterations: 3 });
    const result = await workflow.run();
    expect(result).toEqual({ type: "MaxIterationsReached", limit: 3 });
    expect(calls).toHaveLength(3);
    expect(events.filter((e) => e.type === "IterationStarted")).toHaveLength(3);
    expect(events.filter((e) => e.type === "IterationFinished")).toHaveLength(3);
    expect(events.at(-1)).toBe(result);
  });

  it("retry recovers: publishes both IterationStarted and StepExecutionRetried on the retry iteration", async () => {
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
    expect(events[5]).toEqual({ type: "IterationStarted", iteration: 2, limit: 10, retry: true });
    expect(events[6]).toEqual({ type: "StepExecutionRetried", iteration: 2, limit: 10, previousError: "exit 1" });
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
    const { workflow, calls } = setup([ERROR, FAILED, ERROR, ERROR]);
    expect((await workflow.run()).type).toBe("WorkflowFailed");
    expect(calls).toHaveLength(4);
    const limited = setup([CONTINUE, ERROR, ERROR], { maxIterations: 3 });
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
    const terminal = ["WorkflowFinished", "WorkflowBlocked", "WorkflowFailed", "WorkflowTimedOut"];
    expect(events.filter((e) => terminal.includes(e.type))).toEqual([result]);
  });

  it("publishes immutable events", async () => {
    const { workflow, events } = setup([ERROR, FINISHED]);
    await workflow.run();
    expect(events.every((event) => Object.isFrozen(event))).toBe(true);
  });

  it("ignores observers: return values and mutation attempts do not change the run", async () => {
    const { workflow, calls } = setup([CONTINUE, FINISHED]);
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
    expect(calls).toHaveLength(2);
  });
});
