import { chmodSync, copyFileSync } from "node:fs";

// Ship the agent instructions with the compiled CLI and make its bin entry executable.
copyFileSync("src/workflow/steps/code-step.md", "dist/workflow/steps/code-step.md");
chmodSync("dist/cli.js", 0o755);
