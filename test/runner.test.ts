import { describe, expect, it } from "vitest";
import { runAfk, type SessionRunner } from "../src/runner.js";
import type { SessionResult } from "../src/session.js";

const reply = (message: object): SessionResult => ({
  kind: "exited",
  exitCode: 0,
  signal: null,
  finalMessage: JSON.stringify(message),
});

function scripted(...results: SessionResult[]) {
  const prompts: string[] = [];
  const runner: SessionRunner = async (prompt) => {
    prompts.push(prompt);
    return results[Math.min(prompts.length, results.length) - 1]!;
  };
  return { runner, prompts };
}

const REPEAT = reply({ outcome: "repeat" });
const COMPLETE = reply({ outcome: "complete" });
const BLOCKED = reply({ outcome: "blocked", blocker_text: "need API key" });
const FAIL = reply({ outcome: "fail", failure_summary: "tests broke" });

describe("runAfk", () => {
  it("starts another session after repeat and ends successfully on complete", async () => {
    const { runner, prompts } = scripted(REPEAT, COMPLETE);
    expect(await runAfk({ launchPrompt: "p", maxIterations: 10 }, runner)).toEqual({ kind: "complete" });
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
