---
name: release-prep
description: Prepare a release of this project (version, changelog, checks, notes), stopping before anything is published; run by the person.
disable-model-invocation: true
argument-hint: '[version]'
---

Prepare a release ($ARGUMENTS, or the next version by this project's rules). Prepare only: tagging, publishing, uploading and pushing a release are the person's.

1. **Read the project's own way:** a release document (`RELEASE.md`, `docs/release.md`, CONTRIBUTING), the version files (`package.json`, `pubspec.yaml` with its build number, `build.gradle`, `Info.plist`), the changelog's format, how earlier releases were tagged (`git tag --sort=-creatordate | head`).
2. **Choose the version** by the project's rule (semantic versioning unless it says otherwise): what changed since the last tag (`git log <last-tag>..HEAD --oneline`), breaking, feature or fix. Say why.
3. **Make the changes:** the version in each file that holds it, the changelog section from the commits (grouped as the changelog does, written for its readers), the notes for the release page.
4. **Run the checks** the project defines for a release, to their end.
5. **Report** the diff, the checks' results and the exact commands that would tag and publish, for the person to run or approve.
