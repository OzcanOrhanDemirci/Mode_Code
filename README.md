<p align="right"><b>English</b> · <a href="README.tr.md">Türkçe</a></p>

# terminal-code

**A local companion for Claude Code: a safety belt and a behavior layer inside Claude Code, and a control center in your terminal.** Everything stays on your machine. No telemetry.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Node.js 22.13 or newer](https://img.shields.io/badge/node-%E2%89%A522.13-brightgreen.svg)

> **The name is temporary.** It will change before the first public release; the [trademark policy](TRADEMARK.md) already covers the final name.

## Contents

- [What it does](#what-it-does)
- [Why](#why)
- [Quick start](#quick-start)
- [Requirements](#requirements)
- [The control center](#the-control-center)
- [Keywords](#keywords)
- [The safety belt](#the-safety-belt)
- [Privacy and security](#privacy-and-security)
- [Limits](#limits)
- [FAQ](#faq)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## What it does

**Inside Claude Code** (a plugin that runs in Claude Code's own process, plus a small hook program as a safety net):

- **Safety belt.** Reads every shell command and file write before it runs and stops the risky ones: deleting your home folder, force-pushing a protected branch, turning hooks off, changing your Claude Code settings, rewriting your memory's history, publishing a package. It blocks, asks you, or adds a note, rule by rule. It works in every permission mode, including "bypass permissions".
- **Keywords.** End a message with `continue`, `manual continue`, `chat`, `quota 40`, `wrap up`, `stop`, `status` or `help` (or their Turkish forms: `devam`, `kota 40`, `toparla`, `dur` …) and the tool tells Claude exactly what you mean. `myproject continue quota 40` works on that project autonomously, within 40% of your weekly quota.
- **Quota guard.** Reads the 5-hour and weekly windows that Claude Code reports, wraps up work at your budget, stops at the limit and, when the work was autonomous, resumes by itself one minute after the window resets.
- **Footer lines.** Under each answer: whether your memory repository was pushed, whether anything changed, and the quota when it matters. Computed from git, the turn's tool calls and the measured quota, never guessed.
- **Quiet long work.** Leaves out Claude Code's "the user has not heard from you" reminders, so long autonomous work does not fill your screen with status lines.

**In your terminal** (`terminal-code`): a control center with seven categories, in English and Turkish.

|                 |                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Home**        | Protection status, quota, today, running sessions, and what happened while you were away                                               |
| **Projects**    | Every folder you worked in: sessions, tokens, git state                                                                                |
| **Sessions**    | Every session on this machine, searchable; export one as Markdown with secrets masked                                                  |
| **Measure**     | Quota windows, tokens by day and model, cache hit rate, tool error rates                                                               |
| **Security**    | Whether each protection runs, all 39 belt rules, what they caught, a tester, secrets in memory                                         |
| **Claude Code** | A read-only map of your setup: instruction files and the memory limit, settings sources, hooks, permission rules, MCP servers, plugins |
| **Settings**    | The tool's own settings, edited in place                                                                                               |

### Inside Claude Code

Captured from a real Claude Code session (Windows, Claude Code 2.1.296). The belt asks before an untracked-files cleanup:

```
● Bash(git clean -f)
  ⎿  Waiting…
──────────────────────────────────────────────────────────────────────────────
 ☐ Safety belt
│ The safety belt stopped a Bash call. Deletes untracked files (git clean -f): git clean -f Allow it this once?
❯ 1. Allow once
  2. Block
```

The footer lines under an answer, the mode beside Claude Code's own, and the quota at the end of the hint line:

```
● ready
  Memory pushed: No (the memory repository has no remote branch)
  Changes made: No
✻ Baked for 1s
──────────────────────────────────────────────────────────────────────────────
❯
──────────────────────────────────────────────────────────────────────────────
  ⏵⏵ auto mode on (shift+tab to cycle) · 🛡 5h 31% · week 28%        autonomous
```

## Why

Measured on the author's Windows 11 machine with Claude Code 2.1.296 and Node.js 24.15:

- **Counting tokens from transcripts naively overstates them.** Claude Code writes one transcript row per content block and repeats the message's usage on each: 88,038 assistant rows held 39,572 distinct API messages. The index counts each message once.
- **History is fast.** 660 transcripts (2.8 GB, subagents included) are indexed in 5.5 s the first time; an update afterwards takes about 25 ms. The index keeps the figures after Claude Code deletes old transcripts (30 days by default).
- **The safety net is cheap.** The hook program adds about 0.1 s to each checked tool call on Windows, most of it Node.js start-up. Inside Claude Code the plugin checks the same call in-process.
- **Plain permission rules miss spellings.** A rule like `Bash(git push --force*)` does not match `git -C . push --force`; the belt reads the command the way git does.

## Quick start

The package is not on npm yet (the final name is still open), so install from source:

```sh
git clone https://github.com/OzcanOrhanDemirci/terminal-code.git
cd terminal-code && npm ci && npm run build
node dist/cli.mjs install
```

To try it first without installing anything, run `node dist/cli.mjs try`: it starts one Claude Code session with everything loaded and changes nothing in your Claude Code configuration.

The installer first shows every change it will make and asks once before it changes anything. Then start a new Claude Code session, and open the control center with `node dist/cli.mjs`.

To remove it: `node dist/cli.mjs uninstall` (add `--purge` to delete its settings and history too). Removal undoes exactly what the installation recorded.

## Requirements

- **Node.js 22.13 or newer** (the session index uses Node's built-in SQLite).
- **Claude Code 2.1.295 or newer** for the safety-net hook; **2.1.290 or newer** runs the in-process plugin. With an older Claude Code the hook alone runs the belt and the keywords.
- Windows, macOS or Linux. Developed on Windows 11; the test suite passes on Windows and Linux (Node.js 22 and 24) and on macOS (Node.js 24).

## The control center

`terminal-code` opens it. Three columns: where you came from, where you are, and what is selected. Every screen has an address (`security/rules`, `measure/quota`), which `terminal-code open <address>` also takes.

```
terminal-code › Security › Safety belt rules                             🛡 working  week 27%  5h 21%
╭──────────────────╮╭───────────────────────────────╮╭─────────────────────────────────────────────╮
│  Protection stat…││▸ Force-push to a prote… block ││ Force-push to a protected branch            │
│▸ Safety belt… 39 ││  Force-push               ask ││ Force-pushing a protected branch (main,     │
│  What the belt d…││  Delete a protected re… block ││ master, release/*), which rewrites shared   │
│  Test a command  ││  Delete a remote branch   ask ││ history.                                    │
│  Secrets in memo…││  Mirror or prune remote…  ask ││                                             │
│                  ││  Push past pull reques… block ││ Action                block                 │
│                  ││  New branch in a one-b… block ││ Group                 Git                   │
│                  ││  Rewrite history          ask ││ Locked                no                    │
│                  ││  Change the git hooks…  block ││ Last 30 days          0 times               │
│                  ││  Skip git checks         note ││                                             │
╰──────────────────╯╰───────────────────────────────╯╰─────────────────────────────────────────────╯
Address: security/rules/git.force-push-protected
↑↓ move  → open  ← back  1-7 categories  / filter  Ctrl+K go to  ? help  q quit
```

<sub>Drawn from sample data by the project's own test harness.</sub>

The same keys work everywhere: `↑↓` move, `→` open, `←` back, `1`-`7` jump to a category, `/` filter the list, `Ctrl+K` go to any screen by name (in either language), `?` help with the terms explained, `q` quit. Three view levels (Simple, Recommended, Detailed) change what is shown, never what is protected. Plain mode (no box drawing, ASCII symbols) and high contrast are under Settings › Accessibility.

Everything is also available as commands, each with `--json` output whose shape is versioned:

```sh
terminal-code status            # what is installed and working, quota, today
terminal-code doctor            # every feature's health and how to fix what is broken
terminal-code report --week     # what happened: sessions, tokens, the belt, quota
terminal-code tokens --by model # token use by day, model or folder
terminal-code belt test --command "git clean -f"   # what the belt would do; nothing is run
```

See [docs/cli.md](docs/cli.md) for every command.

## Keywords

A keyword counts only when it is the whole message or ends it; inside a sentence it is just a word. Matching ignores case and accents, so `termınal devam` (Turkish keyboard) works too. `stop` and `wrap up` count only as the whole message, so they never fire by accident.

| Keyword  | English                          | Turkish                   | What Claude is told                                                             |
| -------- | -------------------------------- | ------------------------- | ------------------------------------------------------------------------------- |
| continue | `continue`, `myproject continue` | `devam`, `terminal devam` | Work autonomously; stop only for a decision you must make                       |
| manual   | `manual myproject continue`      | `manuel terminal devam`   | Step by step; say what you will do and wait                                     |
| chat     | `chat`                           | `sohbet`                  | Conversation only; project and memory writes are refused until you say continue |
| quota    | `quota 40`, `quota +8`           | `kota 40`, `kota +8`      | Weekly budget: 40%, or 8 points above the current reading                       |
| wrap up  | `wrap up`                        | `toparla`                 | Bring the step to a consistent point, commit, report, stop                      |
| stop     | `stop`                           | `dur`                     | Stop now; stop timers and agents                                                |
| status   | `status`                         | `durum`                   | Say where you are without stopping                                              |
| help     | `help`                           | `yardım`                  | Summarize the keywords and rules                                                |

Name your projects under Settings › Projects and keywords, and add your own phrases in the settings file. Details: [docs/keywords.md](docs/keywords.md).

## The safety belt

39 rules in nine groups: git, files and disks, self-protection, Claude Code configuration, things that start by themselves, publishing, Docker (an optional pack for servers), secrets, and commands the belt cannot follow. Each rule blocks, asks, notes or allows; you can change that per rule. **Locked rules** protect the protection itself (your Claude Code settings, the tool's own files, your memory folder, hooks): they can be made stricter, never weaker, and agreeing in the chat is not enough to change them.

The belt reads bash, PowerShell and cmd syntax, unwraps `sudo`, `env`, `bash -c` and interpreters, follows `git -C`, `-c` and aliases, and treats code built at run time as something to ask about rather than something proven safe. When the plugin asks you, the decision covers that one call and nothing else.

Details: [docs/safety-belt.md](docs/safety-belt.md).

## Privacy and security

- **Nothing leaves your machine.** No telemetry, no analytics, no network connection of its own.
- **What it reads:** Claude Code's settings files and transcripts (read-only), your memory folders (for git status and secret scans).
- **What it writes:** its data folder (`~/.terminal-code`), and, with your approval at install, four hook entries in your Claude Code user settings (a backup is kept). The plugin is installed through Claude Code's own `claude plugin` command.
- **What it stores:** numbers (tokens, tool counts, times) and short texts (session titles, first prompts) with secrets masked before they are written.
- **Removal:** `terminal-code uninstall` undoes exactly what the installation recorded. Commands that lower a protection refuse to run from inside a Claude Code session.

Found a vulnerability? Please report it privately: see [SECURITY.md](SECURITY.md).

## Limits

- **On native Windows the belt is an accident preventer, not a security boundary.** Claude Code's sandbox does not run there, and a script can do what a single command cannot. For unattended autonomous work use WSL2, macOS or Linux, where the sandbox adds a layer.
- **The plugin uses Claude Code's early-access mods API**, which can change between releases. When it does not load, the hook keeps the belt running and the control center says which features are paused.
- **Quota figures come from Claude Code**, recorded by the plugin after each answer. Without the plugin there is no quota reading; tokens are not quota.
- **Footer lines drawn by the plugin** are part of how the answer is drawn, not of the conversation: the model never reads them and a transcript export does not contain them. If you want them written into the answers themselves, choose the "Checked" footer mode: Claude writes them and a hook checks them.

## FAQ

**Does it change how Claude Code works?** Only where you see it: the belt's decisions, the context a keyword adds, the footer and the status line entry. Turn any feature off under Settings › Features; the belt stays.

**Will it slow Claude Code down?** The hook adds about 0.1 s per checked tool call on Windows (less elsewhere); the plugin's checks run in-process.

**Can Claude turn it off?** Not by itself: changing Claude Code's settings, this tool's files, or removing its plugin are locked rules, and the commands that lower a protection run only from your own terminal.

**Does it work with the Claude desktop app?** The plugin and hooks load wherever Claude Code runs with your user settings; the control center is a terminal program.

## Roadmap

- Modes and mode flows (research, plan, approval, code) enforced by code
- Fully autonomous runs with a definition of done, in WSL2
- Session handoff notes before compaction, quota history, a morning report
- Settings and history sync across machines (append-only, per machine)
- More rule templates (Flutter, public repositories, production servers)
- Publication on npm under the final name, with provenance

## Contributing

Contributions are welcome: issues, ideas, rule templates, translations, code. Please read [CONTRIBUTING.md](CONTRIBUTING.md); commits are signed off under the [Developer Certificate of Origin](https://developercertificate.org/) (`git commit -s`). By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache License 2.0](LICENSE). The [NOTICE](NOTICE) file travels with every copy. The name and logo are covered by the [trademark policy](TRADEMARK.md). Bundled third-party code: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Not made by Anthropic. Claude and Claude Code are trademarks of Anthropic, named here to say what this works with. Built on [Ink](https://github.com/vadimdemedes/ink), [React](https://react.dev), [esbuild](https://esbuild.github.io), [TypeScript](https://www.typescriptlang.org) and Node.js's built-in SQLite.
