import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentAdapter } from "./agents/types.js";

export const DEFAULT_TERMINATION_GRACE_MS = 5000;
export const STDERR_TAIL_LINES = 20;

export interface SessionOptions {
  adapter: AgentAdapter;
  prompt: string;
  cwd: string;
  /** Aborting interrupts the child and ends the session as `interrupted` once it has exited. */
  signal?: AbortSignal;
  /** Overrides the model for this session; otherwise the agent's own configuration applies. */
  model?: string;
  /** Overrides the reasoning effort for this session; otherwise the agent's own configuration applies. */
  effort?: string;
  /** Interrupts and terminates the child once this many seconds have elapsed. */
  timeoutSeconds?: number;
  /** Wait between escalation steps (SIGINT, then SIGTERM, then SIGKILL). */
  graceMs?: number;
}

export type SessionResult =
  | { kind: "launch-failed"; error: Error }
  | { kind: "interrupted" }
  | { kind: "timed-out" }
  | {
      kind: "exited";
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      stdout: string;
      /** What the agent wrote to the output file it was given, if anything. */
      outputFile?: string;
      /** The last {@link STDERR_TAIL_LINES} lines the agent wrote to stderr. */
      stderrTail: string[];
    };

type Outcome =
  { error: Error } | { exitCode: number | null; signal: NodeJS.Signals | null; stdout: string; stderrTail: string[] };

/** Run exactly one non-interactive agent session in the workspace. */
export async function runSession(options: SessionOptions): Promise<SessionResult> {
  if (options.signal?.aborted) return { kind: "interrupted" };
  const outputDir = await mkdtemp(join(tmpdir(), "afk-session-"));
  try {
    return await spawnSession(options, join(outputDir, "final-message.txt"));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

async function spawnSession(options: SessionOptions, outputPath: string): Promise<SessionResult> {
  const { adapter } = options;
  const args = adapter.buildArgs({
    cwd: options.cwd,
    outputFile: outputPath,
    model: options.model,
    effort: options.effort,
  });

  let interrupted = false;
  let timedOut = false;
  const outcome = await new Promise<Outcome>((resolve) => {
    const child = spawn(adapter.executable, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });
    const cleanups: (() => void)[] = [];
    const settle = (result: Outcome) => {
      cleanups.forEach((cleanup) => cleanup());
      resolve(result);
    };

    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    const stderr = new TailBuffer(STDERR_TAIL_LINES);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => stderr.write(chunk));
    // The agent may exit before reading its prompt; that surfaces through its exit status.
    child.stdin.on("error", () => {});
    child.stdin.end(options.prompt);

    child.once("error", (error) => settle({ error }));
    child.once("close", (exitCode, signal) => settle({ exitCode, signal, stdout, stderrTail: stderr.lines() }));

    // Forward the interruption, then escalate until the child is gone. Never detached.
    const grace = options.graceMs ?? DEFAULT_TERMINATION_GRACE_MS;
    const escalation: NodeJS.Timeout[] = [];
    const interrupt = () => {
      if (interrupted) return;
      interrupted = true;
      // A timeout already started the escalation; the user's interrupt just takes over the reason.
      if (!timedOut) terminate();
    };
    const terminate = () => {
      child.kill("SIGINT");
      escalation.push(setTimeout(() => child.kill("SIGTERM"), grace));
      escalation.push(setTimeout(() => child.kill("SIGKILL"), grace * 2));
    };
    if (options.timeoutSeconds !== undefined) {
      const timer = setTimeout(() => {
        if (interrupted) return;
        timedOut = true;
        terminate();
      }, options.timeoutSeconds * 1000);
      cleanups.push(() => clearTimeout(timer));
    }
    if (options.signal?.aborted) interrupt();
    else options.signal?.addEventListener("abort", interrupt, { once: true });
    cleanups.push(() => {
      options.signal?.removeEventListener("abort", interrupt);
      escalation.forEach(clearTimeout);
    });
  });
  if ("error" in outcome) return { kind: "launch-failed", error: outcome.error };
  if (interrupted) return { kind: "interrupted" };
  if (timedOut) return { kind: "timed-out" };
  const outputFile = await readFile(outputPath, "utf8").catch(() => undefined);
  return { kind: "exited", ...outcome, outputFile };
}

/** Keeps the last `max` lines of a text stream, including an unterminated final line. */
class TailBuffer {
  private completed: string[] = [];
  private partial = "";

  constructor(private readonly max: number) {}

  write(chunk: string) {
    const parts = (this.partial + chunk).split("\n");
    this.partial = parts.pop() ?? "";
    this.completed.push(...parts);
    if (this.completed.length > this.max) this.completed = this.completed.slice(-this.max);
  }

  lines(): string[] {
    const all = this.partial === "" ? this.completed : [...this.completed, this.partial];
    return all.slice(-this.max);
  }
}
