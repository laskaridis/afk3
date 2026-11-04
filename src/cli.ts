#!/usr/bin/env node
import { CLI } from "./cli/cli.js";

new CLI().run(process.argv).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`[afk] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  },
);
