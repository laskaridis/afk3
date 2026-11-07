---
name: publish
description: Release a new @laskaridis/afk version to npm using the documented GitHub Actions workflow.
---

# Publish

Follow `doc/PUBLISH.md`. Assume npm trusted publishing is already configured. Never publish locally or use npm credentials.

1. **Establish baseline.** Read `package.json` and run `npm view @laskaridis/afk@latest version gitHead --json`. The npm registry is authoritative for the latest shipped version; use its `gitHead` as the shipped commit only if present and verifiable in this repository. If absent or unverifiable, use the commit pointed to by the newest *published-release* `vX.Y.Z` Git tag (verify it corresponds to an npm-published version). If neither identifies a reliable shipped commit, **ask the user**; do not guess. Never assume the current `package.json` version has shipped.
2. **Choose bump.** Review `git log` and `git diff` from the shipped commit to current `main`, including user-visible behavior and exit codes. Classify the highest-impact change: breaking = major; backward-compatible functionality = minor; fixes/docs/internal only = patch. Explain the evidence and proposed version. If breaking compatibility or intent is ambiguous, ask the user before proceeding. Select a version greater than every previously published npm version; never reuse a version.
3. **Prepare release PR.** Require a clean tree and up-to-date `main`. Create `release-X.Y.Z`, run `npm version X.Y.Z --no-git-tag-version`, and verify only `package.json` changed. Run `pnpm install --frozen-lockfile && pnpm check`; optionally `npm pack --dry-run`. Commit `Release X.Y.Z`, push, and open a PR targeting `main`. Do not merge it yourself. Stop until the PR is merged and CI on `main` passes.
4. **Publish.** After the release PR is merged, run `git fetch origin main` and record the full approved SHA with `approved_sha=$(git rev-parse origin/main)`. Verify its changes and `package.json` version are exactly the intended release; stop and reassess if `main` has advanced unexpectedly. Require green CI **for that SHA** and explicit user authorization for **that SHA and version**. Dispatch `Publish to npm` on `main` with `expected_sha=$approved_sha` and `expected_version=X.Y.Z` (e.g. `gh workflow run publish.yml --ref main -f expected_sha="$approved_sha" -f expected_version="X.Y.Z"`). The workflow must reject mismatched checkout/event SHAs or package versions. Confirm the successful run's SHA matches the approved SHA and it published the intended version; verify with `npm view @laskaridis/afk version` and `npx @laskaridis/afk@X.Y.Z --version`. A failed or unverified publication is not a release.
5. **Tag (mandatory).** Obtain the **full commit SHA of the successful publishing workflow run** (not the current tip of `main`). Verify no conflicting `vX.Y.Z` tag exists, then `git fetch origin <sha>`, `git tag vX.Y.Z <sha>`, and `git push origin vX.Y.Z`. Verify the remote tag points to that SHA. Report the npm version, workflow run, and tag. Never report completion before tagging succeeds.

If a command or required evidence is unavailable, stop at that step and give the exact blocker; do not skip safeguards.
