# Full autonomy

**Full autonomy** runs one task to its end while nobody is at the keyboard. Claude works until a definition of done that code checks is met, and stops before that only for reasons code measures. It never asks: what needs a person (an irreversible or outward step, a question the safety belt would ask, a permission dialog) is refused, recorded with the exact command, and handed over in the run's report, while the rest of the work goes on. It starts only once code has measured where it runs: inside an isolation boundary, or on native Windows, which has none, with the safety belt and the write limits alone.

It is the third step of the interaction axis: manual (`manual <project> continue`) → autonomous (`<project> continue`) → full autonomy (`<project> full auto quota +N`). Autonomous work still stops to ask about the decisions that are yours; full autonomy defers them to the end.

It is off until you turn it on.

## Turning it on

In your own terminal:

```
mode-code autonomy enable
```

or in the control center under Working › Full autonomy. Both show what it does, what it needs and its limits, and ask you to confirm. An agent cannot turn it on: the command refuses to run inside a Claude Code session, and the settings file is protected by the safety belt. `mode-code autonomy disable` turns it off; a run that is going on pauses at its next step.

## Where it runs

Full autonomy is safest behind a boundary the operating system enforces. Claude Code's own documentation says why: its Bash sandbox constrains shell commands only, so it is not enough on its own for unattended runs; file tools, hooks and MCP servers run outside it ([Choose a sandbox environment](https://code.claude.com/docs/en/sandbox-environments)).

| Platform       | What full autonomy needs                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows        | **WSL2** for a boundary: a distribution with no road back to Windows, Windows interop off and no Windows drive mounted (setup below). On native Windows Claude Code runs commands unsandboxed: a run starts there too, guarded by the safety belt and the write limits alone, which prevent accidents and are no boundary. Turning full autonomy on says so |
| Linux, macOS   | Claude Code's Bash sandbox in its strict form. For a hard boundary around file tools too, run Claude Code in a container or a virtual machine                                                                                                                                                                                                               |
| Every platform | Claude Code's sandbox on and strict (where it runs), a permission mode that never stops to ask, Mode_Code's plugin and safety-net hook running, and the write limits below                                                                                                                                                                                  |

**The strict sandbox** is these Claude Code settings (in `~/.claude/settings.json` or passed with `--settings`):

```json
{
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": true,
    "allowUnsandboxedCommands": false
  }
}
```

`failIfUnavailable` makes Claude Code refuse to start when the sandbox cannot run (a missing `bubblewrap`), so a session that is running at all is sandboxed. `allowUnsandboxedCommands: false` removes the escape hatch that lets Claude retry a command outside the sandbox. `excludedCommands` must be empty, and `allowAllUnixSockets` / `allowUnixSockets` unset: each lets commands out of the boundary.

**A permission mode that never stops to ask:** `bypassPermissions`, `dontAsk` or `auto`, or `acceptEdits` together with `sandbox.network.strictAllowlist: true` (otherwise a command reaching a new host waits for an answer). Whatever still asks is answered by the plugin: refused and recorded as deferred, never left waiting.

**The write limits** (Mode_Code's own, in every run): file tools write only inside the project (the git work tree the session runs in), the temporary folders and the run's work folder; reads of credential files (`~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.netrc`, `~/.git-credentials`, `~/.npmrc`, `~/.docker/config.json`, `~/.kube/config`, `~/.gnupg`, Claude Code's own credentials) are refused, by file tools and in shell commands. Memory folders are not written during a run; notes go to the run's notes file, which the report lists for you. On native Windows, where no sandbox holds commands, the write limits also refuse a write a shell command names outside those folders (`Set-Content`, `>`, `cp`, …). Like the safety belt, the write limits are an accident preventer; the boundary is the operating system's.

## Starting a run

Write the task and end the message with the keyword and a budget:

```
Add rate limiting to the public API, with tests. terminal full auto quota +10
Herkese açık API'ye testleriyle hız sınırı ekle. terminal tam otonom kota +10
```

Or press `full auto` on the strip (or type `/tam-otonom`): a window opens where you pick the budget, write the task and press **Start**, and the same message is sent for you. Pressed while a run is attached, it ends the run. The last three tasks you gave full autonomy, either way, are kept under Working › Recent tasks in the control center, where Enter (or `c`) copies one back.

The budget is required: full autonomy never runs on the default limit. `quota N` is an absolute weekly percentage, `quota +N` points above the current reading.

Code checks every condition below, in two steps. At the prompt it checks all it can measure there: any that fails means no run, and you read each failed check with what to do about it. When none fails, Claude's first step is the autonomy tool's `start`. There the last two are measured: the permission mode this prompt came with (Claude Code hands it to the safety-net hook only after Mode_Code has read the prompt, so at the prompt the mode on record is an earlier prompt's or none) and the live probe. Every other check runs again with them, and the run starts, or you read what failed. A tool call Claude makes before `start` is held and answered with the outcome; a start Claude never takes up lapses with its turn. `mode-code autonomy check` shows the same in your terminal before you start (all but the permission mode and the live probe, which need the session).

| Check         | Passes when                                                                                                                                                                               | Measured from                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| turned on     | you enabled full autonomy                                                                                                                                                                 | the settings file                                                                                |
| budget        | the message gives `quota N` or `quota +N`, a fresh quota reading exists, and the budget is above it                                                                                       | the keyword, the plugin's quota reading                                                          |
| platform      | Linux, macOS or WSL2; native Windows passes too and says that there the run has no sandbox                                                                                                | the platform                                                                                     |
| WSL isolation | on WSL: version 2, Windows interop off, no Windows drive mounted                                                                                                                          | `/proc/sys/kernel/osrelease`, `/proc/sys/fs/binfmt_misc`, `/proc/mounts`                         |
| sandbox       | (not on native Windows) `sandbox.enabled`, `failIfUnavailable` and `allowUnsandboxedCommands: false` in the settings Claude Code runs with; no excluded commands, no Unix socket openings | Claude Code's merged settings                                                                    |
| sandbox probe | (not on native Windows) a write outside the project, run through Claude Code's own shell tool, is refused by the operating system                                                         | a live command (`touch ~/.mode-code-sandbox-probe`), at the first step                           |
| asks nobody   | the permission mode is one that never waits for an answer (above)                                                                                                                         | the permission mode this prompt came with, as the safety-net hook received it, at the first step |
| safety net    | the safety-net hook has run in this session (the belt holds even if the plugin stops)                                                                                                     | the hook's state file for the session                                                            |
| project       | the session runs at the top of a git work tree with no uncommitted changes to tracked files                                                                                               | git                                                                                              |
| alone         | no flow and no other run is open in this session, and no other live session runs one in this folder                                                                                       | the plugin's records                                                                             |

## How a run goes

A run has three phases, shown under the prompt (`🤖 full auto · plan`, `🤖 full auto · 2/5`):

```
📐 plan  →  🔨 work: milestone 1 … n  →  ✅ finish
```

**📐 Plan.** Claude writes the run's plan in the run's work folder, in the form of a flow plan ([modes.md](modes.md)): numbered steps, each with an `Acceptance:` line, and a Verification section with the commands that prove the work. Claude finishes the phase with the tool `mcp__mode-code__autonomy` (`plan`); code checks the plan's form, that the safety belt allows each verification command, and that a run may run it (a command that would wait for you could never pass). While planning, the project does not change (the plan mode guard). If you registered your own definition of done for the project (`projects[].verify` in the settings, for example `["npm run check"]`), those commands are added to the verification and the plan cannot drop them. The plan can be revised later the same way: steps may change, verification commands can only be added.

**🔨 Work.** Each plan step ends with a **milestone** (`milestone`, with the step's number). Code:

1. requires a new commit since the last milestone, no uncommitted changes to tracked files, and no new file left untracked (the untracked files that were there at the start are yours and do not count): a milestone is a point you can return to;
2. records a **rollback point**, a git reference `refs/mode-code/runs/<id>/<n>` on that commit (local only; branches and the work tree are not touched);
3. runs an **independent review**: a separate model call that has none of the session's conversation, only your request word for word, the plan, the step with its acceptance criteria, the commits and their diff, and the project as it is at that commit (its tracked files and its build manifests, such as `package.json`, so that what the diff does not touch is not taken for missing). It answers `PASS`, `CONCERNS` (the milestone stands, the findings go back to Claude) or `FAIL` (the milestone is refused with the findings; fix and try again). A change that deletes tests or adds skip markers is pointed out to the reviewer by code;
4. answers with **your request again, word for word**, the next step, and the question whether the rest of the plan still serves the request.

**✅ Finish** (`finish`) succeeds only when: every step has an accepted milestone; nothing is uncommitted and no new file is left untracked; every verification command exits with 0, run through Claude Code's own (sandboxed) shell tool; a final independent review of the whole run against your request, given the verification results with the end of each command's output, does not fail; and the report draft has its sections (below). Only then is the run done.

Until it is done, the run does not end: when Claude tries to stop, the safety-net hook turns it back with what is still missing (the current step, the checks that failed). Stopping is allowed only for the reasons in the next sections.

## What waits for you

These are never done during a run. Each is refused with the word **deferred**, recorded with its exact command or input, and listed in the report; Claude goes on with the rest of the work:

- what the safety belt would ask you about ([safety-belt.md](safety-belt.md)): force pushes, history rewrites, deletions outside the project, publishing a package, changing a repository's visibility, deploying, staging a secret, scheduled tasks, startup entries and shell profiles;
- pushing to a protected branch (`main`, `master`, `release/*` by default) and merging into one (`gh pr merge`); releases (`gh release create`); renaming, archiving or deleting a repository;
- tools that act outside the machine or the run: messages, notifications, publications, schedules, worktrees, and MCP tools whose names say they send, create, update, delete, publish or post (an MCP tool whose name does not say it only reads is deferred too);
- Claude Code's own permission questions;
- questions to you (`AskUserQuestion`) and Claude Code's plan mode: there is no one to answer. Claude decides where there is a sensible default and records the decision; otherwise it records a blocker.

A tool the plugin does not know is refused during a run: it is checked by name, and a new one has to be reviewed into a class before a run will call it.

When something is in the way, the order is: solve it, work around it, record it (`blocker`), and only when every path is blocked, end the run as **stuck** (`stuck`, with the report).

## Away from the computer

A run asks nothing, so it needs no one at the computer. To follow it from elsewhere, Claude Code's own `/remote-control` (`/rc`) connects the session to your phone or claude.ai/code: what Claude does shows there, and you can type into the session. Mode_Code's notifications (Settings › Features) say when a run ends, pauses or gets stuck, on the desktop and, once you give it an [ntfy](https://ntfy.sh) topic (`mode-code config set notify.ntfy https://ntfy.sh/<your topic>`), on your phone: the same one line (the task's first line, masked for secrets, and why), sent with `curl` and nothing else. Anyone who knows a topic's name on ntfy.sh can read it, so choose one nobody would guess, or a server of your own; a topic set from another computer waits for your approval like a lowered protection ([sync.md](sync.md)). At the time limit a run that is still reaching milestones goes on by itself (below), so a long task does not wait for you to come back and type `continue`.

## When a run stops by itself

| Reason                 | What code measures                                                                                                                                                                     | Afterwards                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| done                   | `finish` passed                                                                                                                                                                        | report, notification                                 |
| stuck                  | `stuck` with a report and at least one recorded blocker                                                                                                                                | report, notification                                 |
| no measurable progress | three attempts to stop in a row with nothing changed (the same commit, the same work tree, the same record), or no milestone for `autonomy.stallMinutes` (90) and then as long again   | the run pauses; report, notification                 |
| time limit             | `autonomy.maxHours` (12) of running time, and no milestone within `autonomy.stallMinutes`; a run that reached one goes on with a fresh limit, unless `autonomy.atTimeLimit` is `pause` | the run pauses; report, notification                 |
| budget                 | the quota guard's wrap-up level for the run's budget, or the 5-hour window                                                                                                             | the run pauses and resumes by itself after the reset |
| you                    | `stop` / `dur`, `wrap up` / `toparla`, Esc, `full auto cancel` / `tam otonom iptal`                                                                                                    | paused (cancel: ended)                               |

A paused run continues with `<project> continue` / `<proje> devam` (in a new session too, after `/clear`, after a crash); the checks of the start run again first, and the run picks up at its phase with its budget. After a compaction the run's state is restated to Claude, your request word for word included.

## The report

When a run ends or pauses, `~/.mode-code/runs/<id>/report.md` holds:

- what Claude wrote (the draft's `Summary` and `Decisions`: the decisions it took on its own);
- what code measured: each milestone with its commits, review verdict and rollback commands; the verification results; every deferred step with its exact command; the blockers; memory notes waiting for you; the quota the run used and how long it ran.

To go back to a milestone: `git switch -c <name> <commit>` keeps your branch as it is; `git reset --hard <commit>` moves it. The report prints both for each milestone; `mode-code autonomy rollback <id> <n>` prints them again.

Seeing runs: a notification when a run ends; the control center's Now lists the runs open and Activity › While you were away those that ended, Working › Full-autonomy runs shows each run with its phases, milestones, reviews, deferred steps and report; `mode-code autonomy` and `mode-code autonomy show <id>` (also `--json`).

## Setting up WSL2 for full autonomy

Measured on Windows 11 with WSL 2.6.2 and Ubuntu 24.04, 2026-10-13. In PowerShell:

```powershell
wsl --install -d Ubuntu-24.04 --name mode-code --no-launch
```

Then, inside the distribution as root (`wsl -d mode-code -u root`):

```bash
apt-get update && apt-get install -y bubblewrap socat git ripgrep curl ca-certificates xz-utils
useradd -m -s /bin/bash <you>
# Node.js 22.13 or later, for example from nodejs.org (check its SHASUMS256.txt)
cat > /etc/wsl.conf <<'EOF'
[boot]
systemd=true

[user]
default=<you>

[automount]
enabled=false
mountFsTab=false

[interop]
enabled=false
appendWindowsPath=false
EOF
```

Restart only this distribution (`wsl --terminate mode-code`; `wsl --shutdown` would also stop every other distribution, Docker Desktop's included). Then, as your user inside it: install Claude Code (`curl -fsSL https://claude.ai/install.sh | bash`), sign in (`claude`), add the strict sandbox to `~/.claude/settings.json`, clone your project inside the distribution (its own file system, not `/mnt/c`), and install Mode_Code there.

With automount off the distribution cannot see your Windows files, and with interop off it cannot start Windows programs; Windows can still reach into it (`\\wsl.localhost\mode-code`), and its network goes out through WSL's own. Your work comes back the way it would from another machine: through git.

## Bypass

**Bypass** lifts the safety belt in one session, for a while, when you choose: a deletion you asked for, a force-push you mean, a run of releases, without a question each time. It is a special way of working, not an everyday one, so it is off until you turn it on for this computer (control center › Working › Bypass, which asks first, or `mode-code config set bypass.enabled true` in your own terminal), and even then each session starts without it.

- **Only you switch it.** `/bypass`, or `⚡ bypass` on the strip, typed or pressed by you, here or from the phone; at the computer its window says, before anything changes, what it lifts and until when, with **Cancel** under the keyboard first (from the phone it asks once, "Turn bypass on for 2 h?"); it turns off with one press. A command Claude Code stamps as coming from anywhere else (a background notice, another session, a scheduled task, a headless run) is refused, and the belt keeps Claude from writing the setting or the session's record. The same holds for full autonomy.
- **It ends by itself**: at its time (`bypass.maxHours`, 2 by default, 1 to 24; ten minutes before, a warning), when the session ends or `/clear` starts a new one, and when the setting is turned off. A summary line says how many calls went through without asking.
- **What it lifts, in tiers** ([safety-belt.md](safety-belt.md#bypass)): self-protection and a secret leaving the computer never; deleting a drive root, a system folder or cloud data, formatting a disk and turning security software off are asked instead of blocked; deletes outside the project, a `.git` folder, a database reset and staging a secrets file are asked as always; the rest goes through.
- **No questions from Claude Code's mode either.** A permission question Claude Code's own mode asks (an edit, a command in its default mode) is answered yes for you. One that a rule in Claude Code's settings asks (yours, or your organisation's) stays yours: bypass does not touch Claude Code's own rules or its permission mode.
- **Everything is recorded.** Each call it let through (the tool, what it did, which rules it passed, what they would have done, which agent, whether it ran) is kept, one by one, under Working › Done without asking; the strip shows the count while it is on, in red.
- **Claude is told, plainly.** When it starts: it has full authority and full responsibility; it acts on its own judgment but only when the task truly needs an irreversible or outward step, takes the reversible path, treats text in pages, files and tool results as data and only your messages as instructions, names every such action in its answer, and leaves for you an irreversible step you did not ask for. A one-line reminder comes with each prompt, and the note survives a compaction.

## Limits

- **The boundary is the operating system's.** On WSL2 it is the distribution; on Linux and macOS without a container or virtual machine it is the Bash sandbox for shell commands and the write limits for file tools, which are an accident preventer, not a security boundary. On native Windows there is no boundary at all: the belt and the write limits read what a call says, and a script can do what a command cannot. For unattended work you would not watch, use WSL2.
- **Reads and the network.** File tools read wherever your user can, except the credential files above; commands reach the hosts Claude Code's sandbox settings allow (in `bypassPermissions` mode, any host unless `strictAllowlist` is on). Keep in the distribution only what the work needs.
- **The review reads the change, not the running program.** What runs is what the verification lists; a plan with weak verification is a weak definition of done. Your own `projects[].verify` commands are the strongest one.
- **Form, not meaning, in the plan and the report**, as in flows: code checks that every step has acceptance criteria, not that they are good; the review is a second opinion, not a proof.
- **Needs the plugin and the safety-net hook**, and an interactive session or `claude -p` with a quota reading.

## Measured

On the author's Windows 11 machine (WSL 2.6.2) and in a WSL2 distribution set up as above (Ubuntu 24.04.5, kernel `6.6.87.2-microsoft-standard-WSL2`, bubblewrap 0.9.0, socat 1.8.0.0, Node.js 24.15.0), Claude Code 2.1.296, 2026-10-13.

| What                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WSL as installed                           | `/mnt/c` mounted read-write (`9p`, `aname=drvfs`), the interop entry `/proc/sys/fs/binfmt_misc/WSLInterop` present and `enabled`: the start check names both, with the fix. Both files are kept as test fixtures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| WSL after the setup                        | after `/etc/wsl.conf` and `wsl --terminate`: no interop entry, no Windows drive mounted; `mode-code autonomy check` in a project inside the distribution: every check measurable from the terminal passes; `doctor`: 37 checks, 0 warnings. Ubuntu 24.04's AppArmor key for user namespaces does not exist in WSL's kernel, so bubblewrap needs no profile there                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| The sandbox's answer to the probe          | with `@anthropic-ai/sandbox-runtime` (the runtime Claude Code's sandbox is built on) in the distribution, `touch ~/.mode-code-sandbox-probe` exits 1 with `Read-only file system` and leaves no file: exactly what the start check reads as refused                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Tests                                      | 555 on Windows (553 pass, 2 skipped for the platform) and 555 in the WSL2 distribution (551 pass, 4 skipped), none failing; the engine's test kit 42 of 42 on both, 9 of them full autonomy end to end in the engine                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Mutation testing of the deciding code      | 310 of 310 changes caught in the run record, the start checks, the stop decision, the guard, the review and the report; 6 more explained as equivalent in `test/mutation-equivalents.json`. Three of the first survivors were gaps, now fixed: `cd ~ && cat .npmrc`, `gh -R owner/repo pr merge`, `cat ~/.aws/$PROFILE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Coverage                                   | the deciding modules 99.7 to 100% of their lines; mean line coverage 93.2% over 103 source files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Found in the first live run                | every start was refused with the permission mode unknown. Claude Code runs the plugin's prompt hook before the safety-net hook's `UserPromptSubmit`, and the `SessionStart` input carries no permission mode (measured in `-p` and in an interactive session, Claude Code 2.1.296), so at the prompt the mode on record was an earlier prompt's or none. The engine's test kit had put the mode on record before the prompt and could not see it. Fixed with the two-step start above; the kit now records the hook's view beneath the plugin, after its prompt hook, as Claude Code does                                                                                                                                                                                                                                                    |
| Found in the reviews of the first live run | shown only the diff, the reviewer called an ES module broken for want of a `"type": "module"` that the untouched `package.json` had, called a file of an earlier step missing, and asked for command output the run checks itself; each review ended `CONCERNS`, and Claude spent a turn checking a false alarm. Reviews now get the tracked files and the build manifests at the reviewed commit, and the final review the verification results; in the next runs every review answered `PASS`. The plans had also made "create the branch" and "run the verification" steps, which forced empty commits; the plan phase now says what a step is                                                                                                                                                                                            |
| Found while setting up the distribution    | the safety belt read `wsl -- rm -rf ~/dev/old` as a delete of the Windows home folder's `dev/old`; fixed (see [safety-belt.md](safety-belt.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Live, native Windows                       | 2026-10-15, Claude Code 2.1.300, haiku, `bypassPermissions`, no sandbox: two whole runs (`--only-auto`): the start checks passed without the probe, a plan, two milestones each on a commit with rollback references, the finish with `node --test` passing, the report kept; a stop before the end was turned back once. 0.019 $                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A live run                                 | in the distribution, headless (`claude -p`, Haiku, `bypassPermissions`, the strict sandbox), three times: the checks at the prompt passed (9), Claude's first step was `start`, where the permission mode and the live probe were measured and the run started (11 checks); a plan was accepted, each step reached its milestone on a commit of its own with a rollback reference and an independent review, the finish ran `node --test` through the sandboxed shell tool and the final review, and the report was written. A milestone asked for without a new commit was refused. In a second session told to end its turn once the plan was accepted, the model answered `PAUSED`; the safety-net hook turned the stop back, and the run went on to its finish. The whole live suite: 11 of 11 checks, $0.032 as Claude Code reported it |

## Plan and status

Written 2026-10-13, kept as a checklist:

- [x] Core: the run record and its transitions (start, plan accepted or revised, milestone accepted or refused, blocker, deferred step, finish, stuck, pause with a reason, resume, cancel); a run reaches done only through a finish whose facts all passed.
- [x] Core: the start checks as a pure function of measured facts (platform, WSL files, Claude Code's merged settings, permission mode, hook state, git, budget, records).
- [x] Core: the stop decision (turned back while not done; let through for done, stuck, no progress, time limit, budget, person) with its progress fingerprint.
- [x] Core: the full-autonomy guard: deferred classes (belt asks, protected-branch pushes and merges, releases, outward tools and MCP tools, person-only tools), unknown tools, the write limits (file writes outside the project, temp and work folder; credential reads), memory folders.
- [x] Core: the review (prompt, verdict parsing, the test-weakening signals) and the report (the draft's check, the facts section) in both languages.
- [x] Core: the `full auto` / `tam otonom` keyword with project and budget, `full auto cancel` / `tam otonom iptal`; the interaction level in the session state; settings `autonomy.*` and `projects[].verify`.
- [x] Plugin: start (checks, live sandbox probe, the run record), the `autonomy` tool, rollback references and diffs through git, the review through a model call, the guard on every tool call (agents included), permission questions answered as deferred, labels, compaction, pause and resume (new session, quota reset), notifications, the report.
- [x] Safety-net hook: the stop decision on Stop, with its counters in the hook's own state.
- [x] `mode-code autonomy` (list, show, check, enable, disable, rollback), Working › Full autonomy with the warning screen, Working › Full-autonomy runs, the runs on Now, doctor checks.
- [x] Tests in every layer of [testing.md](testing.md): unit, properties (no sequence of events reaches done without its facts; a failed check never starts a run; the stop decision never lets an unfinished, progressing run stop), the engine's test kit, processes, mutation targets and coverage floors for the new deciding code.
- [x] Measured in the WSL2 distribution: every start check on the real files, the test suite, and live runs (2026-10-13: start, plan, milestones, finish, report, a stop turned back).
- [x] The two-step start, found in the first live run: the checks measurable at the prompt there, the permission mode this prompt came with and the live probe at Claude's first step (the autonomy tool's `start`; a call made before it is held and answered with the outcome); the safety-net hook records each prompt's time beside the mode.
- [x] The safety belt: commands run through `wsl` are judged as the Linux side's (its `/mnt/<drive>` paths as the Windows paths they are), so a command for the distribution is not mistaken for one on Windows.
- [x] Docs: README in both languages, keywords, command reference, architecture, safety belt, testing, changelog.
