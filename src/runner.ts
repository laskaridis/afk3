import { parseFinalResponse } from "./protocol.js";
import type { SessionResult } from "./session.js";

export const DEFAULT_MAX_ITERATIONS = 10;

export type ExecutionErrorKind = "launch-failed" | "exit-status" | "missing-response" | "invalid-response";

export type RunResult =
  | { kind: "complete" }
  | { kind: "blocked"; blockerText: string }
  | { kind: "execution-error"; errorKind: ExecutionErrorKind; detail: string }
  | { kind: "iteration-limit"; limit: number };

export type SessionRunner = (launchPrompt: string) => Promise<SessionResult>;

export interface RunReporter {
  iterationStarted?(iteration: number, limit: number): void;
  failureSurfaced?(failureSummary: string): void;
}

export interface RunConfig {
  launchPrompt: string;
  maxIterations: number;
}

/** Run fresh sessions until a terminal outcome, deciding only from session results. */
export async function runAfk(
  config: RunConfig,
  runSession: SessionRunner,
  reporter: RunReporter = {},
): Promise<RunResult> {
  for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
    reporter.iterationStarted?.(iteration, config.maxIterations);
    const session = await runSession(config.launchPrompt);

    if (session.kind === "launch-failed") {
      return { kind: "execution-error", errorKind: "launch-failed", detail: session.error.message };
    }
    if (session.exitCode !== 0) {
      const detail = session.signal ? `signal ${session.signal}` : `exit status ${session.exitCode}`;
      return { kind: "execution-error", errorKind: "exit-status", detail };
    }
    const response = parseFinalResponse(session.finalMessage);
    if ("violation" in response) {
      const errorKind = session.finalMessage === undefined ? "missing-response" : "invalid-response";
      return { kind: "execution-error", errorKind, detail: response.violation };
    }

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
