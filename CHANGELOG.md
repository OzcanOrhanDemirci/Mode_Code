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
- Rule templates (public repository, pull requests only, one branch, production server, Flutter, measure before claiming, plain writing): a few lines in the folder's CLAUDE.md and, for some, a tighter belt; `terminal-code template` and Claude Code › Rule templates.
- `terminal-code report` and Measure › What happened: the last day or week in a few lines.
- A warning, for the person and for Claude, when another Claude Code session is working in the same folder; Home lists such folders.
- After a quota reset, autonomous work resumes with a prompt that ends with your own continue keyword.
- `terminal-code doctor` measures the machine, checks the installation and the protections, runs the built-in self-tests, compares the installed hook program with this build on the same samples, and offers safe repairs that back up, restore and check again (`--fix`, `--report`, `--quick`, `--self-check`, `--json`). The maintenance page shows the last check.
- `terminal-code belt replay`: the belt run over your recent sessions, counting what it would have asked about or blocked, by rule. Nothing is run.
- A test process with twelve layers, from invariants about the code to real Claude Code sessions, and `npm run verify` to run every layer that can run on a machine. See [docs/testing.md](docs/testing.md).
- Modes, enforced by code: chat, research, plan and code (`sohbet`, `araştırma`, `plan`, `kod`; `serbest` for free). Chat, research and plan write only into temporary folders, the flows' work folder or the plan file, and run a shell command only when they can place what it does: a classifier sorts every program a command runs into reads, writes named files, changes around its folder, changes outside, or unknown, and refuses what it cannot place, saying why. See [docs/modes.md](docs/modes.md).
- Flows: `flow` / `akış` (research ▶ plan → approval → code), `flow plan`, `flow research`. Steps run in order and the model finishes one through the `flow_step` tool; code checks each: a report whose findings cite sources that exist, a plan with numbered steps, acceptance criteria and verification commands the belt allows, the person's approval (the plugin's dialog, Claude Code's plan dialog, or `approve` / `onay`), and verification commands that pass when the plugin runs them. Flows pause, resume across sessions and survive a compaction.
- Claude Code's plan mode is bridged: its plan mode puts the session in plan mode, and its plan dialog approves a flow's plan after the plugin has checked it.
- `terminal-code flow`, Projects › Flows, and plans waiting for approval on Home and in the inbox.
- `belt replay` also says what the restricted modes would run of your recent shell commands; `doctor` runs a modes self-test.

### Changed

- Package runners are read as the program they run: `npx wrangler deploy` is asked about like `wrangler deploy`.
- Publishing and deploying with `--dry-run` are no longer asked about.
- When an agent runs `doctor`, repairs that would put code into the protection are refused and left to the person.
- Text widths are measured the way the terminal draws them (emoji and symbols such as 🛡 ⚪ ✅ ⛔ included), so no line is cut or wraps.

### Fixed

- Windows 8.3 short names of protected folders (`TERMIN~1`) were not recognised, and neither were protected folders that are links.
- On macOS and Linux every recursive delete under the home folder was blocked, inside projects too.
- Windows drops trailing dots and spaces from a name; a protected file spelled that way (`.claude./settings.json.`) was not recognised.
- A command containing a word such as `__proto__` or `constructor` crashed the parser.
- `install --json` and `uninstall --json` printed text before the JSON.
- A path whose last name trims to `.` or `..` resolved differently the second time.
- Scripts run by Claude Code's Monitor tool were not checked by the belt; they are now read like Bash commands, in the plugin and in the safety-net hook. Found by `doctor` on the author's machine.
- A session started in the home folder counted the user's own settings twice, as user and as project settings, and the doctor reported the safety-net hooks as duplicated.
- The doctor called a hook program from an earlier build of the same version "changed after installation". The installation now records the program's fingerprint, so an earlier build and a change are told apart; an older hook matcher is named as such, with the tools it does not check.
