export type FinalMessageResult =
  | { message: string }
  | { missing: true }
  | { invalid: true; reason: string }
  /** The agent itself reported a failure in its structured output. */
  | { agentError: true; detail: string };

export interface AgentInput {
  cwd: string;
  /** A fresh path the session reads after the agent exits; agents that can write their final message there may do so. */
  outputFile?: string;
  model?: string;
  effort?: string;
}

/** Knows one agent CLI: how to launch it and where its final message ends up. Pure and stateless. */
export interface AgentAdapter {
  /** Value accepted by `--agent`. */
  name: string;
  /** Command to launch. */
  executable: string;
  buildArgs(input: AgentInput): string[];
  /**
   * Picks the agent's final message out of what the session captured. Agents differ in where it lives: Claude prints
   * it in a JSON document on `stdout`, Codex writes it to a file. Each adapter reads the source it needs and ignores
   * the other.
   *
   * `outputFile` is the content of {@link AgentInput.outputFile} after exit, or undefined if the agent did not write it.
   */
  extractFinalMessage(stdout: string, outputFile?: string): FinalMessageResult;
}
