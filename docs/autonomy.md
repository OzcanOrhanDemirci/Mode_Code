# Full autonomy

**Full autonomy** runs one task to its end while nobody is at the keyboard. Claude works until a definition of done that code checks is met, and stops before that only for reasons code measures. It never asks: what needs a person (an irreversible or outward step, a question the safety belt would ask, a permission dialog) is refused, recorded with the exact command, and handed over in the run's report, while the rest of the work goes on. It starts only inside an isolation boundary that code measures first.

It is the third step of the interaction axis: manual (`manual <project> continue`) → autonomous (`<project> continue`) → full autonomy (`<project> full auto quota +N`). Autonomous work still stops to ask about the decisions that are yours; full autonomy defers them to the end.

It is off until you turn it on.

## Turning it on

In your own terminal:

```
terminal-code autonomy enable
```

or in the control center under Settings › Autonomy. Both show what it does, what it needs and its limits, and ask you to confirm. An agent cannot turn it on: the command refuses to run inside a Claude Code session, and the settings file is protected by the safety belt. `terminal-code autonomy disable` turns it off; a run that is going on pauses at its next step.

## Where it runs

Full autonomy runs only behind a boundary the operating system enforces. Claude Code's own documentation is the reason: its Bash sandbox constrains shell commands only, so it is not enough on its own for unattended runs; file tools, hooks and MCP servers run outside it ([Choose a sandbox environment](https://code.claude.com/docs/en/sandbox-environments)).

| Platform       | What full autonomy needs                                                                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows        | **WSL2 only**, in a distribution with no road back to Windows: Windows interop off and no Windows drive mounted (setup below). On native Windows Claude Code runs commands unsandboxed, so a run is refused there |
| Linux, macOS   | Claude Code's Bash sandbox in its strict form. For a hard boundary around file tools too, run Claude Code in a container or a virtual machine                                                                     |
| Every platform | Claude Code's sandbox on and strict, a permission mode that never stops to ask, terminal-code's plugin and safety-net hook running, and the fence below                                                           |

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

**The fence** (terminal-code's own, in every run): file tools write only inside the project (the git work tree the session runs in), the temporary folders and the run's work folder; reads of credential files (`~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.netrc`, `~/.git-credentials`, `~/.npmrc`, `~/.docker/config.json`, `~/.kube/config`, `~/.gnupg`, Claude Code's own credentials) are refused, by file tools and in shell commands. Memory folders are not written during a run; notes go to the run's notes file, which the report lists for you. Like the safety belt, the fence is an accident preventer; the boundary is the operating system's.

## Starting a run

Write the task and end the message with the keyword and a budget:

```
Add rate limiting to the public API, with tests. terminal full auto quota +10
Herkese açık API'ye testleriyle hız sınırı ekle. terminal tam otonom kota +10
```

The budget is required: full autonomy never runs on the default limit. `quota N` is an absolute weekly percentage, `quota +N` points above the current reading.

Before the first step, code checks every condition below. Any that fails means no run; you read each failed check with what to do about it. `terminal-code autonomy check` shows the same in your terminal before you start (all but the live probe, which needs the session).

| Check         | Passes when                                                                                                                                                       | Measured from                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| turned on     | you enabled full autonomy                                                                                                                                         | the settings file                                                        |
| budget        | the message gives `quota N` or `quota +N`, a fresh quota reading exists, and the budget is above it                                                               | the keyword, the plugin's quota reading                                  |
| platform      | Linux or macOS (Windows: inside WSL2)                                                                                                                             | the platform                                                             |
| WSL isolation | on WSL: version 2, Windows interop off, no Windows drive mounted                                                                                                  | `/proc/sys/kernel/osrelease`, `/proc/sys/fs/binfmt_misc`, `/proc/mounts` |
| sandbox       | `sandbox.enabled`, `failIfUnavailable` and `allowUnsandboxedCommands: false` in the settings Claude Code runs with; no excluded commands, no Unix socket openings | Claude Code's merged settings                                            |
| sandbox probe | a write outside the project, run through Claude Code's own shell tool, is refused by the operating system                                                         | a live command (`touch ~/.terminal-code-sandbox-probe`)                  |
| asks nobody   | the permission mode is one that never waits for an answer (above)                                                                                                 | Claude Code's permission mode, as the safety-net hook receives it        |
| safety net    | the safety-net hook has run in this session (the belt holds even if the plugin stops)                                                                             | the hook's state file for the session                                    |
| project       | the session runs at the top of a git work tree with no uncommitted changes to tracked files                                                                       | git                                                                      |
| alone         | no flow and no other run is open in this session, and no other live session runs one in this folder                                                               | the plugin's records                                                     |

## How a run goes

A run has three phases, shown under the prompt (`🤖 full auto · plan`, `🤖 full auto · 2/5`):

```
📐 plan  →  🔨 work: milestone 1 … n  →  ✅ finish
```

**📐 Plan.** Claude writes the run's plan in the run's work folder, in the form of a flow plan ([modes.md](modes.md)): numbered steps, each with an `Acceptance:` line, and a Verification section with the commands that prove the work. Claude finishes the phase with the tool `mcp__terminal-code__autonomy` (`plan`); code checks the plan's form and that the safety belt allows each verification command. While planning, the project does not change (the plan mode guard). If you registered your own definition of done for the project (`projects[].verify` in the settings, for example `["npm run check"]`), those commands are added to the verification and the plan cannot drop them. The plan can be revised later the same way: steps may change, verification commands can only be added.

**🔨 Work.** Each plan step ends with a **milestone** (`milestone`, with the step's number). Code:

1. requires a new commit since the last milestone and no uncommitted changes to tracked files: a milestone is a point you can return to;
2. records a **rollback point**, a git reference `refs/terminal-code/runs/<id>/<n>` on that commit (local only; branches and the work tree are not touched);
3. runs an **independent review**: a separate model call that has none of the session's conversation, only your request word for word, the plan, the step with its acceptance criteria, the commits and their diff. It answers `PASS`, `CONCERNS` (the milestone stands, the findings go back to Claude) or `FAIL` (the milestone is refused with the findings; fix and try again). A change that deletes tests or adds skip markers is pointed out to the reviewer by code;
4. answers with **your request again, word for word**, the next step, and the question whether the rest of the plan still serves the request.

**✅ Finish** (`finish`) succeeds only when: every step has an accepted milestone; nothing tracked is uncommitted; every verification command exits with 0, run through Claude Code's own (sandboxed) shell tool; a final independent review of the whole run against your request does not fail; and the report draft has its sections (below). Only then is the run done.

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

## When a run stops by itself

| Reason                 | What code measures                                                                                                                                                                   | Afterwards                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| done                   | `finish` passed                                                                                                                                                                      | report, notification                                 |
| stuck                  | `stuck` with a report and at least one recorded blocker                                                                                                                              | report, notification                                 |
| no measurable progress | three attempts to stop in a row with nothing changed (the same commit, the same work tree, the same record), or no milestone for `autonomy.stallMinutes` (90) and then as long again | the run pauses; report, notification                 |
| time limit             | `autonomy.maxHours` (12) of running time                                                                                                                                             | the run pauses; report, notification                 |
| budget                 | the quota guard's wrap-up level for the run's budget, or the 5-hour window                                                                                                           | the run pauses and resumes by itself after the reset |
| you                    | `stop` / `dur`, `wrap up` / `toparla`, Esc, `full auto cancel` / `tam otonom iptal`                                                                                                  | paused (cancel: ended)                               |

A paused run continues with `<project> continue` / `<proje> devam` (in a new session too, after `/clear`, after a crash); the checks of the start run again first, and the run picks up at its phase with its budget. After a compaction the run's state is restated to Claude, your request word for word included.

## The report

When a run ends or pauses, `~/.terminal-code/runs/<id>/report.md` holds:

- what Claude wrote (the draft's `Summary` and `Decisions`: the decisions it took on its own);
- what code measured: each milestone with its commits, review verdict and rollback commands; the verification results; every deferred step with its exact command; the blockers; memory notes waiting for you; the quota the run used and how long it ran.

To go back to a milestone: `git switch -c <name> <commit>` keeps your branch as it is; `git reset --hard <commit>` moves it. The report prints both for each milestone; `terminal-code autonomy rollback <id> <n>` prints them again.

Seeing runs: a notification when a run ends; the control center's Home lists runs that ended while you were away, Projects › Runs shows each run with its phases, milestones, reviews, deferred steps and report; `terminal-code autonomy` and `terminal-code autonomy show <id>` (also `--json`).

## Setting up WSL2 for full autonomy

Measured on Windows 11 with WSL 2.6.2 and Ubuntu 24.04, 2026-10-13. In PowerShell:

```powershell
wsl --install -d Ubuntu-24.04 --name terminal-code --no-launch
```

Then, inside the distribution as root (`wsl -d terminal-code -u root`):

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

Restart only this distribution (`wsl --terminate terminal-code`; `wsl --shutdown` would also stop every other distribution, Docker Desktop's included). Then, as your user inside it: install Claude Code (`curl -fsSL https://claude.ai/install.sh | bash`), sign in (`claude`), add the strict sandbox to `~/.claude/settings.json`, clone your project inside the distribution (its own file system, not `/mnt/c`), and install terminal-code there.

With automount off the distribution cannot see your Windows files, and with interop off it cannot start Windows programs; Windows can still reach into it (`\\wsl.localhost\terminal-code`), and its network goes out through WSL's own. Your work comes back the way it would from another machine: through git.

## Limits

- **The boundary is the operating system's.** On WSL2 it is the distribution; on Linux and macOS without a container or virtual machine it is the Bash sandbox for shell commands and the fence for file tools, which is an accident preventer, not a security boundary.
- **Reads and the network.** File tools read wherever your user can, except the credential files above; commands reach the hosts Claude Code's sandbox settings allow (in `bypassPermissions` mode, any host unless `strictAllowlist` is on). Keep in the distribution only what the work needs.
- **The review reads the change, not the running program.** What runs is what the verification lists; a plan with weak verification is a weak definition of done. Your own `projects[].verify` commands are the strongest one.
- **Form, not meaning, in the plan and the report**, as in flows: code checks that every step has acceptance criteria, not that they are good; the review is a second opinion, not a proof.
- **Needs the plugin and the safety-net hook**, and an interactive session or `claude -p` with a quota reading.

## Measured

Filled in as the plan below is carried out.

## Plan and status

Written 2026-10-13, kept as a checklist:

- [ ] Core: the run record and its transitions (start, plan accepted or revised, milestone accepted or refused, blocker, deferred step, finish, stuck, pause with a reason, resume, cancel); a run reaches done only through a finish whose facts all passed.
- [ ] Core: the start checks as a pure function of measured facts (platform, WSL files, Claude Code's merged settings, permission mode, hook state, git, budget, records).
- [ ] Core: the stop decision (turned back while not done; let through for done, stuck, no progress, time limit, budget, person) with its progress fingerprint.
- [ ] Core: the full-autonomy guard: deferred classes (belt asks, protected-branch pushes and merges, releases, outward tools and MCP tools, person-only tools), unknown tools, the fence (file writes outside the project, temp and work folder; credential reads), memory folders.
- [ ] Core: the review (prompt, verdict parsing, the test-weakening signals) and the report (the draft's check, the facts section) in both languages.
- [ ] Core: the `full auto` / `tam otonom` keyword with project and budget, `full auto cancel` / `tam otonom iptal`; the interaction level in the session state; settings `autonomy.*` and `projects[].verify`.
- [ ] Plugin: start (checks, live sandbox probe, the run record), the `autonomy` tool, rollback references and diffs through git, the review through a model call, the guard on every tool call (subagents included), permission questions answered as deferred, labels, compaction, pause and resume (new session, quota reset), notifications, the report.
- [ ] Safety-net hook: the stop decision on Stop, with its counters in the hook's own state.
- [ ] `terminal-code autonomy` (list, show, check, enable, disable, rollback), Settings › Autonomy with the warning screen, Projects › Runs, Home's ended runs, doctor checks.
- [ ] Tests in every layer of [testing.md](testing.md): unit, properties (no sequence of events reaches done without its facts; a failed check never starts a run; the stop decision never lets an unfinished, progressing run stop), the engine's test kit, processes, mutation targets and coverage floors for the new deciding code.
- [ ] Measured in the WSL2 distribution: every start check on the real files, the test suite, a live run.
- [ ] The safety belt: commands run through `wsl` are judged as the Linux side's (its `/mnt/<drive>` paths as the Windows paths they are), so a command for the distribution is not mistaken for one on Windows.
- [ ] Docs: README in both languages, keywords, command reference, architecture, safety belt, testing, changelog.
