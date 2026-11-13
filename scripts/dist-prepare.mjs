import { chmodSync, copyFileSync } from "node:fs";

// Ship the agent instructions with the compiled CLI and make its bin entry executable.
for (const step of ["coding-step.md", "verification-step.md"]) {
  copyFileSync(`src/workflow/steps/${step}`, `dist/workflow/steps/${step}`);
}
chmodSync("dist/cli.js", 0o755);
