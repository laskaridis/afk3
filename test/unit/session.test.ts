import { EventEmitter } from "node:events";
import { access, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codexAdapter } from "../../src/agents/codex.js";
import { DEFAULT_TERMINATION_GRACE_MS, runSession, STDERR_TAIL_LINES } from "../../src/session.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
import { spawn } from "node:child_process";

const mockedSpawn = vi.mocked(spawn);

function child() {
  const process = new EventEmitter() as ChildProcess;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(process, { stdin, stdout, stderr, kill: vi.fn(() => true) });
  return { process, stdin, stdout, stderr, kill: vi.mocked(process.kill) };
}

const options = { adapter: codexAdapter, prompt: "do work", cwd: process.cwd() };

afterEach(() => {
  mockedSpawn.mockReset();
});

describe("runSession", () => {
  it("does not spawn when already interrupted", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await runSession({ ...options, signal: controller.signal })).toEqual({ kind: "interrupted" });
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it("captures output, passes options, retains the last stderr lines, and removes the output directory", async () => {
    const fake = child();
    const input: string[] = [];
    fake.stdin.on("data", (chunk: Buffer) => input.push(chunk.toString()));
    let outputPath = "";
    mockedSpawn.mockImplementation((_command, args) => {
      outputPath = args[args.indexOf("--output-last-message") + 1]!;
      queueMicrotask(async () => {
        await writeFile(outputPath, "final answer");
        fake.stdout.write("one");
        fake.stdout.write(" two");
        fake.stderr.write(Array.from({ length: STDERR_TAIL_LINES + 2 }, (_, i) => `line ${i}\n`).join(""));
        fake.stderr.write("partial");
        fake.stderr.write(" end");
        fake.process.emit("close", 0, null);
      });
      return fake.process;
    });
    const result = await runSession({ ...options, model: "model", effort: "high", timeoutSeconds: 3 });
    expect(mockedSpawn).toHaveBeenCalledWith("codex", expect.arrayContaining(["--model", "model"]), {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(input.join("")).toBe("do work");
    expect(result).toEqual({
      kind: "exited",
      exitCode: 0,
      signal: null,
      stdout: "one two",
      outputFile: "final answer",
      stderrTail: [...Array.from({ length: STDERR_TAIL_LINES - 1 }, (_, i) => `line ${i + 3}`), "partial end"],
    });
    await expect(access(outputPath)).rejects.toThrow();
  });

  it("returns an exited result when no output file was written and ignores stdin errors", async () => {
    const fake = child();
    mockedSpawn.mockImplementation(() => {
      queueMicrotask(() => {
        fake.stdin.emit("error", new Error("closed"));
        fake.stderr.write("first\nsecond\n");
        fake.process.emit("close", 2, null);
      });
      return fake.process;
    });
    expect(await runSession(options)).toEqual({
      kind: "exited",
      exitCode: 2,
      signal: null,
      stdout: "",
      stderrTail: ["first", "second"],
      outputFile: undefined,
    });
  });

  it("returns launch failures", async () => {
    const fake = child();
    const error = new Error("ENOENT");
    mockedSpawn.mockImplementation(() => {
      queueMicrotask(() => fake.process.emit("error", error));
      return fake.process;
    });
    expect(await runSession(options)).toEqual({ kind: "launch-failed", error });
  });

  it("interrupts and escalates signals until the child closes", async () => {
    const fake = child();
    const controller = new AbortController();
    mockedSpawn.mockImplementation(() => {
      queueMicrotask(() => controller.abort());
      return fake.process;
    });
    const pending = runSession({ ...options, signal: controller.signal, graceMs: 5 });
    await vi.waitFor(() => expect(fake.kill).toHaveBeenCalledWith("SIGINT"));
    controller.abort();
    await vi.waitFor(() => expect(fake.kill).toHaveBeenCalledWith("SIGKILL"));
    expect(fake.kill.mock.calls.map(([signal]) => signal)).toEqual(["SIGINT", "SIGTERM", "SIGKILL"]);
    fake.process.emit("close", null, "SIGKILL");
    expect(await pending).toEqual({ kind: "interrupted" });
  });

  it("times out, then lets a user interruption take precedence", async () => {
    const fake = child();
    const controller = new AbortController();
    mockedSpawn.mockReturnValue(fake.process);
    const pending = runSession({ ...options, signal: controller.signal, timeoutSeconds: 0.01, graceMs: 50 });
    await vi.waitFor(() => expect(fake.kill).toHaveBeenCalledWith("SIGINT"));
    controller.abort();
    fake.process.emit("close", null, "SIGINT");
    expect(await pending).toEqual({ kind: "interrupted" });
    expect(fake.kill).toHaveBeenCalledTimes(1);
  });

  it("reports a timeout if the child exits after the timer fires", async () => {
    const fake = child();
    mockedSpawn.mockReturnValue(fake.process);
    const pending = runSession({ ...options, timeoutSeconds: 0.01 });
    await vi.waitFor(() => expect(fake.kill).toHaveBeenCalledWith("SIGINT"));
    fake.process.emit("close", null, "SIGINT");
    expect(await pending).toEqual({ kind: "timed-out" });
  });

  it("uses the default grace and handles an abort between the initial check and listener setup", async () => {
    const fake = child();
    const controller = new AbortController();
    const adapter = { ...codexAdapter, buildArgs: codexAdapter.buildArgs.bind(codexAdapter) };
    adapter.buildArgs = (input) => {
      controller.abort();
      return codexAdapter.buildArgs(input);
    };
    mockedSpawn.mockReturnValue(fake.process);
    const pending = runSession({ ...options, adapter, signal: controller.signal });
    await vi.waitFor(() => expect(fake.kill).toHaveBeenCalledWith("SIGINT"));
    expect(DEFAULT_TERMINATION_GRACE_MS).toBe(5000);
    fake.process.emit("close", null, "SIGINT");
    expect(await pending).toEqual({ kind: "interrupted" });
  });

  it("ignores repeated interruption callbacks and a later timeout", async () => {
    const fake = child();
    const controller = new AbortController();
    let interrupt: EventListenerOrEventListenerObject | undefined;
    let ready!: () => void;
    const listenerReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const add = vi.spyOn(controller.signal, "addEventListener").mockImplementation((_type, listener) => {
      interrupt = listener;
      ready();
    });
    mockedSpawn.mockReturnValue(fake.process);
    const pending = runSession({ ...options, signal: controller.signal, timeoutSeconds: 0.05, graceMs: 100 });
    await listenerReady;
    (interrupt as EventListener)(new Event("abort"));
    (interrupt as EventListener)(new Event("abort"));
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(fake.kill.mock.calls.map(([signal]) => signal)).toEqual(["SIGINT"]);
    fake.process.emit("close", null, "SIGINT");
    expect(await pending).toEqual({ kind: "interrupted" });
    add.mockRestore();
  });

  it("handles an empty split result from a malformed stream chunk", async () => {
    const fake = child();
    const split = String.prototype.split;
    mockedSpawn.mockImplementation(() => {
      queueMicrotask(() => {
        const mock = vi.spyOn(String.prototype, "split").mockImplementation(function (this: string, separator, limit) {
          if (String(this) === "unusual" && (separator as unknown) === "\n") return [];
          return split.call(String(this), separator, limit);
        });
        try {
          fake.stderr.write("unusual");
        } finally {
          mock.mockRestore();
        }
        fake.process.emit("close", 0, null);
      });
      return fake.process;
    });
    expect(await runSession(options)).toMatchObject({ kind: "exited", stderrTail: [] });
  });
});
