import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe.each(["coding-step.md", "verification-step.md"])("bundled %s", (file) => {
  const source = readFileSync(join(repoRoot, "src", "workflow", "steps", file), "utf8");

  it("is copied to dist with identical content", () => {
    expect(readFileSync(join(repoRoot, "dist", "workflow", "steps", file), "utf8")).toBe(source);
  });

  it("carries the nonce example block the session nonce is read from", () => {
    expect(source).toContain('<afk-harness-result nonce="{{NONCE}}">');
  });
});

describe("verification-step.md contract", () => {
  const text = readFileSync(join(repoRoot, "src", "workflow", "steps", "verification-step.md"), "utf8");

  it.each([
    "verification_passed",
    "workflow_finished",
    "verification_failed",
    "blocked",
    "failure_summary",
    "findings_file",
    "blocker_text",
    "<feature-name-slug>.verify.md",
    "<feature-name-slug>.code.md",
  ])("mentions %s", (term) => {
    expect(text).toContain(term);
  });
});
