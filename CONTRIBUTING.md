<p align="right"><b>English</b> · <a href="CONTRIBUTING.tr.md">Türkçe</a></p>

# Contributing

Thank you for wanting to help. Issues, ideas, rule templates, translations, tests on your platform and code are all welcome, and a first contribution gets a friendly, careful review.

## Before you start

- **Small fixes** (a typo, a clearer message, a failing test): open a pull request directly.
- **Larger changes** (a new feature, a new rule, a change to how the belt reads commands): open an issue first, so we agree on the shape before you spend time on it.
- **Questions and ideas** that are not yet a task: [Discussions](https://github.com/OzcanOrhanDemirci/Mode_Code/discussions).
- **Security problems:** do not open a public issue; see [SECURITY.md](SECURITY.md).

## Your first contribution

1. Pick an issue marked [good first issue](https://github.com/OzcanOrhanDemirci/Mode_Code/labels/good%20first%20issue) or [help wanted](https://github.com/OzcanOrhanDemirci/Mode_Code/labels/help%20wanted), and say in a comment that you are taking it, so nobody does the same work twice.
2. Fork the repository and make a branch: `git switch -c fix/clearer-quota-message`.
3. Make the change with its test, and run `npm run check`.
4. Commit with a sign-off (`git commit -s`, see [Commits](#commits)) and open a pull request; the template asks for what changed, why, and how you tested it.

You will get an answer within a few days. If a change needs more work, the review says exactly what and why.

## Setup

```sh
git clone https://github.com/OzcanOrhanDemirci/Mode_Code.git
cd Mode_Code
npm ci
npm run check   # type check, format check, build, tests
```

Node.js 22.13 or newer. `npm test` runs everything without Claude Code and without network access. To try the plugin in a real session, build and start Claude Code with `claude --plugin-dir dist/plugin`, or run `node dist/cli.mjs try`.

| Command                  | What it does                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `npm run check`          | everything a pull request must pass: types, formatting, the build, the tests                      |
| `npm test`               | the tests (build first: some run the shipped programs in `dist/`)                                 |
| `npm run format`         | formats the code with Prettier                                                                    |
| `npm run test:installer` | the one-line installer, run against the package this build makes, in every shell you have         |
| `npm run test:av`        | on Windows with an antivirus on: no file of the repository or the build is taken for a threat     |
| `npm run screenshots`    | redraws the README's pictures from the control center itself, after you change a screen           |
| `npm run mo-art`         | redraws Mo's pictures (the README, docs/mo.md, the social preview), after you change Mo           |
| `npm run verify`         | every test layer that can run on your machine, one line each ([docs/testing.md](docs/testing.md)) |

## How the code is organized

See [docs/architecture.md](docs/architecture.md). In short: every decision lives in `src/core` (pure, no Node APIs, because the plugin runs without Node), and the plugin, the hook and the command line only adapt it.

| Folder                      | What is in it                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/core`                  | the decisions: the safety belt, shell parsers, modes, keywords, quota, rule templates, messages |
| `src/mod`                   | the plugin that runs inside Claude Code                                                         |
| `src/hook`                  | the safety-net hook program                                                                     |
| `src/node`                  | what touches the machine: files, git, the installer, the session index                          |
| `src/cli`                   | the `mode-code` command                                                                         |
| `src/tui`                   | the control center                                                                              |
| `test`                      | the tests, by layer ([docs/testing.md](docs/testing.md))                                        |
| `install.sh`, `install.ps1` | the one-line installers                                                                         |

## Rules for changes

- **Tests come with the change.** A bug fix adds the test that would have caught it.
- **Safety belt tests use harmless examples.** Never write a test that runs a risky command; the belt is only ever asked about commands. Keep new rule tests small and focused.
- **Every message the person sees exists in English and Turkish** (`src/core/i18n`). The type check fails when a key is missing; `npm test` checks the placeholders. Plain sentences, one idea each, no long dashes, technical terms explained where they appear.
- **No telemetry, no network calls,** no new runtime dependency without a discussion. Bundled packages must have a license on the allowed list (the build checks).
- **Settings stay backward compatible.** A new setting has a default; an old settings file keeps working.
- **Color never carries meaning alone.** Every state has a symbol and a word; plain mode must stay readable.
- **`install.ps1` stays ASCII.** Windows PowerShell 5.1 reads a script without a byte order mark in the system's code page, so its Turkish messages are written with `\u` escapes of the Turkish letters. `install.sh` must pass `shellcheck --shell=sh`.

## Rule templates

A rule template is a few lines Claude reads (in a marked block of the project's `CLAUDE.md`) and, for some, belt settings that only ever tighten. They live in [src/core/templates.ts](src/core/templates.ts): add an entry with an `id`, a name, a one-line description and at most a handful of rules, in English and Turkish, and a case in `test/core/templates.test.ts`. Good templates are short, concrete, and true for most projects of their kind.

## Translations

Add a language by copying `src/core/i18n/en-ui.ts`, `en-tui.ts` and the strings in `en.ts` to a new language file, adding it to `LANGUAGES`, and adding its keyword phrases in `src/core/keywords.ts`. The type system tells you which keys are missing. Then run `npm run screenshots` to see your language in the control center.

## Commits

- [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`; English, imperative ("add", not "added"), one logical change per commit: it builds and passes the tests on its own, and a change with its tests and docs is one commit.
- The subject is at most 72 characters. The body says why the change was needed, how the problem was found, what changed and which test keeps it so, in lines of at most 72 characters.
- **Sign off every commit** (`git commit -s`). This certifies the [Developer Certificate of Origin](https://developercertificate.org/): you wrote the change or have the right to submit it under the project's license. There is no separate CLA. A check on every pull request looks for the sign-off.
- Contributions are licensed under Apache-2.0 (section 5 of the license).

### AI assistance

You may use AI tools; you stay responsible for every line, as the sign-off says. Say so with an `Assisted-by:` trailer naming the tool, above your sign-off:

```
Assisted-by: Claude Code
Signed-off-by: Your Name <you@example.com>
```

Only a person signs off. This project is built with Claude Code: its commits carry `Assisted-by: Claude Code`, and those up to `15fbce7` carry the equivalent `Co-Authored-By: Claude` and `Claude-Session` trailers.

## Pull requests

- Keep them focused; describe what changed and why, and how you tested it.
- `npm run check` must pass on your machine; CI runs it on Windows and Linux, and runs the installer on both.
- The main branch only changes through pull requests, merged as one commit whose title is the pull request's.

## Releases

Maintainers release by tagging a version; [docs/release.md](docs/release.md) describes what is checked and published.

Thank you to everyone who contributes; contributors are named in the release notes.
