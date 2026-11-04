import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFakeCodexEnvironment,
  expectedSessionPrompt,
  snapshotTree,
  startAfk,
  type Step,
} from "./support/helpers.js";

const AGENT_NAMES = ["codex", "claude"];

const complete: Step[] = [{ finalMessage: '{"outcome":"complete"}' }, { exit: 0 }];
const repeat: Step[] = [{ finalMessage: '{"outcome":"repeat"}' }, { exit: 0 }];
const blocked: Step[] = [{ finalMessage: '{"outcome":"blocked","blocker_text":"need key"}' }, { exit: 0 }];
const crash: Step[] = [{ exit: 7 }];

async function until(condition: () => boolean, timeoutMs = 5000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe.each(AGENT_NAMES)("explicit prompt sources ignore stdin: %s", (agent) => {
  const stdinData = "STDIN-DATA-must-not-appear";

  const sources: { name: string; args: string[]; launchPrompt: string }[] = [
    { name: "positional prompt", args: ["positional launch"], launchPrompt: "positional launch" },
    { name: "--prompt-file", args: ["--prompt-file", "launch.txt"], launchPrompt: "file launch" },
  ];

  describe.each(sources)("$name", ({ args, launchPrompt }) => {
    const prepare = () => {
      const fake = createFakeCodexEnvironment(complete, agent);
      writeFileSync(join(fake.workspace, "launch.txt"), launchPrompt);
      return fake;
    };

    it("uses the explicit source as the launch prompt when non-blank data is piped", async () => {
      const fake = prepare();
      const run = await startAfk({
        args: ["--agent", agent, ...args],
        cwd: fake.workspace,
        env: fake.env,
        stdin: stdinData,
      }).done;

      expect(run.exitCode).toBe(0);
      const { stdin } = fake.soleInvocation();
      expect(stdin).toBe(expectedSessionPrompt(launchPrompt, stdin));
      expect(stdin).not.toContain(stdinData);
    });

    it("still starts and completes when the stdin pipe is never closed", async () => {
      const fake = prepare();
      const afk = startAfk({
        args: ["--agent", agent, ...args],
        cwd: fake.workspace,
        env: fake.env,
        keepStdinOpen: true,
      });
      try {
        const run = await afk.done;
        expect(run.exitCode).toBe(0);
        const { stdin } = fake.soleInvocation();
        expect(stdin).toBe(expectedSessionPrompt(launchPrompt, stdin));
      } finally {
        afk.child.stdin.destroy();
        afk.child.kill("SIGKILL");
      }
    }, 15000);
  });
});

describe("claude launch arguments", () => {
  it("passes neither --model nor --effort without the overrides", async () => {
    const fake = createFakeCodexEnvironment({ sessions: [crash, complete] }, "claude");
    const run = await startAfk({ args: ["--agent", "claude", "build X"], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(0);
    const invocations = fake.invocations();
    expect(invocations).toHaveLength(2);
    for (const { argv } of invocations) {
      expect(argv).not.toContain("--model");
      expect(argv).not.toContain("--effort");
    }
  });

  it("never requests bypassed permissions or session reuse, on a first session or a retry", async () => {
    const fake = createFakeCodexEnvironment({ sessions: [crash, complete] }, "claude");
    const run = await startAfk({
      args: ["--agent", "claude", "--model", "m", "--reasoning-effort", "high", "build X"],
      cwd: fake.workspace,
      env: fake.env,
    }).done;

    expect(run.exitCode).toBe(0);
    const invocations = fake.invocations();
    expect(invocations).toHaveLength(2);
    for (const { argv } of invocations) {
      expect(argv).toContain("--permission-mode");
      expect(argv.join(" ")).not.toContain("bypassPermissions");
      for (const forbidden of [
        "--dangerously-skip-permissions",
        "--resume",
        "--continue",
        "--fork-session",
        "-r",
        "-c",
      ])
        expect(argv).not.toContain(forbidden);
    }
  });
});

describe.each(AGENT_NAMES)("no files created or changed: %s", (agent) => {
  const stopReasons: { name: string; sessions: Step[][]; args: string[]; exitCode: number; interrupt?: boolean }[] = [
    { name: "complete", sessions: [complete], args: [], exitCode: 0 },
    { name: "blocked", sessions: [blocked], args: [], exitCode: 1 },
    { name: "execution error", sessions: [crash, crash], args: [], exitCode: 3 },
    { name: "iteration limit", sessions: [repeat], args: ["--max-iterations", "1"], exitCode: 4 },
    {
      name: "timeout",
      sessions: [[{ ignoreSignals: true }, { sleepMs: 30000 }]],
      args: ["--session-timeout", "1"],
      exitCode: 5,
    },
    { name: "interruption", sessions: [[{ sleepMs: 30000 }]], args: [], exitCode: 130, interrupt: true },
  ];

  it.each(stopReasons)(
    "$name",
    async ({ sessions, args, exitCode, interrupt }) => {
      const fake = createFakeCodexEnvironment({ sessions }, agent);
      const sandbox = dirname(fake.workspace);
      const home = join(sandbox, "home");
      const tmp = join(sandbox, "tmp");
      mkdirSync(join(fake.workspace, "specs"), { recursive: true });
      mkdirSync(home);
      mkdirSync(tmp);
      writeFileSync(join(fake.workspace, "progress.txt"), "existing progress\n");
      writeFileSync(join(fake.workspace, "specs", "feature.spec.md"), "existing spec\n");
      writeFileSync(join(home, "keep"), "home file\n");
      writeFileSync(join(tmp, "keep"), "tmp file\n");

      const before = { workspace: snapshotTree(fake.workspace), home: snapshotTree(home), tmp: snapshotTree(tmp) };
      const afk = startAfk({
        args: ["--agent", agent, ...args, "build X"],
        cwd: fake.workspace,
        env: { ...fake.env, HOME: home, TMPDIR: tmp, AFK_TERMINATION_GRACE_MS: "300" },
      });
      if (interrupt) {
        await until(() => fake.invocations().length === 1);
        await new Promise((r) => setTimeout(r, 200));
        afk.child.kill("SIGINT");
      }
      const run = await afk.done;

      expect(run.exitCode).toBe(exitCode);
      expect(snapshotTree(fake.workspace)).toEqual(before.workspace);
      expect(snapshotTree(home)).toEqual(before.home);
      expect(snapshotTree(tmp)).toEqual(before.tmp);
    },
    15000,
  );
});
