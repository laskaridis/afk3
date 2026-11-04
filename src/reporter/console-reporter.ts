import type { WorkflowEvent } from "../workflow/workflow-event.js";
import type { Reporter } from "./reporter.js";

export interface OutputSink {
  write(text: string): unknown;
}

/** Writes today's `[afk]` status lines for workflow events to its sink. WorkflowFailed has no final line. */
export class ConsoleReporter implements Reporter {
  constructor(private readonly sink: OutputSink) {}

  onEvent(event: WorkflowEvent): void {
    switch (event.type) {
      case "IterationStarted":
        if (!event.retry) this.line(`Iteration ${event.iteration}/${event.limit}: starting agent session`);
        break;
      case "StepExecutionRetried":
        this.line(`Iteration ${event.iteration}/${event.limit}: retrying agent session after execution error`);
        break;
      case "StepExecutionFailed":
        this.line(`Task failure: ${event.failureSummary}`);
        break;
      case "SessionExecutionErrorOccurred":
        this.line(`Execution error: ${event.detail}`, event.stderrTail);
        break;
      case "WorkflowFinished":
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
