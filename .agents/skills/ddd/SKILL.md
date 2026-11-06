---
name: ddd
description: "Discover, challenge, validate, and document domain language, business rules, and bounded-context boundaries. Use when asked to explore or capture domain knowledge, or when a task reveals a meaningful missing, ambiguous, or conflicting domain concept, rule, or boundary. Do not invoke merely because domain terminology appears in code."
---

# Domain-Driven Design

Understand and preserv the business model to help agents write code that aligns with the ubiquitous domain language used by the business.

## Core rules

- Follow the established ubiquitous language and its bounded-context meanings instead of inventing names or business semantics.
- Distinguish between **accepted business knowledge**, **observed implementation behavior**, and **unvalidated interpretations** or **hypothetical scenarios**. Agreement with existing code is not, by itself, proof of business intent.
- Investigate ambiguities and contradctions but never silently resolve a material conflict or turn a plausible scenario into a business rule.
- Keep the work scoped to the domain concepts directly relevant to the task or provided context. This skill capturs the business model, it does not change code, behavior, or architecture.
- Capture domain knowledge independently of the current feature. Keep links to specs, iteration scope, and implementation details in feature artifacts or the task report instead.

## Workflow

### 1. Discover 

Goal: Inspect the specific context supplied by the user or established by the task to establish the current understanding.

- Read existing `CONTEXT.md`, `LANGUAGE.md`, and `CONTEXT-MAP.md` for relevant bounded contexts **before editing**.
- Inspect specifications, business discussions, and relevant code when useful. Treat code as evidence of implementation, not necessarily of intended business behavior.
- Identify business purpose, capabilities, participants, and workflows; terms, contextual meanings, synonyms, and rejected names; rules, invariants, states, commands, queries, and domain events.
- Identify established responsibilities and context relationships without assuming that code modules, services, or database boundaries are bounded contexts.
- For important claims, retain their source and distinguish confirmed knowledge, implementation observations, and tentative inferences. If sources disagree, preserve the disagreement.

### 2. Challenge

Goal: Actively look for material gaps in the discovered model rather than merely transcribing it.

- Challenge ambiguous or overloaded terms, contradictory rules, unclear ownership, and undefined lifecycle transitions.
- For consequential rules or boundaries, devise a few **discriminating hypothetical scenarios** (including relevant failure cases, state transitions, or cross-context interactions) that could reveal different interpretations.
- Test whether the model gives coherent answers: What is allowed or forbidden? When does a rule apply? Who makes the decision? Which context owns the concept?
- Present plausible alternatives or precise terminology when useful, clearly labeling them as proposals, not established facts.
- Focus on uncertainties that could affect invariants, aggregate consistency boundaries, workflows, or context ownership. Do not manufacture edge cases or demand a workshop for a straightforward, evidence-backed documentation update.

**Hypothetical scenarios are probes, not requirements.** Never record an invented scenario's expected outcome as an accepted rule without validation.

### 3. Validate 

Goal: Resolve decisions against evidence before promoting a challenged interpretation into established domain knowledge.

- Confirm it from an explicit user/domain-expert decision or an authoritative, applicable business source. Do not treat a speculative inference or the current implementation as independent business confirmation.
- Surface material discrepancies between intended behavior and code rather than choosing one silently.
- Ask a focused question when unresolved alternatives would materially alter terminology, business rules, invariants, ownership, or context boundaries. Make the competing interpretations and their consequences clear.
- Do **not** seek approval again for an unambiguous rule already established by the user or a reliable business source.
- If domain expertise is unavailable (for example, during unattended coding), continue with independently supported knowledge, capture unresolved alternatives as open questions, and do not finalize decisions that depend on them.

Validation is a decision gate for **new or conflicting consequential claims**, not a mandatory human approval step for every term or edit.

### 4. Capture

Goal: Update the relevant domain documents.

Read [references/document-templates.md](references/document-templates.md) fully for document outlines and placement guidance. Follow the templates *exactly*. Do not add, remove or rename sections, or modify the documetn structure in any other way.

#### Determine context placement

For a single bounded context, a typical structure is:

```text
project/
├── CONTEXT.md
├── LANGUAGE.md
└── src/
```

For multiple project bounded contexts, a typical structure is:

```text
project/
├── CONTEXT-MAP.md
├── context-a/
│   ├── CONTEXT.md
│   ├── LANGUAGE.md
│   └── src/
└── context-b/
    ├── CONTEXT.md
    ├── LANGUAGE.md
    └── src/
```

- Preserve established contexts and existing roots, which may be nested in the project's layout.
- External contexts can be documented as relationships without receiving local directories.
- If no boundary is established and the evidence supports one coherent model, use the project root and mark its scope provisional. Do not invent extra contexts to complete a map.
- Do not reorganize code to settle document placement. If materially different interpretations imply different roots, record the ambiguity and ask when possible.

#### Merge knowledge without inventing it

- Maintain `CONTEXT.md` and `LANGUAGE.md` at each relevant project context root. For multiple contexts, maintain a root `CONTEXT-MAP.md`; for a single context, document external relationships in `CONTEXT.md`.
- Put terminology in the owning context's `LANGUAGE.md`, rules and responsibilities in its `CONTEXT.md`, and cross-context relationships in the map. Link instead of duplicating.
- Capture confirmed examples when they illuminate rules. Keep unvalidated scenarios and interpretations under open questions, not among accepted rules.
- Preserve existing knowledge and distinct local meanings. Consolidate duplicates or supersede definitions only when the change is established; mark deprecated terms and replacements explicitly.
- For **consequential, accepted modeling decisions** (such as business ownership or consistency boundaries), capture the choice, rationale, and meaningful alternatives briefly in `CONTEXT.md`. Link an existing ADR when architectural rationale lives there; do not create architectural ADRs or change code as part of this skill.
- Limit changes to relevant domain documents and necessary links. Do not rename symbols, alter behavior, or scaffold an architecture.

### 5. Verify

Goal: Check integrity and report.

- Every relevant project context has both documents, and a multi-context project has a root map with working relative links.
- Terms have precise local meanings, including material synonyms and conflicting usages.
- Accepted rules, scenarios, responsibilities, boundaries, and relationships are backed by evidence or explicit confirmation. Hypotheses remain visibly provisional.
- Relationship direction is described in words; no integration pattern, ownership arrangement, or aggregate boundary was invented.
- Updates preserve prior accepted knowledge, distinguish business intent from implementation observations, and do not duplicate definitions across contexts.
- Unresolved questions appear in the owning `LANGUAGE.md` (terminology), `CONTEXT.md` (rules or scope), or `CONTEXT-MAP.md` (relationships), as appropriate.

Report the files created or updated, significant modeling decisions and terminology changes, evidence/code discrepancies, and unresolved questions that affect interpretation. Do not paste the full documents unless requested.
