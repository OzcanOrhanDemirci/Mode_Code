---
name: dependency-update
description: Update this project's dependencies safely (patch and minor first, majors only on approval), each step tested; run by the person.
disable-model-invocation: true
argument-hint: '[package or scope]'
---

Update dependencies ($ARGUMENTS, or all of them) without breaking the project.

1. **What is behind:** `npm outdated`, `flutter pub outdated`, `pip list --outdated`, `cargo outdated`, as the project uses. Read the lock file's role: it is updated with the manifest, never by hand.
2. **Plan in groups:** patch and minor updates of a kind together; each major update alone, with its changelog or migration guide read first (say what it breaks). Majors are applied only after the person approves.
3. **Work on a branch** of its own if the project uses branches. For each group: update, install, run the project's checks to their end. A group that fails is reverted and reported with its error; the rest go on.
4. **Report:** what was updated (from → to), what was held back and why, the checks' results. Commit per group in the project's commit style when the person wants commits.
