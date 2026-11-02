import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunResult } from "../../src/runner.js";
import type { SessionResult } from "../../src/session.js";
import { Command } from "commander";

const mocks = vi.hoisted(() => ({
  runAfk: vi.fn(),
  runSession: vi.fn(),
  buildSessionPrompt: vi.fn((prompt: string, nonce: string) => `${prompt} :: ${nonce}`),
}));

vi.mock("../../src/runner.js", async (original) => ({
  ...(await original<typeof import("../../src/runner.js")>()),
  runAfk: mocks.runAfk,
}));
vi.mock("../../src/session.js", async (original) => ({
  ...(await original<typeof import("../../src/session.js")>()),
  runSession: mocks.runSession,
}));
vi.mock("../../src/protocol.js", async (original) => ({
  ...(await original<typeof import("../../src/protocol.js")>()),
  buildSessionPrompt: mocks.buildSessionPrompt,
}));

let originalArgv: string[];
let originalGrace: string | undefined;
let listeners: Record<"SIGINT" | "SIGTERM" | "SIGHUP", ReturnType<typeof process.listeners>>;
let exitCodes: number[];
let stderr: string;
let stdout: string;

beforeEach(() => {
  vi.resetModules();
  mocks.runAfk.mockReset();
  mocks.runSession.mockReset();
  mocks.buildSessionPrompt.mockClear();
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
  mocks.runAfk.mockResolvedValue({ kind: "complete" });
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
  await import("../../src/cli.js");
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
    ["--agent", "unknown"],
    ["--cwd", "/definitely/missing/afk-directory"],
    ["--cwd", "package.json"],
  ])("rejects invalid option %s %s", async (option, value) => {
    expect(await launch([option, value, "prompt"])).toBe(2);
    expect(mocks.runAfk).not.toHaveBeenCalled();
  });

  it("accepts validated options and wires the session prompt and callbacks", async () => {
    process.env.AFK_TERMINATION_GRACE_MS = "25";
    mocks.runAfk.mockImplementation(async (config, runSession, reporter) => {
      expect(config).toMatchObject({ launchPrompt: "prompt", maxIterations: 3, sessionTimeoutSeconds: 2.5 });
      reporter.iterationStarted(1, 3);
      reporter.retryStarted(2, 3, "reason");
      reporter.failureSurfaced("test failed");
      reporter.executionError("bad exit", ["tail"]);
      expect(await runSession("prompt", "nonce")).toEqual({ kind: "exited", exitCode: 0 });
      return { kind: "blocked", blockerText: "need key" };
    });
    mocks.runSession.mockResolvedValue({ kind: "exited", exitCode: 0 } satisfies Partial<SessionResult>);
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
        "prompt",
      ]),
    ).toBe(1);
    expect(mocks.runSession).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "prompt :: nonce",
        cwd: process.cwd(),
        model: "my-model",
        effort: "high",
        graceMs: 25,
        timeoutSeconds: 2.5,
      }),
    );
    expect(stderr).toContain("[afk] Iteration 1/3: starting agent session\n");
    expect(stderr).toContain("[afk] Iteration 2/3: retrying agent session after execution error\n");
    expect(stderr).toContain("[afk] Task failure: test failed\n");
    expect(stderr).toContain("[afk] Execution error: bad exit\ntail\n");
    expect(stderr).toContain("[afk] Run blocked: need key\n");
    expect(stdout).toBe("");
  });

  it("uses defaults and forwards a signal to the session", async () => {
    mocks.runAfk.mockImplementation(async (config, runSession) => {
      expect(config.maxIterations).toBe(10);
      expect(config.adapter.name).toBe("codex");
      process.emit("SIGINT");
      process.emit("SIGTERM");
      process.emit("SIGHUP");
      await runSession("prompt", "nonce");
      return { kind: "interrupted" };
    });
    mocks.runSession.mockResolvedValue({ kind: "interrupted" });
    expect(await launch(["prompt"])).toBe(130);
    expect(mocks.runSession.mock.calls[0]?.[0]).toMatchObject({
      cwd: process.cwd(),
      graceMs: undefined,
      timeoutSeconds: undefined,
      signal: expect.objectContaining({ aborted: true }),
    });
    expect(stderr).toContain("[afk] Run interrupted by user\n");
  });

  it.each([
    [{ kind: "complete" }, 0, "Run complete"],
    [{ kind: "execution-error", errorKind: "exit-status", detail: "bad" }, 3, ""],
    [{ kind: "iteration-limit", limit: 1 }, 4, "Run stopped: iteration limit"],
    [{ kind: "timeout", seconds: 2 }, 5, "Run stopped: agent session timed out"],
  ] as Array<[RunResult, number, string]>)("maps a %j result to exit %i", async (result, code, status) => {
    mocks.runAfk.mockResolvedValue(result);
    expect(await launch(["prompt"])).toBe(code);
    if (status) expect(stderr).toContain(status);
    else expect(stderr).not.toContain("Run ");
  });

  it("reports missing prompt input before launching", async () => {
    const isTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    try {
      expect(await launch([])).toBe(2);
      expect(stderr).toContain("[afk] input error: no prompt provided");
      expect(mocks.runAfk).not.toHaveBeenCalled();
    } finally {
      if (isTTY) Object.defineProperty(process.stdin, "isTTY", isTTY);
      else Reflect.deleteProperty(process.stdin, "isTTY");
    }
  });

  it("lets help win over invalid options and preserves options after --", async () => {
    expect(await launch(["--agent", "invalid", "--help"])).toBe(0);
    expect(stdout).toContain("Usage: afk");
    expect(mocks.runAfk).not.toHaveBeenCalled();
  });

  it("treats help after -- or as an option value as input", async () => {
    expect(await launch(["--", "--help"])).toBe(0);
    expect(mocks.runAfk.mock.calls[0]?.[0].launchPrompt).toBe("--help");
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
      expect(mocks.runAfk.mock.calls[0]?.[0].launchPrompt).toBe("piped prompt");
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
    mocks.runAfk.mockRejectedValue(new Error("unexpected"));
    expect(await launch(["prompt"])).toBe(2);
    expect(stderr).toContain("[afk] unexpected\n");
  });
});
