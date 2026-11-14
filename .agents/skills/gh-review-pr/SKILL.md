---
name: gh-review-pr
description: "Perform a read-only code review on a GitHub pull request and post the findings as a real PR review (inline comments plus a sign-off summary). Use when the user asks to review a PR, review this branch's PR, or get a second opinion on a pull request before merging."
argument-hint: Which PR should be reviewed (number, URL, or branch)? Defaults to the open PR for the current branch if omitted.
---

# gh-review-pr

Review a GitHub pull request against the project's actual code and tests, then publish the review on GitHub itself. Inline comments on the exact lines they concern, and a single sign-off review comment that always gets posted, whether or not issues were found.

## Core rules

1. **Read-only.** The reviewing agent is not allowed to modify the repository or push commits. It only reads the repository, the diff, and GitHub metadata, and provides its feedback by posting comments in GitHub.
2. **Always sign-off with a comment.** Every review is signed-off by the reviewer with a comment on the review even when there are zero findings.
3. **Inline findings on GitHub on the right line.** Every finding concerning a specific line of a specific file in the diff is posted as an inline review comment on that file and line.
4. **Evidence over suspicion.** Ground every finding in the diff and the surrounding code you actually read — not assumptions about what the code "probably" does. If you're unsure whether something is a real problem, say so in the comment rather than asserting it.
5. **Don't invent scope.** Review the PR's own changes. Pre-existing issues in code the PR doesn't touch are out of scope unless the PR's changes depend on or worsen them — mention those only in the summary, not as inline comments on unchanged lines.
6. **Prefer `gh`.*** If `gh` is available in the cli, use `gh`.

## Workflow

### 1. Resolve the target PR

- If the user named a PR (number, URL, or explicit branch), use that.
- Otherwise, check for an open PR on the current branch.
- If there's no explicit PR and no open PR for the current branch, stop and ask the user which PR to review. 

### 2. Gather context

- Check if there are any failing Github Actions related to this PR.
- Read the full content of changed files (not just the diff hunks).
- Read related tests for changed production code, and related production code for changed tests.
- Note the repo's `owner/name` and the PR's current head commit SHA — both are needed to post the review via the API.

### 3. Review

- Delegate he review to a subagent with no write tools (or, if subagents aren't available, perform this pass yourself).
- Give it the PR description, diff, and relevant file contents, and ground it explicitly in `references/review-checklist.md`.
- Ask it to return findings as a structured list: `{file, line (or null), severity, comment}`, plus a short overall assessment for the review body.
- Forbid the review pass from running anything beyond read-only commands (tests, linters, `gh`/`git` reads). It must not run `git commit`, `git push`, or any command that mutates the working tree or the remote.

### 4. Publish the review on GitHub

- Post your findings as inline comments in GitHub, placed on the right file and line.
- Only comment on lines that appear in the diff - GitHub will reject comments on lines outside the diff context.
- Always sign-off your review with a summary comment the PR even if there are no findings (i.e. LGTM).

### 5. Summarize back to the user

After the review is posted, report concisely in the conversation (not by repeating every inline comment verbatim):

- The PR reviewed (number/title) and a link to the posted review.
- Findings by severity, and the one or two that matter most, if any.
- Anything you flagged in the summary body but couldn't tie to a specific line.
- Confirmation that no files were modified locally.
