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
