import { readFile } from "node:fs/promises";

/** The resolved prompt, or a user-facing message saying why none could be resolved. */
export type PromptResult = { ok: true; prompt: string } | { ok: false; message: string };

/** The places a launch prompt can come from, as the CLI found them. */
export interface PromptInput {
  /** Positional prompt arguments; at most one is allowed. */
  positional: string[];
  /** Path given with `--prompt-file`. */
  promptFile?: string;
  /** Whether stdin is a terminal; a terminal is never read. */
  stdinIsTTY: boolean;
  /** Reads all of stdin; called only when no explicit source is given and stdin is not a terminal. */
  readStdin: () => Promise<string>;
}

const isBlank = (text: string) => text.trim() === "";

/**
 * Resolve exactly one launch prompt; sources are never combined.
 *
 * Never throws for bad input: no source, several sources, an unreadable file or a blank prompt are returned as
 * `{ ok: false, message }`.
 */
export async function resolvePrompt(input: PromptInput): Promise<PromptResult> {
  if (input.positional.length > 1) {
    return { ok: false, message: "expected a single prompt argument, got " + input.positional.length };
  }
  // Stdin is only a fallback: a TTY is never read, and an explicit source means a
  // non-TTY stdin that is left open (cron, CI) must not block the run.
  const explicit = input.positional.length === 1 || input.promptFile !== undefined;
  const stdin = input.stdinIsTTY || explicit ? "" : await input.readStdin();
  const sources: { name: string; text: string }[] = [];

  if (input.positional.length === 1) sources.push({ name: "positional argument", text: input.positional[0]! });
  if (input.promptFile !== undefined) {
    try {
      sources.push({ name: `prompt file ${input.promptFile}`, text: await readFile(input.promptFile, "utf8") });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `cannot read prompt file ${input.promptFile}: ${reason}` };
    }
  }
  if (!isBlank(stdin)) sources.push({ name: "stdin", text: stdin });

  if (sources.length === 0) {
    return {
      ok: false,
      message: "no prompt provided: pass a prompt argument, --prompt-file <path>, or pipe it on stdin",
    };
  }
  if (sources.length > 1) {
    return {
      ok: false,
      message: `multiple prompt sources given (${sources.map((s) => s.name).join(", ")}); use exactly one`,
    };
  }
  const [source] = sources as [{ name: string; text: string }];
  if (isBlank(source.text)) return { ok: false, message: `the ${source.name} is empty` };
  return { ok: true, prompt: source.text };
}
