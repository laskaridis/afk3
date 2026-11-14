# Review checklist

Judge every changed file against these four pillars. Not every pillar applies to every file (a pure data file has no "testability"); skip what doesn't apply rather than forcing a comment.

## Correctness

- Does the code do what the PR description and the surrounding code say it should?
- Trace edge cases: empty/null inputs, boundary values, concurrent access, error paths. Does the diff handle the ones the domain actually produces?
- Do changed error-handling paths fail safely, or do they silently swallow errors, retry forever, or leak resources?
- Do types, contracts, and invariants still hold at every call site touched by the diff, not just the one the PR author tested?

## Testability

- Is the new/changed behavior actually covered by a test, not just exercised incidentally by an existing one?
- Do tests assert observable behavior (inputs → outputs, state transitions) rather than implementation details (private methods, internal call order, mock call counts as the main assertion)?
- Are mocks/stubs used to isolate the unit under test from true externalities (network, clock, randomness, other bounded contexts) — not to fake out collaborators that could be exercised directly?
- Any sign of flakiness: reliance on real time, unseeded randomness, test execution order, or shared mutable state across tests?
- Mystery guests: does a test depend on fixture data or external state not visible in the test itself?
- Bloated setup: does getting to the point of the test require excessive arrange-phase ceremony that a smaller unit or a builder/factory would avoid?

## Clarity

- Can a reader unfamiliar with this change follow it without needing the PR description open?
- Do names (variables, functions, types) reveal intent and match the domain's own vocabulary, not generic placeholders (`data`, `temp`, `handleStuff`) or vocabulary invented ad hoc?
- Is control flow flat and linear where possible, or does it bury the main path under nested conditionals?
- Are comments explaining *why* (non-obvious constraints, workarounds) rather than restating *what* the next line already says?

## Design

- Are new interfaces/modules at the right level of abstraction for what they currently need — not generalized for hypothetical future callers (speculative generality)?
- Long methods/classes: does a changed unit take on responsibilities that should split along a natural seam?
- Long parameter lists / data clumps: do the same 3+ parameters travel together across calls, signaling a missing object?
- Duplication: does the diff repeat logic that already exists elsewhere in the touched area, instead of reusing it?
- Dead code: does the diff leave unreachable branches, unused parameters/exports, or now-pointless abstractions behind?
- Feature envy: does a method reach into another object's data/methods more than its own, suggesting it belongs there instead?

## Severity guidance

- **Blocking**: incorrect behavior, data loss, security issue, or a test that doesn't actually verify the behavior it claims to.
- **Should-fix**: clarity or design issues that will cost the next reader/maintainer real time.
- **Nit**: minor naming/style preference — say so explicitly so the author can take it or leave it.

Not every finding needs a severity in the final comment, but keep it in mind when deciding what's worth posting versus noise.
