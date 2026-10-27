import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, symlinkSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const cliPath = join(repoRoot, "dist", "cli.js");
const fakeCodexPath = join(repoRoot, "test", "fixtures", "fake-codex.mjs");

export type Step =
  | { stdout: string }
  | { stderr: string }
  | { sleepMs: number }
  | { finalMessage: string }
  | { exit: number };

export interface CodexInvocation {
  argv: string[];
  cwd: string;
  stdin: string;
  outputPath?: string;
}

export interface AfkRun {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/** A temp workspace with a fake `codex` first on PATH, scripted per test. */
export function createFakeCodexEnvironment(steps: Step[] | { sessions: Step[][] }) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "afk-test-")));
  const binDir = join(sandbox, "bin");
  const workspace = join(sandbox, "workspace");
  const recordPath = join(sandbox, "record.jsonl");
  const scriptPath = join(sandbox, "script.json");

  mkdirs(binDir, workspace);
  symlinkSync(fakeCodexPath, join(binDir, "codex"));
  writeFileSync(scriptPath, JSON.stringify(Array.isArray(steps) ? { steps } : steps));
  writeFileSync(recordPath, "");

  const env = {
    ...process.env,
    PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
    FAKE_CODEX_SCRIPT: scriptPath,
    FAKE_CODEX_RECORD: recordPath,
  };

  return {
    workspace,
    env,
    invocations(): CodexInvocation[] {
      return readFileSync(recordPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as CodexInvocation);
    },
    soleInvocation(): CodexInvocation {
      const all = this.invocations();
      if (all.length !== 1) throw new Error(`expected 1 codex invocation, got ${all.length}`);
      return all[0]!;
    },
    fileExists: (path: string) => existsSync(path),
  };
}

function mkdirs(...dirs: string[]) {
  for (const dir of dirs) {
    spawnSyncMkdir(dir);
  }
}


function spawnSyncMkdir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

/** Spawn the built afk CLI. `onStdout` observes output as it is streamed. */
export function startAfk(options: {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  onStdout?: (chunk: string, run: { stdout: string }) => void;
}) {
  const child = spawn(process.execPath, [cliPath, ...options.args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const run: AfkRun = { stdout: "", stderr: "", exitCode: null };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    run.stdout += chunk;
    options.onStdout?.(chunk, run);
  });
  child.stderr.on("data", (chunk: string) => (run.stderr += chunk));
  // Leave stdin open (never ended) when data is supplied so a leaking
  // inheritance would be observable; otherwise close it.
  if (options.stdin !== undefined) child.stdin.write(options.stdin);
  else child.stdin.end();

  const done = new Promise<AfkRun>((resolveDone) => {
    child.on("close", (code) => {
      run.exitCode = code;
      resolveDone(run);
    });
  });
  return { child, run, done };
}
