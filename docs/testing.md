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

| Layer                       | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                      | Where                                                             | Runs                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **L0 · Static**             | Types are sound (strict TypeScript), formatting, licenses of bundled code, the build itself.                                                                                                                                                                                                                                                                                                                                        | `tsconfig.json`, `scripts/build.mjs`                              | every change, CI                                                                       |
| **L1 · Invariants**         | Rules about the code itself: the pure core imports no Node module (it also runs inside Claude Code, where there is no Node), no network module anywhere (no telemetry, checked), every source file carries its license line, every message exists in both languages, every command and every belt rule is documented, the minimum Node and Claude Code versions agree everywhere they are written.                                  | `test/invariants/`                                                | every change, CI                                                                       |
| **L2 · Unit**               | Each module on its own, edge cases included: shell parsers (Bash, PowerShell, cmd), path resolution, belt rules, keywords, quota, footer, config, secrets, formatting, transcripts, the session index, installer planning, health, the control center screens.                                                                                                                                                                      | `test/core/`, `test/node/`, `test/app/`, `test/cli/`, `test/tui/` | every change, CI                                                                       |
| **L3 · Properties**         | Statements that must hold for _every_ input, checked on generated ones: parsers never throw and always finish; resolving a path twice changes nothing; `parse(serialize(config))` is the config; masking a secret twice is masking it once; versions compare as a total order; no screen draws a line wider than the terminal at any width. 300 cases each with a fixed seed on every change; 50,000 with a fresh seed every night. | `test/properties/`, `test/tui/widths.test.tsx`                    | every change, CI · nightly                                                             |
| **L4 · False alarms**       | A corpus of everyday commands (builds, tests, git reads, file viewing, package managers, in Bash and PowerShell) that must pass without a single question. A replay tool measures the same thing on your own recent sessions.                                                                                                                                                                                                       | `test/corpus/`, `terminal-code belt replay`                       | every change, CI · on demand                                                           |
| **L5 · Self-protection**    | The tool defends its own files, its hooks, Claude Code's settings and your memory folders, under every spelling of a path (Windows, Git Bash, `~`, variables, 8.3 short names, links), and fails closed when it breaks (a crashing or slow belt blocks changing tools, never reads).                                                                                                                                                | `test/protection/`, `test/hook/`                                  | every change, CI                                                                       |
| **L6 · Processes**          | The hook program, the command line and the installer as separate processes, against isolated data and Claude Code folders and a stand-in `claude` command: install, doctor, repair, uninstall, every `--json` contract.                                                                                                                                                                                                             | `test/process/`                                                   | every change, CI                                                                       |
| **L7 · Shipped bundles**    | The same process suite against `dist/`.                                                                                                                                                                                                                                                                                                                                                                                             | `test/process/suite.ts`, `test/dist/`                             | after build, CI                                                                        |
| **L8 · Inside Claude Code** | The plugin as Claude Code reads it (`claude plugin validate --strict`), its types against the engine's own, and the mod loaded by Claude Code's engine and test kit (`claude plugin test`): belt verdicts through the real hook chain, the fail-closed `.catch`, keywords, the quota guard and the resume timer on a mocked clock, footer drawing, compaction.                                                                      | `test/mod/`, `scripts/test-mod.mjs`, `scripts/typecheck-mod.mjs`  | every change where Claude Code is installed; nightly CI against the newest Claude Code |
| **L9 · Assumptions**        | Facts about the machine the code relies on, measured on the machine itself.                                                                                                                                                                                                                                                                                                                                                         | `test/assumptions/`, `terminal-code doctor`                       | CI on Windows, Linux, macOS · your machine                                             |
| **L10 · Live**              | Three real Claude Code sessions (`claude -p`, the cheapest model, a spending cap) with the hooks and the mod loaded from the build, five checks: a harmless command runs; the mod loaded in the real engine and reported itself alive; a write into the tool's own data folder is refused and the file never appears; the refusal reaches the model with its reason; a keyword typed as the prompt reaches the mod.                 | `scripts/test-live.mjs`                                           | opt-in (`npm run test:live`), costs about one US cent of quota                         |
| **L11 · Mutation**          | Small deliberate changes (a comparison flipped, a boundary moved, a condition inverted) to the belt, paths, config, keywords, quota, secrets, versions and the doctor's checks; a surviving change means a missing test, or is explained in `test/mutation-equivalents.json`.                                                                                                                                                       | `scripts/mutate.mjs`                                              | weekly CI, `npm run verify`, on demand                                                 |

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
- under every spelling: `C:\x`, `C:/x`, `/c/x`, `/cygdrive/c/x`, `\\?\C:\x`, `~`, `$HOME`, `%USERPROFILE%`, `$env:USERPROFILE`, relative paths, `..`, mixed case on Windows and macOS, Git Bash's `/tmp`, Windows 8.3 short names (`TERMIN~1`), the trailing dots and spaces Windows drops from a name (`.claude.`), and protected folders that are themselves links (a dotfiles repository behind `~/.claude`).

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

When a check fails and a safe repair exists, `doctor` offers it; `doctor --fix` applies them without asking. Every repair backs up what it changes, is re-checked right after (a repair counts only if the check then passes), and never weakens a protection: repairs only restore. What cannot be repaired automatically is reported with the exact next step.

When an agent runs `doctor`, the repairs that would put code or a program into the protection are refused and left to you: copying the hook program or the plugin files from the build that runs the doctor, reinstalling or turning on the plugin, pointing the hooks at another Node.js, and rewriting your settings file. Hook entries are put back only with the Node.js you installed them with. Otherwise an agent could build a weaker hook and have the doctor install it for it. Housekeeping repairs (data folders, the session index, stale files, a broken quota reading, permissions) run either way.

`doctor` also runs the built-in self-tests: the samples the CI uses for the belt, the parsers, the secret scanner, the keywords and the footer, run against the code installed on your machine, and the installed hook program compared with the in-process belt on the same samples.

`doctor --self-check` tests the doctor itself: it builds a throwaway sandbox (temporary folders, a stand-in `claude`), breaks it in known ways (hooks removed, hook program altered, settings file broken, data folder missing, index corrupted, …), and verifies that every fault is detected and every repairable one is repaired. Your real files are not touched.

## Running the tests

```sh
npm run build          # first: the process tests also run the shipped bundles in dist/
npm test               # L1–L7 and L9: invariants, unit, properties, corpus, protection, processes, bundles, assumptions
npm run test:coverage  # the same, holding each file to its coverage floor (test/coverage-floors.json)
npm run test:mod       # L8, needs Claude Code on PATH (says "skipped" without it)
npm run test:mutation  # L11, about a minute on 12 threads
npm run test:live      # L10, opt-in, uses a little quota
npm run verify         # every layer that can run here, one line each; --fast leaves out mutation, --live adds L10
```

A property test that fails prints its seed and the smallest input that fails; `TC_SEED=<seed> TC_RUNS=<runs> npm test` replays it exactly.

## Where each layer runs

| When                       | What runs                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every change (CI)          | L0–L7 and L9 on Windows and Linux with Node.js 22 and 24; coverage floors on Windows with Node.js 24; macOS on demand while the repository is private, then on every change |
| Every night (CI)           | the newest Claude Code release against this build (L8); the property tests with a fresh seed and 50,000 cases, on Linux and Windows                                         |
| Every week (CI)            | mutation testing (L11)                                                                                                                                                      |
| Before a release (by hand) | `npm run verify -- --live` on Windows and macOS                                                                                                                             |
| On your machine            | `terminal-code doctor`: the assumptions, the installation and the built-in self-tests                                                                                       |

A night or week that fails sends the repository owner GitHub's failure mail; nothing fails quietly.

## Measured

`npm run verify` on the author's Windows 11 machine (Node.js 24.15, Claude Code 2.1.296, 12 threads), 2026-10-12:

| Layer                   | Result                                                                                                            | Time         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------ |
| L0 types, format, build | pass                                                                                                              | 2 s          |
| L1–L7, L9 and coverage  | 392 tests: 390 pass, 2 skipped (a macOS-only and a POSIX-only one); mean line coverage 96.1% over 83 source files | 55 s         |
| L8 inside Claude Code   | 19 of 19 in the engine's test kit; the mod type-checks against the engine's own types                             | 3 s          |
| doctor self-check       | 13 faults injected in a sandbox: 13 noticed, 12 of 12 repairable ones repaired and checked again                  | 4 s          |
| L11 mutation            | 602 of 602 changes caught; 32 more explained in `test/mutation-equivalents.json`                                  | 69 s         |
| L10 live (opt-in)       | 5 of 5 checks in 3 sessions, US$0.010 reported by Claude Code                                                     | separate run |

Also measured: the everyday corpus is 197 commands (165 Bash, 32 PowerShell), each judged on Windows, macOS and Linux with not one question; `belt replay` over the author's last 30 days read 36,423 tool calls in 17 s and would have asked 133 times (4.4 a day) and blocked 91; the property tests passed with four fresh seeds at 200,000 cases each. The doctor has 36 checks and 14 repairs. CI runs the same suite on Linux and macOS, where the 2 skipped tests run and the Windows-only ones skip.

## What the tests found

Every one of these was a real defect in code that already had tests, found while building the layers above and fixed with a test that keeps it fixed:

- **Self-protection bypasses.** Windows 8.3 short names (`TERMIN~1`) and trailing dots and spaces (`.claude./settings.json.`) reached protected files without being recognised; so did a protected folder reached through a link. The first fix for short names broke protection when the data folder itself was spelled short: the CI's Windows runner, whose temporary folder is `RUNNER~1`, caught it.
- **False alarms.** On macOS and Linux every recursive delete under the home folder was blocked, inside projects too (found while writing the macOS and Linux tests). Dry-run deployments were asked about (found by the corpus).
- **Missed calls.** `npx wrangler deploy` hid the program it runs from the belt (found by measuring the author's own sessions).
- **Crashes and inconsistencies.** A command containing `__proto__` or `constructor` crashed the parser; the width the screens measured differed from what Ink draws on 756 characters, emoji and symbols among them; a path whose last name trims to `.` or `..` resolved differently the second time (property tests, the last one only with 50,000 cases and a fresh seed).
- **Contracts.** `install --json` and `uninstall --json` printed text before the JSON (process tests).
- **The doctor itself.** Run by an agent, `doctor --fix` would have copied the build the agent was running into the protection (found while testing the repairs).

## Not covered

- **Branches an agent may not write a test for.** The doctor's checks for settings that turn hooks off are tested only with values that leave hooks on: the safety belt, rightly, refuses to let an agent write a settings fixture that turns hooks off. They are listed as `not-agent-testable` in `test/mutation-equivalents.json` and are for a person to cover.
- **Version comparisons the source never reaches.** Five comparisons of the installed version with this build's are skipped when running from source; the shipped-bundle tests reach them, mutation testing (which runs the source) does not.
- **Interactive Claude Code.** The live tests run `claude -p`. The permission dialog and the drawing of footer lines were checked in real interactive sessions by hand, not on every change; the resume after a quota reset is tested in the engine's test kit on a mocked clock, not in a session that waits for a real reset.
- **A determined adversary on native Windows.** The belt is an accident preventer there, not a security boundary (see [safety-belt.md](safety-belt.md)).

## Plan and status

The plan this page was written from (2026-10-12), kept as a checklist:

- [x] Test helpers: temporary data and Claude Code folders, fixtures, golden files, property-test settings with recorded seeds, a stand-in `claude`.
- [x] L1 invariants.
- [x] L2 unit tests for every module without one, and the uncovered branches of the rest; per-file coverage floors.
- [x] L3 property tests.
- [x] L4 everyday corpus; `belt replay`.
- [x] L5 self-protection, including the gaps found while measuring this plan: Windows 8.3 short names of protected folders, and protected folders behind links.
- [x] L6 process tests for the CLI and the installer with a stand-in `claude`.
- [x] L7 the same against `dist/`.
- [x] L8 mod tests with Claude Code's test kit; `claude plugin validate --strict`.
- [x] L9 assumption tests.
- [x] `doctor`: the check catalog, safe repairs with backup and re-check, self-tests, `--self-check`, `--fix`, `--json`, the control center's maintenance page.
- [x] L10 live tests (opt-in).
- [x] L11 mutation testing.
- [x] `npm run verify`; CI: coverage floors, a nightly run against the newest Claude Code, weekly mutation testing; README section with measured numbers.
- [ ] macOS on every change: set up, and switches on by itself when the repository becomes public.
