import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_CODES } from "../src/reporter.js";
import { createFakeCodexEnvironment, startAfk, type Step } from "./helpers.js";

const COMPLETE: Step[] = [{ finalMessage: '{"outcome":"complete"}' }, { exit: 0 }];

describe("afk --help", () => {
  for (const flag of ["--help", "-h"]) {
    it(`${flag} prints usage, options, and exit codes to stdout and launches nothing`, async () => {
      const fake = createFakeCodexEnvironment(COMPLETE);
      const run = await startAfk({ args: [flag], cwd: fake.workspace, env: fake.env }).done;

      expect(run.exitCode).toBe(0);
      expect(fake.invocations()).toHaveLength(0);
      for (const text of [
        "[prompt...]",
        "--prompt-file",
        "--cwd",
        "--max-iterations",
        "default: 10",
        "--session-timeout",
        "seconds",
        "--model",
        "--reasoning-effort",
        "--help",
        "Exit codes",
      ]) {
        expect(run.stdout).toContain(text);
      }
    });
  }

  it("lists exactly the exit codes the CLI maps", async () => {
    const fake = createFakeCodexEnvironment(COMPLETE);
    const run = await startAfk({ args: ["--help"], cwd: fake.workspace, env: fake.env }).done;

    const section = run.stdout.split("Exit codes:")[1] ?? "";
    const listed = [...section.matchAll(/^\s+(\d+)\s+\S/gm)].map((match) => Number(match[1]));
    expect(listed.sort((a, b) => a - b)).toEqual(Object.values(EXIT_CODES).sort((a, b) => a - b));
  });

  it("takes precedence over invalid options and prompt input", async () => {
    const fake = createFakeCodexEnvironment(COMPLETE);
    const run = await startAfk({
      args: ["--help", "--max-iterations", "abc", "--prompt-file", "missing.txt", "x"],
      cwd: fake.workspace,
      env: fake.env,
      stdin: "some piped prompt",
    }).done;

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("--prompt-file");
    expect(fake.invocations()).toHaveLength(0);
  });

  it("exits promptly without reading a stdin pipe that is never closed", async () => {
    const fake = createFakeCodexEnvironment(COMPLETE);
    const child = spawn(process.execPath, [join(import.meta.dirname, "..", "dist", "cli.js"), "--help"], {
      cwd: fake.workspace,
      env: fake.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const code = await new Promise<number | null>((resolveCode) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolveCode(-1);
      }, 3000);
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolveCode(exitCode);
      });
    });
    expect(code).toBe(0);
  });

  it("rejects an unknown option as an option error", async () => {
    const fake = createFakeCodexEnvironment(COMPLETE);
    const run = await startAfk({ args: ["--full-access", "x"], cwd: fake.workspace, env: fake.env }).done;

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("--full-access");
    expect(fake.invocations()).toHaveLength(0);
  });
});
