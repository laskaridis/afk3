# Domain document outlines

Use these outlines when creating files. Replace bracketed guidance with evidence-backed content; omit optional sections without useful content. For required information that is unknown, say so briefly under open questions. Preserve useful existing structure when updating a document.

## CONTEXT.md

Describe the boundary and the model's responsibilities. Keep terminology definitions in the companion language document.

```markdown
# [Context name]

## Purpose and scope

[Business outcome and responsibility. State whether the boundary is established
or provisional, and the evidence for it.]

- Owns: [Capabilities, decisions, and domain information governed here.]
- Participants: [Known domain actors; model-owning team only if established.]

## Model and business rules

[Known concepts and how they relate. Link definitions in LANGUAGE.md.]

- [Business rule or invariant, with relevant evidence.]
- [Optional validated scenario illustrating a meaningful rule or exception.]

[Include meaningful lifecycles, commands, events, or aggregate consistency
boundaries when established. Do not invent a full tactical model.]

## Relationships

[Links to related contexts and relevant contracts. Explain what is provided
or consumed, who owns its meaning, and where translation occurs, when known.
In multi-context projects, link to the root map for relationship details.]

## Model decisions

[Optional: consequential accepted domain modeling decisions. Record the choice,
why it was made, relevant alternatives and confirming source. Link an existing
ADR when the reasoning is primarily architectural. Omit this section if none.]

## Open questions

- [Unresolved ambiguity, competing interpretation, provisional scope, or
  hypothetical scenario whose expected business behavior is not yet confirmed.]

## Language

See [Ubiquitous language](LANGUAGE.md).
```

## LANGUAGE.md

Capture terms with domain significance, including verbs and states. A concise table is enough for simple terms; use entries with examples or rules where a table would obscure meaning. Include only supported distinctions. Do not require every term to be an entity, value object, command, or event.

```markdown
# [Context name] — Ubiquitous Language

These meanings apply within [context name](CONTEXT.md).

## Terms

### [Preferred term]

[Precise domain meaning and distinguishing limits within this context.]

- Usage: [A short validated domain statement demonstrating the term, when helpful.]
- Related terms: [Meaningful distinctions or links, if known.]
- Synonyms / deprecated names: [Accepted aliases or names to avoid, and why.]
- Other contexts: [Link to any different meaning or boundary translation.]
- Evidence: [Decision summary or relative link where useful.]

[Repeat for the relevant terms. Omit unsupported or unhelpful fields.]

## Open terminology questions

- [Ambiguous term, conflicting definitions, or unconfirmed proposed name.]
```

## CONTEXT-MAP.md

Create at the project root when the project contains multiple bounded contexts. This map records model relationships, rather than merely deployments or network calls. A table and short explanations are enough; a diagram is optional.

```markdown
# Context Map

## Project contexts

| Context | Responsibility | Documents |
| --- | --- | --- |
| [Name] | [Business responsibility] | [Context](path/CONTEXT.md), [Language](path/LANGUAGE.md) |

## External contexts

[Known external models/systems relevant to these relationships, if any.
Distinguish them from contexts maintained in this project.]

## Relationships

### [Context A] and [Context B]

- Exchange: [Domain information, service, command, or event crossing the boundary.]
- Direction: [Who supplies what to whom; distinguish data flow from model influence.]
- Model ownership and translation: [Whose definitions govern the contract and how
  the receiving context interprets them, if known.]
- Contract / evidence: [Relevant relative links or agreed decision summary.]
- Relationship pattern: [Only if established; otherwise omit or record as unknown.]

## Open boundary questions

- [Provisional boundaries, unclear ownership, or unresolved integration semantics.]
```

Use DDD relationship names, such as shared kernel, partnership, customer/supplier, conformist, or anti-corruption layer, only when supported by evidence. An event exchange alone does not establish any of these relationships. A shared identifier does not establish a shared domain model.
