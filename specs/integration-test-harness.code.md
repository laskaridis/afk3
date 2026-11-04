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

## 2026-11-04 (TASK-004)
- Task id: TASK-004
- What was implemented:
  - Shared fake agent (fake-codex.mjs, used by fake-claude.mjs) gained: `{{NONCE}}` substitution in `stdout`/`finalMessage`/`rawFinalMessage` text, and a `killSelf: <signal>` step. Both documented in the fixture header; `killSelf` added to the `Step` type in helpers.ts.
  - New test/integration/final-response.test.ts, per agent: 25 invalid-response cases (AC-012, exact reason text, 2 sessions, exit 3, full stderr; nonce in the "no block" reason read from each session's prompt); 10 valid-response cases (AC-013 surrounding text, other-nonce blocks before/after, last-of-two wins in both orders; AC-014 with/without task_id/task_plan_file, blocked with both null); Codex-only stdout-only block -> missing final response (AC-015); SIGKILL/SIGABRT self-kill -> signal execution error + retry, and recovery (AC-016).
- Files changed: test/integration/fixtures/fake-codex.mjs, test/integration/support/helpers.ts, test/integration/final-response.test.ts, specs/integration-test-harness.plan.json, this file.
- Verification: `pnpm check` passed (25 files, 378 tests, typecheck, lint, prettier); `git diff --stat src/` empty. Reason texts confirmed against the current build's runs.
- Learnings: the nonce differs per session (also per retry), so expected "no block" reasons must use each invocation's own nonce. Perl multi-line header edits via regex are error-prone; rewrite headers wholesale.
- Scope deviations: none. Review subagent skipped: test-only change.
- Follow up needed: none.
---

## 2026-11-04 (TASK-005)
- Task id: TASK-005
- What was implemented:
  - New test/integration/termination.test.ts, per agent (codex, claude): timeout with a signal-ignoring agent (signals exactly SIGINT,SIGTERM; pid gone; exit 5; one session; exact stderr "Run stopped: agent session timed out after 1 seconds"); agent stderr absent after SIGINT interruption; stderr tail follows the execution-error line for non-zero exit, missing final response and invalid final response; SIGTERM and SIGHUP sent to afk -> interrupted line, exit 130, one session, agent pid gone.
- Files changed: test/integration/termination.test.ts, specs/integration-test-harness.plan.json, this file.
- Verification: `pnpm check` passed; `git diff --stat src/` empty. Timeout wording taken from the build's actual output after a first failing run.
- Learnings: a timeout prints "[afk] Run stopped: ..." (not an execution error line) and no retry.
- Scope deviations: none. Review subagent skipped: test-only change.
- Follow up needed: none.
---

## 2026-11-04 (TASK-006)
- Task id: TASK-006
- What was implemented:
  - New test/integration/launch-boundaries.test.ts:
    - per agent, positional prompt and `--prompt-file` with non-blank piped stdin: session prompt equals `expectedSessionPrompt(launch prompt)` and never contains the stdin data (AC-021);
    - per agent, same sources with a stdin pipe that is never closed still launch and complete (AC-021);
    - Claude: no `--model`/`--effort` without overrides (AC-022); no bypassPermissions, `--dangerously-skip-permissions`, `--resume`, `--continue`, `--fork-session` (or `-r`/`-c`) on first session and retry (AC-023);
    - per agent and stop reason (complete, blocked, execution error, iteration limit, timeout, interruption): workspace, HOME and TMPDIR snapshots (kind, size, mtime, content) unchanged, with pre-existing progress.txt and specs/ content (AC-024).
  - helpers.ts: `snapshotTree(dir)` and `keepStdinOpen` option on `startAfk`.
- Files changed: test/integration/launch-boundaries.test.ts, test/integration/support/helpers.ts, specs/integration-test-harness.plan.json, this file.
- Verification: `pnpm check` passed (27 files, 414 tests, typecheck, lint, prettier); `git diff --stat src/` empty. No mutation experiment was run for the snapshot assertion.
- Learnings: TMPDIR/HOME are redirected to sandbox dirs via env so the per-session temp dir (created under os.tmpdir()) is observed. `python3` is not usable in this repo (asdf, no version) — use perl/Edit.
- Scope deviations: none. Review subagent skipped: test-only change.
- Follow up needed: none.
---
