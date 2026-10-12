# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Safety belt: 39 rules over bash, PowerShell and cmd commands and file writes, with locked self-protection rules; runs in the in-process plugin and in a safety-net hook that blocks on failure.
- Keywords in English and Turkish (`continue`/`devam`, `quota 40`/`kota 40`, `chat`/`sohbet`, `wrap up`/`toparla`, `stop`/`dur` …), robust to Turkish keyboards and typos.
- Quota guard: wraps up at the budget, stops at the limit, resumes autonomous work after the reset.
- Footer lines under each answer, drawn by the plugin or written by the model and checked by a hook.
- Quiet long work: Claude Code's "the user has not heard from you" reminders are left out.
- Chat mode enforced by code: no project or memory writes until you say continue.
- Control center with seven categories, three columns, addresses, a go-to palette, filters, view levels, plain and high-contrast modes, settings edited in place.
- Session index in SQLite: incremental, each API message counted once, secrets masked.
- Commands: `status`, `doctor`, `install`, `uninstall`, `quota`, `tokens`, `sessions`, `belt`, `secrets`, `config`, each with versioned `--json` output.
- Installer that shows every change, asks once, backs up the settings, records a manifest and self-tests; removal undoes exactly the manifest. Running it again repairs an installation.
- `terminal-code try`: one Claude Code session with everything loaded, without installing.
- Quota history on the quota screen, from readings the plugin records.
- Settings changed in the control center apply to running sessions at the next prompt.
- The session state (autonomous work, project, weekly budget, chat mode) survives a compaction; /clear starts fresh.
- Footer lines are drawn inside the answer, and the mode and quota beside the prompt, without notice prefixes.
- A warning, for the person and for Claude, when another Claude Code session is working in the same folder; Home lists such folders.
- After a quota reset, autonomous work resumes with a prompt that ends with your own continue keyword.
