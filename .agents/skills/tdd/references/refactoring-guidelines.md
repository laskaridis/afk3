# Refactoring guidelines

- Things to look for:
  * Unnecessary complexity
  * Duplication
  * Code that is difficult to read and understand
  * Poor naming or names that don't follow ubiquitous language or domain concepts
  * Excessive coupling
  * Low coherence
  * Unclear responsibilities
- Keep refactoring small and focused. Avoid speculative abstractions and unrelated cleanup.
- Refactoring preserves observable behavior. Do not introduce new behavior or change the existing observable behavior.
- Tests may themselves be refactoring targets only to improve their structure and readability. Their behavioral assertions and coverage must be preserved.
- Tests should not change after refactoring the implementation details of the SUT. If they do need to change treat this as a design smell and consider changing your design to make the code testable (HINT: look for minimal, stable interfaces).
- If refactoring reveals the need for new behavior address it in a separate RED -> GREEN -> REFACTOR cycle.
- Never weaken or remove assertions just to make refactored production code pass.