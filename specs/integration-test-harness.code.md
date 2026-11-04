## Project discovery
- BSD sed on macOS: use perl -0pi for edits; `pnpm install --frozen-lockfile` needed in fresh worktree.
- `pnpm format` also rewrites doc/ARCHITECTURE.md (pre-existing drift); revert it with `git checkout doc/ARCHITECTURE.md` unless in scope.
- Prompt = launch + "\n\n---\n" + dist/code.md (nonce substituted) + "\n"; helpers: `expectedSessionPrompt`, `withoutNonce`, `promptNonce`.
---

## 2026-11-04
- Task id: TASK-001
- What was implemented:
  - Removed all `src/` imports from test/integration; agent names, default agent, exit codes are literals.
  - Added `promptNonce`, `expectedSessionPrompt`; `withoutNonce` now masks the nonce announced in the result-block example.
  - Exact prompt comparison for first session (tracer-bullet) and first session + retry (execution-error); no phrase picking.
  - Nonce masking test for differing length/alphabet nonces (tracer-bullet.test.ts "nonce masking").
  - doc/TESTING.md lists the four contracts.
- Files changed: test/integration/{agent-option,agent-parity,execution-error,help,tracer-bullet}.test.ts, test/integration/support/helpers.ts, doc/TESTING.md, specs/integration-test-harness.plan.json, this file.
- Verification:
  - `grep -rn "src/" test/integration | grep import` -> none.
  - `pnpm check` passed (24 files, 275 tests, typecheck, lint, prettier); `git diff --stat src/` empty.
- Learnings: see Project discovery.
- Scope deviations: doc/ARCHITECTURE.md was already failing prettier --check at HEAD (blocking pnpm check); formatted it only (separate commit).
- Follow up needed: none.
---

## 2026-11-04 (TASK-002)
- Task id: TASK-002
- What was implemented:
  - agent-parity.test.ts: each shared scenario now asserts `stderr` equals a literal transcript (`asStderr(lines)`) and `stdout` is empty, for codex and claude. Transcripts were captured from the current build's output (temporary dump test, deleted), including full protocol-violation reason, stderr-tail lines, retry lines and task-failure line.
  - Added "launch failure" scenario per agent (empty PATH): asserts exit 3, zero invocations, 4 lines: iteration line, execution-error prefix, retry line, execution-error prefix; OS error text not asserted. Excluded from the cross-agent byte-identical comparison (it is its own describe; error text names the executable).
- Files changed: test/integration/agent-parity.test.ts, specs/integration-test-harness.plan.json, this file.
- Verification:
  - `pnpm check` passed (tests, typecheck, lint, prettier); `git diff --stat src/` empty.
  - Mutation experiments (uncommitted, reverted with git checkout src, dist rebuilt): "Task failure"->"Task failed" in src/cli.ts: 2 parity tests failed; retry line reworded: 10 failed; "Run complete: feature complete!" in reporter.ts: 8 failed. Exact string equality on the whole transcript also pins order and line count. Parity back to 35 passed after revert.
- Learnings for future iterations:
  - Launch failure: run with PATH set to an empty dir (afk is spawned via process.execPath so node still works).
  - All 11 shared scenarios print byte-identical stderr for codex and claude.
- Scope deviations: none. Review subagent skipped: test-only change verified by mutation experiments.
- Follow up needed: none.
---

## 2026-11-04 (TASK-003)
- Task id: TASK-003
- What was implemented:
  - agent-parity.test.ts: 8 new shared scenarios (run for codex and claude, and in the cross-agent identical comparison), each with an exact literal stderr transcript, empty stdout, exit code and session count:
    - retry allowance resets after a valid repeat (4 sessions, exit 0);
    - a valid fail is not an execution error (4 sessions, exit 0);
    - `--max-iterations 1` with execution error / repeat / fail (exit 4), complete (exit 0), blocked (exit 1), one session each;
    - default iteration limit: always repeat -> 10 sessions, exit 4, iteration lines 1/10..10/10.
  - Transcripts were captured from the current build with a temporary dump test (deleted); they match the spec's AC-008..AC-011 expectations, so no findings.
- Files changed: test/integration/agent-parity.test.ts, specs/integration-test-harness.plan.json, this file.
- Verification:
  - `pnpm check` passed (24 files, 301 tests, typecheck, lint, prettier); `git diff --stat src/` empty.
  - Criteria: every bullet maps to a scenario above; all assert full stderr via `asStderr`.
- Learnings: an execution error on the last allowed iteration prints the execution-error line (plus tail) then the iteration-limit line; no retry line.
- Scope deviations: none. Review subagent skipped: test-only data additions verified against current build output.
- Follow up needed: none.
---
