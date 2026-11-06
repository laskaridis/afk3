---
name: doc-gardening
description: Verify that a project's documentation is up to date, accurate and reflects actual behaviour, fixing what can be proven and escalating what cannot. Use this skill to audit or maintain documentation of any kind (READMEs, guides, specs, ADRs, API docs, comments) against the code, tests and tools of a project.
argument-hint: Which documentation should be gardened (whole project, a path, or a diff)? Is a human available to answer questions?
---

## Goal

Make the project's documentation accurate and current. Fix every discrepancy you can prove. Escalate every discrepancy you cannot. Never assume or invent facts.

## Core rules

1. **Evidence.** Every claim you write, change or flag must trace to a fact: repository content, command output, a passing test, or the nearest authoritative source (official docs, the installed tool's own help or source).

2. **Truth order.** Documents created from users to steer intent (such as specs and ADRs) come first, then code and tests, then all other documentation. Documents that are superseded or deprecated are ignored.

3. **Specs and ADRs are intent.** Never edit them without explicit user permission. If code contradicts one, report it as a discrepancy: the code is probably wrong.

4. **Fix the "how", escalate the "why".** You may fix what the code or tooling can prove: broken links, stale paths, wrong flags, renamed symbols, versions, commands, non-running examples. Rationale, intent and behaviour you cannot verify must be escalated.

5. **Don't fix toward a disputed side.** If the code and a spec disagree, leave the derived documents that depend on either untouched until a human decides.

6. **Conflicting evidence is a finding.** If code, tests and tooling disagree, escalate. Do not pick a winner.

7. **Unverifiable means untouched.** Leave the claim as is and report it as unverified, with the reason.

8. **Flag, don't delete.** Documented features missing from the code are flagged, not removed.

9. **Correct, don't author.** Fix existing docs. Report undocumented behaviour as a gap instead of writing prose about it, except for a minimal factual entry (name, signature) where the project already documents that kind of thing.

10. **Fix the source, not the output.** If a document is generated, do not edit it. Fix its source or generator, or flag it if you cannot.

11. **Keep rewrites small.** Anything beyond a minimal, mechanical change is flagged for review.

12. **Safe execution.** Run only read-only commands (`--help`, `--version`) and the project's tests, linters and builds, and only when they do not mutate state outside the working tree. Never run anything that needs credentials. A failing test is evidence, not something to fix.

## Workflow

### 1. Scope

Documentation, code and conventions differ per project. Do not assume structure.

- Determine what to garden: the whole project, a path, or a diff. For a diff, include documents that describe the changed code, not only documents changed in the diff. Default to what the invocation implies.
- Find the documentation and classify each document by its content, not its location: intent (specs, ADRs), derived (everything else), or ignored (superseded, deprecated).
- Learn the project's documentation conventions and follow them when editing.
- Include relevant inline, block and API documentation comments when discovering documentation; adapt to the project's languages and conventions.
- When a human is available, confirm the classification if it is unclear.

### 2. Verify

For each claim in scope, find the evidence in the code, tests or tooling and compare. Record each as accurate, discrepant or unverifiable.

For code comments, check factual claims against the associated implementation, including comments made stale by changes. Preserve explanations of *why* unless contradicted by evidence; escalate uncertain intent. Flag potentially redundant comments for review rather than removing them automatically.

### 3. Resolve

- **Provable "how" discrepancy:** fix it.
- **Anything else:** escalate (see below).

### 4. Report

Summarise in the conversation, unless told otherwise. For each finding give its location, the claim, the evidence, and the action taken: `FIXED`, `FLAGGED` or `UNVERIFIED`. End with what you did not check and why.

## Escalation

Assume a human is available unless told otherwise. Batch related questions and keep working on unrelated findings while you wait. Do not commit or open pull requests unless the invocation asks for it.
