# afk

Leave a coding agent implementing a feature, one task at a time, while you are away from keyboard.

`afk` is agent-neutral: it launches a fresh session of the coding agent you choose, hands it your instructions, reads the
agent's final response, and repeats until the feature is reported complete, blocked, or the iteration limit is reached.

## Usage

```
afk [options] [prompt...]
```

The feature instructions come from the prompt arguments, `--prompt-file <path>`, or stdin.

| Option                       | Description                                                            |
| ---------------------------- | ---------------------------------------------------------------------- |
| `--agent <name>`             | Coding agent for every session: `codex` or `claude` (default: `codex`) |
| `--prompt-file <path>`       | Read the feature instructions from a file                              |
| `--cwd <directory>`          | Workspace directory for every session (default: current directory)     |
| `--max-iterations <count>`   | Maximum number of agent sessions to launch (default: 10)               |
| `--session-timeout <secs>`   | Stop the run if a single session exceeds this many seconds             |
| `--model <name>`             | Model for every session, passed to the agent unchanged                 |
| `--reasoning-effort <level>` | Reasoning effort for every session, passed to the agent unchanged      |

Run `afk --help` for the exit codes.

Progress is printed to stderr as `[afk]` lines. When a session fails to execute, the last 20 lines of the agent's stderr
are printed after the `Execution error` line.

## Supported agents

Prerequisites are not checked up front: a missing executable is a launch failure and follows the normal retry-once
policy. In every case the prompt is delivered on stdin and the workspace is the directory given by `--cwd`.

### Codex (`--agent codex`)

- **Prerequisites:** Codex CLI installed and authenticated, with `--approve-for-me` support.
- **Launch:** `codex exec --approve-for-me -C <workspace> --output-last-message <file> [--model <model>] [--config model_reasoning_effort=<effort>] -`.
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
pnpm test    # build, then run the test suite
```
