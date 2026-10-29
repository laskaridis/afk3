import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DEFAULT_TERMINATION_GRACE_MS = 5000;

export interface SessionOptions {
  prompt: string;
  cwd: string;
  /** Aborting interrupts the child and ends the session as `interrupted` once it has exited. */
  signal?: AbortSignal;
  /** Overrides the model for this session; otherwise the user's Codex configuration applies. */
  model?: string;
  /** Overrides the reasoning effort for this session; otherwise the user's Codex configuration applies. */
  reasoningEffort?: string;
  /** Interrupts and terminates the child once this many seconds have elapsed. */
  timeoutSeconds?: number;
  /** Wait between escalation steps (SIGINT, then SIGTERM, then SIGKILL). */
  graceMs?: number;
}

export type SessionResult =
  | { kind: "launch-failed"; error: Error }
  | { kind: "interrupted" }
  | { kind: "timed-out" }
  | { kind: "exited"; exitCode: number | null; signal: NodeJS.Signals | null; finalMessage?: string };

/** Run exactly one non-interactive Codex session in the workspace. */
export async function runSession(options: SessionOptions): Promise<SessionResult> {
  if (options.signal?.aborted) return { kind: "interrupted" };
  const tempDir = await mkdtemp(join(tmpdir(), "afk-"));
  const outputPath = join(tempDir, "last-message.txt");
  const args = ["exec", "--approve-for-me", "-C", options.cwd, "-o", outputPath];
  if (options.model !== undefined) args.push("-m", options.model);
  if (options.reasoningEffort !== undefined)
    args.push("-c", `model_reasoning_effort=${JSON.stringify(options.reasoningEffort)}`);
  // `--` keeps a prompt that starts with `-` from being parsed as an option.
  args.push("--", options.prompt);

  let interrupted = false;
  let timedOut = false;
  try {
    const outcome = await new Promise<{ error: Error } | { exitCode: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        // stdin is ignored: Codex appends piped stdin to its prompt.
        const child = spawn("codex", args, { cwd: options.cwd, stdio: ["ignore", "inherit", "inherit"] });
        const cleanups: (() => void)[] = [];
        const settle = (result: { error: Error } | { exitCode: number | null; signal: NodeJS.Signals | null }) => {
          cleanups.forEach((cleanup) => cleanup());
          resolve(result);
        };
        child.once("error", (error) => settle({ error }));
        child.once("close", (exitCode, signal) => settle({ exitCode, signal }));

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
      },
    );
    if ("error" in outcome) return { kind: "launch-failed", error: outcome.error };
    if (interrupted) return { kind: "interrupted" };
    if (timedOut) return { kind: "timed-out" };
    return { kind: "exited", ...outcome, finalMessage: await readFinalMessage(outputPath) };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function readFinalMessage(path: string): Promise<string | undefined> {
  try {
    const text = await readFile(path, "utf8");
    return text.trim() === "" ? undefined : text;
  } catch {
    return undefined;
  }
}
