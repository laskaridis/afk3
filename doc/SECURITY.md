# Security and safety constraints

`afk` runs an autonomous agent unattended in the user's workspace, so it must never widen the agent's permissions.

- **No full-access modes.** Codex always gets `--approve-for-me` (automatic approval review); Claude always gets
  `--permission-mode auto`. Never pass `--dangerously-bypass-approvals-and-sandbox`, `danger-full-access`,
  `bypassPermissions`, or similar. `test/tracer-bullet.test.ts` and `test/agents/*.test.ts` assert this.
- **No silent broadening.** If the agent is denied an action, the expected result is a `blocked` outcome, not a retry
  with more permissions.
- **No argument passthrough.** Only `--model` and `--reasoning-effort` reach the agent, passed unchanged as discrete
  argv items (never through a shell). No options that apply to one agent only.
- **Agent stdin is the session prompt only.** afk's own stdin is never forwarded to the agent.
- **Untrusted agent output.** The final message is only trusted on exit code 0, and only the last result block carrying
  this session's nonce counts, so echoed examples or injected blocks with other nonces are ignored.
- **No persistence.** No logs, run history, or config files. The only file afk creates is the per-session temp output
  file, outside the workspace, deleted when the session ends.
- **No orphaned agents.** Timeout and Ctrl+C escalate SIGINT → SIGTERM → SIGKILL and wait for exit; the child is never
  detached.
- **No user-environment changes.** afk does not touch git branches/worktrees, install skills, or edit agent config.
