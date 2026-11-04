## Project discovery
- Agents live in `src/agents/`: `adapter.ts` (AgentAdapter + AgentInput/FinalMessageResult), `codex.ts`, `claude.ts`, `registry.ts` (AgentRegistry: `get`, `names`, `defaultName`). Outside the package import only `adapter.js` and `registry.js`.
- Adapters are classes; spreading an instance drops prototype methods, so tests that override members build a plain-object view (see `test/unit/session.test.ts`).
- No python in this environment; use node scripts for scripted edits. `sed -i` needs `''` on macOS.
- Sessions live in `src/session/`: `session-result.ts` (7-kind union), `session-executor.ts` (`SessionExecutor`, `STDERR_TAIL_LINES`, `DEFAULT_TERMINATION_GRACE_MS`), `session-executor-factory.ts`. Failure kinds carry `detail`; all but launch-failed/timed-out/interrupted carry `stderrTail`. Runner only maps kinds to error kinds and parses result blocks.
- Verify each task with `pnpm check`, `pnpm test:coverage` and `git diff 3f42e29 -- test/integration src/code.md` (must be empty).
- Workflow lives in `src/workflow/`: `workflow-step.ts` (WorkflowStep, WorkflowStepOptions), `workflow-step-result.ts` (type discriminator: Continue/Finished/StepFailed/Blocked/SessionFailed/Timeout/Interrupted; task_id/task_plan_file carried as parsed), `coding-step.ts` (nonce, prompt, `../code.md`), `result-block.ts` (parser). `runner.ts` takes a `StepRunner` and maps step results to `RunResult` (no errorKind any more).
---

## 2026-11-04
- Task id: TASK-001
- What was implemented:
  - `agents/types.ts` renamed to `agents/adapter.ts` (interface + input/result types).
  - `CodexAdapter` and `ClaudeAdapter` classes (behavior and arguments unchanged); `AgentRegistry` class replaces `agents`/`agentNames`/`DEFAULT_AGENT`.
  - `src/cli.ts` derives help text, `--agent` validation and the default from `AgentRegistry`; `session.ts`/`runner.ts` import `agents/adapter.js`.
  - Tests: new `registry.test.ts`; codex/claude tests pin exact args for every model x effort combination (plus outputFile for codex) and all extraction cases.
- Files changed: src/agents/{adapter,codex,claude,registry}.ts, src/{cli,session,runner}.ts, test/unit/agents/{registry,codex,claude}.test.ts, test/unit/{agent-neutral-docs,session,runner}.test.ts, specs/refactor-architecture.plan.json, this file.
- Verification:
  - `pnpm check` exit 0 (427 tests pass, typecheck, lint, prettier).
  - `pnpm test:coverage` exit 0, 100% statements/branches/functions/lines, no files with missing coverage.
  - `git diff 3f42e29 -- test/integration src/code.md` prints nothing.
  - `ls src/agents` shows adapter.ts, claude.ts, codex.ts, registry.ts (no types.ts); grep shows outside importers only use `agents/registry.js` and `agents/adapter.js`.
  - Criteria: registry order/default pinned in test/unit/agents/registry.test.ts; each adapter has own test file.
- Learnings for future iterations: see Project discovery.
- Scope deviations: test/unit/session.test.ts and test/unit/runner.test.ts edited only to build a plain-object codex adapter (needed because adapters are now classes); they are deleted in later tasks.
- Follow up needed: none.
---

## 2026-11-04 (TASK-002)
- Task id: TASK-002
- What was implemented:
  - `src/session/`: `SessionResult` (launch-failed, timed-out, interrupted, exited-unsuccessfully, missing-final-message, invalid-final-message, success), `SessionExecutor` (spawn/stdin/stdout/20-line stderr tail/temp output file/SIGINT-SIGTERM-SIGKILL escalation/classification in order signal, agent error, non-zero exit, invalid, missing), `SessionExecutorFactory` (signal, timeout seconds, grace ms shared by every created executor).
  - `src/session.ts` deleted. `runner.ts` now consumes the new `SessionResult` (maps kinds to its error kinds, still parses result blocks until TASK-003) and no longer takes an adapter; `cli.ts` creates the executor from the factory.
  - Tests: `test/unit/session/{session-executor,session-executor-factory}.test.ts` (old session.test.ts moved + classification cases from runner.test.ts); `runner.test.ts` and `cli.test.ts` adapted.
- Files changed: src/session/{session-result,session-executor,session-executor-factory}.ts, src/session.ts (deleted), src/runner.ts, src/cli.ts, test/unit/session/*.test.ts, test/unit/session.test.ts (moved), test/unit/{runner,cli}.test.ts, specs/refactor-architecture.plan.json, this file.
- Verification:
  - `pnpm check` exit 0; `pnpm test:coverage` exit 0, 100% on all of src/ (439 tests).
  - `git diff 3f42e29 -- test/integration src/code.md` prints nothing.
  - `grep -rniE "codex|claude|--output|--approve|permission-mode" src/session` prints nothing; src/session imports only agents/adapter.js.
  - Detail texts kept verbatim; precedence cases pinned in session-executor.test.ts "result classification"; old session.test.ts cases kept (moved) and runner classify cases moved to the executor tests (signal, agent error 0/non-zero, invalid, missing) and runner mapping tests.
  - Plan statuses: TASK-001 (completed in previous commit but left "pending") and TASK-002 set to completed.
- Learnings for future iterations: `runner.ts` still holds the result-block half of classification until TASK-003; mapped via `classify` on `session.kind`.
- Scope deviations: cli.test.ts mocks the factory class instead of `runSession`; plan.json TASK-001 status corrected.
- Follow up needed: none.
---

## 2026-11-04 (TASK-003)
- Task id: TASK-003
- What was implemented:
  - `src/workflow/`: WorkflowStep interface, WorkflowStepOptions, WorkflowStepResult, CodingStep (fresh nonce per execute, byte-identical session prompt, maps every SessionResult/parsed block), result-block parser (moved from protocol.ts).
  - `src/protocol.ts` and `test/unit/protocol.test.ts` removed (moved via git mv). `runner.ts` runs one step per iteration via `StepRunner`; `cli.ts` builds a CodingStep from the executor and no longer builds prompts. `errorKind` dropped from RunResult execution-error (unused outside tests).
- Files changed: src/workflow/{workflow-step,workflow-step-result,coding-step,result-block}.ts, src/{runner,cli}.ts, src/protocol.ts (deleted), test/unit/workflow/{coding-step,result-block}.test.ts, test/unit/{runner,cli,reporter}.test.ts, test/unit/protocol.test.ts (deleted), plan.json, this file.
- Verification:
  - `pnpm check` exit 0; `pnpm test:coverage` exit 0 (445 tests), 100% on src/.
  - `git diff 3f42e29 -- test/integration src/code.md` empty; `cmp src/code.md dist/code.md` identical after build.
  - Mapping of old tests: protocol.test.ts parse cases -> test/unit/workflow/result-block.test.ts; buildSessionPrompt cases + runner nonce/classification cases (fresh nonce, other-nonce block, violation with stderr tail, empty message, each SessionResult kind) -> test/unit/workflow/coding-step.test.ts (details verbatim); runner policy cases stay in test/unit/runner.test.ts (until TASK-004).
  - src/workflow imports only session/session-executor(.js, type) and its own modules; no agents import.
- Learnings for future iterations: runner tests now script WorkflowStepResult values instead of session results.
- Scope deviations: removed `errorKind`/ExecutionErrorKind from runner RunResult and edited reporter.test.ts/cli.test.ts accordingly. No subagent review run.
- Follow up needed: none.
---
