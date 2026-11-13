# afk

Leave a coding agent implementing a feature, one task at a time, while you are away from keyboard.

`afk` is agent-neutral: it launches a fresh session of the coding agent you choose, hands it your instructions, reads the
agent's final response, and repeats until the feature is reported complete, blocked, or a limit is reached.

Every run is a two-phase loop. A coding session implements one task and commits a candidate; a fresh, independent
verification session then reviews it. A passing verdict lets the run advance (or finish, when the verification agent
reports that no task remains). A rejection sends the same task back to the coding agent in a correction iteration with
the verification findings, until the task is accepted or the per-task verification limit stops the run (exit code 6).
Verification cannot be skipped.

Requires Node.js **22.13.0 or later**.

## Install

```sh
npm install --global @laskaridis/afk
```

This installs the `afk` command. Install and authenticate a supported coding agent before running it.

## Usage

```
afk [options] [prompt...]
```

The feature instructions come from the prompt arguments, `--prompt-file <path>`, or stdin.

| Option                                | Description                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `--agent <name>`                      | Coding agent for every session: `codex` or `claude` (default: `codex`)            |
| `--prompt-file <path>`                | Read the feature instructions from a file                                         |
| `--cwd <directory>`                   | Workspace directory for every session (default: current directory)                |
| `--max-iterations <count>`            | Maximum number of coding iterations, corrections included (default: 10)           |
| `--max-verification-attempts <count>` | Rejections by verification one task may receive before the run stops (default: 2) |
| `--session-timeout <seconds>`         | Stop the run if a single session exceeds this many seconds                        |
| `--model <name>`                      | Model for every session, passed to the agent unchanged                            |
| `--reasoning-effort <level>`          | Reasoning effort for every session, passed to the agent unchanged                 |
| `--verify-model <name>`               | Model for verification sessions only, passed to the agent unchanged               |
| `--verify-reasoning-effort <level>`   | Reasoning effort for verification sessions only, passed unchanged                 |

Run `afk --help` for the exit codes.

Progress is printed to stderr as `[afk]` lines. When a session fails to execute, the last 20 lines of the agent's stderr
are printed after the `Execution error` line.

## Supported agents

Prerequisites are not checked up front: a missing executable is a launch failure and follows the normal retry-once
policy. In every case the prompt is delivered on stdin and the workspace is the directory given by `--cwd`.

### Codex (`--agent codex`)

- **Prerequisites:** Codex CLI installed and authenticated, with `--approve-for-me` support.
- **Launch:** `codex exec --approve-for-me -C <workspace> --output-last-message <file> [--model <model>] [--config model_reasoning_effort="<effort>"] -`.
  The final message is the content of `<file>`, a temporary file outside the workspace that `afk` removes after the
  session; Codex's stdout is a progress log and is ignored.
- **Honored settings:** workspace, `--model`, `--reasoning-effort`.

### Claude Code (`--agent claude`)

- **Prerequisites:** Claude Code CLI installed and authenticated; `auto` permission mode available for the account and
  model; the `code` skill discoverable by Claude Code (for example under `.claude/skills`).
- **Launch:** `claude -p --output-format json --permission-mode auto [--model <model>] [--effort <effort>]`, run in the
  workspace. The final message is the `result` field of the JSON object on stdout; `is_error: true` is an execution error.
- **Honored settings:** workspace, `--model`, `--reasoning-effort` (passed as `--effort`).

`afk` never selects a full-access mode for any agent.

## Development

```
pnpm check   # test, typecheck, lint, prettier
pnpm test    # build once, then run both test suites
pnpm test:unit # run unit tests without building
pnpm test:integration # build, then run CLI integration tests
pnpm test:coverage # build, test, and generate coverage reports
```

See [Testing](doc/TESTING.md#coverage) for coverage reports in CI and their scope.
