import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import type { AgentRegistry } from "../agents/registry.js";
import { DEFAULT_MAX_ITERATIONS } from "../workflow/workflow-executor.js";
import { EXIT_CODES, formatExitCodeHelp } from "./exit-codes.js";

const MAX_TIMER_MS = 2 ** 31 - 1;

export interface CliOptions {
  agent: string;
  maxIterations: number;
  sessionTimeout?: number;
  promptFile?: string;
  cwd: string;
  model?: string;
  reasoningEffort?: string;
  /** Positional prompt arguments. */
  positional: string[];
}

/** Either the options to run with, or the exit code of a run that ended while parsing (help, version, error). */
export type ParsedOptions = { kind: "run"; options: CliOptions } | { kind: "exit"; code: number };

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
  // setTimeout treats delays above 2^31-1 ms as 1 ms.
  if (Number(value) * 1000 > MAX_TIMER_MS) {
    throw new InvalidArgumentError(`must be at most ${Math.floor(MAX_TIMER_MS / 1000)} seconds.`);
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

function readVersion(): string {
  // Resolves to the repository's package.json from both src/cli/ and dist/cli/.
  const require = createRequire(import.meta.url);
  return (require("../../package.json") as { version: string }).version;
}

/** Parse and validate argv. Help wins over every other option. */
export function parseOptions(argv: string[], registry: AgentRegistry): ParsedOptions {
  const parseAgent = (value: string): string => {
    if (!registry.names().includes(value)) {
      throw new InvalidArgumentError(`must be one of: ${registry.names().join(", ")}.`);
    }
    return value;
  };
  const program = new Command()
    .name("afk")
    .description("Leave the coding agent implementing a feature, one task at a time, while you are away from keyboard")
    .version(readVersion())
    .argument("[prompt...]", "feature instructions (or use --prompt-file, or pipe on stdin)")
    .option(
      "--agent <name>",
      `coding agent for every session (supported: ${registry.names().join(", ")}; default: ${registry.defaultName})`,
      parseAgent,
      registry.defaultName,
    )
    .option("--prompt-file <path>", "read the feature instructions from a file")
    .option("--cwd <directory>", "workspace directory for every session (default: current directory)", parseCwd)
    .option(
      "--max-iterations <count>",
      "maximum number of agent sessions to launch",
      parseMaxIterations,
      DEFAULT_MAX_ITERATIONS,
    )
    .option(
      "--session-timeout <seconds>",
      "stop the run if a single session exceeds this many seconds",
      parseSessionTimeout,
    )
    .option(
      "--model <name>",
      "model for every session, passed to the agent unchanged (default: the agent's configuration)",
      parseNonEmpty,
    )
    .option(
      "--reasoning-effort <level>",
      "reasoning effort for every session, passed to the agent unchanged (default: the agent's configuration)",
      parseNonEmpty,
    )
    .addHelpText("after", formatExitCodeHelp())
    .exitOverride();
  try {
    const optionArgs = argv.slice(2);
    const endOfOptions = optionArgs.indexOf("--");
    const valueOptions = new Set(program.options.filter((o) => o.required || o.optional).map((o) => o.long));
    const helpRequested = (endOfOptions === -1 ? optionArgs : optionArgs.slice(0, endOfOptions)).some(
      (arg, i, args) => (arg === "--help" || arg === "-h") && !valueOptions.has(args[i - 1]),
    );
    program.parse(helpRequested ? [...argv.slice(0, 2), "--help"] : argv);
  } catch (error) {
    if (error instanceof CommanderError)
      return { kind: "exit", code: error.exitCode === 0 ? 0 : EXIT_CODES.inputError };
    throw error;
  }
  const { cwd = process.cwd(), ...rest } = program.opts<Omit<CliOptions, "cwd" | "positional"> & { cwd?: string }>();
  return { kind: "run", options: { ...rest, cwd, positional: program.args } };
}
