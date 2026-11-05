import { rmSync } from "node:fs";

// Remove stale build output before TypeScript creates the new dist directory.
rmSync("dist", { recursive: true, force: true });
