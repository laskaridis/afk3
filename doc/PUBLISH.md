# Publishing afk to npm

This guide explains how to publish a new version of [`@laskaridis/afk`](https://www.npmjs.com/package/@laskaridis/afk)
to npm. Anyone with write access to the repository can follow it. You do **not** need an npm account, npm token, or any
local npm login: publishing runs in GitHub Actions and authenticates with npm trusted publishing (OIDC).

## How it works

The [Publish to npm](../.github/workflows/publish.yml) workflow:

1. only runs when started manually (`workflow_dispatch`) and fails unless it runs from `main`;
2. installs dependencies with `pnpm install --frozen-lockfile`;
3. runs `pnpm check` (tests, typecheck, lint, prettier, depcheck) — a failure stops the release;
4. runs `npm publish --access public`, which builds `dist/` first (via `prepack`) and publishes only the `dist/` folder.

The version that gets published is whatever `version` says in `package.json` on `main`. The workflow does not bump the
version, tag the commit, or create a GitHub release.

## Before you start

- You have write access to `laskaridis/afk3` on GitHub.
- All changes meant for the release are merged to `main`, and CI on `main` is green.
- The trusted publisher is configured on npm (one-time setup, see [First-time setup](#first-time-setup)).

## Publish a new version

### 1. Choose the version

Follow [semantic versioning](https://semver.org/):

| Change                                          | Bump  | Example           |
| ----------------------------------------------- | ----- | ----------------- |
| Breaking change (options, exit codes, behavior) | major | `1.0.0` → `2.0.0` |
| New backwards-compatible feature                | minor | `1.0.0` → `1.1.0` |
| Bug fix, docs, internal change                  | patch | `1.0.0` → `1.0.1` |

Behavior and exit codes are a contract, see [PRODUCT.md](PRODUCT.md). When in doubt about a change being breaking, treat
it as breaking.

npm never accepts a version number twice, even if that version was unpublished. Always pick a new one.

### 2. Bump the version on a branch

```sh
git switch main
git pull
git switch -c release-X.Y.Z
npm version X.Y.Z --no-git-tag-version
```

`--no-git-tag-version` only edits `package.json`; no tag or commit is created. Check with `git diff` that `version` is
the only change. (`pnpm version` is not used; use `npm version`.)

### 3. Verify locally

```sh
pnpm install --frozen-lockfile
pnpm check
```

Optionally inspect exactly what would be published, without publishing anything:

```sh
npm pack --dry-run
```

The file list should contain `package.json`, `README.md`, and files under `dist/` (including `dist/cli.js` and
`dist/code.md`), and nothing else.

### 4. Merge the version bump

```sh
git commit -am "Release X.Y.Z"
git push -u origin release-X.Y.Z
```

Open a pull request, wait for CI to pass, and merge it into `main`.

### 5. Run the workflow

1. Open the repository on GitHub, go to **Actions**, and select **Publish to npm**.
2. Click **Run workflow**, make sure the branch is **main**, and confirm.
3. Wait for the run to finish. If it fails, see [Troubleshooting](#troubleshooting).

### 6. Verify the release

```sh
npm view @laskaridis/afk version        # should print X.Y.Z
npx @laskaridis/afk@X.Y.Z --version     # smoke test of the published package
```

The npm registry can take a minute to reflect a new version.

### 7. Tag the release (recommended)

Tag the published commit so the version can be traced back to the source:

```sh
git switch main
git pull
git tag vX.Y.Z
git push origin vX.Y.Z
```

Optionally create a GitHub release for that tag with `gh release create vX.Y.Z --generate-notes`.

## First-time setup

This is needed once per package, by a maintainer who owns `@laskaridis/afk` on npm. In the package settings on
npmjs.com, add a **GitHub Actions** trusted publisher with these values:

| Setting              | Value         |
| -------------------- | ------------- |
| Organization or user | `laskaridis`  |
| Repository           | `afk3`        |
| Workflow filename    | `publish.yml` |

Leave the optional environment name empty and enable **Allow npm publish**. The values must match exactly; renaming the
repository or the workflow file breaks publishing until the trusted publisher is updated.

## Troubleshooting

| Symptom                                                         | Cause and fix                                                                                                                      |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Run this workflow from main.`                                  | The workflow was started from another branch. Re-run it and select `main`.                                                         |
| `pnpm check` fails                                              | Fix the failure on a branch, merge to `main`, and run the workflow again. Nothing was published.                                   |
| `403` / "cannot publish over the previously published versions" | That version already exists (or was unpublished). Bump to a new version, merge, and re-run.                                        |
| `E404` or authentication / OIDC error on publish                | The trusted publisher is missing or its values don't match the repository and workflow. See [First-time setup](#first-time-setup). |
| Package name unavailable after a full unpublish                 | npm blocks republishing a fully unpublished name for 24 hours. Wait, then retry.                                                   |

## Rules of thumb

- Never publish from a local machine or add an npm token to the repository; the workflow is the only publishing path.
- Never add secrets to the workflow. Trusted publishing needs only `id-token: write`.
- A published version cannot be changed. To fix a bad release, publish a new patch version; use `npm deprecate` on the
  bad one if needed (requires a package owner).
