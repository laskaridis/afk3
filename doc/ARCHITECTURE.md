# Architecture

## Stack

- TypeScript compiled by `tsc`
- `vitest` for testing
- `pnpm` package manager
- GitHub Actions
- `commander` is the only runtime dependency; use Node built-ins and avoid adding more

## Flow

```
cli ──validate options──▶ prompt.resolvePrompt
 │
 └─▶ runner.runAfk(config, sessionRunner, reporter)
        per iteration: new nonce
        └─▶ session.runSession(adapter, protocol.buildSessionPrompt(prompt, nonce), …)
              spawn adapter.executable + adapter.buildArgs(); prompt on stdin
              ◀─ SessionResult (launch-failed | exited | timed-out | interrupted)
        classify: adapter.extractFinalMessage(stdout, outputFile) → protocol.parseFinalResponse(text, nonce)
        └─▶ reporter callbacks (cli writes [afk] lines)
 cli ◀─ RunResult → formatFinalStatus + exitCodeFor
```

## Module boundaries

- **`runner`** owns run policy only. It receives a `SessionRunner` function, so unit tests inject scripted results
  without spawning processes. It never inspects agent-specific output.
- **`session`** is agent-neutral process handling: piped stdio, stderr `TailBuffer` (`STDERR_TAIL_LINES`), timeout
  and abort with SIGINT → SIGTERM → SIGKILL escalation (grace `DEFAULT_TERMINATION_GRACE_MS`, overridable with the
  `AFK_TERMINATION_GRACE_MS` env var). It always waits for the child to exit. It creates one temp dir per session (`afk-session-*` under `os.tmpdir()`) for the output file and
  removes it in `finally`.
- **`protocol`** is pure: builds the session prompt and parses the result block. `harness.md` is read at module load
  from next to the compiled file (`new URL("./harness.md", import.meta.url)`).
- **`reporter`** holds exit codes and status wording as pure functions; `cli` does the actual writes.
- **`agents/`** — `AgentAdapter` (`types.ts`): `name`, `executable`, pure `buildArgs(input)`, pure
  `extractFinalMessage(stdout, outputFile?)` returning `FinalMessageResult`
  (`message | missing | invalid | agentError`). Adapters are stateless; the session owns temp files. Where the final
  message lives differs per agent: Codex writes it to the `--output-last-message` file (stdout is ignored); Claude
  prints JSON on stdout (`result`, or `is_error: true` → `agentError`). Full launch commands: README "Supported agents".

## Adding an agent

1. `src/agents/<name>.ts` exporting an `AgentAdapter`; register it in `src/agents/registry.ts`.
2. `test/agents/<name>.test.ts` unit tests for `buildArgs` and `extractFinalMessage`.
3. `test/fixtures/fake-<name>.mjs` that sets `FAKE_AGENT_FORMAT=<name>` and imports `fake-codex.mjs` (see
   `fake-claude.mjs`), plus a branch in `emitFinal` in `fake-codex.mjs` that emits the final message the way the real
   CLI does. The parity suite then picks the agent up automatically.
4. Document prerequisites, launch command, and honored settings under "Supported agents" in `README.md`
   (`test/agent-neutral-docs.test.ts` checks every registered name appears).

No changes to `runner`, `session`, `protocol`, `reporter`, or `cli` should be needed; if they are, reconsider.

## Adding a CLI option

1. `.option(...)` in `src/cli.ts`, with a `parse*` validator throwing `InvalidArgumentError` (→ exit 2). Help-text
   wording must stay agent-neutral.
2. If the agent needs it, add it to `SessionOptions` / `AgentInput` and let each adapter map or ignore it silently.
3. Tests: behavior plus `test/help.test.ts`; `test/agent-neutral-docs.test.ts` if the wording touches agents.
4. Add a row to the options table in `README.md`.
