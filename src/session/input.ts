/** What one session is asked to do. */
export interface SessionInput {
  /** The full prompt, written to the agent's stdin. */
  prompt: string;
  /** Working directory of the agent process. */
  cwd: string;
  /** Overrides the model for this session; otherwise the agent's own configuration applies. */
  model?: string;
  /** Overrides the reasoning effort for this session; otherwise the agent's own configuration applies. */
  effort?: string;
}
