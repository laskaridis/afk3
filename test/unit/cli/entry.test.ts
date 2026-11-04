import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
vi.mock("../../../src/cli/cli.js", () => ({
  CLI: class {
    run(argv: string[]) {
      return run(argv);
    }
  },
}));

let exitCodes: number[];
let stderr: string;

beforeEach(() => {
  vi.resetModules();
  run.mockReset();
  exitCodes = [];
  stderr = "";
  vi.spyOn(process, "exit").mockImplementation((code) => {
    exitCodes.push(Number(code));
    return undefined as never;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => vi.restoreAllMocks());

describe("src/cli.ts entry point", () => {
  it("runs the CLI with process.argv and exits with the returned code", async () => {
    run.mockResolvedValue(4);
    await import("../../../src/cli.js");
    await vi.waitFor(() => expect(exitCodes).toEqual([4]));
    expect(run).toHaveBeenCalledWith(process.argv);
    expect(stderr).toBe("");
  });

  it.each([
    [new Error("boom"), "boom"],
    ["plain failure", "plain failure"],
  ])("prints an unexpected error %j and exits 2", async (error, message) => {
    run.mockRejectedValue(error);
    await import("../../../src/cli.js");
    await vi.waitFor(() => expect(exitCodes).toEqual([2]));
    expect(stderr).toBe(`[afk] ${message}\n`);
  });
});
