---
name: specify
description: Turn the current conversation context into a specification document. Use when user wants to create a lean specification from the current context.
argument-hint: Where should the specification document be created?
---

## Goal

Synthesize the current conversation context, along with your understanding of the project, into a clear and concise specification document that can guide coding agents in implementing and delivering the feature.

## Input

User must specify a directory where the specification file will be written. If not specified, stop and ask the user before proceeding.

## Permissions

You are in **RESTRICTED EDIT MODE**. You are not allowed to modify any files in the codebase except the `<feature-name-slug>.spec.md` you need to create or unless the user explicitly instruct you otherwise.

## Workflow 

1. Read fully SKILL_ROOT/references/spec-template.md to understand the expected structure and content of the specification document.

2. Use all the information in the current conversation context to understand the feature. Extract the agreed outcomes, scope, rules, assumptions and unresolved questions. Follow explicit corrections and exclude rejected or superseded proposals. 

3. Explore the codebase as needed to understand the current state of relevant area(s) that the new feature will affect. Direct exploration toward the axis of change imposed by the conversation. Identify any:
  - Relevant bounded contexts and domain language.
  - Established implementation conventions relevant to the feature.
  - Relevant architectural decisions and constraints documented in ADRs or other project documentation.
  - Existing contracts, domain invariants, integration boundaries, and compatibility requirements that the feature must respect.

4. Validate the finished spec against that extracted context, checking both omissions and unsupported addition:
   - Check that stories and acceptance criteria describe consistently and fully the target behavior.
   - Check that acceptance criteria codes are unique across all stories in the spec, following the template's numbering rules, and any references identify the intended criteria.
   - Check that the spec does not introduces unrequested scope.
   - Resolve inconsistencies using the conversation and codebase. Record unresolved material conflicts under "Clarifications" needed rather than choosing silently.

**Important:** Follow the instructions in the template closely. Pay special attention to any guidelines, make sure to include all required sections and use the appropriate formatting.

## Output

 Write the specification document under the location specified by the user, as a file named `<feature-name-slug>.spec.md`.

 Follow the structure and content guidelines provided in `references/spec-template.md`.

## Guidelines

- Always use clear, plain and concise language.
- Align the document with pre-existing bounded contexts and domain language.
- Focus on user needs, how these are addressed and the value provided.
- Follow the project's established domain language vocabulary throughout the specification.
