import type { AgentAdapter } from "../agents/adapter.js";
import { SessionExecutor } from "./session-executor.js";

/** Holds the run-wide session settings so every session gets the same signal, timeout and grace period. */
export class SessionExecutorFactory {
  constructor(
    private readonly signal: AbortSignal,
    private readonly timeoutSeconds?: number,
    private readonly graceMs?: number,
  ) {}

  create(adapter: AgentAdapter): SessionExecutor {
    return new SessionExecutor(adapter, this.signal, this.timeoutSeconds, this.graceMs);
  }
}
