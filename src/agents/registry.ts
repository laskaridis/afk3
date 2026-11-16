import type {AgentAdapter} from './adapter.js';
import {ClaudeAdapter} from './claude.js';
import {CodexAdapter} from './codex.js';

export class AgentRegistry {
  private readonly adapters: ReadonlyMap<string, AgentAdapter>;

  constructor(
    adapters: readonly AgentAdapter[] = [
      new CodexAdapter(),
      new ClaudeAdapter(),
    ],
  ) {
    this.adapters = new Map(adapters.map(adapter => [adapter.name, adapter]));
  }

  get defaultName(): string {
    return 'codex';
  }

  names(): string[] {
    return [...this.adapters.keys()];
  }

  get(name: string): AgentAdapter | undefined {
    return this.adapters.get(name);
  }
}
