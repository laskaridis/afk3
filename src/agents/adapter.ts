/** What an adapter found when looking for the agent's final message. */
export type FinalMessageResult =
  /** The final message text, not yet checked for the harness result block. */
  | { message: string }
  /** The agent produced no final message. */
  | { missing: true }
  /** Output was present but unusable; `reason` says why. */
  | { invalid: true; reason: string }
  /** The agent itself reported a failure in its structured output. */
  | { agentError: true; detail: string };

/** What an adapter needs to build the launch arguments for one session. */
export interface AgentInput {
  /** Working directory the session runs in. */
  cwd: string;
  /** A fresh path the session reads after the agent exits; agents that can write their final message there may do so. */
  outputFile?: string;
  /** Model to use; when omitted, no model flag is passed and the agent's own configuration applies. */
  model?: string;
  /** Reasoning effort to use; when omitted, no effort flag is passed and the agent's own configuration applies. */
  effort?: string;
}

/** Knows one agent CLI: how to launch it and where its final message ends up. Pure and stateless. */
export interface AgentAdapter {
  /** Value accepted by `--agent`. */
  name: string;
  /** Command to launch. */
  executable: string;
  /**
   * Builds the command-line arguments for one session. The prompt is not an argument: it is written to the process's
   * stdin.
   */
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
