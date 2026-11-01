# Conventions

## Language and formatting

- TypeScript `strict` + `noUncheckedIndexedAccess`, `module`/`moduleResolution: NodeNext`, ESM (`"type": "module"`).
  Relative imports end in `.js`; node built-ins use the `node:` prefix; type-only imports use `import type`.
- ESLint flat config (`@eslint/js` + `typescript-eslint` recommended + prettier). Prettier: width 120, double quotes,
  semicolons, trailing commas. Prettier also checks Markdown (`README.md`, `AGENTS.md`, `CLAUDE.md`, `doc/`), but ignores `specs/` and
  `src/code.md`.

## Code style

- Small, flat modules with named exports; no classes except tiny private helpers (`TailBuffer`). No default exports.
- Model results as discriminated unions (`kind: "…"`, or shape-discriminated like `{ message } | { missing: true }`)
  and narrow with `"key" in value` / `switch`. Exhaustive `switch` with no `default`.
- Errors that are expected are returned as values (`{ ok: false, message }`, `{ violation }`), not thrown. Option
  parsers throw commander's `InvalidArgumentError` (→ exit 2).
- Use `!` only where the index is guaranteed (`agents[agent]!` after validation).
- Comments are sparse and explain _why_ (a constraint, an external CLI quirk), as one-line `//` or a short `/** */` on
  exported items. Don't narrate the code.
- Constants in `UPPER_SNAKE_CASE` (`DEFAULT_MAX_ITERATIONS`, `EXIT_CODES`); camelCase elsewhere. Protocol JSON fields
  keep their wire names (`blocker_text`, `failure_summary`).
- Status lines go to stderr as `[afk] <Label>: <detail>`, where the detail is a lowercase, agent-neutral fragment
  (e.g. `[afk] Execution error: agent exited without a final response`). The label is capitalised, except for input
  errors, which use the lowercase `[afk] input error: <detail>`.

## Commits

- Imperative, sentence-case subject, no prefix/conventional-commit tags (e.g. "Add Claude Code adapter and classify its
  structured errors"). Older AFK-loop commits end with the task id, e.g. "(TASK-004)".
- One task per commit; only the files that task touched plus its bookkeeping (`specs/*.plan.json`, `progress.txt`).
- Work on a feature branch and open a PR to `main`; CI (`.github/workflows/ci.yml`) runs `pnpm check`.
