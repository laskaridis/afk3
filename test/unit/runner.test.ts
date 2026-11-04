import { describe, expect, it } from "vitest";
import { runAfk, type SessionRunner } from "../../src/runner.js";
import type { SessionResult } from "../../src/session/session-result.js";

/** A scripted session result; replies are built from the nonce the runner passes in. */
type Scripted = SessionResult | ((nonce: string) => SessionResult);

const reply =
  (message: object): Scripted =>
  (nonce) => ({
    kind: "success",
    finalMessage: `<afk-harness-result nonce="${nonce}">\n${JSON.stringify(message)}\n</afk-harness-result>`,
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
  const ERROR: SessionResult = {
    kind: "exited-unsuccessfully",
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
      errorKind: "exit-status",
      detail: "agent exited unsuccessfully with exit code 1",
    });
    expect(prompts).toHaveLength(4);
  });

  it("two consecutive errors stop after two launches, identifying the last error kind", async () => {
    const { runner, prompts } = scripted(ERROR, { kind: "launch-failed", detail: "failed to launch agent: ENOENT" });
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
    const ERROR: SessionResult = {
      kind: "exited-unsuccessfully",
      detail: "agent exited unsuccessfully with exit code 1",
      stderrTail: [],
    };
    const { runner, nonces } = scripted(REPEAT, ERROR, COMPLETE);
    await runAfk({ launchPrompt: "p", maxIterations: 5 }, runner);
    expect(nonces).toHaveLength(3);
    expect(new Set(nonces).size).toBe(3);
  });

  it("treats a block carrying another nonce as an invalid response", async () => {
    const stale: SessionResult = {
      kind: "success",
      finalMessage: '<afk-harness-result nonce="cafebabe">\n{"outcome":"complete"}\n</afk-harness-result>',
      stderrTail: [],
    };
    const { runner } = scripted(stale);
    expect(await runAfk({ launchPrompt: "p", maxIterations: 2 }, runner)).toMatchObject({
      kind: "execution-error",
      errorKind: "invalid-response",
    });
  });
});

describe("runAfk interruption", () => {
  it("stops with interrupted without retrying or iterating", async () => {
    const calls: string[] = [];
    const result = await runAfk({ launchPrompt: "p", maxIterations: 5 }, async () => {
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
    const result = await runAfk({ launchPrompt: "p", maxIterations: 5, sessionTimeoutSeconds: 7 }, async () => {
      launches++;
      return { kind: "timed-out" };
    });
    expect(result).toEqual({ kind: "timeout", seconds: 7 });
    expect(launches).toBe(1);
  });

  it("uses zero seconds when no timeout was configured", async () => {
    expect(await runAfk({ launchPrompt: "p", maxIterations: 1 }, async () => ({ kind: "timed-out" }))).toEqual({
      kind: "timeout",
      seconds: 0,
    });
  });
});

describe("runAfk error classification", () => {
  const config = { launchPrompt: "p", maxIterations: 1 };
  const failures: Array<[SessionResult, string, string]> = [
    [
      { kind: "launch-failed", detail: "failed to launch agent: ENOENT" },
      "launch-failed",
      "failed to launch agent: ENOENT",
    ],
    [{ kind: "exited-unsuccessfully", detail: "bad exit", stderrTail: ["t"] }, "exit-status", "bad exit"],
    [{ kind: "missing-final-message", detail: "no message", stderrTail: ["t"] }, "missing-response", "no message"],
    [{ kind: "invalid-final-message", detail: "invalid", stderrTail: ["t"] }, "invalid-response", "invalid"],
  ];

  it.each(failures)(
    "maps %j to an execution error and reports it with the stderr tail",
    async (session, errorKind, detail) => {
      const errors: Array<[string, string[]]> = [];
      const twice = scripted(session);
      const result = await runAfk({ ...config, maxIterations: 2 }, twice.runner, {
        executionError: (d, tail) => errors.push([d, tail]),
      });
      expect(result).toEqual({ kind: "execution-error", errorKind, detail });
      const tail = "stderrTail" in session ? session.stderrTail : [];
      expect(errors).toEqual([
        [detail, tail],
        [detail, tail],
      ]);
    },
  );

  it("turns a result block violation into an invalid response with the session's stderr tail", async () => {
    const session: SessionResult = { kind: "success", finalMessage: "no block here", stderrTail: ["last"] };
    const errors: Array<[string, string[]]> = [];
    const result = await runAfk({ ...config, maxIterations: 2 }, scripted(session).runner, {
      executionError: (d, tail) => errors.push([d, tail]),
    });
    expect(result).toMatchObject({ kind: "execution-error", errorKind: "invalid-response" });
    expect(errors[0]?.[1]).toEqual(["last"]);
    expect(errors[0]?.[0]).toMatch(
      /^agent final response is invalid: the final message has no <afk-harness-result nonce="[0-9a-f]+"> block$/,
    );
  });

  it("treats an empty final message as invalid", async () => {
    const session: SessionResult = { kind: "success", finalMessage: " ", stderrTail: [] };
    expect(await runAfk(config, scripted(session).runner)).toEqual({ kind: "iteration-limit", limit: 1 });
    expect(await runAfk({ ...config, maxIterations: 2 }, scripted(session).runner)).toEqual({
      kind: "execution-error",
      errorKind: "invalid-response",
      detail: "agent final response is invalid: the final message is missing or empty",
    });
  });
});
