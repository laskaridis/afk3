import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, startAfk, type Step } from "./helpers.js";

const complete: Step[] = [{ finalMessage: '{"outcome":"complete"}' }, { exit: 0 }];
const repeat: Step[] = [{ finalMessage: '{"outcome":"repeat"}' }, { exit: 0 }];

/** Every path under a directory with its size and mtime, to detect creation or modification. */
function snapshot(dir: string, prefix = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stat = statSync(path);
    const entry = `${prefix}${name}:${stat.isDirectory() ? "dir" : `${stat.size}:${stat.mtimeMs}`}`;
    return stat.isDirectory() ? [entry, ...snapshot(path, `${prefix}${name}/`)] : [entry];
  });
}

function until(condition: () => boolean, timeoutMs = 5000) {
  return new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error("timed out"));
      }
    }, 20);
  });
}

interface Scenario {
  name: string;
  sessions: Step[][];
  args?: string[];
  noCodexOnPath?: boolean;
  interrupt?: boolean;
  exitCode: number;
  status: string[];
  completionWording: boolean;
}

const scenarios: Scenario[] = [
  { name: "complete", sessions: [complete], exitCode: 0, status: ["Run complete"], completionWording: true },
  {
    name: "blocked",
    sessions: [[{ finalMessage: '{"outcome":"blocked","blocker_text":"need API key"}' }, { exit: 0 }]],
    exitCode: 1,
    status: ["Run blocked: need API key"],
    completionWording: false,
  },
  {
    name: "execution error: launch failure",
    sessions: [complete],
    noCodexOnPath: true,
    exitCode: 3,
    status: ["Execution error: failed to launch agent"],
    completionWording: false,
  },
  {
    name: "execution error: exit status",
    sessions: [[{ finalMessage: '{"outcome":"complete"}' }, { exit: 7 }]],
    exitCode: 3,
    status: ["Execution error: agent exited unsuccessfully with exit code 7"],
    completionWording: false,
  },
  {
    name: "execution error: missing response",
    sessions: [[{ exit: 0 }]],
    exitCode: 3,
    status: ["Execution error: agent exited without a final response"],
    completionWording: false,
  },
  {
    name: "execution error: invalid response",
    sessions: [[{ finalMessage: "all done!" }, { exit: 0 }]],
    exitCode: 3,
    status: ["Execution error: agent final response is invalid: "],
    completionWording: false,
  },
  {
    name: "iteration limit",
    sessions: [repeat],
    args: ["--max-iterations", "2"],
    exitCode: 4,
    status: ["Run stopped: iteration limit of 2"],
    completionWording: false,
  },
  {
    name: "timeout",
    sessions: [[{ sleepMs: 30000 }]],
    args: ["--session-timeout", "1"],
    exitCode: 5,
    status: ["Run stopped: agent session timed out after 1 seconds"],
    completionWording: false,
  },
  {
    name: "interruption",
    sessions: [[{ sleepMs: 30000 }]],
    interrupt: true,
    exitCode: 130,
    status: ["Run interrupted by user"],
    completionWording: false,
  },
];

describe("run progress", () => {
  it("announces each iteration with its number and the limit, and retries distinctly", async () => {
    const fake = createFakeCodexEnvironment({ sessions: [repeat, [{ exit: 1 }], repeat, complete] });
    const afk = startAfk({ args: ["do it", "--max-iterations", "5"], cwd: fake.workspace, env: fake.env });
    const run = await afk.done;

    expect(run.exitCode).toBe(0);
    const lines = run.stderr.split("\n");
    expect(lines).toContain("[afk] Iteration 1/5: starting agent session");
    expect(lines).toContain("[afk] Iteration 3/5: retrying agent session after execution error");
    expect(lines).toContain("[afk] Iteration 2/5: starting agent session");
    expect(lines).not.toContain("[afk] Iteration 3/5: starting agent session");
    expect(lines).toContain("[afk] Iteration 4/5: starting agent session");
  });
});

describe("final status per stop reason", () => {
  it.each(scenarios)(
    "$name",
    async (scenario) => {
      const fake = createFakeCodexEnvironment({ sessions: scenario.sessions });
      const home = realpathSync(mkdtempSync(join(tmpdir(), "afk-home-")));
      const tmp = realpathSync(mkdtempSync(join(tmpdir(), "afk-tmp-")));
      writeFileSync(join(home, "existing"), "keep");
      // Simulated skill files in the workspace must survive untouched.
      mkdirSync(join(fake.workspace, "specs"));
      writeFileSync(join(fake.workspace, "progress.txt"), "notes");
      writeFileSync(join(fake.workspace, "specs", "plan.json"), "{}");

      const env = {
        ...fake.env,
        HOME: home,
        CODEX_HOME: join(home, ".codex"),
        TMPDIR: tmp,
        AFK_TERMINATION_GRACE_MS: "300",
      };
      if (scenario.noCodexOnPath) env.PATH = "/nonexistent-afk-test-path";

      const workspaceBefore = snapshot(fake.workspace);
      const homeBefore = snapshot(home);

      const afk = startAfk({ args: ["do it", ...(scenario.args ?? [])], cwd: fake.workspace, env });
      if (scenario.interrupt) {
        await until(() => fake.invocations().length === 1);
        afk.child.kill("SIGINT");
      }
      const run = await afk.done;

      expect(run.exitCode).toBe(scenario.exitCode);
      for (const text of scenario.status) expect(run.stderr).toContain(text);
      expect(run.stdout).not.toContain("[afk]");
      expect(/feature complete/i.test(run.stderr)).toBe(scenario.completionWording);
      expect(run.exitCode === 0).toBe(scenario.completionWording);

      // No harness-created files, and the workspace content is untouched.
      expect(snapshot(fake.workspace)).toEqual(workspaceBefore);
      expect(readFileSync(join(fake.workspace, "progress.txt"), "utf8")).toBe("notes");
      expect(snapshot(home)).toEqual(homeBefore);
      expect(readdirSync(tmp)).toEqual([]);
    },
    20000,
  );
});
