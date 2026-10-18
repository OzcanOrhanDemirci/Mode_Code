---
name: pr-prep
description: Prepare a pull request from this branch (title, description, checks), stopping before it is opened; run by the person.
disable-model-invocation: true
argument-hint: '[base branch]'
---

Prepare a pull request for the current branch against $ARGUMENTS (or the repository's default branch).

1. **What is in it:** `git log --oneline <base>..HEAD` and `git diff --stat <base>...HEAD`. Read the diff; if it holds more than one change, say so and propose how to split it.
2. **The project's rules:** a pull request template (`.github/pull_request_template.md`), CONTRIBUTING, the commit style of recent merges, a sign-off rule (DCO).
3. **Run the checks** the project's CI runs, as far as they run here.
4. **Write** a title in the project's style, and a description: why, what changed, how it was tested (the commands and their results), what a reviewer should look at first, what is left out.
5. Show it. Pushing the branch and opening the pull request (`gh pr create`) are the person's call: give the exact commands.
