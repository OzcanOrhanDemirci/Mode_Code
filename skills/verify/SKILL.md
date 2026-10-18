---
name: verify
description: Verify the current work with fresh evidence before calling it done; run by the person.
disable-model-invocation: true
argument-hint: '[what to verify]'
---

Verify the work of this session (or what the person names: $ARGUMENTS) with fresh evidence. A claim that something works is made only from output seen in this turn.

1. **Find the project's own checks.** In this order: the definition of done the person gave for this project (`mode-code config get projects` lists `verify` commands per project), the scripts the project defines (`package.json` scripts, a `Makefile`, `pubspec.yaml` with `flutter analyze` and `flutter test`, `pyproject.toml` with its test runner), its CI workflow. Say which you chose and why.
2. **Run them**, each to its end, reading its exit code: a command piped into a filter (`| tail`) hides a failure, so run without the pipe or with `set -o pipefail`.
3. **Check what changed against what was asked.** List the request's points and, for each, the evidence that it holds: a test that covers it, a command's output, a file's content. A point with no evidence is "not verified", never "done".
4. **Report** in this order: what passed (with the command), what failed (with the first lines of the error), what was not verified and why. No "should work"; no percentages that were not measured.

Do not fix anything in this step unless the person asks: a failure found is reported first.
