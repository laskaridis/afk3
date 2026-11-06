---
name: plan
description: Convert a specification document into a list of tasks that can be executed by a coding agent. Use this skill when you have a specification document and want to break it down into actionable tasks for a coding agent to implement.
argument-hint: <path to spec>
---

## Goal

Convert a specification file into an implementation task plan which coding agents can follow to produce a feature aligned to the given specifications. The task plan must assume that it will be implemented without the mediation of a human developer.

## User input

### Prerequisites

The user is required to provide a specification file. If none has been provided then stop and ask the user to provide one.

### Additional supporting documents

Optionally, the user may also explicitly provide supporting context documents to further specify intent. If they do, reference them from the plan following the expected output rules. Inspect other documentation as needed during planning, but do not automatically add discovered documents or transitive references to required reading. If another document contains an essential implementation contract or constraint, explain the concrete decision or correctness check it supports and obtain the user's agreement before including it and finalizing the plan.

## How should a good plan look like?

1. **Correctness.** It steers coding agents to produce the intended feature by specifying what must be true and what constraints must hold.
2. **Autonomy.** It does not prescribe how the code must be written. Agents can implement each task without asking for clarifications.
3. **Verifiability.** It explains how success for each task will be demonstrated.

## Core rules

1. Size tasks by cohesive capability, not by acceptance criterion. A task may cover many acceptance criteria and vice versa.
2. Each task must enable some story or acceptance criterion mentioned in the specification.
3. Each task must have clear, unambiguous and locally verifiable completion criteria which verify observable behavior.
4. Identify any decisions that cannot safely be delegated to an implementation agent, such as module boundaries in a codebase with no established architecture.
5. Do not resolve significant ambiguity yourself, instead ask the user for clarifications as needed.

## Workflow

### 1. Understand.

Goal: Gain enough knowledge so you can split the specification into a task plan that delivers the intended feature and complies to the project's domain language, architecture, conventions and quality characteristics.

Before you write any tasks:

- Read the user-provided spec file and all user-designated supporting context documents to understand the broader context.
- Inspect the relevant codebase as needed to build understanding. Treat observations about code as provisional as they may change during task execution.
- Make sure you look for and read any relevant context about:
  - Project architecture
  - Ubiquitous domain language used
  - Coding and testing guidelines
  - Project conventions

### 2. Design.

Goal: Identify appropriate implementation boundaries around which tasks can be sliced.

- **Identify architectural drivers.** Determine which requirements, quality attributes, constraints, and existing architectural decisions materially influence the design. If the project or the specification already defines an architecture, use it. Avoid designing around requirements that have no architectural significance.
- **Explore critical design alternatives.** For consequential decisions, consider plausible alternatives and their trade-offs. Do not require alternatives for routine decisions already settled by project conventions.
- **Identify architectural risks and uncertainties.** Examine integration boundaries, dependencies, data consistency, compatibility, and testability. Decide which assumptions require early validation, potentially through a tracer bullet.
- **Establish implementation boundaries.** Identify cohesive modules, their responsibilities, interfaces, dependencies, and the smallest independently verifiable vertical slices that can evolve into the complete feature:
  * Outline the minimal set of coherent modules needed to deliver the feature.
  * Prefer a single responsibility per module. ASK: What reason has this module to change?
  * Prefer fewer deep (i.e. do a lot of useful work) modules with small interfaces (have minimal surface areas).
  * Add a module only when it isolates an external boundary or a responsibility that would otherwise be mixed into another.
- **Record your design decisions**. Use file `<feature-name-slug>.design.md` located in the same folder as the specification:
  * Modules their responsibility and interfaces
  * Dependencies and flow of execution
  * Key architectural decisions
  * Record the resulting design document under `design_document`.

**IMPORTANT:** If the design requires a product or architectural choice the specification does not settle, ask the user.

### 3. Decompose.

Goal: Decompose the design into a prioritized list of tasks that a code agent can implement.

- Break down the design into a prioritized list of tasks.
- Focus each task on one coheasive, vertical slice of independently verifiable observable value.
- Every task must contribute directly to at least one story or acceptance criterion, or be a necessary prerequisite for delivering one.
- A task may cross architectural layers.
- Leave implementation details to the implementor. Include implementation guidance ONLY when critical to preserve established architectural decisions, contracts, or compatibility requirements.
- Schedule tasks with the highest technical risk as early as their dependencies allow.

### 4. Verify.

Goal: Ensure that the task plan delivers the specified value following the project's architecture and conventions.

Before returning, verify that all of the following conditions are satisfied:

- Every specification acceptance criterion is covered by at least one task.
- All tasks collectively implement the specified feature.
- No task introduces behaviours unsupported by the specification.
- Output is valid JSON file, named appropriately and placed in the correct location.
- `specification_document`, `design_document` and all context document paths are repository-root-relative and resolve to existing, readable files.
- No material contradictions remain unresolved between the specification, design, supporting documents, and task plan.
- Each task enabled at least one user story or one acceptance criterion.
- Task dependencies reference valid IDs and there are no circular dependencies between tasks.
- Every task has one cohesive, specific and unambiguous outcome that aligns with the specification.
- Every task has clear, unambiguous completion criteria that can be locally verified.
- No task dictates low-level implementation details that constrain the implementor.
- The task plan can be executed by an autonomous coding agent without human steering.

## Expected output

- Write the plan into a valid JSON file - no markdown, no prose, no comments.
- Unless instructed otherwise from the user:
  * Place the task plan in the same directory as the specification.
  * Base the task plan name on the specification. Example: if the spec is named `<feature-name-slug>.spec.md` then name the task plan as `<feature-name-slug>.plan.json`.
- Always emit `context_documents` as an array; use `[]` when no supporting documents apply.
- Populate `context_documents` only with supporting files explicitly designated by the user.
- Give each entry in `context_documents` a repository-root-relative `path` and a non-empty, one-sentence `purpose` describing how it guides implementation. Do not restrict document types or copy document contents into the plan.
- Default `status` is allways `pending`.
- Use the following schema EXACTLY:
  ```json
  {
    "specification_document": "<path to the specification file relative to current repo root>",
    "design_document": "<path to the design file relative to current repo root>",
    "context_documents": [
      {
        "path": "<path to a supporting file relative to current repo root>",
        "purpose": "<one sentence describing the implementation decisions or correctness checks this documenfeature slugt guides>"
      }
    ],
    "tasks": [
      {
        "id": "TASK-001",
        "objective": "<1 sentence description of what needs to be accomplished, what is the observable outcome>",
        "status": "<pending|completed>",
        "stories_enabled": [
          "<the id of the user story enabled by this task>"
        ],
        "acceptance_criteria_addressed": [
          "<the id of the functional or non-functional acceptance criterion this task enables>"
        ],
        "completion_criteria": [
          "<task specific conditions that must be true for the task to be considered complete>",
          "<do not copy the acceptance criteria from the specification here>"
        ],
        "constraints": [
          "<optionally, a description of anything critical that must constrain this implementation>"
        ],
        "dependencies": []
      }
    ]
  }
  ```
