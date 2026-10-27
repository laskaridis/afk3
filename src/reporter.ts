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

export function formatFinalStatus(result: RunResult): string {
  switch (result.kind) {
    case "complete":
      return "feature complete";
    case "blocked":
      return `blocked: ${result.blockerText}`;
    case "execution-error":
      return `execution error (${result.errorKind}): ${result.detail}`;
    case "iteration-limit":
      return `iteration limit of ${result.limit} reached without reported completion`;
    case "timeout":
      return `session timed out after ${result.seconds} seconds`;
    case "interrupted":
      return "interrupted by user";
  }
}
