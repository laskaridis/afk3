import type {AgentInput} from './agent-input.js';

export type FinalMessageResult =
  /** The final message text, not yet checked for the harness result block. */
  | {message: string}
  /** The agent produced no final message. */
  | {missing: true}
  /** Output was present but unusable; `reason` says why. */
  | {invalid: true; reason: string}
  /** The agent itself reported a failure in its structured output. */
  | {agentError: true; detail: string};

export interface AgentAdapter {
  name: string;
  executable: string;
  buildArgs(input: AgentInput): string[];
  extractFinalMessage(stdout: string, outputFile?: string): FinalMessageResult;
}
