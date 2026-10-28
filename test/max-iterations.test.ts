import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, startAfk, type Step } from "./helpers.js";

const complete: Step[] = [{ finalMessage: '{"outcome":"complete"}' }, { exit: 0 }];

describe("--max-iterations numeric bounds", () => {
  it.each(["9007199254740992", "9007199254740993", "9".repeat(309)])(
    "rejects an unsafe or overflowing count without launching Codex (%s)",
    async (value) => {
      const fake = createFakeCodexEnvironment(complete);
      const run = await startAfk({
        args: ["do it", `--max-iterations=${value}`], cwd: fake.workspace, env: fake.env,
      }).done;

      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain(`must be at most ${Number.MAX_SAFE_INTEGER}`);
      expect(fake.invocations()).toHaveLength(0);
    },
  );

  it.each(["1", "10", String(Number.MAX_SAFE_INTEGER)])("accepts the safe count %s", async (value) => {
    const fake = createFakeCodexEnvironment(complete);
    const run = await startAfk({
      args: ["do it", `--max-iterations=${value}`], cwd: fake.workspace, env: fake.env,
    }).done;

    expect(run.exitCode).toBe(0);
    expect(fake.invocations()).toHaveLength(1);
    expect(run.stderr).toContain(`[afk] iteration 1/${value}`);
  });
});
