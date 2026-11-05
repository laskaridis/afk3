import { describe, expect, it } from "vitest";
import { CodexAdapter } from "../../../src/agents/codex.js";
import { SessionExecutor } from "../../../src/session/session-executor.js";
import { SessionExecutorFactory } from "../../../src/session/session-executor-factory.js";

describe("SessionExecutorFactory", () => {
  it("creates executors that all share the factory's signal, timeout and grace period", async () => {
    const controller = new AbortController();
    const factory = new SessionExecutorFactory(controller.signal, 12, 34);
    const adapter = new CodexAdapter();
    const first = factory.create(adapter);
    const second = factory.create(adapter);
    expect(first).toBeInstanceOf(SessionExecutor);
    expect(second).not.toBe(first);
    for (const executor of [first, second]) {
      expect(executor).toMatchObject({ adapter, signal: controller.signal, timeoutSeconds: 12, graceMs: 34 });
    }
    controller.abort();
    // Both executors observe the one shared signal and refuse to spawn.
    expect(await first.execute({ prompt: "p", cwd: "." })).toEqual({ kind: "interrupted" });
    expect(await second.execute({ prompt: "p", cwd: "." })).toEqual({ kind: "interrupted" });
  });

  it("leaves the timeout unset and uses the default grace period when not given", () => {
    const executor = new SessionExecutorFactory(new AbortController().signal).create(new CodexAdapter());
    expect(executor).toMatchObject({ timeoutSeconds: undefined, graceMs: 5000 });
  });
});
