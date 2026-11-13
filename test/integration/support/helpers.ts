import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import type { Dirent } from "node:fs";
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

/** A session that answers with the given result block fields and exits successfully. */
export const reply = (message: object): Step[] => [{ finalMessage: JSON.stringify(message) }, { exit: 0 }];

/** A coding session that commits a candidate for task `T-1`. */
export const IMPLEMENTED: Step[] = reply({ outcome: "task_implemented", task_id: "T-1", task_plan_file: "p.json" });

/** A verification session that accepts the candidate of task `T-1` while tasks remain. */
export const PASSED: Step[] = reply({ outcome: "verification_passed", task_id: "T-1", task_plan_file: "p.json" });

/** A verification session that rejects the candidate of task `T-1`. */
export const REJECTED: Step[] = reply({
  outcome: "verification_failed",
  failure_summary: "AC-1 not met",
  findings_file: "p.verify.md",
  task_id: "T-1",
  task_plan_file: "p.json",
});

/** `rounds` repetitions of a coding session followed by its verification session; the last session then repeats. */
export const rounds = (coding: Step[], verification: Step[], count: number): Step[][] =>
  Array.from({ length: count }, () => [coding, verification]).flat();

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
 * (`dist/workflow/steps/coding-step.md`) with `{{NONCE}}` replaced by the session's nonce, and a trailing newline.
 */
export function expectedSessionPrompt(launchPrompt: string, recordedPrompt: string) {
  const nonce = promptNonce(recordedPrompt);
  if (nonce === undefined) throw new Error("recorded prompt has no result-block example to read the nonce from");
  const instructions = readFileSync(join(repoRoot, "dist", "workflow", "steps", "coding-step.md"), "utf8").replaceAll(
    "{{NONCE}}",
    nonce,
  );
  return `${launchPrompt}\n\n---\n${instructions}\n`;
}

/** The bundled instructions of a step (`coding` or `verification`) with the session nonce read from `recordedPrompt`. */
function bundledInstructions(step: "coding" | "verification", recordedPrompt: string) {
  const nonce = promptNonce(recordedPrompt);
  if (nonce === undefined) throw new Error("recorded prompt has no result-block example to read the nonce from");
  return readFileSync(join(repoRoot, "dist", "workflow", "steps", `${step}-step.md`), "utf8").replaceAll(
    "{{NONCE}}",
    nonce,
  );
}

/**
 * The prompt a verification session must receive: the launch prompt, a blank line, the assignment naming the candidate
 * (the `- revision:` line only when one was reported), `---`, then the shipped verification instructions with the
 * session's nonce, and a trailing newline.
 */
export function expectedVerificationPrompt(
  launchPrompt: string,
  assignment: { taskId: string; taskPlanFile: string; revision?: string },
  recordedPrompt: string,
) {
  const lines = [
    "Verification Assignment:",
    `- task_id: ${assignment.taskId}`,
    `- task_plan_file: ${assignment.taskPlanFile}`,
    ...(assignment.revision === undefined ? [] : [`- revision: ${assignment.revision}`]),
  ];
  return `${launchPrompt}\n\n${lines.join("\n")}\n---\n${bundledInstructions("verification", recordedPrompt)}\n`;
}

/**
 * The prompt a correction iteration must receive: the correction assignment and its fixed instruction, `---`, then the
 * shipped coding instructions with the session's nonce, and a trailing newline. It has no launch prompt.
 */
export function expectedCorrectionPrompt(
  assignment: { taskId: string; taskPlanFile: string; findingsFile: string; failureSummary: string },
  recordedPrompt: string,
) {
  return [
    "Correction Assignment:",
    `- task_id: ${assignment.taskId}`,
    `- task_plan_file: ${assignment.taskPlanFile}`,
    `- findings_file: ${assignment.findingsFile}`,
    `- failure_summary: ${assignment.failureSummary}`,
    "Fix the issues the verification agent found for this task.",
    "---",
    `${bundledInstructions("coding", recordedPrompt)}\n`,
  ].join("\n");
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
    const byName = (a: Dirent, b: Dirent) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of readdirSync(current, { withFileTypes: true }).sort(byName)) {
      const path = join(current, entry.name);
      const key = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        entries[key] = `dir mtime=${lstatSync(path).mtimeMs}`;
        walk(path, `${key}/`);
      } else if (entry.isSymbolicLink()) {
        entries[key] = `link ${readlinkSync(path)}`;
      } else {
        // Stat and read through one descriptor so the file cannot be swapped between the two calls (js/file-system-race).
        const fd = openSync(path, "r");
        try {
          const stat = fstatSync(fd);
          entries[key] = `file size=${stat.size} mtime=${stat.mtimeMs} ${readFileSync(fd, "utf8")}`;
        } finally {
          closeSync(fd);
        }
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
