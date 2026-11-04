import type { AgentAdapter } from "../agents/adapter.js";

/** The resolved launch prompt the workflow consumes. */
export interface LaunchPrompt {
  /** The prompt text given to the agent in every iteration, before the harness instructions are appended. */
  readonly text: string;
}

/** Run configuration taken from the command line. */
export interface WorkflowOptions {
  /** The adapter for the agent that runs each session. */
  adapter: AgentAdapter;
  /** Model passed to each step; when omitted, the agent's own default applies. */
  model?: string;
  /** Reasoning effort passed to each step; when omitted, the agent's own default applies. */
  effort?: string;
  /** Maximum number of iterations, retries included; reaching it without a terminal outcome ends the run. */
  maxIterations: number;
  /**
   * Per-session timeout in seconds. The executor does not enforce it; it only reports it when a session times out.
   * A missing value is reported as 0.
   */
  sessionTimeoutSeconds?: number;
  /** Working directory each session runs in. */
  cwd: string;
}
