import type { AgentAdapter } from "./types.js";

export const codexAdapter: AgentAdapter = {
  name: "codex",
  executable: "codex",
  buildArgs({ cwd, outputFile, model, effort }) {
    const args = ["exec", "--approve-for-me", "-C", cwd];
    // Stdout is a progress log; the final message is only reliable in the output file.
    if (outputFile !== undefined) args.push("--output-last-message", outputFile);
    if (model !== undefined) args.push("--model", model);
    if (effort !== undefined) args.push("--config", `model_reasoning_effort=${JSON.stringify(effort)}`);
    // `-` makes Codex read the prompt from stdin.
    args.push("-");
    return args;
  },
  /**
   * Codex's stdout is a progress log (reasoning, tool calls), so it is ignored here. Instead `buildArgs` asks Codex
   * to write its last message to a file via `--output-last-message`; the session reads that file after Codex exits
   * and hands its content in as `outputFile`.
   *
   * The content is returned as-is. Finding the `<afk-harness-result>` block inside it is the protocol's job.
   * No file, or a blank one, means Codex never produced a final message.
   */
  extractFinalMessage(_, outputFile) {
    return outputFile === undefined || outputFile.trim() === "" ? { missing: true } : { message: outputFile };
  },
};
