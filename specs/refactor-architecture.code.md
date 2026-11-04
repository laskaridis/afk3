## Project discovery
- Agents live in `src/agents/`: `adapter.ts` (AgentAdapter + AgentInput/FinalMessageResult), `codex.ts`, `claude.ts`, `registry.ts` (AgentRegistry: `get`, `names`, `defaultName`). Outside the package import only `adapter.js` and `registry.js`.
- Adapters are classes; spreading an instance drops prototype methods, so tests that override members build a plain-object view (see `test/unit/session.test.ts`).
- No python in this environment; use node scripts for scripted edits. `sed -i` needs `''` on macOS.
- Verify each task with `pnpm check`, `pnpm test:coverage` and `git diff 3f42e29 -- test/integration src/code.md` (must be empty).
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
