import type { AgentAdapter } from "./adapter.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";

/** The single list of supported agents; register new adapters here. */
export class AgentRegistry {
  private readonly adapters: ReadonlyMap<string, AgentAdapter>;

  /** @param adapters The supported agents; defaults to all built-in adapters. Names must be unique. */
  constructor(adapters: readonly AgentAdapter[] = [new CodexAdapter(), new ClaudeAdapter()]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.name, adapter]));
  }

  /** The agent used when `--agent` is not given. */
  get defaultName(): string {
    return "codex";
  }

  /** Supported agent names in registration order. */
  names(): string[] {
    return [...this.adapters.keys()];
  }

  /** The adapter registered under `name`, or `undefined` if there is none. */
  get(name: string): AgentAdapter | undefined {
    return this.adapters.get(name);
  }
}
