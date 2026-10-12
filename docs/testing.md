# How terminal-code is tested

terminal-code sits between an AI agent and your machine. A tool in that place has to be trusted, and trust has to be earned with evidence, not adjectives. This page describes every layer of testing, what each layer proves, what it cannot prove, and how to run it yourself. The numbers in it are produced by the test runs, not typed by hand.

## Principles

1. **A false alarm is a bug.** A safety belt that asks about harmless commands trains people to click "allow" without reading. Every protective rule is tested twice: it must catch what it is for, and it must stay silent on the harmless commands next to it.
2. **Test what ships.** Unit tests run the TypeScript source; a separate layer runs the built bundles (`dist/cli.mjs`, `dist/hook.mjs`, `dist/plugin`) the way Claude Code and a person run them.
3. **Every assumption is measured.** Where the code assumes something about the machine (how Git Bash spells `/tmp`, whether the file system ignores case, whether a folder is a link), that assumption is written down as a test that measures the real machine: in CI on Windows, Linux and macOS, and on your machine by `terminal-code doctor`.
4. **Hermetic and harmless.** Tests never touch your real `~/.claude` or `~/.terminal-code`, never open a network connection, and never execute the commands the belt judges. Belt samples are evaluated, not run.
5. **Deterministic.** No test depends on the clock, the locale, the terminal width or the order of files unless it sets them itself. Property tests use a recorded seed, so a failure can be replayed exactly.
6. **The tests are tested.** Mutation testing changes the code on purpose and checks that some test fails; a maintenance self-check breaks a sandbox on purpose and checks that the doctor finds and repairs every fault.
7. **Honest limits.** Each layer says what it does not cover. On native Windows the belt is an accident preventer, not a security boundary (see [safety-belt.md](safety-belt.md)).

## Layers

| Layer                       | What it proves                                                                                                                                                                                                                                                                                                                                                                                     | Where                                                             | Runs                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **L0 · Static**             | Types are sound (strict TypeScript), formatting, licenses of bundled code, the plugin manifest and hooks module as Claude Code reads them (`claude plugin validate --strict`).                                                                                                                                                                                                                     | `tsconfig.json`, `scripts/build.mjs`                              | every change, CI                                                                       |
| **L1 · Invariants**         | Rules about the code itself: the pure core imports no Node module (it also runs inside Claude Code, where there is no Node), no network module anywhere (no telemetry, checked), every source file carries its license line, every message exists in both languages, every command and every belt rule is documented, the minimum Node and Claude Code versions agree everywhere they are written. | `test/invariants/`                                                | every change, CI                                                                       |
| **L2 · Unit**               | Each module on its own, edge cases included: shell parsers (Bash, PowerShell, cmd), path resolution, belt rules, keywords, quota, footer, config, secrets, formatting, transcripts, the session index, installer planning, health, the control center screens.                                                                                                                                     | `test/core/`, `test/node/`, `test/app/`, `test/cli/`, `test/tui/` | every change, CI                                                                       |
| **L3 · Properties**         | Statements that must hold for _every_ input, checked on thousands of generated ones: parsers never throw and always finish; resolving a path twice changes nothing; `parse(serialize(config))` is the config; masking a secret twice is masking it once; no screen draws a line wider than the terminal at any width.                                                                              | `test/properties/`                                                | every change, CI                                                                       |
| **L4 · False alarms**       | A corpus of everyday commands (builds, tests, git reads, file viewing, package managers, in Bash and PowerShell) that must pass without a single question. A replay tool measures the same thing on your own recent sessions.                                                                                                                                                                      | `test/corpus/`, `terminal-code belt replay`                       | every change, CI · on demand                                                           |
| **L5 · Self-protection**    | The tool defends its own files, its hooks, Claude Code's settings and your memory folders, under every spelling of a path (Windows, Git Bash, `~`, variables, 8.3 short names, links), and fails closed when it breaks (a crashing or slow belt blocks changing tools, never reads).                                                                                                               | `test/protection/`, `test/hook/`                                  | every change, CI                                                                       |
| **L6 · Processes**          | The hook program, the command line and the installer as separate processes, against isolated data and Claude Code folders and a stand-in `claude` command: install, doctor, repair, uninstall, every `--json` contract.                                                                                                                                                                            | `test/process/`                                                   | every change, CI                                                                       |
| **L7 · Shipped bundles**    | The same process tests against `dist/`.                                                                                                                                                                                                                                                                                                                                                            | `test/dist/`                                                      | after build, CI                                                                        |
| **L8 · Inside Claude Code** | The in-process mod loaded by Claude Code's own engine and test kit (`claude plugin test`): belt verdicts through the real hook chain, the fail-closed `.catch`, keywords, the quota guard and the resume timer on a mocked clock, footer drawing, compaction.                                                                                                                                      | `test/mod/`                                                       | every change where Claude Code is installed; nightly CI against the latest Claude Code |
| **L9 · Assumptions**        | Facts about the machine the code relies on, measured on the machine itself.                                                                                                                                                                                                                                                                                                                        | `test/assumptions/`, `terminal-code doctor`                       | CI on Windows, Linux, macOS · your machine                                             |
| **L10 · Live**              | A real Claude Code session (`claude -p`, the cheapest model, a spending cap) with the hooks and the mod loaded from the build: a harmless command runs, a protected write is refused, the mod reports itself alive.                                                                                                                                                                                | `test/live/`                                                      | opt-in (`npm run test:live`), costs a few cents of quota                               |
| **L11 · Mutation**          | Small deliberate changes to the belt, paths, config and keyword code; a surviving change means a missing test.                                                                                                                                                                                                                                                                                     | `scripts/mutate.mjs`                                              | on demand, before a release                                                            |

`npm run verify` runs every layer that can run on the machine, prints one line per layer with its counts and duration, and exits non-zero if any layer fails. Layers that need something absent (Claude Code for L8, opt-in for L10) say "skipped" and why; they never pass silently.

## False alarms

The belt's job is to ask about the rare dangerous call and to stay out of the way for everything else. Two instruments keep it honest:

- **The everyday corpus** (`test/corpus/`): commands people and agents actually run, written by hand, grouped by ecosystem. Each must come back `allow` with no findings. A new rule that makes any of them ask fails the build.
- **Replay** (`terminal-code belt replay [--days N]`): runs the belt over the shell and file tool calls in your own recent Claude Code sessions and prints counts only: how many calls, how many would have been asked about or blocked, by rule. Nothing is executed and no command text is printed. On the author's machine, 30 days and about 36,000 calls produce roughly four questions a day; the number is re-measured before each release.

## Self-protection

What the belt protects, and the spellings it must see through:

- its own data folder (`~/.terminal-code`), hook program and plugin files;
- Claude Code's settings files, global config, plugin registry and managed settings;
- the memory folders the person registered;
- under every spelling: `C:\x`, `C:/x`, `/c/x`, `/cygdrive/c/x`, `\\?\C:\x`, `~`, `$HOME`, `%USERPROFILE%`, `$env:USERPROFILE`, relative paths, `..`, mixed case on Windows and macOS, Git Bash's `/tmp`, Windows 8.3 short names (`TERMIN~1`), and protected folders that are themselves links (a dotfiles repository behind `~/.claude`).

And how it fails: a hook that crashes, cannot parse its input or runs past its deadline refuses changing tools (`Bash`, `PowerShell`, `Write`, `Edit`, …) and lets pure reads through, so a broken belt never silently opens and never locks the session.

## Assumptions the code makes, measured

| Assumption                                                                            | Relied on by                       | Measured how                                                        |
| ------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| Git Bash mounts `/tmp` on the user's Temp folder (Windows)                            | path resolution                    | `cygpath -w /tmp` in the Git Bash Claude Code uses                  |
| The file systems of Windows and macOS ignore case                                     | path comparison                    | a probe file looked up in another case, in the data folder's volume |
| Protected folders are not links, or their link targets are known                      | belt                               | `realpath` of each protected folder                                 |
| 8.3 short names of protected folders are recognised                                   | belt                               | the short form of each protected folder (Windows)                   |
| The Node.js the hooks run is present and new enough                                   | safety-net hook                    | the recorded `node` is run with `--version`                         |
| `claude` is one installation, new enough                                              | installer, health                  | every `claude` on `PATH`, with its version                          |
| Tool names that change files are the ones the belt matches                            | hook matcher                       | tool names in recent transcripts with file or command inputs        |
| Session ids are safe as file names; transcript rows have the shape the reader expects | session state, index, footer check | recent transcripts                                                  |
| The data folder supports atomic rename and has free space                             | every writer                       | a rename probe and `statfs`                                         |
| `git` is available and can read the registered repositories                           | git rules, footer                  | `git --version`, `git rev-parse` per project                        |

## The maintenance check: `terminal-code doctor`

`doctor` is the same set of checks the tests use, run on your machine. It groups them as **Node.js**, **Claude Code**, **installation**, **protection**, **shells and terminal**, **file system**, **git**, **data** and **self-tests**. Each check reports `ok`, `info`, `warn` or `fail` with the measured value behind it.

When a check fails and a safe repair exists, `doctor` offers it; `doctor --fix` applies them without asking. Every repair backs up what it changes, is re-checked right after (a repair counts only if the check then passes), and never weakens a protection: repairs only restore. Repairs that would change your own settings are refused when an agent runs `doctor`. What cannot be repaired automatically is reported with the exact next step.

`doctor` also runs the built-in self-tests: the samples the CI uses for the belt, the parsers, the secret scanner, the keywords and the footer, run against the code installed on your machine, and the installed hook program compared with the in-process belt on the same samples.

`doctor --self-check` tests the doctor itself: it builds a throwaway sandbox (temporary folders, a stand-in `claude`), breaks it in known ways (hooks removed, hook program altered, settings file broken, data folder missing, index corrupted, …), and verifies that every fault is detected and every repairable one is repaired. Your real files are not touched.

## Running the tests

```sh
npm test               # L1–L6: invariants, unit, properties, corpus, protection, processes
npm run test:coverage  # the same with per-file coverage floors
npm run test:dist      # L7, after npm run build
npm run test:mod       # L8, needs Claude Code
npm run test:live      # L10, opt-in, uses a little quota
npm run verify         # everything that can run here, one summary
```

## Plan and status

The plan this page was written from (2026-10-12), kept as a checklist until every item is done:

- [ ] Test helpers: temporary data and Claude Code folders, fixtures, golden files, property-test settings with recorded seeds, a stand-in `claude`.
- [ ] L1 invariants.
- [ ] L2 unit tests for every module without one, and the uncovered branches of the rest; per-file coverage floors.
- [ ] L3 property tests.
- [ ] L4 everyday corpus; `belt replay`.
- [ ] L5 self-protection, including the gaps found while measuring this plan: Windows 8.3 short names of protected folders are not recognised (`C:/Users/u/TERMIN~1/config.json` is allowed today), and protected folders behind links.
- [ ] L6 process tests for the CLI and the installer with a stand-in `claude`.
- [ ] L7 the same against `dist/`.
- [ ] L8 mod tests with Claude Code's test kit; `claude plugin validate --strict` in the static layer.
- [ ] L9 assumption tests.
- [ ] `doctor`: the check catalog, safe repairs with backup and re-check, self-tests, `--self-check`, `--fix`, `--json`, the control center's maintenance page.
- [ ] L10 live tests (opt-in).
- [ ] L11 mutation testing.
- [ ] `npm run verify`; CI: macOS on every change once public, nightly run against the latest Claude Code; README section with measured numbers.
