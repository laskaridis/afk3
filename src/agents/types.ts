export type FinalMessageResult =
  | { message: string }
  | { missing: true }
  | { invalid: true; reason: string }
  /** The agent itself reported a failure in its structured output. */
  | { agentError: true; detail: string };

export interface AgentInput {
  cwd: string;
  model?: string;
  effort?: string;
}

/** Knows one agent CLI: how to launch it and how its stdout encodes the final message. Pure and stateless. */
export interface AgentAdapter {
  /** Value accepted by `--agent`. */
  name: string;
  /** Command to launch. */
  executable: string;
  buildArgs(input: AgentInput): string[];
  extractFinalMessage(stdout: string): FinalMessageResult;
}
