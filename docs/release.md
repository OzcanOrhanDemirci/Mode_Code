# Releasing

How Mode_Code goes from this repository to a release anyone can install with one line, what is checked on the way, and the one-time steps of going public.

## What a release carries

A GitHub release, made by [.github/workflows/release.yml](../.github/workflows/release.yml) from a version tag:

| File                        | What it is                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `mode-code-<version>.tgz`   | the package, exactly as `npm pack` makes it (its file list is held to an exact expectation, L12) |
| `mode-code.tgz`             | the same file under a name without the version: what the installers download as "the newest"     |
| `install.sh`, `install.ps1` | the installers of that version                                                                   |
| `SHA256SUMS`                | the SHA-256 of each file above; the installers refuse a download that does not match             |

Each file also gets a build provenance attestation, so anyone can check it was built by this workflow from this repository: `gh attestation verify mode-code.tgz --repo OzcanOrhanDemirci/Mode_Code`. The release notes are the changelog's section for the version, after how to install it (`node scripts/release.mjs notes`).

The installers are always fetched from `main` (`raw.githubusercontent.com/…/main/install.sh`); they download `releases/latest/download/mode-code.tgz`, or `releases/download/v<version>/mode-code-<version>.tgz` with `--version`.

## Releasing a version

1. On a branch: move the changelog's "Unreleased" entries under `## [x.y.z] - <today>`, add the version's link at the bottom, and set the version with `npm version x.y.z --no-git-tag-version`. Merge it through a pull request.
2. Check, then tag on `main`:

   ```sh
   node scripts/release.mjs check --tag vx.y.z
   git tag -s vx.y.z -m "Mode_Code x.y.z"
   git push origin vx.y.z
   ```

3. The release workflow does the rest, and stops at the first thing that fails: the tag, `package.json`, the changelog and the installers agree; type check, format, build, tests and the package test pass; the package is built once; the installers install that very package, update it, run it and remove it on Linux, macOS and Windows (L14); only then the release is created with its files and attestation. Run it again for an existing tag from the Actions tab (`workflow_dispatch`): it replaces the release's files.

To rehearse on your own machine, without GitHub:

```sh
npm run build
node scripts/release.mjs pack --out release
MODE_CODE_RELEASE_URL="$PWD/release" sh install.sh --no-setup        # or install.ps1 -NoSetup on Windows
```

### npm

Off for now: the package is `"private": true`, and the workflow's `npm` job runs only when the repository variable `NPM_PUBLISH` is `true`. To publish there too: remove `"private": true`, set up npm's trusted publishing for `release.yml` (or add an `NPM_TOKEN` secret), and set `NPM_PUBLISH`. The package is then published from the release's own tarball, with provenance. Until then the name `mode-code` on npm is free, so anyone could take it.

## Going public

Once, when the owner decides. Everything that can be set while the repository is private already is, by [scripts/github-settings.mjs](../scripts/github-settings.mjs), which keeps the repository's settings as code: the description and topics, issues and Discussions on, the wiki and projects off, squash merges only with the pull request's title, branches deleted after merging, sign-off required for web commits, the labels the issue forms use, Dependabot alerts and security updates, and a rule set for `main` (pull requests only, squashed, the CI checks required, no force-push or deletion; the owner can bypass it to repair CI itself). The rule set is created switched off while the repository is private, since its checks need Actions minutes a private repository pays for.

1. `node scripts/github-settings.mjs`: what differs from what the project wants; nothing is changed.
2. `node scripts/github-settings.mjs --public`: asks you to type the repository's name, makes it public, then turns on what only a public repository has (secret scanning with push protection, private vulnerability reporting), switches the rule set on, and starts CI on `main`: the runs made while the repository was private stopped for billing, and the README's badge shows the newest one.
3. In the repository's settings, by hand (GitHub has no API for these): upload [docs/images/social-preview.png](images/social-preview.png) as the social preview (General › Social preview), and accept reported content from all users (Moderation options › Reported content), which the [Code of Conduct](../CODE_OF_CONDUCT.md) names as the way to report.
4. Release 1.0.0 as above, with the changelog dated the day it is released. The one-line install works from the moment the release exists.
5. Check it as a newcomer would: the README's install line on a machine without Mode_Code.

## Before going public: the audit

Done on 2026-10-14, kept here as a record:

- **Secrets**, in every commit reachable from any branch: none (gitleaks 8.30.1, 146 commits). What ships is kept clean by a test, and CI runs gitleaks on the whole history.
- **The author's machine** in tracked files and history: no machine names, addresses or private paths; the user name appears only as a sample path in two tests.
- **Commit identities**: every commit is authored with GitHub's noreply address.
- **Actions logs and artifacts**, which become public with the repository (196 runs, 46 coverage reports): no workflow uses a secret, and the reports hold only coverage figures.
- **Licenses**: every bundled package is on the allowed list (the build checks) and listed in THIRD_PARTY_NOTICES.md.

## Renaming

The name was temporary while the project was built; it became Mode_Code on 2026-10-14. [scripts/rename.ts](../scripts/rename.ts) renames every spelling of the name in one pass and records the old one in `PREVIOUS_NAMES` ([src/core/app.ts](../src/core/app.ts)); the installer then recognises an installation under an earlier name and moves it: data and settings kept, hooks swapped in one write, the old plugin removed, the old folder removed only after the new installation tested itself. `npm run test:rename` rehearses it: today's build installed, a renamed copy of the repository built and tested, then installed over it (L13).
