# Design: afk CLI core

Specification: [afk-cli-core.spec.md](afk-cli-core.spec.md)

## Architectural drivers

- **External process boundary (Codex CLI).** The riskiest part of the feature: flag selection, streaming output, capturing the final assistant message separately from activity, and signal/timeout termination. Isolated in a single module and validated first with a tracer bullet.
- **Testability without real Codex.** Every behavior must be verifiable in automation, offline. Integration tests run the built CLI against a fake `codex` executable placed first on `PATH`; unit tests drive the run loop through an injected session runner.
- **Trust the skill (AC-012).** The harness only interprets the final protocol response; no task, Git, or test inspection exists anywhere in the design.
- **No persistence (AC-030).** The only file the harness creates is a per-session temporary file for Codex's last message, removed when the session ends.

## Toolchain

- TypeScript compiled with `tsc` to `dist/`, ESM, Node.js >= 20.
- `commander` for argument parsing and help; `vitest` for tests. No other runtime dependencies are expected.
- `package.json` exposes the executable `afk` via `bin` so `npx` can run the package (e.g. `npx <package>` or `npm exec` from a local path). Working package name: `afk-cli` (availability unverified; publishing is out of scope).
- Scripts: `build`, `test`, `typecheck`.

## Modules

| Module | Responsibility (reason to change) | Interface (conceptual) |
| --- | --- | --- |
| `cli` (entry point) | Translate the command line into a validated run configuration, wire the other modules, install the Ctrl+C handler, print the final status, and set the exit code. Changes when the command-line surface changes. | `main(argv, io) → exit code` |
| `prompt` | Resolve exactly one launch prompt from positional argument, `--prompt-file`, or stdin, enforcing AC-001–AC-004. Changes when prompt-source rules change. | `resolvePrompt({ positional, promptFile, stdin, stdinIsTTY }) → prompt \| InputError` |
| `protocol` | Own the contract protocol: the per-session instructions appended to the launch prompt and the parser/validator for the final response. Pure functions. Changes when the code skill's protocol changes. | `buildSessionPrompt(launchPrompt) → string`; `parseFinalResponse(text) → Outcome \| ContractViolation` |
| `session` | Run exactly one Codex session: build the `codex exec` arguments, spawn, stream activity to the terminal, capture the final message via a temp file, enforce the optional timeout, honor an abort signal, guarantee the child has exited before resolving, and delete the temp file. Changes when Codex's CLI changes. | `runSession({ prompt, cwd, model?, reasoningEffort?, timeoutSeconds?, signal }) → SessionResult` |
| `runner` | Orchestrate iterations: session budget, outcome handling (AC-011), single consecutive execution-error retry, and stop-on-timeout/interrupt. Emits progress events. Changes when run policy changes. | `runAfk(config, sessionRunner, reporter) → RunResult` |
| `reporter` | Format iteration banners, retry notices, surfaced failure summaries, and the final status; map `RunResult` to exit codes. Changes when presentation changes. | `reporter` callbacks; `exitCodeFor(result)`; `formatFinalStatus(result)` |

### Key types

- `AgentOutcome`: `{ outcome: "repeat" } | { outcome: "complete" } | { outcome: "blocked", blocker_text } | { outcome: "fail", failure_summary }`.
- `SessionResult`: `launch-failed (error)` | `exited (exitCode or signal, finalMessage text or absent)` | `timed-out` | `interrupted`.
- `RunResult`: `complete` | `blocked (blocker_text)` | `execution-error (kind: launch-failed | exit-status N | missing-response | invalid-response, detail)` | `iteration-limit (limit)` | `timeout (seconds)` | `interrupted`, plus `input-error` / `option-error` produced before any run.

## Flow of execution

1. `cli` parses argv with commander. `--help`/`-h` prints usage, options, and exit codes to stdout and exits 0 before any other validation or stdin read.
2. `cli` validates options (`--max-iterations`, `--session-timeout`, `--cwd`, `--model`, `--reasoning-effort`), then calls `prompt-input`. Any error → message on stderr, exit code 2, no Codex launch.
3. `runner` iterates up to `maxIterations` launches. Each launch: reporter announces `iteration i/N` (and whether it is a retry) → `codex-session.runSession` with `buildSessionPrompt(launchPrompt)` → classify:
   - `exited` with code 0 → `parseFinalResponse(finalMessage)`; valid → act on outcome and reset error allowance; violation → execution error.
   - `exited` non-zero, `launch-failed` → execution error (regardless of any apparent protocol response).
   - `timed-out` → stop with `timeout`. `interrupted` → stop with `interrupted`.
   - Execution error: if the previous attempt was also an execution error → stop `execution-error`; otherwise report and retry if budget remains.
   - `repeat`/`fail`/retry needed with no budget left → stop `iteration-limit`.
4. `cli` prints the final status and exits with the mapped code.

## Key decisions

- **Codex invocation.** Every session runs `codex exec` with `--approve-for-me` (automatic approval review), `-C <workspace>`, and `-o <temp file>`. It also runs with the child's working directory set to the workspace. `-m <model>` is added only when `--model` is given, and `-c model_reasoning_effort="<effort>"` only when `--reasoning-effort` is given. The harness never passes `--dangerously-bypass-approvals-and-sandbox`, `-s danger-full-access`, `--worktree`, `--ephemeral`, `--ignore-user-config`, `resume`, or `fork`.
- **Final message capture.** Codex's stdout/stderr are passed through to the terminal live. The final assistant message is read only from the `-o` temp file after the process exits. A missing or empty file means a missing response. Streamed output is never parsed.
- **Child stdin.** The Codex child never inherits the harness's stdin, because Codex appends piped stdin to its prompt. Ctrl+C still reaches Codex through the terminal's foreground process group, and the harness additionally forwards SIGINT itself.
- **Prompt-source rule (stdin).** When stdin is not a TTY, the harness reads it to EOF. Empty or whitespace-only stdin does not count as a prompt source. Non-blank stdin combined with another source is an input error. A TTY stdin is never read and never prompts. Empty or whitespace-only positional or file prompts are input errors.
- **Session prompt.** The original launch prompt is sent verbatim, followed by a harness-authored instruction block. The block tells Codex to use the available code skill to complete one task and to end with a final message that is only the skill's JSON protocol response. The launch prompt is identical across iterations and retries.
- **Termination.** On timeout or interrupt, the session sends SIGINT to the child and escalates to SIGTERM, then SIGKILL, after a bounded grace period. The run does not end until the child has exited. No rollback.
- **Exit codes.**

  | Code | Meaning |
  | --- | --- |
  | 0 | Feature complete (valid `complete` outcome), or help |
  | 1 | Blocked (`blocked` outcome) |
  | 2 | Input or option error (no session launched) |
  | 3 | Execution error after retry allowance exhausted |
  | 4 | Iteration limit reached without completion |
  | 5 | Session timeout |
  | 130 | Interrupted by user |

- **Output streams.** Help goes to stdout. Harness status lines (iteration banners, retries, failure summaries, final status) go to stderr, so they stay distinguishable from Codex activity passed through on stdout.
- **Testing strategy.** Unit tests (vitest) cover `prompt`, `protocol`, and `runner` (with a scripted fake session runner). Integration tests spawn the built `afk` with a fake `codex` executable first on `PATH`. The fake is scripted per test via environment variables or a fixture file in a temp directory. It records the argv, cwd, and stdin it received; emits output; writes a final message to the `-o` path; exits with a chosen code; or sleeps and records the signals it receives.
