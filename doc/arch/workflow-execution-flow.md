# Workflow execution flow

How `WorkflowExecutor` runs the coding and verification steps. This is the two-phase loop proposed by
[add-verification-stage.spec.md](../../specs/add-verification-stage.spec.md), not the current code.
`VerificationStep` is a working name for the second `WorkflowStep`. The CLI, the reporter, the session layer and the
agent adapters are left out.

```mermaid
sequenceDiagram
    autonumber
    participant WE as workflow/WorkflowExecutor
    participant CS as workflow/steps/CodingStep
    participant VS as workflow/steps/VerificationStep

    Note over WE: run()

    loop coding iterations 1..max-iterations (verification sessions not counted)
        WE->>CS: execute (launch prompt, or correction assignment + findings)
        CS-->>WE: task_implemented | no_more_tasks | blocked

        alt no_more_tasks
            Note over WE: Run complete (exit 0)
        else blocked
            Note over WE: WorkflowBlocked (exit 1)
        else task_implemented (task_id, task_plan_file, revision?)
            WE->>VS: execute (launch prompt + assignment: task_id, task_plan_file, revision)
            VS-->>WE: verification_passed | workflow_finished | verification_failed | blocked

            alt verification_passed
                Note over WE: next coding iteration is autonomous, launch prompt, no assignment
            else workflow_finished
                Note over WE: WorkflowFinished (exit 0)
            else verification_failed (failure_summary, findings_file)
                WE->>WE: attempts[task_id] += 1
                alt attempts below max-verification-attempts
                    Note over WE: next coding iteration is a correction iteration:<br/>correction assignment + findings, no launch prompt
                else limit reached
                    Note over WE: verification limit reached (exit 6)
                end
            else blocked
                Note over WE: WorkflowBlocked (exit 1)
            end
        end
    end

    Note over WE: MaxIterationsReached (exit 4)
```

In either phase, an execution error or contract violation is retried once with a new nonce and the same prompt; a
second consecutive one ends the run (exit 3). A timeout (exit 5) or an interrupt (exit 130) ends the run immediately.
