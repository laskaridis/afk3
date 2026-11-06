---
name: tdd
description: "Guide coding agents through test-driven development for code changes. Use when the user asks to code, implement, fix, refactor, or extend behavior using TDD."
---

# TDD

Use this skill to write verifiable, clean production code.

## Core Rule

When writing production code start by writing a test that describes the intended behavior first. Follow a RED -> GREEN -> REFACTOR cycle throughout.

## Workflow

1. Create a list of test scenarios

Before you write a single line of code:

- Identify the expected behavior directly from the specification. (HINT: focus on pre-conditions, post-conditions and invariants).
- Inspect relevant code and test conventions.
- Identify edge cases and failure modes.
- Identify the public interface through which each behavior should be verified (test seams):
  * Ground test seams directly on specification, existing architecture/design, and established module contracts.
  * Prefer the smallest, stable interface that exposes the intended behavior to its consumers.
  * Avoid introducing new interfaces soley to facilitate testing.
- Create internally a list of test scenarios that cover the expected behavior and edge cases. Map each scenario to its corresponding specification requirement and selected testing boundary.

For non-trivial behavior changes, delegate an independent review of the scenario list and testing boundaries to a subagent. Provide the specification and relevant project contracts. Request evidence-backed omissions, unsupported expectations, and boundary concerns without file edits. Assess the findings before starting RED.

IMPORTANT: Expected outcomes of tests must be independent of the implementation. Derive expectations directly from specifications, requirements and acceptance criteria provided by the user.

2. RED - Write a failing test for the next test scenario in the list.

- Pick a single, highest priority test scenario to implement from that list.
- Write a failing test slice following closely the instructions in `references/testing-guidelines.md`. 
- Don't assume it fails, run the narrowest relevant test command and capture the failure. Make sure it demonstrates the missing behavior not an unrelated failure.

3. GREEN - Make the test pass.

- Write the minimum code needed to make the test pass.
- Avoid broad rewrites, speculative abstractions, unrelated cleanup, or extra behavior not covered by the test.
- Don't assume it passes, verify by running the narrowest relevant test command.

4. REFACTOR - Improve the design

- Review your code and assess whether refactoring meanigfully improves the design.
- If it does, refactor following closely the instructions in `references/refactoring-guidelines.md`.
- Run all relevant tests affected by the change to verify that existing behavior is preserved. If tests fail, investigate and fix  them before proceeding.

5. Repeat.

- Continue to step 2 with the next test scenario, reassessing the scenario list if new requirements or edge cases emerge.
- Stop if there are no more test scenarios in the list.
- At completion, run the broader relevant test suite and investigate any failures before reporting success.

## Reporting

When summarizing TDD work, include:

- The list of identified test scenarios.
- The failing test added and the behavior it captured.
- The narrow command used to observe red and green.
- The production change made to satisfy the test.
- Any broader verification run, or why broader verification was not possible.
- Any refactoring performed, why it was justified, and how behavioral preservation was verified.
