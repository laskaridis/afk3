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
