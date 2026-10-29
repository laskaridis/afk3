import type { AgentAdapter } from "./types.js";

export const codexAdapter: AgentAdapter = {
  name: "codex",
  executable: "codex",
  buildArgs({ cwd, model, effort }) {
    const args = ["exec", "--approve-for-me", "-C", cwd];
    if (model !== undefined) args.push("-m", model);
    if (effort !== undefined) args.push("-c", `model_reasoning_effort=${JSON.stringify(effort)}`);
    // `-` makes Codex read the prompt from stdin.
    args.push("-");
    return args;
  },
  extractFinalMessage(stdout) {
    return stdout.trim() === "" ? { missing: true } : { message: stdout };
  },
};
