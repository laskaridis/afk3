import { randomBytes } from "node:crypto";
import { parseFinalResponse, type AgentOutcome } from "./protocol.js";
import type { SessionResult } from "./session/session-result.js";

export const DEFAULT_MAX_ITERATIONS = 10;

export type ExecutionErrorKind = "launch-failed" | "exit-status" | "missing-response" | "invalid-response";

export type RunResult =
  | { kind: "complete" }
  | { kind: "blocked"; blockerText: string }
  | { kind: "execution-error"; errorKind: ExecutionErrorKind; detail: string }
  | { kind: "iteration-limit"; limit: number }
  | { kind: "timeout"; seconds: number }
  | { kind: "interrupted" };

/** `nonce` is unique per session and must appear in the result block the agent returns. */
export type SessionRunner = (launchPrompt: string, nonce: string) => Promise<SessionResult>;

export interface RunReporter {
  iterationStarted?(iteration: number, limit: number): void;
  retryStarted?(iteration: number, limit: number, reason: string): void;
  failureSurfaced?(failureSummary: string): void;
  /** Called for every execution error, including the one that leads to a retry; the stderr tail is the agent's last lines. */
  executionError?(detail: string, stderrTail: string[]): void;
}

export interface RunConfig {
  launchPrompt: string;
  maxIterations: number;
  /** Per-session timeout; only used to report a timeout. */
  sessionTimeoutSeconds?: number;
}

/** Run fresh sessions until a terminal outcome, deciding only from session results. */
export async function runAfk(
  config: RunConfig,
  runSession: SessionRunner,
  reporter: RunReporter = {},
): Promise<RunResult> {
  let previousError: string | undefined;
  for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
    if (previousError === undefined) reporter.iterationStarted?.(iteration, config.maxIterations);
    else reporter.retryStarted?.(iteration, config.maxIterations, previousError);
    const nonce = randomBytes(4).toString("hex");
    const session = await runSession(config.launchPrompt, nonce);

    if (session.kind === "interrupted") return { kind: "interrupted" };
    if (session.kind === "timed-out") return { kind: "timeout", seconds: config.sessionTimeoutSeconds ?? 0 };

    const classified = classify(session, nonce);
    if ("kind" in classified) {
      const error = classified;
      reporter.executionError?.(error.detail, "stderrTail" in session ? session.stderrTail : []);
      // One retry per consecutive error; a second consecutive error stops the run.
      if (previousError !== undefined) return error;
      if (iteration === config.maxIterations) break;
      previousError = error.detail;
      continue;
    }
    previousError = undefined;
    const response = classified;

    switch (response.outcome) {
      case "complete":
        return { kind: "complete" };
      case "blocked":
        return { kind: "blocked", blockerText: response.blocker_text };
      case "fail":
        reporter.failureSurfaced?.(response.failure_summary);
        break;
      case "repeat":
        break;
    }
  }
  return { kind: "iteration-limit", limit: config.maxIterations };
}

type ExecutionError = Extract<RunResult, { kind: "execution-error" }>;

/** Classify a session as an execution error or the valid outcome it reported. */
function classify(
  session: Exclude<SessionResult, { kind: "interrupted" | "timed-out" }>,
  nonce: string,
): ExecutionError | AgentOutcome {
  switch (session.kind) {
    case "launch-failed":
      return { kind: "execution-error", errorKind: "launch-failed", detail: session.detail };
    case "exited-unsuccessfully":
      return { kind: "execution-error", errorKind: "exit-status", detail: session.detail };
    case "missing-final-message":
      return { kind: "execution-error", errorKind: "missing-response", detail: session.detail };
    case "invalid-final-message":
      return { kind: "execution-error", errorKind: "invalid-response", detail: session.detail };
    case "success": {
      const response = parseFinalResponse(session.finalMessage, nonce);
      if ("violation" in response) {
        return {
          kind: "execution-error",
          errorKind: "invalid-response",
          detail: `agent final response is invalid: ${response.violation}`,
        };
      }
      return response;
    }
  }
}
