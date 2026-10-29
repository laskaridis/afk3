import type { RunResult } from "./runner.js";

export const EXIT_CODES = {
  complete: 0,
  blocked: 1,
  inputError: 2,
  executionError: 3,
  iterationLimit: 4,
  timeout: 5,
  interrupted: 130,
} as const;

const EXIT_CODE_MEANINGS: Record<keyof typeof EXIT_CODES, string> = {
  complete: "the feature was reported complete",
  blocked: "the code skill reported a blocker",
  inputError: "invalid options or prompt input; no session was launched",
  executionError: "the agent failed to execute twice in a row",
  iterationLimit: "the iteration limit was reached without reported completion",
  timeout: "a session exceeded --session-timeout",
  interrupted: "interrupted by the user (Ctrl+C)",
};

export function formatExitCodeHelp(): string {
  const lines = (Object.keys(EXIT_CODES) as (keyof typeof EXIT_CODES)[]).map(
    (name) => `  ${String(EXIT_CODES[name]).padEnd(4)}${EXIT_CODE_MEANINGS[name]}`,
  );
  return `\nExit codes:\n${lines.join("\n")}\n`;
}

export function exitCodeFor(result: RunResult): number {
  switch (result.kind) {
    case "complete":
      return EXIT_CODES.complete;
    case "blocked":
      return EXIT_CODES.blocked;
    case "execution-error":
      return EXIT_CODES.executionError;
    case "iteration-limit":
      return EXIT_CODES.iterationLimit;
    case "timeout":
      return EXIT_CODES.timeout;
    case "interrupted":
      return EXIT_CODES.interrupted;
  }
}

/** The final `[afk] ...` line; execution errors are reported as they happen, so they have none. */
export function formatFinalStatus(result: RunResult): string | undefined {
  switch (result.kind) {
    case "complete":
      return "Run complete: feature complete";
    case "blocked":
      return `Run blocked: ${result.blockerText}`;
    case "execution-error":
      return undefined;
    case "iteration-limit":
      return `Run stopped: iteration limit of ${result.limit} reached without reported completion`;
    case "timeout":
      return `Run stopped: agent session timed out after ${result.seconds} seconds`;
    case "interrupted":
      return "Run interrupted by user";
  }
}

/** The execution-error line followed by the agent's last stderr lines, in original order. */
export function formatExecutionError(detail: string, stderrTail: string[]): string {
  return [`[afk] Execution error: ${detail}`, ...stderrTail].map((line) => `${line}\n`).join("");
}
