# Testing

Vitest, `test/**/*.test.ts` (`vitest.config.ts`). `pnpm test` runs `pnpm run build` first because integration
tests spawn `dist/cli.js` — running `vitest` directly against stale `dist/` gives misleading results.

## Commands and layout

- `pnpm test:unit`: run unit tests without building the CLI.
- `pnpm test:integration`: build the CLI, then run integration tests.
- `pnpm test`: build once, then run both suites; CI runs this through `pnpm check`.

Integration helpers live in `test/integration/support/`; fake-agent fixtures live in `test/integration/fixtures/`.
These support files are used only by integration tests and are not test suites.
Keep each test file in the directory matching its execution boundary; split mixed files rather than
putting subprocess tests into the unit suite. To run one test file, use `pnpm vitest run test/unit/<file>.test.ts`
or `pnpm build && pnpm vitest run test/integration/<file>.test.ts`.

## Two kinds of tests

**Unit** (`test/unit/`) — call source functions directly, without launching the CLI. Static documentation checks also live here.

- `runner.test.ts`: drives `runAfk` with a scripted `SessionRunner`; `reply(message)` builds a result block from the
  nonce the runner passes in.
- `protocol.test.ts`, `prompt.test.ts`, `test/unit/agents/<name>.test.ts`: pure functions, table-driven with `it.each`.

**Integration** (`test/integration/`) — run the built CLI against a fake agent on `PATH`, no real agent needed:

```ts
const fake = createFakeCodexEnvironment([{ finalMessage: '{"outcome":"complete"}' }, { exit: 0 }]); // or (steps, "claude")
const run = await startAfk({ args: ["build X"], cwd: fake.workspace, env: fake.env }).done;
expect(run.exitCode).toBe(0);
fake.soleInvocation(); // { argv, cwd, stdin, pid, files }
```

- `createFakeCodexEnvironment(steps | { sessions: Step[][] }, agent = "codex")` makes a temp sandbox, symlinks
  `test/integration/fixtures/fake-<agent>.mjs` into a `bin/` first on `PATH`, and returns `workspace`, `env`, `invocations()`,
  `soleInvocation()`, `signals()`.
- Despite the names, `createFakeCodexEnvironment`, `FAKE_CODEX_*` and `fake-codex.mjs` serve every agent. Reuse
  them; don't add per-agent copies.
- `{ sessions: [...] }` scripts one step list per invocation; the last list repeats.
- Steps (`Step` in `helpers.ts`, documented at the top of `fake-codex.mjs`): `stdout`, `stderr`, `sleepMs`,
  `finalMessage` (wrapped in the result block using the nonce found in stdin), `rawFinalMessage` (unwrapped, for
  violations), `json`, `writeFile`, `ignoreSignals`, `exit`.
- `fake-claude.mjs` sets `FAKE_AGENT_FORMAT=claude` and reuses `fake-codex.mjs`; `finalMessage` then emits Claude's JSON
  result on stdout instead of writing the `--output-last-message` file.
- For timeout/interrupt tests pass `AFK_TERMINATION_GRACE_MS` (e.g. `"300"`) in `env` to keep them fast.
- `withoutNonce(prompt)` masks the nonce when comparing prompts across sessions.

## Conventions

- Behavior that must be identical across agents goes in `agent-parity.test.ts`, which runs every scenario for each
  name in `agentNames()` and also asserts byte-identical stderr/exit codes across agents.
- Assert on exact `[afk]` wording, exit codes, and that `run.stdout` is `""`.
- Help text and README content are asserted (`help.test.ts`, `agent-neutral-docs.test.ts`); update them together.
- Test files are named after the behavior (`session-timeout`, `stderr-tail`), not the module, except unit tests.
- Write the test first (the AFK loop uses the `tdd` skill: red → green → refactor).

## Coverage

Run `pnpm test:coverage` to build the CLI and run the suite with Vitest's V8 coverage provider.
It prints a coverage table and writes an HTML report (`coverage/index.html`), LCOV (`coverage/lcov.info`),
and JSON totals (`coverage/coverage-summary.json`). Reports include all `src/**/*.ts` files, including untested files;
tests, fixtures, and generated output are excluded. No minimum coverage thresholds are enforced.

CI collects coverage on Node 24 for pull requests, pushes to `main`, and manual runs. Open the workflow run's
**Summary** for line, statement, function, and branch percentages. Download the **coverage-report** artifact and
open `index.html` to inspect individual files. Reports are retained for 14 days and are also produced when tests fail.

The report measures code executed inside Vitest. Integration tests spawn `dist/cli.js` in separate processes,
whose execution is not captured by this provider. Files exercised only by those subprocesses can therefore show
zero coverage; this report is not a complete measure of integration-test coverage.
