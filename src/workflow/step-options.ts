/** The per-step subset of the run options: where to run and with which model. */
export interface WorkflowStepOptions {
  /** Working directory the step's agent session runs in. */
  cwd: string;
  /** Model the agent should use; when omitted, the agent's own default applies. */
  model?: string;
  /** Reasoning effort the agent should use; when omitted, the agent's own default applies. */
  effort?: string;
}
