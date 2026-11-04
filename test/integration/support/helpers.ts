import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");
const cliPath = join(repoRoot, "dist", "cli.js");
const fakeExecutable = (agent: string) => join(repoRoot, "test", "integration", "fixtures", `fake-${agent}.mjs`);

export type Step =
  | { stdout: string }
  | { stderr: string }
  | { sleepMs: number }
  | { finalMessage: string }
  | { rawFinalMessage: string }
  | { json: unknown }
  | { writeFile: string }
  | { killSelf: NodeJS.Signals }
  | { ignoreSignals: true }
  | { exit: number };

const NONCE_EXAMPLE = /<afk-harness-result nonce="([^"]+)">/;

/** The nonce a session prompt announces in its result-block example, or undefined if there is none. */
export const promptNonce = (prompt: string) => NONCE_EXAMPLE.exec(prompt)?.[1];

/** The session prompt with its per-session nonce masked, for comparing prompts across sessions. Any nonce shape works. */
export function withoutNonce(prompt: string) {
  const nonce = promptNonce(prompt);
  return nonce === undefined ? prompt : prompt.replaceAll(nonce, "<nonce>");
}

/**
 * The prompt a session must receive: the launch prompt verbatim, a blank line, `---`, then the shipped instructions
 * (`dist/code.md`) with `{{NONCE}}` replaced by the session's nonce, and a trailing newline.
 */
export function expectedSessionPrompt(launchPrompt: string, recordedPrompt: string) {
  const nonce = promptNonce(recordedPrompt);
  if (nonce === undefined) throw new Error("recorded prompt has no result-block example to read the nonce from");
  const instructions = readFileSync(join(repoRoot, "dist", "code.md"), "utf8").replaceAll("{{NONCE}}", nonce);
  return `${launchPrompt}\n\n---\n${instructions}\n`;
}

export interface CodexInvocation {
  argv: string[];
  cwd: string;
  stdin: string;
  pid: number;
  files: string[];
}

export interface AfkRun {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/** A temp workspace with a fake agent executable (default `codex`) first on PATH, scripted per test. */
export function createFakeCodexEnvironment(steps: Step[] | { sessions: Step[][] }, agent = "codex") {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "afk-test-")));
  const binDir = join(sandbox, "bin");
  const workspace = join(sandbox, "workspace");
  const recordPath = join(sandbox, "record.jsonl");
  const scriptPath = join(sandbox, "script.json");

  mkdirs(binDir, workspace);
  symlinkSync(fakeExecutable(agent), join(binDir, agent));
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
    signals(): string[] {
      return existsSync(`${recordPath}.signals`)
        ? readFileSync(`${recordPath}.signals`, "utf8").split("\n").filter(Boolean)
        : [];
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

/**
 * Every entry under `dir` (recursively) mapped to its kind, size, modification time and content, so two snapshots are
 * equal only when nothing was added, removed or changed.
 */
export function snapshotTree(dir: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const walk = (current: string, prefix: string) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const key = `${prefix}${name}`;
      const stat = lstatSync(path);
      if (stat.isDirectory()) {
        entries[key] = `dir mtime=${stat.mtimeMs}`;
        walk(path, `${key}/`);
      } else if (stat.isSymbolicLink()) {
        entries[key] = `link ${readlinkSync(path)}`;
      } else {
        entries[key] = `file size=${stat.size} mtime=${stat.mtimeMs} ${readFileSync(path, "utf8")}`;
      }
    }
  };
  walk(dir, "");
  return entries;
}

/** Spawn the built afk CLI. `onStdout` observes output as it is streamed. */
export function startAfk(options: {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  /** Leave stdin open (never ended) instead of ending it after `stdin`; afk must not wait for it. */
  keepStdinOpen?: boolean;
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
  // afk reads non-TTY stdin to EOF when it needs it, so stdin is ended unless a test asks to keep it open.
  if (options.keepStdinOpen) {
    if (options.stdin) child.stdin.write(options.stdin);
  } else {
    child.stdin.end(options.stdin ?? "");
  }

  const done = new Promise<AfkRun>((resolveDone) => {
    child.on("close", (code) => {
      run.exitCode = code;
      resolveDone(run);
    });
  });
  return { child, run, done };
}
