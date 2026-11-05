import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentAdapter } from "../agents/adapter.js";
import type { SessionInput } from "./session-input.js";
import type { SessionResult } from "./session-result.js";

/** Default wait between termination escalation steps (SIGINT, SIGTERM, SIGKILL). */
export const DEFAULT_TERMINATION_GRACE_MS = 5000;
/** How many trailing stderr lines are kept for reporting a failed session. */
export const STDERR_TAIL_LINES = 20;

type ProcessOutcome =
  { error: Error } | { exitCode: number | null; signal: NodeJS.Signals | null; stdout: string; stderrTail: string[] };

/** Runs exactly one non-interactive agent process and classifies how the session ended. */
export class SessionExecutor {
  constructor(
    private readonly adapter: AgentAdapter,
    /** Aborting interrupts the child and ends the session as `interrupted` once it has exited. */
    private readonly signal: AbortSignal,
    /** Interrupts and terminates the child once this many seconds have elapsed. */
    private readonly timeoutSeconds?: number,
    /** Wait between escalation steps (SIGINT, then SIGTERM, then SIGKILL). */
    private readonly graceMs: number = DEFAULT_TERMINATION_GRACE_MS,
  ) {}

  /**
   * Runs one agent process to the end and classifies how it ended.
   *
   * Resolves with a `SessionResult` for every outcome, including launch failure, timeout and interruption; it is not
   * expected to reject. If the signal is already aborted no process is started.
   */
  async execute(input: SessionInput): Promise<SessionResult> {
    if (this.signal.aborted) return { kind: "interrupted" };
    const outputDir = await mkdtemp(join(tmpdir(), "afk-session-"));
    try {
      return await this.run(input, join(outputDir, "final-message.txt"));
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }

  private async run(input: SessionInput, outputPath: string): Promise<SessionResult> {
    const args = this.adapter.buildArgs({
      cwd: input.cwd,
      outputFile: outputPath,
      model: input.model,
      effort: input.effort,
    });

    let interrupted = false;
    let timedOut = false;
    const outcome = await new Promise<ProcessOutcome>((resolve) => {
      const child = spawn(this.adapter.executable, args, { cwd: input.cwd, stdio: ["pipe", "pipe", "pipe"] });
      const cleanups: (() => void)[] = [];
      const settle = (result: ProcessOutcome) => {
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
      child.stdin.end(input.prompt);

      child.once("error", (error) => settle({ error }));
      child.once("close", (exitCode, exitSignal) =>
        settle({ exitCode, signal: exitSignal, stdout, stderrTail: stderr.lines() }),
      );

      // Forward the interruption, then escalate until the child is gone. Never detached.
      const escalation: NodeJS.Timeout[] = [];
      const interrupt = () => {
        if (interrupted) return;
        interrupted = true;
        // A timeout already started the escalation; the user's interrupt just takes over the reason.
        if (!timedOut) terminate();
      };
      const terminate = () => {
        child.kill("SIGINT");
        escalation.push(setTimeout(() => child.kill("SIGTERM"), this.graceMs));
        escalation.push(setTimeout(() => child.kill("SIGKILL"), this.graceMs * 2));
      };
      if (this.timeoutSeconds !== undefined) {
        const timer = setTimeout(() => {
          if (interrupted) return;
          timedOut = true;
          terminate();
        }, this.timeoutSeconds * 1000);
        cleanups.push(() => clearTimeout(timer));
      }
      if (this.signal.aborted) interrupt();
      else this.signal.addEventListener("abort", interrupt, { once: true });
      cleanups.push(() => {
        this.signal.removeEventListener("abort", interrupt);
        escalation.forEach(clearTimeout);
      });
    });
    if ("error" in outcome)
      return { kind: "launch-failed", detail: `failed to launch agent: ${outcome.error.message}` };
    if (interrupted) return { kind: "interrupted" };
    if (timedOut) return { kind: "timed-out" };
    const outputFile = await readFile(outputPath, "utf8").catch(() => undefined);
    return this.classify(outcome, outputFile);
  }

  /** Signal, then agent-reported error, then non-zero exit, then invalid, then missing. */
  private classify(exited: Extract<ProcessOutcome, { stdout: string }>, outputFile: string | undefined): SessionResult {
    const { exitCode, signal, stderrTail } = exited;
    const failed = (detail: string): SessionResult => ({ kind: "exited-unsuccessfully", detail, stderrTail });
    if (signal) return failed(`agent exited unsuccessfully with signal ${signal}`);
    const extracted = this.adapter.extractFinalMessage(exited.stdout, outputFile);
    if ("agentError" in extracted) {
      return failed(
        exitCode === 0
          ? `agent exited unsuccessfully (agent reported an error: ${extracted.detail})`
          : `agent exited unsuccessfully with exit code ${exitCode} (agent reported an error: ${extracted.detail})`,
      );
    }
    // A message from a failed process is never trusted.
    if (exitCode !== 0) return failed(`agent exited unsuccessfully with exit code ${exitCode}`);
    if ("invalid" in extracted) {
      return {
        kind: "invalid-final-message",
        detail: `agent final response is invalid: ${extracted.reason}`,
        stderrTail,
      };
    }
    if ("missing" in extracted) {
      return { kind: "missing-final-message", detail: "agent exited without a final response", stderrTail };
    }
    return { kind: "success", finalMessage: extracted.message, stderrTail };
  }
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
