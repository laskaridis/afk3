# Design: Verification stage

Design decisions for [add-verification-stage.spec.md](add-verification-stage.spec.md). It records the module
boundaries and the policy ownership the implementation must preserve; it does not prescribe code.

## Architectural drivers

| Driver                                                                                | Consequence                                                                                       |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| The completion decision moves from the coding session to a second, independent session | A second `WorkflowStep` implementation and a two-phase loop policy in `WorkflowExecutor`          |
| Each phase has its own outcome vocabulary (AC-010)                                     | The result-block parser becomes phase-aware instead of growing a union of all outcomes            |
| A correction iteration is prompted with an assignment, not the launch prompt (AC-018)  | A step must be able to receive an assignment; prompt assembly stays inside the step               |
| Verification sessions must not consume an iteration, coding retries still do (AC-006)  | Verification runs inside the coding iteration, with its own inner retry loop                      |
| The harness reads no files and forms no opinion about correctness                      | `findings_file`, `revision` and `task_plan_file` are passed through verbatim, never resolved      |
| Status lines stay agent-neutral and must name the phase (AC-007)                       | Phase is carried on step-level events (`stepName`); the reporter maps it to wording               |
| Existing layering (`cli` → `reporting` → `workflow` → `session` → `agents`)            | The whole change lives in `workflow/`, `reporting/`, `cli/`, the build script and the docs        |
| 100% coverage gate and an integration suite that scripts sessions                      | Every new branch needs a test; fake-agent scripts move to `{ sessions: [...] }` for two phases    |

## Modules and responsibilities

| Module                                     | Responsibility after this feature                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workflow/result-block`                    | Validates a result block **for one phase**: coding and verification vocabularies, required `task_id`/`task_plan_file`, optional `revision`, `findings_file` |
| `workflow/steps/CodingStep`                | One coding session: builds its prompt from either the launch prompt or a correction assignment, parses the block with the coding vocabulary                 |
| `workflow/steps/VerificationStep`          | One verification session: builds its prompt from a verification assignment, parses the block with the verification vocabulary                               |
| `workflow/steps/verification-step.md`      | Bundled verification instructions; the agent-facing contract, carrying the `{{NONCE}}` example block                                                        |
| `workflow/` assignment types               | The harness-supplied assignment values: verification assignment (task, plan, optional revision) and correction assignment (task, plan, findings, summary)   |
| `workflow/WorkflowStepResult` + handlers   | Per-phase outcomes as step results; handlers publish events and request a transition, they decide no policy                                                 |
| `workflow/WorkflowExecutor`                | The two-phase policy: when to verify, iteration accounting, retry budget, the per-task verification attempt counter and its limit, terminal events          |
| `reporting/ConsoleReporter`                | The new status lines, phase-aware, agent-neutral                                                                                                            |
| `cli/`                                     | The three new options and their validation, exit code `6`, passing verification model/effort into the run options                                            |

`session/` and `agents/` are unchanged: a verification session is an ordinary session with a different prompt, model
and effort, and `SessionInput` already carries model and effort per session.

## Flow

```
WorkflowExecutor.run()
  iteration n (bounded by --max-iterations)
    CodingStep          prompt = launch prompt            (autonomous)
                        prompt = correction assignment    (after a rejection)
      no_more_tasks  -> terminal: run complete, exit 0            (no verification)
      blocked        -> terminal: blocked, exit 1                 (no verification)
      task_implemented
         |
         v
    VerificationStep    prompt = verification assignment + --- + verification-step.md
      (execution error -> one immediate re-run with a new nonce and the same assignment;
       a second consecutive execution error ends the run. Neither consumes an iteration.)
      verification_passed -> iteration n+1, CodingStep with the launch prompt
      workflow_finished   -> terminal: complete, exit 0
      verification_failed -> attempt counter for this task += 1
                               below the limit -> iteration n+1, CodingStep with a correction assignment
                               at the limit    -> terminal: verification limit, exit 6
      blocked             -> terminal: blocked, exit 1
```

## Key decisions

1. **Verification is a `WorkflowStep`, the policy stays in the executor.** `VerificationStep` owns its prompt, its
   nonce and the interpretation of its result block, exactly as `CodingStep` does. Everything about *when* a
   verification session runs, how outcomes are counted and when the run ends stays in `WorkflowExecutor`, so the
   existing division between step and policy is preserved.
2. **The parser is phase-aware.** `parseResultBlock` takes the phase and accepts only that phase's vocabulary, so an
   outcome from the other phase is reported as an ordinary contract violation (AC-012) without special cases in the
   steps. The former `repeat` / `complete` / `fail` values disappear from the parser entirely.
3. **Assignments are values given to the step, not to `execute()`'s prompt argument.** The executor creates a fresh
   step per session and hands it the assignment it must work on; the step decides whether the session prompt starts
   with the launch prompt (autonomous coding) or with the assignment alone (correction and verification). This keeps
   prompt assembly in one place and keeps `WorkflowStep` usable for both phases.
4. **Verification runs inside the coding iteration.** The iteration counter is incremented only for coding sessions,
   so `--max-iterations` keeps counting coding sessions, correction iterations and coding retries, while verification
   sessions and their retries never consume one. A verification retry is an immediate re-run inside the same
   iteration with a new nonce and the same assignment.
5. **One consecutive-execution-error budget for the run, shared by both phases**, reset by any valid outcome. Because
   a coding execution error never produces a candidate, a streak can only ever be a streak within one phase, so one
   shared counter gives the behaviour AC-008 asks for with no phase-specific policy.
6. **Phase is reported through `stepName`.** Step-level events already carry the step's name; the reporter maps it to
   the wording of AC-007 ("agent session" / "verification session"). The start line moves from `IterationStarted` to
   the step-level start event so that a verification session can announce itself inside an iteration.
7. **The verification attempt counter is invocation-local state of the executor**, keyed by the task id it is
   counting, reset when a different task is observed. It is never persisted and never written to disk.
8. **The verification limit outranks the iteration limit.** When the last allowed coding iteration ends with a
   rejection that reaches the limit, the executor returns the verification-limit terminal event (exit `6`), because
   it names the reason the run cannot continue.
9. **`verification-step.md` is bundled exactly like `coding-step.md`**: shipped in `src/workflow/steps/`, copied to
   `dist/` by `scripts/dist-prepare.mjs`, excluded from prettier, read at run time with `{{NONCE}}` substituted, and
   carrying the result-block example the fake agents read the nonce from.

## Risks

- **Test-suite migration.** About twenty test files script the former vocabulary; the vocabulary change and the
  two-phase loop are not separable from them. The migration is split in two steps (coding contract first, the
  verification stage second) so that the suite is green at every task boundary.
- **Prompt equality assertions.** Integration tests compare session prompts byte for byte against the bundled
  instructions. The verification prompt needs its own helper built the same way.
- **Coverage gate.** New terminal events and new branches in the executor must each be reachable from a test.
