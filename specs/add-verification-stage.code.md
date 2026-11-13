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

## 2026-11-13 (TASK-002)
- Task id: TASK-002
- What was implemented:
  - `--max-verification-attempts <count>` (default 2, positive integer), `--verify-model <name>`, `--verify-reasoning-effort <level>` (non-empty) in `src/cli/cli-options.ts`; the integer parser is shared with `--max-iterations` (`parsePositiveInteger`).
  - `WorkflowOptions` gained `maxVerificationAttempts`, `verifyModel`, `verifyEffort`; `DEFAULT_MAX_VERIFICATION_ATTEMPTS` lives next to `DEFAULT_MAX_ITERATIONS`; `cli.ts` wires them.
- Files changed:
  - src/cli/cli-options.ts, src/cli/cli.ts, src/workflow/workflow-options.ts, src/workflow/workflow-executor.ts
  - test/unit/cli/cli.test.ts, test/unit/workflow/workflow-executor.test.ts, test/integration/help.test.ts, test/integration/run-loop.test.ts, test/integration/agent-option.test.ts
  - specs/add-verification-stage.plan.json (status), specs/add-verification-stage.code.md
- Verification:
  - RED/GREEN: new unit/integration tests; `pnpm check` passes (503 tests, typecheck, lint, prettier, depcheck).
  - Criteria: three options in --help (help test); default 2 (unit + help); invalid values exit 2 with no launch (unit + integration, 0 invocations); values reach workflow options (unit constructor assertion); existing help assertions pass.
- Learnings for future iterations:
  - Adding wider option names re-wraps `--help`; help assertions must collapse whitespace (done for `default: codex`).
  - Python via asdf needs `ASDF_PYTHON_VERSION=3.13.5` in this repo.
- Scope deviations:
  - test/integration/agent-option.test.ts touched: its help assertion broke on re-wrapping. Delegated review skipped (small option-parsing change).
- Follow up needed: none
---
