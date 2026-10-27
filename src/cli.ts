#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { buildSessionPrompt } from "./protocol.js";
import { EXIT_CODES, exitCodeFor, formatFinalStatus } from "./reporter.js";
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

async function main(argv: string[]): Promise<number> {
  const program = new Command()
    .name("afk")
    .version(version)
    .argument("<prompt>", "feature instructions")
    .option("--max-iterations <count>", "maximum number of Codex sessions to launch", parseMaxIterations, DEFAULT_MAX_ITERATIONS)
    .exitOverride();
  try {
    program.parse(argv);
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : EXIT_CODES.inputError;
    throw error;
  }
  const [prompt] = program.args as [string];
  const { maxIterations } = program.opts<{ maxIterations: number }>();

  const result = await runAfk(
    { launchPrompt: prompt, maxIterations },
    (launchPrompt) => runSession({ prompt: buildSessionPrompt(launchPrompt), cwd: process.cwd() }),
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
