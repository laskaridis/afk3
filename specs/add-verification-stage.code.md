## Project discovery
- Bundled agent instructions live in `src/workflow/steps/*.md`, are copied to `dist/` by `scripts/dist-prepare.mjs`, and must be listed in `.prettierignore`.
- `pnpm install --frozen-lockfile` is needed in a fresh worktree before `pnpm depcheck` (depcruise) works.
---

## 2026-11-13
- Task id: TASK-001
- What was implemented:
  - Added `src/workflow/steps/verification-step.md`: placeholder body stating the verification contract (outcome vocabulary, required fields, limited-write rules, findings-file naming, `{{NONCE}}` example block).
  - `scripts/dist-prepare.mjs` now copies both step files to `dist/workflow/steps/`.
  - Excluded the new file from prettier.
- Files changed:
  - src/workflow/steps/verification-step.md (new), scripts/dist-prepare.mjs, .prettierignore
  - test/integration/bundled-instructions.test.ts (new)
  - specs/add-verification-stage.plan.json (status), specs/add-verification-stage.code.md (new)
- Verification:
  - RED: new test failed before the file existed (ENOENT on source).
  - `pnpm check` passes: 489 tests, typecheck, lint, prettier --check, depcheck (after `pnpm install --frozen-lockfile`).
  - Criteria: file exists with contract (test asserts each outcome/field/file-naming term); nonce block asserted for both step files; dist copy compared byte-for-byte; prettier check passes; pnpm check passes.
- Learnings for future iterations:
  - Test for bundling lives in test/integration since it reads `dist/`.
- Scope deviations:
  - None. A delegated review was skipped: the change is a static file plus a build copy loop.
- Follow up needed: none
---
