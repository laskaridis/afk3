# Development workflow

Features are built spec-first and implemented by running `afk` on this repo.

## Artifacts

While a feature is in progress its files sit flat in `specs/`, including `<slug>.code.md` implementation notes beside
the specification. Once merged, all of them move to `specs/_done/NNN-<slug>/`, preserving their filenames.

| File                | Content                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| `<slug>.spec.md`    | User stories (`US-00x`) with acceptance criteria (`AC-00x`), assumptions, out of scope |
| `<slug>.design.md`  | Architectural drivers, module table, key decisions                                     |
| `<slug>.plan.json`  | `spec_path` + `tasks[]` with `id` (`TASK-00x`), `objective`, `status`, ACs, criteria   |
| `<slug>.prompt.txt` | The launch prompt given to `afk`                                                       |
| `<slug>.code.md`    | Append-only log written by the `code` loop, one entry per task                         |

Skills come from `laskaridis/skills` (`specify`, `plan`, `code`, `tdd`, …), installed locally into the git-ignored
`.claude/skills` and `.agents/skills`.

## Implementation notes

- Entry format is defined in `src/code.md`: task id, what was implemented, files changed, verification evidence,
  learnings, scope deviations, follow-ups.
- A `## Project discovery` section at the top consolidates reusable learnings.
- Append only; never rewrite past entries.
- Archived logs in `specs/_done/` are not guidance. Their "Project discovery" notes can be wrong for today's code
  (e.g. 002 says Codex's final message is on stdout); verify against the code before acting on them.

## Rules for a task

- One task per session and per commit; mark it `completed` in the plan only after checking every completion criterion.
- Validation/smoke-check tasks are read-only except for bookkeeping; defects found become new follow-up tasks.
- Real-agent smoke checks are manual and recorded as evidence in `<slug>.code.md`, never added to the automated suite.
