# Conventions

## Language and formatting

- TypeScript `strict` + `noUncheckedIndexedAccess`, `module`/`moduleResolution: NodeNext`, ESM (`"type": "module"`).
  Relative imports end in `.js`; node built-ins use the `node:` prefix; type-only imports use `import type`.
- ESLint flat config (`@eslint/js` + `typescript-eslint` recommended + prettier). Prettier: width 120, double quotes,
  semicolons, trailing commas. Prettier also checks Markdown (`README.md`, `AGENTS.md`, `CLAUDE.md`, `doc/`), but ignores `specs/` and
  `src/workflow/steps/coding-step.md`.

## Code style

- Small, focused modules with named exports. No default exports.
- Model results as discriminated unions (`kind: "…"`, or shape-discriminated like `{ message } | { missing: true }`)
  and narrow with `"key" in value` / `switch`. Exhaustive `switch` with no `default`.
- Errors that are expected are returned as values (`{ ok: false, message }`, `{ violation }`), not thrown. Option
  parsers throw commander's `InvalidArgumentError` (→ exit 2).
- Use `!` only where the index is guaranteed (`agents[agent]!` after validation).
- Always document public API with a `/** */` doc comment: every exported class, interface, type, function and constant,
  and every public method, constructor and property of an exported class or interface, and anything else a module
  exposes to other modules. State what it is for and the contract callers rely on (what it returns, when, what it
  guarantees or does not, ordering, mutation, errors), and use `@param` where a parameter is not self-explanatory.
  Private members and module-local helpers need a doc comment only when their purpose isn't obvious.
- Inline comments are sparse and explain _why_ (a constraint, an external CLI quirk) as one-line `//`. Don't narrate the
  code.
- Constants in `UPPER_SNAKE_CASE` (`DEFAULT_MAX_ITERATIONS`, `EXIT_CODES`); camelCase elsewhere. Protocol JSON fields
  keep their wire names (`blocker_text`, `failure_summary`).
- Status lines go to stderr as `[afk] <Label>: <detail>`, where the detail is a lowercase, agent-neutral fragment
  (e.g. `[afk] Execution error: agent exited without a final response`). The label is capitalised, except for input
  errors, which use the lowercase `[afk] input error: <detail>`.

## Commits

- Imperative, sentence-case subject, no prefix/conventional-commit tags (e.g. "Add Claude Code adapter and classify its
  structured errors"). Older AFK-loop commits end with the task id, e.g. "(TASK-004)".
- One task per commit; only the files that task touched plus its bookkeeping (`specs/*.plan.json`, `specs/*.code.md`).
- Work on a feature branch and open a PR to `main`; CI (`.github/workflows/ci.yml`) runs `pnpm check`.
