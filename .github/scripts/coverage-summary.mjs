// Appends a coverage table to the GitHub Actions job summary.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const reportPath = "coverage/coverage-summary.json";
const summaryPath = process.env.GITHUB_STEP_SUMMARY;

if (!summaryPath) {
  console.error("GITHUB_STEP_SUMMARY is not set; run this script inside GitHub Actions.");
  process.exit(1);
}

if (!existsSync(reportPath)) {
  appendFileSync(summaryPath, "## Code coverage\n\nNo coverage report was generated. Check the test logs.\n");
  process.exit(0);
}

const { total } = JSON.parse(readFileSync(reportPath, "utf8"));
const rows = ["lines", "statements", "functions", "branches"].map((metric) => {
  const { pct, covered, total: count } = total[metric];
  return `| ${metric} | ${pct}% | ${covered}/${count} |`;
});

appendFileSync(
  summaryPath,
  [
    "## Code coverage",
    "",
    "| Metric | Coverage | Covered / Total |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "Required: 100% lines, statements, functions, and branches for every source file.",
    "Coverage includes src/**/*.ts executed inside Vitest. Spawned CLI subprocesses are not captured.",
    "Download the coverage-report artifact and open index.html for the file-level report.",
    "",
  ].join("\n"),
);
