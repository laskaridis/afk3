import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import type { AgentAdapter } from "./types.js";

/** The single map of supported agents; register new adapters here. */
export const agents: Record<string, AgentAdapter> = {
  [codexAdapter.name]: codexAdapter,
  [claudeAdapter.name]: claudeAdapter,
};

export const DEFAULT_AGENT = codexAdapter.name;

export function agentNames(): string[] {
  return Object.keys(agents);
}
