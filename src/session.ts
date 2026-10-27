import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SessionOptions {
  prompt: string;
  cwd: string;
}

export type SessionResult =
  | { kind: "launch-failed"; error: Error }
  | { kind: "exited"; exitCode: number | null; signal: NodeJS.Signals | null; finalMessage?: string };

/** Run exactly one non-interactive Codex session in the workspace. */
export async function runSession(options: SessionOptions): Promise<SessionResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "afk-"));
  const outputPath = join(tempDir, "last-message.txt");
  const args = ["exec", "--approve-for-me", "-C", options.cwd, "-o", outputPath, options.prompt];

  try {
    const outcome = await new Promise<
      { error: Error } | { exitCode: number | null; signal: NodeJS.Signals | null }
    >((resolve) => {
      // stdin is ignored: Codex appends piped stdin to its prompt.
      const child = spawn("codex", args, { cwd: options.cwd, stdio: ["ignore", "inherit", "inherit"] });
      child.once("error", (error) => resolve({ error }));
      child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
    });
    if ("error" in outcome) return { kind: "launch-failed", error: outcome.error };
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
