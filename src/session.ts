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
  /** Wait between escalation steps (SIGINT, then SIGTERM, then SIGKILL). */
  graceMs?: number;
}

export type SessionResult =
  | { kind: "launch-failed"; error: Error }
  | { kind: "interrupted" }
  | { kind: "exited"; exitCode: number | null; signal: NodeJS.Signals | null; finalMessage?: string };

/** Run exactly one non-interactive Codex session in the workspace. */
export async function runSession(options: SessionOptions): Promise<SessionResult> {
  if (options.signal?.aborted) return { kind: "interrupted" };
  const tempDir = await mkdtemp(join(tmpdir(), "afk-"));
  const outputPath = join(tempDir, "last-message.txt");
  const args = ["exec", "--approve-for-me", "-C", options.cwd, "-o", outputPath, options.prompt];

  let interrupted = false;
  try {
    const outcome = await new Promise<
      { error: Error } | { exitCode: number | null; signal: NodeJS.Signals | null }
    >((resolve) => {
      // stdin is ignored: Codex appends piped stdin to its prompt.
      const child = spawn("codex", args, { cwd: options.cwd, stdio: ["ignore", "inherit", "inherit"] });
      child.once("error", (error) => resolve({ error }));
      child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));

      // Forward the interruption, then escalate until the child is gone. Never detached.
      const grace = options.graceMs ?? DEFAULT_TERMINATION_GRACE_MS;
      const escalation: NodeJS.Timeout[] = [];
      const interrupt = () => {
        interrupted = true;
        child.kill("SIGINT");
        escalation.push(setTimeout(() => child.kill("SIGTERM"), grace));
        escalation.push(setTimeout(() => child.kill("SIGKILL"), grace * 2));
      };
      if (options.signal?.aborted) interrupt();
      else options.signal?.addEventListener("abort", interrupt, { once: true });
      child.once("close", () => {
        options.signal?.removeEventListener("abort", interrupt);
        escalation.forEach(clearTimeout);
      });
    });
    if ("error" in outcome) return { kind: "launch-failed", error: outcome.error };
    if (interrupted) return { kind: "interrupted" };
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
