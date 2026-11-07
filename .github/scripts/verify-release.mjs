// Fail closed unless this workflow is publishing the exact approved commit and version.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

const expectedSha = process.env.EXPECTED_SHA;
const expectedVersion = process.env.EXPECTED_VERSION;

if (!/^[0-9a-f]{40}$/.test(expectedSha ?? "")) {
  fail("Provide a full 40-character approved commit SHA.");
}

const actualSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const actualVersion = JSON.parse(readFileSync("package.json", "utf8")).version;

if (process.env.GITHUB_SHA !== expectedSha || actualSha !== expectedSha) {
  fail(`Workflow checkout ${actualSha} does not match approved SHA ${expectedSha}.`);
}

if (actualVersion !== expectedVersion) {
  fail(`Package version ${actualVersion} does not match approved version ${expectedVersion}.`);
}
