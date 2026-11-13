import type { TerminalWorkflowEvent } from "../workflow/workflow-event.js";

/** Process exit codes of the CLI, by the outcome that produces them. */
export const EXIT_CODES = {
  complete: 0,
  blocked: 1,
  inputError: 2,
  executionError: 3,
  iterationLimit: 4,
  timeout: 5,
  verificationLimit: 6,
  interrupted: 130,
} as const;

const EXIT_CODE_MEANINGS: Record<keyof typeof EXIT_CODES, string> = {
  complete: "the feature was reported complete",
  blocked: "the code skill reported a blocker",
  inputError: "invalid options or prompt input; no session was launched",
  executionError: "the agent failed to execute twice in a row",
  iterationLimit: "the iteration limit was reached without reported completion",
  timeout: "a session exceeded --session-timeout",
  verificationLimit: "verification rejected the same task too many times",
  interrupted: "interrupted by the user (Ctrl+C)",
};

/** The "Exit codes" section appended to `--help`, one line per code with its meaning. */
export function formatExitCodeHelp(): string {
  const lines = (Object.keys(EXIT_CODES) as (keyof typeof EXIT_CODES)[]).map(
    (name) => `  ${String(EXIT_CODES[name]).padEnd(4)}${EXIT_CODE_MEANINGS[name]}`,
  );
  return `\nExit codes:\n${lines.join("\n")}\n`;
}

/** Maps the terminal event of a run to the process exit code. */
export function exitCodeFor(result: TerminalWorkflowEvent): number {
  switch (result.type) {
    case "WorkflowFinished":
    case "WorkflowCompleted":
      return EXIT_CODES.complete;
    case "WorkflowBlocked":
      return EXIT_CODES.blocked;
    case "WorkflowFailed":
      return EXIT_CODES.executionError;
    case "MaxIterationsReached":
      return EXIT_CODES.iterationLimit;
    case "VerificationLimitReached":
      return EXIT_CODES.verificationLimit;
    case "WorkflowTimedOut":
      return EXIT_CODES.timeout;
    case "WorkflowInterrupted":
      return EXIT_CODES.interrupted;
  }
}
