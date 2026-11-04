import { describe, expect, it } from "vitest";
import type { AgentAdapter } from "../../src/agents/adapter.js";
import { CodexAdapter } from "../../src/agents/codex.js";
import { runAfk, type SessionRunner } from "../../src/runner.js";
import type { SessionResult } from "../../src/session.js";

// A plain-object view of the real adapter, so tests can spread and override single members.
const codex = new CodexAdapter();
const codexAdapter: AgentAdapter = {
  name: codex.name,
  executable: codex.executable,
  buildArgs: (input) => codex.buildArgs(input),
  extractFinalMessage: (stdout, outputFile) => codex.extractFinalMessage(stdout, outputFile),
};

/** A scripted session result; replies are built from the nonce the runner passes in. */
type Scripted = SessionResult | ((nonce: string) => SessionResult);

const reply =
  (message: object): Scripted =>
  (nonce) => ({
    kind: "exited",
    exitCode: 0,
    signal: null,
    stdout: "",
    outputFile: `<afk-harness-result nonce="${nonce}">\n${JSON.stringify(message)}\n</afk-harness-result>`,
    stderrTail: [],
  });

function scripted(...results: Scripted[]) {
  const prompts: string[] = [];
  const nonces: string[] = [];
  const runner: SessionRunner = async (prompt, nonce) => {
    prompts.push(prompt);
    nonces.push(nonce);
    const result = results[Math.min(prompts.length, results.length) - 1]!;
    return typeof result === "function" ? result(nonce) : result;
  };
  return { runner, prompts, nonces };
}

const REPEAT = reply({ outcome: "repeat" });
const COMPLETE = reply({ outcome: "complete" });
const BLOCKED = reply({ outcome: "blocked", blocker_text: "need API key" });
const FAIL = reply({ outcome: "fail", failure_summary: "tests broke" });

describe("runAfk", () => {
  it("starts another session after repeat and ends successfully on complete", async () => {
    const { runner, prompts } = scripted(REPEAT, COMPLETE);
    expect(await runAfk({ adapter: codexAdapter, launchPrompt: "p", maxIterations: 10 }, runner)).toEqual({
      kind: "complete",
    });
    expect(prompts).toEqual(["p", "p"]);
  });

  it("ends blocked with the blocker_text and starts no further session", async () => {
    const { runner, prompts } = scripted(BLOCKED, COMPLETE);
    expect(await runAfk({ adapter: codexAdapter, launchPrompt: "p", maxIterations: 10 }, runner)).toEqual({
      kind: "blocked",
      blockerText: "need API key",
    });
    expect(prompts).toHaveLength(1);
  });

  it("surfaces the failure_summary and starts another session after fail", async () => {
    const { runner, prompts } = scripted(FAIL, COMPLETE);
    const surfaced: string[] = [];
    const result = await runAfk({ adapter: codexAdapter, launchPrompt: "p", maxIterations: 10 }, runner, {
      failureSurfaced: (summary) => surfaced.push(summary),
    });
    expect(result).toEqual({ kind: "complete" });
    expect(surfaced).toEqual(["tests broke"]);
    expect(prompts).toHaveLength(2);
  });

  it("allows 10 launches by default budget and honours a smaller limit", async () => {
    const ten = scripted(REPEAT);
    expect(await runAfk({ adapter: codexAdapter, launchPrompt: "p", maxIterations: 10 }, ten.runner)).toEqual({
      kind: "iteration-limit",
      limit: 10,
    });
    expect(ten.prompts).toHaveLength(10);

    const three = scripted(REPEAT);
    expect(await runAfk({ adapter: codexAdapter, launchPrompt: "p", maxIterations: 3 }, three.runner)).toEqual({
      kind: "iteration-limit",
      limit: 3,
    });
    expect(three.prompts).toHaveLength(3);
  });

  it("on the last allowed iteration: fail hits the limit, complete succeeds, blocked reports the blocker", async () => {
    const config = { adapter: codexAdapter, launchPrompt: "p", maxIterations: 1 };
    expect(await runAfk(config, scripted(FAIL).runner)).toEqual({ kind: "iteration-limit", limit: 1 });
    expect(await runAfk(config, scripted(COMPLETE).runner)).toEqual({ kind: "complete" });
    expect(await runAfk(config, scripted(BLOCKED).runner)).toEqual({ kind: "blocked", blockerText: "need API key" });
  });
});

describe("runAfk execution-error retry", () => {
  const ERROR: SessionResult = { kind: "exited", exitCode: 1, signal: null, stdout: "", stderrTail: [] };
  const cfg = { adapter: codexAdapter, launchPrompt: "p", maxIterations: 10 };

  it("a valid response resets the allowance: error, repeat, error, complete succeeds", async () => {
    const { runner, prompts } = scripted(ERROR, REPEAT, ERROR, COMPLETE);
    expect(await runAfk(cfg, runner)).toEqual({ kind: "complete" });
    expect(prompts).toHaveLength(4);
  });

  it("fail resets the allowance and is not an error: error, fail, error, error stops after four launches", async () => {
    const { runner, prompts } = scripted(ERROR, FAIL, ERROR, ERROR);
    expect(await runAfk(cfg, runner)).toEqual({
      kind: "execution-error",
      errorKind: "exit-status",
      detail: "agent exited unsuccessfully with exit code 1",
    });
    expect(prompts).toHaveLength(4);
  });

  it("two consecutive errors stop after two launches, identifying the last error kind", async () => {
    const { runner, prompts } = scripted(ERROR, { kind: "launch-failed", error: new Error("ENOENT") });
    expect(await runAfk(cfg, runner)).toMatchObject({ kind: "execution-error", errorKind: "launch-failed" });
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

describe("runAfk result block nonce", () => {
  it("passes a fresh nonce to every session, including retries", async () => {
    const ERROR: SessionResult = { kind: "exited", exitCode: 1, signal: null, stdout: "", stderrTail: [] };
    const { runner, nonces } = scripted(REPEAT, ERROR, COMPLETE);
    await runAfk({ adapter: codexAdapter, launchPrompt: "p", maxIterations: 5 }, runner);
    expect(nonces).toHaveLength(3);
    expect(new Set(nonces).size).toBe(3);
  });

  it("treats a block carrying another nonce as an invalid response", async () => {
    const stale: SessionResult = {
      kind: "exited",
      exitCode: 0,
      signal: null,
      stdout: "",
      outputFile: '<afk-harness-result nonce="cafebabe">\n{"outcome":"complete"}\n</afk-harness-result>',
      stderrTail: [],
    };
    const { runner } = scripted(stale);
    expect(await runAfk({ adapter: codexAdapter, launchPrompt: "p", maxIterations: 2 }, runner)).toMatchObject({
      kind: "execution-error",
      errorKind: "invalid-response",
    });
  });
});

describe("runAfk interruption", () => {
  it("stops with interrupted without retrying or iterating", async () => {
    const calls: string[] = [];
    const result = await runAfk({ adapter: codexAdapter, launchPrompt: "p", maxIterations: 5 }, async () => {
      calls.push("x");
      return { kind: "interrupted" };
    });
    expect(result).toEqual({ kind: "interrupted" });
    expect(calls).toHaveLength(1);
  });
});

describe("timed-out session", () => {
  it("stops the run as a timeout without retrying", async () => {
    let launches = 0;
    const result = await runAfk(
      { adapter: codexAdapter, launchPrompt: "p", maxIterations: 5, sessionTimeoutSeconds: 7 },
      async () => {
        launches++;
        return { kind: "timed-out" };
      },
    );
    expect(result).toEqual({ kind: "timeout", seconds: 7 });
    expect(launches).toBe(1);
  });

  it("uses zero seconds when no timeout was configured", async () => {
    expect(
      await runAfk({ adapter: codexAdapter, launchPrompt: "p", maxIterations: 1 }, async () => ({ kind: "timed-out" })),
    ).toEqual({ kind: "timeout", seconds: 0 });
  });
});

describe("runAfk error classification", () => {
  const config = { adapter: codexAdapter, launchPrompt: "p", maxIterations: 2 };

  it("reports each error with the exited session's stderr tail", async () => {
    const errors: Array<[string, string[]]> = [];
    const exited: SessionResult = {
      kind: "exited",
      exitCode: 1,
      signal: null,
      stdout: "",
      stderrTail: ["last line"],
    };
    await runAfk(config, scripted(exited, { kind: "launch-failed", error: new Error("ENOENT") }).runner, {
      executionError: (detail, tail) => errors.push([detail, tail]),
    });
    expect(errors).toEqual([
      ["agent exited unsuccessfully with exit code 1", ["last line"]],
      ["failed to launch agent: ENOENT", []],
    ]);
  });

  it("classifies a signal before examining the final message", async () => {
    const session: SessionResult = {
      kind: "exited",
      exitCode: null,
      signal: "SIGKILL",
      stdout: "",
      stderrTail: [],
    };
    expect(await runAfk({ ...config, maxIterations: 1 }, scripted(session).runner)).toEqual({
      kind: "iteration-limit",
      limit: 1,
    });
    expect(await runAfk(config, scripted(session).runner)).toEqual({
      kind: "execution-error",
      errorKind: "exit-status",
      detail: "agent exited unsuccessfully with signal SIGKILL",
    });
  });

  it("classifies adapter errors with both zero and nonzero exit statuses", async () => {
    const adapter = {
      ...codexAdapter,
      extractFinalMessage: () => ({ agentError: true as const, detail: "rate limit" }),
    };
    const exited = (exitCode: number): SessionResult => ({
      kind: "exited",
      exitCode,
      signal: null,
      stdout: "",
      stderrTail: [],
    });
    expect(await runAfk({ ...config, adapter }, scripted(exited(0)).runner)).toEqual({
      kind: "execution-error",
      errorKind: "exit-status",
      detail: "agent exited unsuccessfully (agent reported an error: rate limit)",
    });
    expect(await runAfk({ ...config, adapter }, scripted(exited(7)).runner)).toEqual({
      kind: "execution-error",
      errorKind: "exit-status",
      detail: "agent exited unsuccessfully with exit code 7 (agent reported an error: rate limit)",
    });
  });

  it("classifies an invalid extraction and a missing final response", async () => {
    const session: SessionResult = { kind: "exited", exitCode: 0, signal: null, stdout: "", stderrTail: [] };
    const invalidAdapter = {
      ...codexAdapter,
      extractFinalMessage: () => ({ invalid: true as const, reason: "bad JSON" }),
    };
    expect(await runAfk({ ...config, adapter: invalidAdapter }, scripted(session).runner)).toEqual({
      kind: "execution-error",
      errorKind: "invalid-response",
      detail: "agent final response is invalid: bad JSON",
    });
    expect(await runAfk(config, scripted(session).runner)).toEqual({
      kind: "execution-error",
      errorKind: "missing-response",
      detail: "agent exited without a final response",
    });
  });
});
