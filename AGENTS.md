# AGENTS.md

`afk` is a small TypeScript CLI (ESM, Node >= 20) that runs a coding agent (Codex or Claude Code) in a loop of fresh,
non-interactive sessions until the agent reports the feature `complete`, `blocked`, or a limit is hit. The harness only
launches sessions and interprets each session's final response; the agent's `code` skill owns the development workflow.

## Commands

```
pnpm install --frozen-lockfile
pnpm test     # builds dist/ first, then vitest (integration tests run dist/cli.js)
pnpm check    # test + typecheck + lint + prettier --check — what CI runs; must pass before committing
pnpm format   # prettier --write .
pnpm build && pnpm vitest run test/<file>.test.ts   # one file; rebuild first or you test a stale dist/
```

## Map

| Path              | What lives there                                                                   |
| ----------------- | ---------------------------------------------------------------------------------- |
| `README.md`       | User-facing usage, options, supported agents and how each is launched              |
| `src/cli.ts`      | Entry point: options (commander), wiring, signals, exit code                       |
| `src/runner.ts`   | Run loop policy: iterations, retry-once, outcome handling, error classification    |
| `src/session.ts`  | Spawns one agent process; stdin prompt, stdout capture, stderr tail, timeout/abort |
| `src/protocol.ts` | Session prompt assembly and final-response parser (nonce result block)             |
| `src/harness.md`  | Instructions appended to every session prompt — a contract with the agent          |
| `src/agents/`     | One adapter per agent + `registry.ts`                                              |
| `src/reporter.ts` | Exit codes, `[afk]` status wording                                                 |
| `src/prompt.ts`   | Resolves the single launch prompt (arg / `--prompt-file` / stdin)                  |
| `test/`           | Vitest suites; `test/fixtures/fake-*.mjs` fake agents; `test/helpers.ts`           |
| `specs/`          | Feature specs, designs, plans, progress logs; finished features in `specs/_done/`  |

## Read before you change…

- anything — [doc/CONVENTIONS.md](doc/CONVENTIONS.md) (style, idioms, commits)
- behavior, wording, exit codes — [doc/PRODUCT.md](doc/PRODUCT.md) (behavior contract and domain language)
- module boundaries, adding an agent or a CLI option — [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md)
- tests — [doc/TESTING.md](doc/TESTING.md) (fake agents, helpers, parity suite)
- agent launch flags, permissions, files on disk — [doc/SECURITY.md](doc/SECURITY.md)
- specs, plans, progress logs — [doc/WORKFLOW.md](doc/WORKFLOW.md)

## Must-knows

- The code is the source of truth. Specs and progress logs in `specs/_done/` are historical and partly superseded
  (e.g. Codex's final message is read from `--output-last-message`, not stdout).
- `src/harness.md` is copied to `dist/` by the build script and is excluded from prettier. Its example block
  `<afk-harness-result nonce="{{NONCE}}">` is load-bearing: the fake agents read the session nonce from it, so changing
  or removing it breaks every integration test.
- Keep the runner, session, and reporter agent-neutral: agent-specific knowledge belongs only in `src/agents/<name>.ts`.
- Never add a full-access / permission-bypass mode for any agent.
