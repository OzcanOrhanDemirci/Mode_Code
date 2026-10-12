<p align="right"><b>English</b> · <a href="CONTRIBUTING.tr.md">Türkçe</a></p>

# Contributing

Thank you for wanting to help. Issues, ideas, rule templates, translations and code are all welcome, and a first contribution gets a friendly review.

## Before you start

- **Small fixes** (a typo, a clearer message, a failing test): open a pull request directly.
- **Larger changes** (a new feature, a new rule, a change to how the belt reads commands): open an issue first, so we agree on the shape before you spend time on it.
- **Security problems:** do not open a public issue; see [SECURITY.md](SECURITY.md).

## Setup

```sh
git clone https://github.com/OzcanOrhanDemirci/terminal-code.git
cd terminal-code
npm ci
npm run check   # type check, format check, tests, build
```

Node.js 22.13 or newer. `npm test` runs everything without Claude Code and without network access. To try the plugin in a real session, build and start Claude Code with `claude --plugin-dir dist/plugin`.

## How the code is organized

See [docs/architecture.md](docs/architecture.md). In short: every decision lives in `src/core` (pure, no Node APIs, because the plugin runs without Node), and the plugin, the hook and the command line only adapt it.

## Rules for changes

- **Tests come with the change.** A bug fix adds the test that would have caught it.
- **Safety belt tests use harmless examples.** Never write a test that runs a risky command; the belt is only ever asked about commands. Keep new rule tests small and focused.
- **Every message the person sees exists in English and Turkish** (`src/core/i18n`). The type check fails when a key is missing; `npm test` checks the placeholders. Plain sentences, one idea each, no long dashes, technical terms explained where they appear.
- **No telemetry, no network calls,** no new runtime dependency without a discussion. Bundled packages must have a license on the allowed list (the build checks).
- **Settings stay backward compatible.** A new setting has a default; an old settings file keeps working.
- **Color never carries meaning alone.** Every state has a symbol and a word; plain mode must stay readable.

## Commits

- [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`; English, imperative ("add", not "added"), one change per commit.
- **Sign off every commit** (`git commit -s`). This certifies the [Developer Certificate of Origin](https://developercertificate.org/): you wrote the change or have the right to submit it under the project's license. There is no separate CLA.
- Contributions are licensed under Apache-2.0 (section 5 of the license).

## Pull requests

- Keep them focused; describe what changed and why, and how you tested it.
- `npm run check` must pass on your machine; CI runs it on Windows, macOS and Linux.
- The main branch only changes through pull requests, merged as one commit.

## Translations

Add a language by copying `src/core/i18n/en-ui.ts`, `en-tui.ts` and the strings in `en.ts` to a new language file, adding it to `LANGUAGES`, and adding its keyword phrases in `src/core/keywords.ts`. The type system tells you which keys are missing.

Thank you to everyone who contributes; contributors are named in the release notes.
