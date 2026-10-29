# Design: Agent adapters

Extends the design in `_done/001-afk-cli-core/afk-cli-core.design.md`. Modules not listed here (`prompt`, `protocol`) are unchanged.

## Architectural drivers

- Adding an agent must touch only `src/agents/` (AC-019, AC-022).
- Every behavior that must be identical across agents (AC-012) lives in shared code, not in adapters.
- Adapters are pure, so they are unit-testable without processes (AC-023).

## Modules

| Module | Responsibility (reason to change) | Interface |
| --- | --- | --- |
| `agents/<name>.ts` (one per agent) | Knows one agent CLI: its arguments and how its stdout encodes the final message. Changes when that CLI changes. | `AgentAdapter` as in AC-019 |
| `agents/registry.ts` | Single map of name → adapter, the default agent name, and the list of supported names used by validation, errors, and help. | `agents`, `DEFAULT_AGENT`, `agentNames()` |
| `session` (agent-neutral) | Run one session for a given adapter: spawn, prompt on stdin, capture stdout and a 20-line stderr tail, timeout/abort escalation, report the raw exit. Changes when process handling changes. | `runSession({ adapter, prompt, cwd, model?, effort?, timeoutSeconds?, signal?, graceMs? }) → SessionResult` (adds captured stdout and stderr tail to `exited`/error results) |
| `runner` | Unchanged policy. Classification now takes the adapter's `FinalMessageResult` instead of a file-read message. | as before |
| `reporter` / `cli` | Agent-neutral wording; print stderr tail after an execution-error line; `--agent` option. | as before |

## Key decisions

- **`FinalMessageResult`** is `{ message } | { missing } | { invalid, reason } | { agentError, detail }`. The `agentError` variant carries Claude's structured `is_error: true` result (with `subtype`) so it can be reported as "exited unsuccessfully" on exit `0` or non-zero (AC-008). The runner consults the adapter's extractor for every exit that is not a signal/launch failure, but only trusts `message` when the exit code is `0`.
- **The runner never inspects agent-specific output.** Only adapters parse stdout.
- **Stderr tail** is attached to the session result and printed by the reporter only for execution errors; timeouts, interruptions, and valid protocol responses never print it (AC-017, AC-018).
- **Prompt delivery** is via stdin for both agents (AC-006, AC-013).
- **Tests** run one shared behavior suite per registered adapter using per-agent fake executables that emit the final message as the real agent does.
- **Wording** is defined by the AC-011 examples; `[afk] Run <status>` and `[afk] Execution error: <reason>` style lines (see AC-027, AC-017) are used for final status and execution errors.

## Flow

`cli` validates `--agent` against the registry → `runner` iterates → `session` spawns `adapter.executable` with `adapter.buildArgs(...)`, writes the prompt to stdin, collects stdout/stderr tail → `adapter.extractFinalMessage(stdout)` → `protocol.parseFinalResponse` → run policy as before → `reporter` prints status and, on execution error, the stderr tail.
