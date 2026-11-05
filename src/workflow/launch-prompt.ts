/** The resolved launch prompt the workflow consumes. */
export interface LaunchPrompt {
  /** The prompt text given to the agent in every iteration, before the harness instructions are appended. */
  readonly text: string;
}
