import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, startAfk } from "./helpers.js";

const COMPLETE = { finalMessage: '{"outcome":"complete"}' };

describe("afk <prompt> with a single Codex session", () => {
  it("launches codex exec once with automatic review, the workspace, and an output file", async () => {
    const fake = createFakeCodexEnvironment([COMPLETE, { exit: 0 }]);

    const run = await startAfk({ args: ["build feature X"], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(0);
    const { argv, cwd, outputPath } = fake.soleInvocation();
    expect(argv[0]).toBe("exec");
    expect(argv).toContain("--approve-for-me");
    expect(argv[argv.indexOf("-C") + 1]).toBe(fake.workspace);
    expect(argv[argv.indexOf("-o") + 1]).toBe(outputPath);
    expect(cwd).toBe(fake.workspace);
  });

  it("sends the launch prompt verbatim followed by the harness instructions", async () => {
    const fake = createFakeCodexEnvironment([COMPLETE, { exit: 0 }]);

    await startAfk({ args: ["build feature X"], cwd: fake.workspace, env: fake.env }).done;

    const { argv } = fake.soleInvocation();
    const prompt = argv[argv.length - 1]!;
    expect(prompt.startsWith("build feature X")).toBe(true);
    expect(prompt).toMatch(/Coding loop protocol/);
    expect(prompt).toMatch(/one task/i);
    expect(prompt).toMatch(/JSON object and nothing else/i);
  });

  it("shows codex stdout and stderr while the codex process is still running", async () => {
    const fake = createFakeCodexEnvironment([
      { stdout: "first-out\n" },
      { stderr: "first-err\n" },
      { sleepMs: 2500 },
      { stdout: "last-out\n" },
      COMPLETE,
      { exit: 0 },
    ]);
    const started = Date.now();
    let firstSeenAt: number | undefined;
    const afk = startAfk({
      args: ["build feature X"],
      cwd: fake.workspace,
      env: fake.env,
      onStdout: (_chunk, run) => {
        if (firstSeenAt === undefined && run.stdout.includes("first-out")) firstSeenAt = Date.now();
      },
    });

    const run = await afk.done;
    const finishedAt = Date.now();

    expect(firstSeenAt).toBeDefined();
    expect(firstSeenAt! - started).toBeLessThan(2000);
    expect(finishedAt - firstSeenAt!).toBeGreaterThan(1500);
    expect(run.stdout).toContain("last-out");
    expect(run.stderr).toContain("first-err");
  });

  it("reports completion and exits 0 on a valid complete response", async () => {
    const fake = createFakeCodexEnvironment([COMPLETE, { exit: 0 }]);

    const run = await startAfk({ args: ["build feature X"], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toMatch(/complete/i);
  });

  it("does not request dangerous modes or session reuse", async () => {
    const fake = createFakeCodexEnvironment([COMPLETE, { exit: 0 }]);

    await startAfk({ args: ["build feature X"], cwd: fake.workspace, env: fake.env }).done;

    const { argv } = fake.soleInvocation();
    // The prompt (last argument) is free text; check the flags only.
    const flags = argv.slice(0, -1);
    for (const forbidden of [
      "--dangerously-bypass-approvals-and-sandbox",
      "danger-full-access",
      "--worktree",
      "--ephemeral",
      "--ignore-user-config",
      "resume",
      "fork",
    ]) {
      expect(flags).not.toContain(forbidden);
    }
  });

  it("gives codex no stdin data even when afk's own prompt came from stdin", async () => {
    const fake = createFakeCodexEnvironment([COMPLETE, { exit: 0 }]);

    await startAfk({
      args: [],
      cwd: fake.workspace,
      env: fake.env,
      stdin: "secret piped data",
    }).done;

    const { stdin } = fake.soleInvocation();
    expect(stdin).toBe("");
  });

  it("removes the final-message file and creates nothing in the workspace", async () => {
    const fake = createFakeCodexEnvironment([COMPLETE, { exit: 0 }]);

    await startAfk({ args: ["build feature X"], cwd: fake.workspace, env: fake.env }).done;

    const outputPath = fake.soleInvocation().outputPath!;
    expect(outputPath).toBeDefined();
    expect(fake.fileExists(outputPath)).toBe(false);
    expect(readdirSync(fake.workspace)).toEqual([]);
    expect(dirname(outputPath).startsWith(fake.workspace)).toBe(false);
  });
});

describe("afk executable", () => {
  it("runs through npm exec using the bin entry", async () => {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync("npm", ["exec", "--offline", "--package=.", "--", "afk", "--version"], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
