import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolvePrompt } from "../../src/prompt.js";

const fileFailure = vi.hoisted(() => ({ nonError: false }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      if (fileFailure.nonError) throw "unavailable";
      return actual.readFile(...args);
    },
  };
});

describe("resolvePrompt", () => {
  it("returns a missing-input error for a TTY stdin without reading it", async () => {
    const readStdin = vi.fn(async () => "never");
    const result = await resolvePrompt({ positional: [], stdinIsTTY: true, readStdin });

    expect(result).toEqual({ ok: false, message: expect.stringContaining("no prompt") });
    expect(readStdin).not.toHaveBeenCalled();
  });

  it("uses a positional prompt on a TTY without reading stdin", async () => {
    const readStdin = vi.fn(async () => "never");
    const result = await resolvePrompt({ positional: ["do it"], stdinIsTTY: true, readStdin });

    expect(result).toEqual({ ok: true, prompt: "do it" });
    expect(readStdin).not.toHaveBeenCalled();
  });

  it("uses non-blank stdin as the only source", async () => {
    const result = await resolvePrompt({ positional: [], stdinIsTTY: false, readStdin: async () => "do the thing\n" });
    expect(result).toEqual({ ok: true, prompt: "do the thing\n" });
  });

  it("ignores blank stdin when another source exists", async () => {
    const result = await resolvePrompt({ positional: ["x"], stdinIsTTY: false, readStdin: async () => " \n" });
    expect(result).toEqual({ ok: true, prompt: "x" });
  });

  it("does not read stdin when another source exists", async () => {
    const readStdin = vi.fn(async () => "y");
    const result = await resolvePrompt({ positional: ["x"], stdinIsTTY: false, readStdin });
    expect(result).toEqual({ ok: true, prompt: "x" });
    expect(readStdin).not.toHaveBeenCalled();
  });

  it("rejects more than one positional argument", async () => {
    const result = await resolvePrompt({ positional: ["a", "b"], stdinIsTTY: true, readStdin: async () => "" });
    expect(result.ok).toBe(false);
  });

  it("rejects a blank positional prompt", async () => {
    const result = await resolvePrompt({ positional: ["  "], stdinIsTTY: true, readStdin: async () => "" });
    expect(result.ok).toBe(false);
  });

  it("reads a prompt file and skips stdin", async () => {
    const dir = await mkdtemp(join(tmpdir(), "afk-prompt-test-"));
    try {
      const path = join(dir, "prompt.txt");
      await writeFile(path, "from file\n");
      const readStdin = vi.fn(async () => "unused");
      expect(await resolvePrompt({ positional: [], promptFile: path, stdinIsTTY: false, readStdin })).toEqual({
        ok: true,
        prompt: "from file\n",
      });
      expect(readStdin).not.toHaveBeenCalled();
      expect(
        await resolvePrompt({ positional: ["also supplied"], promptFile: path, stdinIsTTY: true, readStdin }),
      ).toEqual({
        ok: false,
        message: `multiple prompt sources given (positional argument, prompt file ${path}); use exactly one`,
      });
      await writeFile(path, " \n");
      expect(await resolvePrompt({ positional: [], promptFile: path, stdinIsTTY: true, readStdin })).toEqual({
        ok: false,
        message: `the prompt file ${path} is empty`,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports unreadable prompt files and blank piped input", async () => {
    const path = join(tmpdir(), "afk-missing-prompt-file");
    expect(
      await resolvePrompt({ positional: [], promptFile: path, stdinIsTTY: true, readStdin: async () => "" }),
    ).toEqual({
      ok: false,
      message: expect.stringContaining(`cannot read prompt file ${path}:`),
    });
    expect(await resolvePrompt({ positional: [], stdinIsTTY: false, readStdin: async () => " \n" })).toEqual({
      ok: false,
      message: expect.stringContaining("no prompt provided"),
    });
  });

  it("stringifies a non-Error file read failure", async () => {
    fileFailure.nonError = true;
    try {
      expect(
        await resolvePrompt({
          positional: [],
          promptFile: "/missing",
          stdinIsTTY: true,
          readStdin: async () => "",
        }),
      ).toEqual({ ok: false, message: "cannot read prompt file /missing: unavailable" });
    } finally {
      fileFailure.nonError = false;
    }
  });

  it("preserves varied piped prompts verbatim", async () => {
    const prompts = [
      "plain",
      "leading space",
      "trailing space ",
      "first\nsecond",
      "first\nsecond\n",
      "first\r\nsecond",
      "emoji 🛠️",
      'quoted "text"',
      "apostrophe's",
      "--help",
      "```code```",
      '{"task":"ship"}',
    ];
    for (const prompt of prompts) {
      expect(await resolvePrompt({ positional: [], stdinIsTTY: false, readStdin: async () => prompt })).toEqual({
        ok: true,
        prompt,
      });
    }
  });
});
