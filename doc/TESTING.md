# Testing

Vitest 3, `test/**/*.test.ts` (`vitest.config.ts`). `pnpm test` runs `pnpm run build` first because integration
tests spawn `dist/cli.js` — running `vitest` directly against stale `dist/` gives misleading results.

## Two kinds of tests

**Unit** — import directly from `../src/*.js`.

- `runner.test.ts`: drives `runAfk` with a scripted `SessionRunner`; `reply(message)` builds a result block from the
  nonce the runner passes in.
- `protocol.test.ts`, `prompt.test.ts`, `test/agents/<name>.test.ts`: pure functions, table-driven with `it.each`.

**Integration** — run the built CLI against a fake agent on `PATH`, no real agent needed:

```ts
const fake = createFakeCodexEnvironment([{ finalMessage: '{"outcome":"complete"}' }, { exit: 0 }]); // or (steps, "claude")
const run = await startAfk({ args: ["build X"], cwd: fake.workspace, env: fake.env }).done;
expect(run.exitCode).toBe(0);
fake.soleInvocation(); // { argv, cwd, stdin, pid, files }
```

- `createFakeCodexEnvironment(steps | { sessions: Step[][] }, agent = "codex")` makes a temp sandbox, symlinks
  `test/fixtures/fake-<agent>.mjs` into a `bin/` first on `PATH`, and returns `workspace`, `env`, `invocations()`,
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
