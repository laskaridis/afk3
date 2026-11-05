# AGENTS.md

`afk` is a small TypeScript CLI (ESM, Node >= 22.13.0) that runs a coding agent (Codex or Claude Code) in a loop of fresh,
non-interactive sessions until the agent reports the feature `complete`, `blocked`, or a limit is hit. The harness only
launches sessions and interprets each session's final response; the agent's `code` skill owns the development workflow.

## Commands

```
pnpm install --frozen-lockfile
pnpm test:unit # unit tests, no build required
pnpm test:integration # build, then CLI integration tests
pnpm depcheck # architecture rules (layering, cycles)
pnpm test     # builds dist/ first, then vitest (integration tests run dist/cli.js)
pnpm check    # test + typecheck + lint + prettier --check + depcheck — what CI runs; must pass before committing
pnpm format   # prettier --write .
pnpm build && pnpm vitest run test/integration/<file>.test.ts   # one file; rebuild first or you test a stale dist/
```

## Map

| Path                         | What lives there                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `README.md`                  | User-facing usage, options, supported agents and how each is launched             |
| `src/cli.ts`                 | Thin entry point: shebang, runs the CLI, exits with its code                      |
| `src/cli/`                   | CLI: options (commander), launch prompt, wiring, signals, `EXIT_CODES`            |
| `src/workflow/`              | `WorkflowExecutor` (iteration policy, events), `CodingStep`, result-block parser  |
| `src/session/`               | `SessionExecutorFactory`, `SessionExecutor` (one agent process), `SessionResult`  |
| `src/agents/`                | `AgentAdapter`, one adapter per agent, `AgentRegistry`                            |
| `src/reporting/`             | `ConsoleReporter`: `[afk]` status lines from workflow events                      |
| `src/code.md`                | Instructions appended to every session prompt — a contract with the agent         |
| `test/unit/`                 | Unit tests for source functions and static documentation checks                   |
| `test/integration/`          | CLI integration tests that spawn `dist/cli.js` against fake agents                |
| `test/integration/support/`  | Helpers shared by CLI integration tests                                           |
| `test/integration/fixtures/` | Fake-agent executables used by integration tests                                  |
| `specs/`                     | Feature specs, designs, plans, progress logs; finished features in `specs/_done/` |

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
- `src/code.md` is copied to `dist/` by the build script and is excluded from prettier. Its example block
  `<afk-harness-result nonce="{{NONCE}}">` is load-bearing: the fake agents read the session nonce from it, so changing
  or removing it breaks every integration test.
- Keep `src/workflow/`, `src/session/`, `src/reporting/` and `src/cli/` agent-neutral (enforced by `pnpm depcheck`, see `.dependency-cruiser.cjs`): agent-specific knowledge belongs only in `src/agents/<name>.ts`.
- Never add a full-access / permission-bypass mode for any agent.
