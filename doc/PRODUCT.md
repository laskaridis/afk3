# Product: behavior contract and domain language

User-facing docs live in [README.md](../README.md). Detailed acceptance criteria are in `specs/_done/*/*.spec.md`
(historical; where they disagree with the code, the code wins).

## Domain language

Use these terms in code, tests, and messages; don't invent synonyms.

| Term               | Meaning                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| launch prompt      | The user's feature instructions, from exactly one source: argument, `--prompt-file`, or stdin  |
| session prompt     | Launch prompt + `---` + `src/code.md` with `{{NONCE}}` replaced                                |
| session            | One fresh, non-interactive agent process. Never resumed or forked                              |
| iteration          | One session launch, retries included; bounded by `--max-iterations` (`DEFAULT_MAX_ITERATIONS`) |
| nonce              | Random per session (`runner.ts`); the result block must carry it                               |
| result block       | `<afk-harness-result nonce="…">{json}</afk-harness-result>`; the last one with the nonce wins  |
| outcome            | `repeat` \| `complete` \| `blocked` (+`blocker_text`) \| `fail` (+`failure_summary`)           |
| execution error    | `launch-failed` \| `exit-status` \| `missing-response` \| `invalid-response`                   |
| contract violation | Final message present but not a valid result block → `invalid-response`                        |
| stderr tail        | Last `STDERR_TAIL_LINES` of the agent's stderr, printed only after an execution-error line     |
| adapter            | Knowledge of one agent CLI (`src/agents/<name>.ts`)                                            |
| code skill         | The agent-side workflow (`laskaridis/skills`) that picks one task, implements it, and responds |

## Run policy

- `repeat` → next session; `fail` → print `[afk] Task failure: …`, next session; `complete` / `blocked` → stop.
- One retry per consecutive execution error; a second consecutive one stops the run. A valid outcome resets it.
- A non-zero exit is an execution error even if the output contains a valid result block.
- Timeout and interruption stop the run immediately, with no retry.
- The harness trusts the outcome: it never reads tasks, git state, or runs tests.

## Output and exit codes

- stdout is empty during a run (help and `--version` only). All status goes to stderr as `[afk] …` lines.
- Agent stdout/stderr are captured, never streamed. No heartbeat lines.
- Wording is agent-neutral ("agent session", "the coding agent") and identical across agents; tests assert it.
- Exit codes and their meanings are defined once in `src/reporter.ts` (`EXIT_CODES`, shown by `afk --help`). They are
  part of the user contract: don't renumber them.
- `--help` / `-h` wins over every other option and over prompt input.

## Explicitly out of scope

Persisted logs/run history, resume commands, config files, env-var agent selection, plugin adapters, per-agent option
translation or validation, pre-flight checks of agent installation, arbitrary argument passthrough, publishing.
