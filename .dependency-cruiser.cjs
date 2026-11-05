/**
 * Architecture rules, checked by `pnpm depcheck` (part of `pnpm check`).
 * Layers, highest to lowest: cli, reporting, workflow, session, agents.
 * A layer may import lower layers, never higher ones. See doc/ARCHITECTURE.md.
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "Import cycles make modules impossible to understand or test in isolation.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "reporting-not-up",
      comment: "reporting may not import cli.",
      severity: "error",
      from: { path: "^src/reporting/" },
      to: { path: "^src/(cli/|cli\\.ts$)" },
    },
    {
      name: "workflow-not-up",
      comment: "workflow may not import cli or reporting.",
      severity: "error",
      from: { path: "^src/workflow/" },
      to: { path: "^src/(cli/|cli\\.ts$|reporting/)" },
    },
    {
      name: "session-not-up",
      comment: "session may not import cli, reporting or workflow.",
      severity: "error",
      from: { path: "^src/session/" },
      to: { path: "^src/(cli/|cli\\.ts$|reporting/|workflow/)" },
    },
    {
      name: "agents-not-up",
      comment: "agents is the lowest layer and imports nothing from the other layers.",
      severity: "error",
      from: { path: "^src/agents/" },
      to: { path: "^src/(cli/|cli\\.ts$|reporting/|workflow/|session/)" },
    },
    {
      name: "reporting-limits",
      comment: "reporting depends only on workflow events and the observer contract.",
      severity: "error",
      from: { path: "^src/reporting/" },
      to: { path: "^src/", pathNot: ["^src/reporting/", "^src/workflow/workflow-(event|observer)\\.ts$"] },
    },
    {
      name: "entry-limits",
      comment: "src/cli.ts is a thin entry point that only imports src/cli/.",
      severity: "error",
      from: { path: "^src/cli\\.ts$" },
      to: { path: "^src/", pathNot: "^src/cli/" },
    },
    {
      name: "agents-internals-private",
      comment: "Outside src/agents/, only the adapter contract and the registry are public.",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/agents/" },
      to: { path: "^src/agents/", pathNot: "^src/agents/(adapter|registry)\\.ts$" },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
    includeOnly: "^src/",
    // Count `import type` edges too: they are real architectural dependencies.
    tsPreCompilationDeps: true,
  },
};
