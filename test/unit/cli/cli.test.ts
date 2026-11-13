import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalWorkflowEvent } from "../../../src/workflow/workflow-event.js";
import { Command } from "commander";

const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  run: vi.fn(),
  subscribe: vi.fn(),
  factory: vi.fn(),
}));

vi.mock("../../../src/workflow/workflow-executor.js", async (original) => ({
  ...(await original<typeof import("../../../src/workflow/workflow-executor.js")>()),
  WorkflowExecutor: class {
    constructor(...args: unknown[]) {
      mocks.construct(...args);
    }
    subscribe(observer: unknown) {
      mocks.subscribe(observer);
    }
    run() {
      return mocks.run();
    }
  },
}));
vi.mock("../../../src/session/session-executor-factory.js", () => ({
  SessionExecutorFactory: class {
    constructor(...args: unknown[]) {
      mocks.factory(...args);
    }
  },
}));

let originalArgv: string[];
let originalGrace: string | undefined;
let listeners: Record<"SIGINT" | "SIGTERM" | "SIGHUP", ReturnType<typeof process.listeners>>;
let exitCodes: number[];
let stderr: string;
let stdout: string;

beforeEach(() => {
  vi.resetModules();
  mocks.construct.mockReset();
  mocks.run.mockReset();
  mocks.subscribe.mockReset();
  mocks.factory.mockReset();
  originalArgv = process.argv;
  originalGrace = process.env.AFK_TERMINATION_GRACE_MS;
  listeners = {
    SIGINT: process.listeners("SIGINT"),
    SIGTERM: process.listeners("SIGTERM"),
    SIGHUP: process.listeners("SIGHUP"),
  };
  exitCodes = [];
  stderr = "";
  stdout = "";
  vi.spyOn(process, "exit").mockImplementation((code) => {
    exitCodes.push(Number(code));
    return undefined as never;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  mocks.run.mockResolvedValue({ type: "WorkflowFinished", task: {} });
});

afterEach(() => {
  process.argv = originalArgv;
  if (originalGrace === undefined) delete process.env.AFK_TERMINATION_GRACE_MS;
  else process.env.AFK_TERMINATION_GRACE_MS = originalGrace;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    for (const listener of process.listeners(signal)) {
      if (!listeners[signal].includes(listener)) {
        process.removeListener(signal, listener);
      }
    }
  }
  vi.restoreAllMocks();
});

async function launch(args: string[]) {
  process.argv = ["node", "afk", ...args];
  await import("../../../src/cli.js");
  await vi.waitFor(() => expect(exitCodes).toHaveLength(1));
  return exitCodes[0];
}

describe("CLI entrypoint", () => {
  it.each([
    ["--max-iterations", "0"],
    ["--max-iterations", "1.5"],
    ["--max-iterations", "01"],
    ["--session-timeout", "0"],
    ["--session-timeout", "abc"],
    ["--session-timeout", "2147484"],
    ["--model", "   "],
    ["--reasoning-effort", ""],
    ["--max-verification-attempts", "0"],
    ["--max-verification-attempts", "1.5"],
    ["--max-verification-attempts", "01"],
    ["--max-verification-attempts", "abc"],
    ["--verify-model", "  "],
    ["--verify-reasoning-effort", ""],
    ["--agent", "unknown"],
    ["--cwd", "/definitely/missing/afk-directory"],
    ["--cwd", "package.json"],
  ])("rejects invalid option %s %s", async (option, value) => {
    expect(await launch([option, value, "prompt"])).toBe(2);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("defaults the verification attempt limit to 2 with no verification overrides", async () => {
    mocks.run.mockResolvedValue({ type: "WorkflowBlocked", blockerText: "x", task: {} });
    await launch(["prompt"]);
    expect(mocks.construct).toHaveBeenCalledWith(
      expect.objectContaining({ maxVerificationAttempts: 2, verifyModel: undefined, verifyEffort: undefined }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("wires the workflow executor from validated options and subscribes a console reporter", async () => {
    process.env.AFK_TERMINATION_GRACE_MS = "25";
    mocks.subscribe.mockImplementation((observer: { onEvent(event: unknown): void }) => {
      observer.onEvent({ type: "WorkflowBlocked", blockerText: "test failed", task: {} });
    });
    mocks.run.mockResolvedValue({ type: "WorkflowBlocked", blockerText: "need key", task: {} });
    expect(
      await launch([
        "--agent",
        "claude",
        "--cwd",
        ".",
        "--max-iterations",
        "3",
        "--session-timeout",
        "2.5",
        "--model",
        "my-model",
        "--reasoning-effort",
        "high",
        "--max-verification-attempts",
        "4",
        "--verify-model",
        "strong-model",
        "--verify-reasoning-effort",
        "max",
        "prompt",
      ]),
    ).toBe(1);
    expect(mocks.construct).toHaveBeenCalledWith(
      expect.objectContaining({
        adapter: expect.objectContaining({ name: "claude" }),
        model: "my-model",
        effort: "high",
        maxIterations: 3,
        maxVerificationAttempts: 4,
        verifyModel: "strong-model",
        verifyEffort: "max",
        sessionTimeoutSeconds: 2.5,
        cwd: process.cwd(),
      }),
      { text: "prompt" },
      expect.anything(),
    );
    expect(mocks.factory).toHaveBeenCalledWith(expect.objectContaining({ aborted: false }), 2.5, 25);
    expect(stderr).toBe("[afk] Run blocked: test failed\n");
    expect(stdout).toBe("");
  });

  it("uses defaults and aborts the shared signal on SIGINT, SIGTERM and SIGHUP", async () => {
    mocks.run.mockImplementation(async () => {
      process.emit("SIGINT");
      process.emit("SIGTERM");
      process.emit("SIGHUP");
      return { type: "WorkflowInterrupted" };
    });
    expect(await launch(["prompt"])).toBe(130);
    expect(mocks.construct.mock.calls[0]?.[0]).toMatchObject({ maxIterations: 10, cwd: process.cwd() });
    expect(mocks.factory).toHaveBeenCalledWith(expect.objectContaining({ aborted: true }), undefined, undefined);
    expect(stderr).toBe("");
  });

  it.each([
    [{ type: "WorkflowFinished", task: {} }, 0],
    [{ type: "WorkflowFailed", detail: "bad", stderrTail: [] }, 3],
    [{ type: "MaxIterationsReached", limit: 1 }, 4],
    [{ type: "WorkflowTimedOut", seconds: 2 }, 5],
  ] as Array<[TerminalWorkflowEvent, number]>)("exits for the run() result %j with %i", async (result, code) => {
    mocks.run.mockResolvedValue(result);
    expect(await launch(["prompt"])).toBe(code);
  });

  it("reports missing prompt input before launching", async () => {
    const isTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    try {
      expect(await launch([])).toBe(2);
      expect(stderr).toContain("[afk] input error: no prompt provided");
      expect(mocks.run).not.toHaveBeenCalled();
    } finally {
      if (isTTY) Object.defineProperty(process.stdin, "isTTY", isTTY);
      else Reflect.deleteProperty(process.stdin, "isTTY");
    }
  });

  it("lets help win over invalid options and preserves options after --", async () => {
    expect(await launch(["--agent", "invalid", "--help"])).toBe(0);
    expect(stdout).toContain("Usage: afk");
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("treats help after -- or as an option value as input", async () => {
    expect(await launch(["--", "--help"])).toBe(0);
    expect(mocks.construct.mock.calls[0]?.[1]).toEqual({ text: "--help" });
  });

  it("reads piped stdin in chunks when there is no explicit prompt", async () => {
    const isTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
    const iterator = vi
      .spyOn(process.stdin, Symbol.asyncIterator)
      .mockImplementation(async function* (): AsyncGenerator<string, undefined> {
        yield "piped ";
        yield "prompt";
        return undefined;
      });
    const encoding = vi.spyOn(process.stdin, "setEncoding").mockReturnValue(process.stdin);
    try {
      expect(await launch([])).toBe(0);
      expect(mocks.construct.mock.calls[0]?.[1]).toEqual({ text: "piped prompt" });
      expect(encoding).toHaveBeenCalledWith("utf8");
    } finally {
      iterator.mockRestore();
      encoding.mockRestore();
      if (isTTY) Object.defineProperty(process.stdin, "isTTY", isTTY);
      else Reflect.deleteProperty(process.stdin, "isTTY");
    }
  });

  it("propagates unexpected parser errors to the outer error handler", async () => {
    const parse = vi.spyOn(Command.prototype, "parse").mockImplementation(() => {
      throw "parser failure";
    });
    try {
      expect(await launch(["prompt"])).toBe(2);
      expect(stderr).toContain("[afk] parser failure\n");
    } finally {
      parse.mockRestore();
    }
  });

  it("prints a rejected main error and exits with input code", async () => {
    mocks.run.mockRejectedValue(new Error("unexpected"));
    expect(await launch(["prompt"])).toBe(2);
    expect(stderr).toContain("[afk] unexpected\n");
  });
});
