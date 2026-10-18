---
name: project-intro
description: Introduce this project as it really is (purpose, structure, commands, conventions) from its files; run by the person.
disable-model-invocation: true
argument-hint: '[for whom]'
---

Write a short, true introduction to this project ($ARGUMENTS: for whom, if the person said).

1. **Read, do not guess:** the README and docs, the manifest files (`package.json`, `pubspec.yaml`, `pyproject.toml`, `Cargo.toml` …), the top-level folders and a few central files, the CI workflow, the last 30 commits (`git log --oneline -30`), any `CLAUDE.md` or `AGENTS.md`.
2. **Write**, in this order and briefly: what it is for; the stack and its versions; how the code is laid out (the folders that matter and what is in each); how to build, run and test it (the real commands, checked against the files); the conventions the code and commits follow; what is unfinished or fragile, if the files say so.
3. Mark anything you could not confirm from the files as such. Do not write it into a file unless the person asks; if they ask for a `CLAUDE.md`, keep it to what changes how Claude works here.
