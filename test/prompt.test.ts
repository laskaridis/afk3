import { describe, expect, it, vi } from "vitest";
import { resolvePrompt } from "../src/prompt.js";

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
});
