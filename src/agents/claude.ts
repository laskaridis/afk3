import type { AgentAdapter } from "./types.js";

export const claudeAdapter: AgentAdapter = {
  name: "claude",
  executable: "claude",
  buildArgs({ model, effort }) {
    // The prompt arrives on stdin in print mode; the workspace is the process's working directory.
    const args = ["-p", "--output-format", "json", "--permission-mode", "auto"];
    if (model !== undefined) args.push("--model", model);
    if (effort !== undefined) args.push("--effort", effort);
    return args;
  },
  extractFinalMessage(stdout) {
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
  },
};
