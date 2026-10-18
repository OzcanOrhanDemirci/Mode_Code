---
name: commit
description: "Use when writing a commit message or committing in git: the project's own commit style, one change per commit, why and how in the body, its sign-off."
---

When you commit:

1. **Follow the project's own rules first:** a commit guide in CONTRIBUTING or the docs, a commit-message hook, the style of the last commits (`git log --oneline -15`): Conventional Commits or not, the language, the subject's length, a `Signed-off-by` line (DCO) or other trailers the project or the person asked for.
2. **One logical change per commit.** Stage only what belongs to it (`git add <paths>`, not `git add -A` when other changes are around); check with `git diff --cached --stat`.
3. **The message:** a subject in the imperative that says what the commit does; a body that says why, then how, then how it was tested, wrapped at 72 columns. Give each paragraph its own `-m`, so no editor opens.
4. **Never** skip the repository's hooks (`--no-verify`), commit a secret or personal data, or amend or rewrite a commit already pushed, unless the person asks for it.
5. If a hook refuses the commit, read why, fix the cause, and commit again; do not work around it.
