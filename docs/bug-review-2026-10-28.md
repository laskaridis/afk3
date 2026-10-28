# Bug review — 2026-10-28

Reviewed all six TypeScript source modules, the session harness, package scripts,
existing tests, and core requirements at main commit
53ee53b81112a1ceff439c912defc173023c6d4e.

## 1. High: session termination leaves subprocesses running (open)

Location: src/session.ts, `terminate()` and `settle()`.

Expected: stopping a timed-out or interrupted coding session prevents its running
commands from continuing to mutate the workspace.
Observed: escalation calls `child.kill()` only on Codex's PID. Descendants receive
no signals, and escalation timers are cleared when Codex closes. A descendant
with independent stdio can continue after AFK reports timeout and exits.
Impact: build scripts or other commands can continue writing files after the user
believes the unattended run has stopped. Inherited output handles can also delay
`close`, making termination hang after the direct child has died.

Reproduced on Linux with a fake Codex executable that spawns a Node subprocess
with ignored stdio. The subprocess writes a marker after 700 ms; Codex remains
alive. Running `runSession` with a 300 ms timeout and 50 ms escalation grace
returns `timed-out`, but the marker is written afterward.

Follow-up: design process-tree cancellation with explicit platform support and
regressions for both inherited and independent stdio, including escalation after
the direct child exits. This PR deliberately leaves that broader change open.

## 2. Medium: unsafe iteration limits bypass a finite session budget (fixed)

Location: src/cli.ts, `parseMaxIterations()`.

Expected: an invalid numeric limit produces input error 2 without launching Codex.
Observed: digit-only strings pass the regex even when conversion loses precision
or returns Infinity. `9007199254740993` becomes `9007199254740992`; 309 nines become
Infinity. The iteration counter also ceases advancing beyond the safe-integer
range, so a repeating run with such a limit has no effective budget stop.
Impact: malformed/generated configuration can cause unexpected unattended session
costs and workspace changes. Ordinary small iteration counts are unaffected.

Fix: require `Number.isSafeInteger` after the positive-integer syntax check and
report the maximum supported count. Tests cover overflow, unsafe rounding, and
valid small and boundary counts, including no child launches for rejected input.

## Validation and limitations

- Reproduced both findings directly with Node 24 before changing the parser.
- Focused checks against the actual parser function body pass: seven rejected
  inputs and three accepted inputs, including the safe-integer boundary.
- Added six CLI integration cases in test/max-iterations.test.ts.
- Full Vitest suite, build, and typecheck could not run: dependencies are absent;
  offline pnpm installation fails on missing package metadata, and the shell
  cannot connect to the configured network proxy. The new integration cases
  remain unexecuted in this environment.
- No live Codex session was launched during this review. This is a source review
  with focused reproductions, not an exhaustive audit.
