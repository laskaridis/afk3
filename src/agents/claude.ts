import type { AgentAdapter, AgentInput, FinalMessageResult } from "./adapter.js";

/** Adapter for Claude Code, run in non-interactive print mode with JSON output. */
export class ClaudeAdapter implements AgentAdapter {
  readonly name = "claude";
  readonly executable = "claude";

  /** Builds `claude -p` arguments with JSON output and `auto` permission mode, plus `--model` and `--effort` if given. */
  buildArgs({ model, effort }: AgentInput): string[] {
    // The prompt arrives on stdin in print mode; the workspace is the process's working directory.
    const args = ["-p", "--output-format", "json", "--permission-mode", "auto"];
    if (model !== undefined) args.push("--model", model);
    if (effort !== undefined) args.push("--effort", effort);
    return args;
  }

  /**
   * Reads the final message from the `result` field of the JSON document on stdout. Empty output or a blank result
   * is `missing`, unparseable output is `invalid`, and `is_error: true` is an `agentError` carrying the `subtype`.
   */
  extractFinalMessage(stdout: string): FinalMessageResult {
    if (stdout.trim() === "") return { missing: true };
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return { invalid: true, reason: "agent output could not be parsed" };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { invalid: true, reason: "agent output could not be parsed" };
    }
    const { is_error, subtype, result } = parsed as Record<string, unknown>;
    if (is_error === true) {
      return { agentError: true, detail: typeof subtype === "string" && subtype !== "" ? subtype : "unknown" };
    }
    return typeof result === "string" && result.trim() !== "" ? { message: result } : { missing: true };
  }
}
