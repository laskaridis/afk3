# Testing

Vitest, `test/**/*.test.ts` (`vitest.config.ts`). `pnpm test` runs `pnpm run build` first because integration
tests spawn `dist/cli.js` — running `vitest` directly against stale `dist/` gives misleading results.

## Commands and layout

- `pnpm test:unit`: run unit tests without building the CLI.
- `pnpm test:integration`: build the CLI, then run integration tests.
- `pnpm test`: build once, then run both suites; CI runs this through `pnpm check`.
- `pnpm depcheck`: dependency-cruiser architecture rules (layering, cycles, agent internals; rules in `.dependency-cruiser.cjs`), not vitest; part of `pnpm check`.

Integration helpers live in `test/integration/support/`; fake-agent fixtures live in `test/integration/fixtures/`.
These support files are used only by integration tests and are not test suites.
Keep each test file in the directory matching its execution boundary; split mixed files rather than
putting subprocess tests into the unit suite. To run one test file, use `pnpm vitest run test/unit/<file>.test.ts`
or `pnpm build && pnpm vitest run test/integration/<file>.test.ts`.

## Two kinds of tests

**Unit** (`test/unit/`) — call source functions directly, without launching the CLI. Static documentation checks also live here.

- `test/unit/workflow/workflow-executor.test.ts`: drives `WorkflowExecutor` with scripted steps and a recording observer; covers the run policy and the event sequence.
- `test/unit/workflow/coding-step.test.ts`: drives `CodingStep` with a stubbed `SessionExecutor`; `reply(message)` builds a result block from the nonce the step passes in the session prompt.
- `test/unit/workflow/result-block.test.ts`, `test/unit/cli/launch-prompt.test.ts`, `test/unit/agents/<name>.test.ts`: pure functions, table-driven with `it.each`.
- `test/unit/session/`, `test/unit/reporter/console-reporter.test.ts`, `test/unit/cli/`: session executor and factory, console output, option parsing, exit codes and entry point.

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
- `withoutNonce(prompt)` masks the nonce announced in the prompt's result-block example when comparing prompts across sessions.
- `expectedSessionPrompt(launchPrompt, recordedPrompt)` builds the exact prompt a session must receive from `dist/code.md`.

## Contracts the integration suite relies on

Beyond the public CLI (`dist/cli.js`, its arguments, environment, stdio, exit codes, and the files and processes it touches),
integration tests depend on these contracts. Tests import nothing from `src/`; agent names, the default agent, and exit
codes are literal values. If a refactoring changes one of these, update the suite in the same change.

- `AFK_TERMINATION_GRACE_MS`: environment variable that shortens the SIGINT-to-SIGTERM grace period in termination scenarios.
- `dist/code.md`: the shipped instructions file. Session prompts are compared exactly against the launch prompt, the
  `---` separator, and this file with `{{NONCE}}` replaced (`expectedSessionPrompt` in `helpers.ts`).
- The result-block example `<afk-harness-result nonce="…">` in the session prompt: the fake agents and `withoutNonce`
  read the session nonce from it, whatever its length or alphabet.
- Codex's `--output-last-message` file: how the Codex fake agent delivers the final message (stdout is ignored).

## Conventions

- Behavior that must be identical across agents goes in `agent-parity.test.ts`, which runs every scenario for each
  name in its literal `AGENT_NAMES` list and also asserts byte-identical stderr/exit codes across agents.
- Assert on exact `[afk]` wording, exit codes, and that `run.stdout` is `""`.
- Help text and README content are asserted (`help.test.ts`); update them together.
- Test files are named after the behavior (`session-timeout`, `stderr-tail`), not the module, except unit tests.
- Write the test first (the AFK loop uses the `tdd` skill: red → green → refactor).

## Coverage

Run `pnpm test:coverage` to build the CLI and run both suites with Vitest's V8 coverage provider.
It prints a coverage table and writes an HTML report (`coverage/index.html`), LCOV (`coverage/lcov.info`),
and JSON totals (`coverage/coverage-summary.json`). Reports include all `src/**/*.ts` files, including untested files;
tests, fixtures, and generated output are excluded. Every source file must have 100% line, statement, function,
and branch coverage. The command exits nonzero if any threshold is missed.

CI enforces these thresholds on Node 24 for pull requests, pushes to `main`, and manual runs. Open the workflow run's
**Summary** for line, statement, function, and branch percentages. Download the **coverage-report** artifact and
open `index.html` to inspect individual files. Reports are retained for 14 days and are also produced when tests fail.

The report measures code executed inside Vitest. Integration tests spawn `dist/cli.js` in separate processes,
whose execution is not captured by this provider and does not contribute to satisfying the coverage gate.
