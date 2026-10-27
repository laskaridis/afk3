export type AgentOutcome = { outcome: "complete" };

const SESSION_INSTRUCTIONS = [
  "Use the available code skill to implement exactly one task, then follow its response protocol.",
  "Your final message must be only the code skill's JSON protocol response: a single JSON object, with no surrounding prose and no Markdown fences.",
].join("\n");

export function buildSessionPrompt(launchPrompt: string): string {
  return `${launchPrompt}\n\n---\n${SESSION_INSTRUCTIONS}\n`;
}

export function parseFinalResponse(text: string): AgentOutcome | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      (value as { outcome?: unknown }).outcome === "complete"
    ) {
      return { outcome: "complete" };
    }
  } catch {
    // not JSON: contract violation
  }
  return undefined;
}
