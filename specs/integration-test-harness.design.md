# Design: Integration test harness for behavior preservation

Specification: [integration-test-harness.spec.md](integration-test-harness.spec.md)

## Architectural drivers

- **Black-box boundary (US-001).** The suite must survive any restructuring of `src/`. The only things it may rely on are:
  - `dist/cli.js`;
  - the CLI's arguments, environment, stdio, and exit code;
  - files and processes the CLI touches;
  - the contracts listed in AC-004.
- **Exact, human-owned expectations (US-002).** The expected `[afk]` output is the baseline the refactoring is judged against, so it must be explicit and reviewable. It must not be regenerated automatically.
- **Parity by construction.** Shared behavior is checked once and run against every agent, as `doc/TESTING.md` prescribes.
- **No production change.** `src/` is frozen for this feature. Anything new is added only to tests, helpers, or fake agents.

## Modules

| Module | Responsibility (reason to change) | Interface (conceptual) |
| --- | --- | --- |
| `test/integration/support/helpers.ts` | Run the built CLI and script and inspect a fake-agent sandbox. Changes when the way tests drive `afk` changes. | `createFakeCodexEnvironment`, `startAfk`, `withoutNonce`, plus any new shared helpers (e.g. a workspace/home/tmp snapshot or a condition wait) |
| `test/integration/fixtures/fake-codex.mjs` (+ `fake-claude.mjs`) | Imitate an agent process: read the prompt, emit output in the agent's format, exit or end by a signal as scripted, record what it received. Changes when a scenario needs new agent behavior. | The `Step` list documented at the top of the file and mirrored by `Step` in `helpers.ts` |
| `test/integration/agent-parity.test.ts` | Shared harness scenarios run against every agent, with exact expected stderr transcripts. Changes when shared harness behavior changes. | Scenario table: sessions, args, signal to send, expected exit code, invocation count, transcript |
| Other `test/integration/*.test.ts` | Agent-specific launch arguments, input validation, help, and side effects. | As today |
| `doc/TESTING.md` | Explain to maintainers which non-CLI contracts the suite relies on. | Prose |

## Flow

1. A test scripts the fake agent's sessions.
2. It starts `dist/cli.js` with the fake agent first on `PATH`, optionally sending a signal to `afk` while it runs.
3. It compares:
   - stderr and stdout against literal expected values;
   - the exit code;
   - the fake agent's recorded invocations (argv, cwd, stdin, files);
   - the received signals;
   - the workspace, home, and temporary-directory contents.

## Key decisions

- **Literal expected values, no snapshots.** Agent names, exit codes, and `[afk]` transcripts are literal values in the test files. Vitest snapshots (file or inline) are not used, because `vitest -u` would silently rewrite the baseline during the refactoring.
- **Transcripts are captured from the current build.** Each expected transcript is copied from what today's `dist/cli.js` prints, then reviewed. It is not composed from the specification or from `src/` wording.
- **Launch failure is asserted outside the exact-transcript comparison** (AC-007). Its detail includes an OS error message that may name the executable or vary by platform. It is still pinned by prefix, retry line, exit code, and line count.
- **The session prompt is compared against the shipped instructions** (AC-002). The expected prompt is built from the launch prompt, the separator, and `dist/code.md` with the session's nonce substituted. Comparing against the shipped file, rather than picking phrases, pins every later revision to the instructions (result-block protocol, task metadata, explicit task assignment, implementation-notes location). It also stays correct when those instructions are deliberately edited. `dist/code.md` is a documented contract (AC-004). If the refactoring moves the shipped file, this test must be updated in the same change.
- **The current code is the oracle.** Expected values come from running the current build and reading `src/`. They never come from `specs/_done/`, which is historical and partly out of date. The spec's Assumptions list the current behaviors that are most often misread from older documents.
- **Nonce masking uses the nonce the prompt announces.** It reads the value from the `<afk-harness-result nonce="…">` example in each recorded prompt and masks every occurrence. It does not match a fixed hex pattern.
- **Fake-agent capabilities are added as new steps on the shared fake agent**, documented in the fixture header and in the `Step` type, and available to every agent's fake. This feature needs three new capabilities:
  - ending the agent's own process with a chosen signal (AC-016). The fake's SIGINT and SIGTERM handlers turn those signals into `exit 130`, so the step must really end the process by the signal (for example SIGKILL, or with the handlers removed);
  - writing a nonce-wrapped result block to stdout instead of to the final-message channel (AC-015);
  - a final message that combines arbitrary text, such as an echoed block with another nonce, with the valid block (AC-013).
- **Where a scenario lives.** Behavior expected to be identical for every agent lives in the per-agent scenario table in `agent-parity.test.ts`. The cross-agent byte-identical comparison skips scenarios whose output is legitimately agent-specific, such as launch failure.
- **SIGTERM and SIGHUP to `afk`** are sent with `child.kill(signal)` from the test, exactly as SIGINT already is.
- **Strengthened assertions that fail against the current build are findings, not fixes.** The responsible task reports a `fail` outcome with a follow-up task. It does not edit `src/`.
