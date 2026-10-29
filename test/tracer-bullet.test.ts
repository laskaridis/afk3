import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, startAfk } from "./helpers.js";

const COMPLETE = { finalMessage: '{"outcome":"complete"}' };

describe("afk <prompt> with a single Codex session", () => {
  it("launches codex exec once with automatic review, the workspace, and the prompt read from stdin", async () => {
    const fake = createFakeCodexEnvironment([COMPLETE, { exit: 0 }]);

    const run = await startAfk({ args: ["build feature X"], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(0);
    const { argv, cwd } = fake.soleInvocation();
    expect(argv[0]).toBe("exec");
    expect(argv).toContain("--approve-for-me");
    expect(argv[argv.indexOf("-C") + 1]).toBe(fake.workspace);
    expect(argv.at(-1)).toBe("-");
    expect(cwd).toBe(fake.workspace);
  });

  it("sends the launch prompt verbatim followed by the harness instructions", async () => {
    const fake = createFakeCodexEnvironment([COMPLETE, { exit: 0 }]);

    await startAfk({ args: ["build feature X"], cwd: fake.workspace, env: fake.env }).done;

    const { stdin: prompt } = fake.soleInvocation();
    expect(prompt.startsWith("build feature X")).toBe(true);
    expect(prompt).toMatch(/Coding loop protocol/);
    expect(prompt).toMatch(/one task/i);
    expect(prompt).toMatch(/JSON object and nothing else/i);
  });

  it("shows only [afk] lines on stderr and nothing on stdout", async () => {
    const fake = createFakeCodexEnvironment([{ stderr: "agent-err\n" }, COMPLETE, { exit: 0 }]);

    const run = await startAfk({ args: ["build feature X"], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("");
    expect(run.stderr).not.toContain("agent-err");
    for (const line of run.stderr.split("\n").filter(Boolean)) expect(line).toMatch(/^\[afk\]/);
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
    for (const forbidden of [
      "--dangerously-bypass-approvals-and-sandbox",
      "danger-full-access",
      "--worktree",
      "--ephemeral",
      "--ignore-user-config",
      "resume",
      "fork",
    ]) {
      expect(argv).not.toContain(forbidden);
    }
  });

  it("gives codex the session prompt on stdin, not afk's own piped stdin", async () => {
    const fake = createFakeCodexEnvironment([COMPLETE, { exit: 0 }]);

    await startAfk({
      args: ["build feature X"],
      cwd: fake.workspace,
      env: fake.env,
      stdin: "secret piped data",
    }).done;

    const { stdin } = fake.soleInvocation();
    expect(stdin).toMatch(/^build feature X/);
    expect(stdin).not.toContain("secret piped data");
  });

  it("passes an output file outside the workspace and leaves no files in the temp directory or workspace", async () => {
    const fake = createFakeCodexEnvironment([COMPLETE, { exit: 0 }]);
    const tmp = mkdtempSync(join(tmpdir(), "afk-empty-tmp-"));

    await startAfk({ args: ["build feature X"], cwd: fake.workspace, env: { ...fake.env, TMPDIR: tmp } }).done;

    const { argv } = fake.soleInvocation();
    const outputFile = argv[argv.indexOf("--output-last-message") + 1]!;
    expect(outputFile.startsWith(tmp)).toBe(true);
    expect(readdirSync(fake.workspace)).toEqual([]);
    expect(readdirSync(tmp)).toEqual([]);
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
