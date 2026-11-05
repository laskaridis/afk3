import { chmodSync, copyFileSync } from "node:fs";

// Ship the agent instructions with the compiled CLI and make its bin entry executable.
copyFileSync("src/code.md", "dist/code.md");
chmodSync("dist/cli.js", 0o755);
