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

## 2026-11-13 (TASK-003)
- Task id: TASK-003
- What was implemented:
  - `parseResultBlock` now validates the coding vocabulary only (task_implemented with optional revision, no_more_tasks, blocked); task_id/task_plan_file required, null rules enforced; findings_file/revision-elsewhere rejected as unsupported fields.
  - Step results `TaskImplemented` (carries revision) and `NoMoreTasks` replace Continue/Finished; StepFailed, its handler, the StepExecutionFailed event and the "Task failure" line are removed. no_more_tasks ends the run via WorkflowFinished, printed as "Run complete: no more tasks". Interim: TaskImplemented continues to the next coding session.
  - coding-step.md rewritten for the new vocabulary, candidate commits, progress entry per candidate, harness-supplied (correction) assignment, no delegated review.
- Files changed:
  - src/workflow/{result-block,workflow-event,workflow-executor,workflow-step-result}.ts, src/workflow/steps/{coding-step.ts,coding-step.md}, src/workflow/step-handlers/* (renamed continue->task-implemented, finished->no-more-tasks, failed handler deleted), src/reporting/console-reporter.ts
  - tests: unit result-block, coding-step, step-handlers, executor, reporter, cli; all integration suites migrated to the new vocabulary
  - specs/add-verification-stage.plan.json, specs/add-verification-stage.code.md
- Verification:
  - `pnpm check` passes (533 tests, typecheck, lint, prettier, depcheck).
  - Criteria: parser vocabulary/null/revision/findings_file rules covered by unit + integration (final-response) tests; violations follow the one-retry policy (integration "execution error twice"); no_more_tasks incl. last iteration (unit + integration); blocked unchanged; coding-step.md content pinned by unit tests; failure line/result removed (grep of src/ clean).
  - Delegated read-only review: no findings.
- Learnings for future iterations:
  - Integration tests use `{"outcome":"no_more_tasks","task_id":null,"task_plan_file":"p.json"}` as the "run ends" block and task_implemented with T-1 as "continue".
  - TASK-004 must add the verification vocabulary to the parser (phase-aware) and a feature-complete wording for workflow_finished; WorkflowFinished currently prints "no more tasks".
- Scope deviations:
  - None beyond migrating existing tests to the new contract (required by the spec).
- Follow up needed: none
---

## 2026-11-13 (TASK-004)
- Task id: TASK-004
- What was implemented:
  - Phase-aware `parseResultBlock(text, nonce, phase)` with coding and verification vocabularies (`findings_file`/`failure_summary` rules, null-id rules per phase).
  - `VerificationStep` plus shared `executeStepSession` (`steps/step-session.ts`); `CodingStep` takes an optional `CorrectionAssignment`. Both reject a block naming another task than the assigned one (blocked with null id exempt).
  - New step results `VerificationPassed`, `FeatureVerified`, `VerificationFailed` with handlers; context gained `requestCorrection`. New events `VerificationPassed`, `VerificationFailed`, terminal `WorkflowCompleted` ("Run complete: feature complete", exit 0). The start line moved from `IterationStarted` to `StepExecutionStarted` (now `limit`, `retry`).
  - `WorkflowExecutor`: verification runs inside the coding iteration with its own inner retry loop (shared consecutive-error budget), per-run attempt counter (reset when a different task id is observed), correction assignment carried to the next iteration (and across coding retries). Interim: rejection always starts a correction (TASK-005); verification uses `--model`/`--reasoning-effort` (TASK-006).
- Files changed:
  - src/workflow/{result-block,assignment,workflow-event,workflow-executor,workflow-step-result}.ts, src/workflow/steps/{coding-step,verification-step,step-session}.ts, src/workflow/step-handlers/* (3 new, context, registry), src/reporting/console-reporter.ts, src/cli/cli-exit-codes.ts
  - tests: unit (result-block, steps, handlers, executor, reporter), integration (new verification-stage.test.ts; helpers `reply/IMPLEMENTED/PASSED/REJECTED/rounds/expectedVerificationPrompt/expectedCorrectionPrompt`; eight suites migrated to two-phase scripts)
  - specs/add-verification-stage.plan.json, specs/add-verification-stage.code.md
- Verification:
  - `pnpm check` passes (641 tests, typecheck, lint, prettier, depcheck); `pnpm test:coverage` 100% statements/branches/functions/lines before the last small change.
  - Criteria: per-agent integration tests assert exact verification and correction prompts, stderr lines, exit codes and session order; unit tests cover steps, handlers, policy (iteration accounting, last-iteration outcomes, retry sharing, attempt counting/reset, assignment mismatch).
  - Delegated read-only review: no defects; one low observation (counter reset only on rejection) was fixed and tested.
- Learnings for future iterations:
  - Fake-agent `sessions` repeat the last list, so loops that iterate need `rounds(coding, verification, n)` and the invocation index continues across runs in one environment.
  - A `no_more_tasks` answer in a correction iteration is invalid (assigned task id mismatch).
- Scope deviations:
  - AC-002's prose says the verification prompt starts with the launch prompt but its example omits it (design says assignment alone); implemented the prose, which TASK-004's criteria also state.
- Follow up needed: none
---

## 2026-11-13 (TASK-005)
- Task id: TASK-005
- What was implemented:
  - New terminal event `VerificationLimitReached` ({limit, taskId}); `requestCorrection` in `WorkflowExecutor` ends the run with it instead of scheduling a correction once the per-task rejection count reaches `--max-verification-attempts`. The `Verification failed (attempt k/n)` line is still printed first.
  - Exit code 6 (`verificationLimit`, "verification rejected the same task too many times") in `cli-exit-codes.ts`, listed in `--help`; reporter line `Run stopped: verification limit of <n> reached for <task id>`.
  - Precedence over the iteration limit is natural: the pending terminal event is returned before `MaxIterationsReached`.
- Files changed:
  - src/workflow/{workflow-event,workflow-executor}.ts, src/reporting/console-reporter.ts, src/cli/cli-exit-codes.ts
  - tests: unit (executor, reporter, exit codes), integration (verification-stage, help)
  - specs/add-verification-stage.plan.json, specs/add-verification-stage.code.md
- Verification:
  - `pnpm check` passes (654 tests, typecheck, lint, prettier, depcheck).
  - Criteria: default and configured limit stop with exit 6, no correction session (integration, per agent; unit); help lists 6 and 0-5/130 unchanged (help + exit-code tests); both limits at once -> 6 (unit + integration); workspace directory listing unchanged (integration); counter remains in memory only.
- Learnings for future iterations:
  - With the default limit of 2, scripts that reject a task twice now end the run; use `--max-verification-attempts` in tests needing more rejections.
- Scope deviations:
  - None. Delegated review skipped: small policy change fully covered by tests.
- Follow up needed: none
---

## 2026-11-13 (TASK-006)
- Task id: TASK-006
- What was implemented:
  - Verification sessions now run with `verifyModel ?? model` and `verifyEffort ?? effort` (resolved independently per field); coding sessions are untouched. Values are passed through unchanged; both phases use the one adapter.
- Files changed:
  - src/workflow/workflow-executor.ts
  - test/unit/workflow/workflow-executor.test.ts, test/integration/verification-model-overrides.test.ts (new)
  - specs/add-verification-stage.plan.json, specs/add-verification-stage.code.md
- Verification:
  - `pnpm check` passes (tests, typecheck, lint, prettier, depcheck).
  - Criteria: unit tests cover override, per-field fallback and no-override resolution; the integration test asserts the argv each of the three sessions receives for all 16 combinations of the four options, for codex and claude; both phases launched via the single `--agent` adapter (parity of invocation count/agent in those runs).
- Learnings for future iterations:
  - Fake-agent argv assertions: codex uses `--model`/`--config model_reasoning_effort="x"`, claude uses `--model`/`--effort`.
- Scope deviations:
  - None. Delegated review skipped: one-line policy change fully covered by tests.
- Follow up needed: none
---

## 2026-11-13 (TASK-007)
- Task id: TASK-007
- What was implemented:
  - Documentation brought in line with the two-phase loop: README (options table, loop description, exit code 6 via help), doc/PRODUCT.md (new domain terms, redefined iteration/session prompt/outcome, per-phase run policy, verification limit, null-id rules, exit code 6), doc/ARCHITECTURE.md (two-phase flow, VerificationStep, new handlers/step results/events, findings-file note replaced), AGENTS.md (map + must-knows), doc/WORKFLOW.md (`.verify.md`), doc/TESTING.md (scripting two-phase sessions, expected prompt helpers), doc/PUBLISH.md (package contents).
- Files changed:
  - README.md, AGENTS.md, doc/{PRODUCT,ARCHITECTURE,WORKFLOW,TESTING,PUBLISH}.md, specs/add-verification-stage.plan.json, specs/add-verification-stage.code.md
- Verification:
  - `pnpm check` passes (tests, typecheck, lint, prettier, depcheck).
  - Statements checked against code: event/handler/step-result names from src/workflow, exit code 6 and wording from cli-exit-codes.ts and console-reporter.ts, helper names from test/integration/support/helpers.ts.
- Learnings for future iterations:
  - `python3` needs `ASDF_PYTHON_VERSION=3.13.5` in this repo; `pnpm format` reflows doc tables.
- Scope deviations: removed the stale `StepExecutionFailed` entry from the ARCHITECTURE event list (no such event exists in code).
- Follow up needed: none
---
