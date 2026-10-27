#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command, CommanderError } from "commander";
import { buildSessionPrompt, parseFinalResponse } from "./protocol.js";
import { runSession } from "./session.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

async function main(argv: string[]): Promise<number> {
  const program = new Command()
    .name("afk")
    .version(version)
    .argument("<prompt>", "feature instructions")
    .exitOverride();
  try {
    program.parse(argv);
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2;
    throw error;
  }
  const [prompt] = program.args as [string];

  process.stderr.write("[afk] iteration 1\n");
  const result = await runSession({ prompt: buildSessionPrompt(prompt), cwd: process.cwd() });

  if (result.kind === "exited" && result.exitCode === 0 && result.finalMessage !== undefined) {
    const response = parseFinalResponse(result.finalMessage);
    if ("outcome" in response && response.outcome === "complete") {
      process.stderr.write("[afk] feature complete\n");
      return 0;
    }
  }
  process.stderr.write("[afk] execution error\n");
  return 3;
}

main(process.argv).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`[afk] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  },
);
