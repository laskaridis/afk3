import type { AgentAdapter } from "../agents/adapter.js";
import { SessionExecutor } from "./session-executor.js";

/** Holds the run-wide session settings so every session gets the same signal, timeout and grace period. */
export class SessionExecutorFactory {
  /**
   * @param signal Aborting it interrupts the running session and ends later ones as interrupted.
   * @param timeoutSeconds Per-session timeout; no timeout when omitted.
   * @param graceMs Wait between termination escalation steps; the executor's default when omitted.
   */
  constructor(
    private readonly signal: AbortSignal,
    private readonly timeoutSeconds?: number,
    private readonly graceMs?: number,
  ) {}

  /** Creates a new `SessionExecutor` for `adapter` with the run-wide settings. */
  create(adapter: AgentAdapter): SessionExecutor {
    return new SessionExecutor(adapter, this.signal, this.timeoutSeconds, this.graceMs);
  }
}
