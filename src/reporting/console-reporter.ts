import type { WorkflowEvent } from "../workflow/workflow-event.js";
import type { ReporterOutputSink } from "./reporter-output-sink.js";
import type { Reporter } from "./reporter.js";

/** How a step's session is called in status lines; agent-neutral. */
function sessionName(stepName: string): string {
  return stepName === "verification" ? "verification session" : "agent session";
}

/** Writes today's `[afk]` status lines for workflow events to its sink. WorkflowFailed has no final line. */
export class ConsoleReporter implements Reporter {
  /** @param sink Where the status lines are written. */
  constructor(private readonly sink: ReporterOutputSink) {}

  /** Writes the status line for `event`, if it has one; other events are ignored. */
  onEvent(event: WorkflowEvent): void {
    switch (event.type) {
      case "StepExecutionStarted":
        if (!event.retry)
          this.line(`Iteration ${event.iteration}/${event.limit}: starting ${sessionName(event.stepName)}`);
        break;
      case "StepExecutionRetried":
        this.line(
          `Iteration ${event.iteration}/${event.limit}: retrying ${sessionName(event.stepName)} after execution error`,
        );
        break;
      case "VerificationPassed":
        this.line("Verification passed");
        break;
      case "VerificationFailed":
        this.line(`Verification failed (attempt ${event.attempt}/${event.limit}): ${event.failureSummary}`);
        break;
      case "SessionExecutionErrorOccurred":
        this.line(`Execution error: ${event.detail}`, event.stderrTail);
        break;
      case "WorkflowFinished":
        this.line("Run complete: no more tasks");
        break;
      case "WorkflowCompleted":
        this.line("Run complete: feature complete");
        break;
      case "WorkflowBlocked":
        this.line(`Run blocked: ${event.blockerText}`);
        break;
      case "MaxIterationsReached":
        this.line(`Run stopped: iteration limit of ${event.limit} reached without reported completion`);
        break;
      case "WorkflowTimedOut":
        this.line(`Run stopped: agent session timed out after ${event.seconds} seconds`);
        break;
      case "WorkflowInterrupted":
        this.line("Run interrupted by user");
        break;
      default:
        break;
    }
  }

  private line(message: string, extra: readonly string[] = []): void {
    this.sink.write([`[afk] ${message}`, ...extra].map((text) => `${text}\n`).join(""));
  }
}
