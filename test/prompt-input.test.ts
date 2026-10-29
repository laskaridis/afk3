import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createFakeCodexEnvironment, startAfk } from "./helpers.js";

const COMPLETE = [{ finalMessage: '{"outcome":"complete"}' }, { exit: 0 }];

async function afk(args: string[], stdin?: string, setup?: (workspace: string) => void) {
  const fake = createFakeCodexEnvironment(COMPLETE);
  setup?.(fake.workspace);
  const result = await startAfk({ args, cwd: fake.workspace, env: fake.env, stdin }).done;
  return { fake, result };
}

function expectInputError({ fake, result }: Awaited<ReturnType<typeof afk>>) {
  expect(result.exitCode).toBe(2);
  expect(result.stderr).toMatch(/error/i);
  expect(fake.invocations()).toHaveLength(0);
}

describe("launch prompt sources", () => {
  it("reads the prompt from --prompt-file", async () => {
    const { fake, result } = await afk(["--prompt-file", "spec-prompt.txt"], undefined, (w) =>
      writeFileSync(join(w, "spec-prompt.txt"), "from file\n"),
    );
    expect(result.exitCode).toBe(0);
    expect(fake.soleInvocation().stdin).toMatch(/^from file\n/);
  });

  it("reads the prompt from piped stdin", async () => {
    const { fake, result } = await afk([], "do the thing\n");
    expect(result.exitCode).toBe(0);
    expect(fake.soleInvocation().stdin).toMatch(/^do the thing\n/);
  });

  it("accepts a positional prompt with empty stdin", async () => {
    const { fake, result } = await afk(["positional prompt"], "");
    expect(result.exitCode).toBe(0);
    expect(fake.soleInvocation().stdin).toMatch(/^positional prompt/);
  });

  const withFile = (w: string) => writeFileSync(join(w, "p.txt"), "file prompt");
  const cases: [string, string[], string | undefined, ((w: string) => void) | undefined][] = [
    ["positional and --prompt-file", ["x", "--prompt-file", "p.txt"], undefined, withFile],
    ["blank positional", ["   "], undefined, undefined],
    ["blank prompt file", ["--prompt-file", "p.txt"], undefined, (w) => writeFileSync(join(w, "p.txt"), " \n")],
    ["missing prompt file", ["--prompt-file", "nope.txt"], undefined, undefined],
    ["unreadable prompt file (a directory)", ["--prompt-file", "."], undefined, undefined],
    ["more than one positional", ["a", "b"], undefined, undefined],
    ["no source and empty stdin", [], "", undefined],
  ];
  it.each(cases)("rejects %s", async (_name, args, stdin, setup) => {
    expectInputError(await afk(args, stdin, setup));
  });
});

describe("--cwd", () => {
  it("runs every session in the selected directory", async () => {
    const fake = createFakeCodexEnvironment({
      sessions: [[{ finalMessage: '{"outcome":"repeat"}' }, { exit: 0 }], COMPLETE],
    });
    const target = join(fake.workspace, "other");
    mkdirSync(target);
    const result = await startAfk({
      args: ["go", "--cwd", target],
      cwd: mkdtempSync(join(fake.workspace, "elsewhere-")),
      env: fake.env,
    }).done;

    expect(result.exitCode).toBe(0);
    const invocations = fake.invocations();
    expect(invocations).toHaveLength(2);
    for (const invocation of invocations) {
      expect(invocation.cwd).toBe(target);
      expect(invocation.argv[invocation.argv.indexOf("-C") + 1]).toBe(target);
    }
  });

  it.each([
    ["a nonexistent path", (w: string) => join(w, "missing")],
    [
      "a regular file",
      (w: string) => {
        writeFileSync(join(w, "f"), "");
        return join(w, "f");
      },
    ],
  ])("rejects %s", async (_name, make) => {
    const fake = createFakeCodexEnvironment(COMPLETE);
    const result = await startAfk({ args: ["go", "--cwd", make(fake.workspace)], cwd: fake.workspace, env: fake.env })
      .done;
    expect(result.exitCode).toBe(2);
    expect(fake.invocations()).toHaveLength(0);
  });
});

describe("workspace preparation", () => {
  it("leaves git state alone and runs no git commands", async () => {
    const fake = createFakeCodexEnvironment(COMPLETE);
    const binDir = join(fake.workspace, "..", "bin");
    const log = join(fake.workspace, "..", "git.log");
    spawnSync("git", ["init", "-q"], { cwd: fake.workspace });
    const gitState = () =>
      [
        ["branch", "--all"],
        ["worktree", "list"],
      ].map((a) => spawnSync("git", a, { cwd: fake.workspace, encoding: "utf8" }).stdout);
    const before = gitState();
    writeFileSync(join(binDir, "git"), `#!/bin/sh\necho "$@" >> "${log}"\n`, { mode: 0o755 });

    const result = await startAfk({ args: ["go"], cwd: fake.workspace, env: fake.env }).done;

    expect(result.exitCode).toBe(0);
    expect(gitState()).toEqual(before);
    expect(spawnSync("test", ["-e", log]).status).not.toBe(0);
  });
});
