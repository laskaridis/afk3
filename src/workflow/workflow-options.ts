import type { AgentAdapter } from "../agents/adapter.js";

/** The resolved launch prompt text the workflow consumes. */
export interface LaunchPrompt {
  readonly text: string;
}

/** Run configuration taken from the command line. */
export interface WorkflowOptions {
  adapter: AgentAdapter;
  model?: string;
  effort?: string;
  maxIterations: number;
  /** Per-session timeout; only used to report a timeout. */
  sessionTimeoutSeconds?: number;
  cwd: string;
}
