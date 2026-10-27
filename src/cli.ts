#!/usr/bin/env node
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { resolvePrompt } from "./prompt.js";
import { buildSessionPrompt } from "./protocol.js";
import { EXIT_CODES, exitCodeFor, formatExitCodeHelp, formatFinalStatus } from "./reporter.js";
import { DEFAULT_MAX_ITERATIONS, runAfk } from "./runner.js";
import { runSession } from "./session.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

function parseMaxIterations(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new InvalidArgumentError("must be a positive integer.");
  }
  return Number(value);
}

function parseSessionTimeout(value: string): number {
  if (!/^\d+(\.\d+)?$/.test(value) || Number(value) <= 0) {
    throw new InvalidArgumentError("must be a positive number of seconds.");
  }
  return Number(value);
}

function parseNonEmpty(value: string): string {
  if (value.trim() === "") throw new InvalidArgumentError("must not be empty.");
  return value;
}

function parseCwd(value: string): string {
  const directory = resolve(value);
  let isDirectory = false;
  try {
    isDirectory = statSync(directory).isDirectory();
  } catch {
    // reported below
  }
  if (!isDirectory) throw new InvalidArgumentError(`${value} is not an existing directory.`);
  return directory;
}

async function readAllStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) text += chunk as string;
  return text;
}

async function main(argv: string[]): Promise<number> {
  const program = new Command()
    .name("afk")
    .version(version)
    .argument("[prompt...]", "feature instructions (or use --prompt-file, or pipe on stdin)")
    .option("--prompt-file <path>", "read the feature instructions from a file")
    .option("--cwd <directory>", "workspace directory for every session (default: current directory)", parseCwd)
    .option("--max-iterations <count>", "maximum number of Codex sessions to launch", parseMaxIterations, DEFAULT_MAX_ITERATIONS)
    .option("--session-timeout <seconds>", "stop the run if a single session exceeds this many seconds", parseSessionTimeout)
    .option("--model <name>", "model for every session (default: your Codex configuration)", parseNonEmpty)
    .option("--reasoning-effort <level>", "reasoning effort for every session (default: your Codex configuration)", parseNonEmpty)
    .addHelpText("after", formatExitCodeHelp())
    .exitOverride();
  try {
    // Help takes precedence over validation of every other option.
    const optionArgs = argv.slice(2);
    const endOfOptions = optionArgs.indexOf("--");
    const helpRequested = (endOfOptions === -1 ? optionArgs : optionArgs.slice(0, endOfOptions)).some(
      (arg) => arg === "--help" || arg === "-h",
    );
    program.parse(helpRequested ? [...argv.slice(0, 2), "--help"] : argv);
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : EXIT_CODES.inputError;
    throw error;
  }
  const { maxIterations, sessionTimeout, promptFile, cwd = process.cwd(), model, reasoningEffort } = program.opts<{
    maxIterations: number;
    sessionTimeout?: number;
    promptFile?: string;
    cwd?: string;
    model?: string;
    reasoningEffort?: string;
  }>();
  const resolved = await resolvePrompt({
    positional: program.args,
    promptFile,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    readStdin: readAllStdin,
  });
  if (!resolved.ok) {
    process.stderr.write(`[afk] input error: ${resolved.message}\n`);
    return EXIT_CODES.inputError;
  }
  const prompt = resolved.prompt;

  const interruption = new AbortController();
  // Repeated SIGINTs are absorbed: the first one already stops the run.
  process.on("SIGINT", () => interruption.abort());

  const graceMs = Number(process.env.AFK_TERMINATION_GRACE_MS) || undefined;
  const result = await runAfk(
    { launchPrompt: prompt, maxIterations, sessionTimeoutSeconds: sessionTimeout },
    (launchPrompt) => runSession({ prompt: buildSessionPrompt(launchPrompt), cwd, signal: interruption.signal, graceMs, timeoutSeconds: sessionTimeout, model, reasoningEffort }),
    {
      iterationStarted: (iteration, limit) => process.stderr.write(`[afk] iteration ${iteration}/${limit}\n`),
      retryStarted: (iteration, limit, reason) =>
        process.stderr.write(`[afk] retrying after execution error (${reason}): iteration ${iteration}/${limit}\n`),
      failureSurfaced: (summary) => process.stderr.write(`[afk] failure reported: ${summary}\n`),
    },
  );
  process.stderr.write(`[afk] ${formatFinalStatus(result)}\n`);
  return exitCodeFor(result);
}

main(process.argv).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`[afk] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  },
);
