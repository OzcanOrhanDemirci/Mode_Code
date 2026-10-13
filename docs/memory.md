# Memory and handoffs

Claude Code's **auto memory** is a folder of markdown notes Claude keeps for itself: a `MEMORY.md` index loaded into every session (its first 200 lines or 25 KB) and one topic file per memory, read when needed. By default it lives under `~/.claude/projects/<project>/memory/`, one folder per repository, on one machine only ([How Claude remembers your project](https://code.claude.com/docs/en/memory#auto-memory)).

terminal-code lets you choose where that memory lives, keeps it in sync, and carries your work from one session to the next with **handoff notes** kept inside the same memory. It guides you through the setup and does the parts that can be done for you; it never publishes your memory, and it holds anything that looks like a secret back from GitHub.

## Where your memory lives

You pick one of three places:

|                          | 1 · This computer only                                                          | 2 · Your GitHub only                                                                                                          | 3 · This computer and your GitHub                                     |
| ------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Where the notes are      | a folder you choose (`~/claude-memory` by default)                              | a private repository in your GitHub account                                                                                   | a folder you choose, and a private repository it is kept in sync with |
| On this computer         | the folder, with its own change history (git, local only) when git is installed | a working copy terminal-code keeps in its own data folder (`~/.terminal-code/memory/<repository>`); you never need to open it | the folder                                                            |
| When you are offline     | nothing changes                                                                 | sessions work from the working copy; changes go up when the network is back                                                   | sessions work from the folder; changes go up when the network is back |
| On a new computer        | nothing to bring                                                                | run the setup, pick the same repository: everything comes back                                                                | run the setup, pick the same repository and an empty folder           |
| If this computer is lost | the memory is lost with it                                                      | nothing is lost                                                                                                               | nothing is lost                                                       |

Claude Code reads memory from files on the computer it runs on, so with GitHub there is always a copy here: in choice 2 it is terminal-code's to manage, in choice 3 it is a folder of yours. The repository is always **private**; the setup refuses to use a public one.

All three make Claude Code use **one memory for all your projects**: the folder is set as Claude Code's `autoMemoryDirectory` in your user settings. One index keeps what you teach Claude in one project available in the others; per-project memories you already have are brought in under `projects/<name>/` (below).

## Setting it up

```
terminal-code memory setup
```

or in the control center: Settings › Memory › Where it lives, then `s` (the control center steps aside for the setup and comes back to the same page). The setup is a short conversation in your terminal; it changes nothing until you have seen the whole list of changes and said yes once.

1. **What is there now.** Where it is set up, Claude Code's `autoMemoryDirectory` if you set one, the per-project memories under `~/.claude/projects/`, and whether the folder is a git repository with a remote.
2. **Where it should live:** 1, 2 or 3 (Enter takes 3).
3. **git and the GitHub CLI** (`gh`). When one is missing, the setup shows the command that installs it on your system (winget on Windows, Homebrew on macOS, apt-get, dnf, pacman or zypper on Linux) and runs it in your terminal if you say so; where none fits, it names the download page. A program installed a moment ago is found where its installer put it, even before a new terminal knows it. Without git a memory on this computer works, with no history; GitHub needs git.
4. **Signing in to GitHub** (2 and 3): `gh auth login` in your terminal if you are not signed in.
5. **The folder** (1 and 3): an empty folder, or one that already holds a memory (a `MEMORY.md`), which is used as it is. A folder of other files is used only if you say so.
6. **The repository** (2 and 3): a name in your account, `claude-memory` by default, or `owner/name`. A name GitHub would not take is explained with what it would become (`my memory` → `my-memory`). A repository that does not exist is created **private**; an existing private one is used (empty, or holding the memory of another computer, which then comes down here); a public one is refused. A folder that is already a clone of a repository is kept that way. Without the GitHub CLI you can give the address of an empty private repository instead; its privacy cannot be checked then, and the setup asks you to confirm it.
7. **Memory you already have:** the notes in the folder Claude Code used until now are copied into the new place, and Claude Code's per-project memories under `projects/<name>/`, with a line for each in `MEMORY.md`. Nothing is moved or deleted; the old folders stay as they were.
8. **Protection:** whether the safety belt protects the folder as memory (Claude cannot delete notes; shrinking the index asks you first).
9. **The list of changes**, then one confirmation. What can be on it: creating the repository; letting git use your GitHub sign-in (`gh auth setup-git`); bringing the repository down or starting the history; the commit name and address in this folder only (GitHub's private `…@users.noreply.github.com` address when you are signed in), when git has none; a README, a `.gitignore` and the `handoffs/` folder; the copied notes; the first commit and push (a file that looks like it holds a secret is held back); Claude Code's `autoMemoryDirectory` (your settings file is backed up first, and a settings file that is not valid JSON is left alone); the protection; your choices in terminal-code's settings.

If a step fails, the setup stops there and says what was done; running it again picks up from what is there. It runs only in your own terminal: inside a Claude Code session it refuses, as the other commands that change protections do. `terminal-code memory` shows where things stand at any time.

## Keeping it in sync

With a git history (all three, when git is installed):

| When                                       | What terminal-code does                                                                                                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A session starts                           | records what was left from before, brings in what changed on GitHub (`git pull --rebase --autostash`) and sends what is new; what came in is told to Claude with your first prompt |
| A turn ended and the memory folder changed | records the change (a commit that says what changed and in which session) and, with GitHub, sends it (`git push`)                                                                  |
| You run `terminal-code memory sync`        | the same, at once, and says where things stand                                                                                                                                     |

- **Only the memory's own files.** A memory folder inside a larger repository commits only its own files.
- **Secrets and large files are held back.** Before a commit, each changed file is scanned with the secret scanner; one that looks like it holds a key or a token is not committed, nor is a file over 1 MB, and you are told which file (once per session, and in `terminal-code memory`).
- **Nothing is forced.** When the same note changed here and on another computer and git cannot join the changes, the pull is undone, your files stay as they are, and `terminal-code memory` says which files need you. A push the remote rejects (it moved on) is pulled once and sent again. terminal-code never force-pushes or rewrites the memory's history.
- **Offline is normal.** A pull or push that cannot reach GitHub is tried again at the next turn or session.
- **A memory you keep in sync yourself.** When the folder already has a git history the setup did not start, the setup asks how terminal-code should look after it: everything (as above), **only bring in** changes when a session starts and only when that needs no merge (`git pull --ff-only`; you commit and push), or **leave git to you** (status only; `terminal-code memory sync` does everything when you ask). Such a folder gets no README or `.gitignore`, and handoff notes go into it only when you say so. In every mode, what arrived since this computer's last session, whoever brought it in, is told to Claude. See [sync.md](sync.md#memory-you-already-keep-in-sync).
- **Claude hears what came in.** Claude Code loads the index (`MEMORY.md`) as a session starts, and the pull at the start can land after that: measured once in WSL2, where a session answered from the old index although the pull had landed 0.7 s before the prompt. So what a pull brings in is told to Claude with your next prompt (the first one waits for the start's pull): the files, and the lines the index lost and gained, up to 30. Past that, or when the lines cannot be read, Claude is asked to read the index again.
- **Who does it.** The plugin, inside Claude Code. Where the plugin is not loaded, the safety-net hook does the same at the session's first prompt and at the end of each turn. Each keeps a record of its last sync.

## Handoffs

A **handoff note** says where the work stands so that the next session, here or on another computer, goes on from there instead of starting over.

**What is in it.** What Claude wrote: a summary, what is still open, the decisions taken, and the next step. What code measured: the project's folder and branch, your last request, an open flow or full-autonomy run, the quota, the commits of the session and the files left uncommitted. Secrets are masked everywhere.

**When one is written:**

| When                                                                               | Who writes it                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| You type `handoff` / `devir` (alone or at the end of a message)                    | Claude writes the four parts through the tool `mcp__terminal-code__handoff`; code checks that each is there, not too long and free of secrets, adds what it measured, keeps the note and syncs it |
| You type `wrap up` / `toparla`                                                     | the same, as part of wrapping up                                                                                                                                                                  |
| Before Claude Code compacts the conversation                                       | the compaction's own summary, with what code measured: no extra model call                                                                                                                        |
| On `/clear` and when the session ends, if it changed something since its last note | what code measured and your last request (no summary: there is no one left to write it)                                                                                                           |
| When a full-autonomy run pauses or ends                                            | the run's state, with the path of its report                                                                                                                                                      |

**Where it is kept:** in the memory, under `handoffs/<project>/`, one file per note named by its time (UTC) and session, synced like the rest; without a memory set up, in terminal-code's own folder. `<project>` is the project you named in the session (`terminal devam`), else the project registered for the folder, else its GitHub repository (`owner-repo`), else its folder's name, so the same project on two computers shares its handoffs. The newest 20 per project stay in the folder; older ones leave it at the next session's start and remain in the memory's git history.

**How the next session takes it.** On the session's first prompt, Claude is told in one line that a note is waiting: when and where it was written, why, its next step, and its path. When you type `<project> continue` / `<proje> devam`, the whole note goes to Claude with your prompt. A session is not offered its own note, and notes older than 14 days are not offered. `terminal-code memory handoff` prints the newest, `--all` lists them; the control center lists them under Projects › Handoffs.

Handoff notes are not memory entries: they are not added to `MEMORY.md`, and Claude is told not to index them.

## The morning report

When you come back after a while (6 hours by default), the first prompt shows one line of what happened while you were away and what waits for you, the control center's Home shows it first, and `terminal-code morning` shows it in full:

- full-autonomy runs that ended, paused or got stuck, with their reports, and the steps they deferred to you;
- flows whose plans wait for your approval;
- the memory: changes that still wait to go up, a pull that needs you, a file held back for a secret, a sync that failed;
- notes from full-autonomy runs waiting for your approval (below);
- sessions that ran, by folder, and the handoff notes they left;
- what the safety belt blocked or asked about, and the quota used.

## Notes from full-autonomy runs

During a full-autonomy run Claude does not write the memory (the run's guard refuses it); its notes go to the run's notes file instead. They wait for you: `terminal-code memory notes` shows them, `approve <id>` hands the notes to the next session, where Claude merges them into the memory by the memory's own rules, and `discard <id>` leaves them out. Each is handed over once. Nothing from an unattended run enters your memory without you, and an agent cannot approve.

## Commands

| Command                                                  | What it does                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| `terminal-code memory`                                   | where the memory lives, its sync state, the newest handoff here  |
| `terminal-code memory setup`                             | the setup above                                                  |
| `terminal-code memory sync`                              | record, pull and push now                                        |
| `terminal-code memory handoff [--all] [--project <key>]` | the newest handoff note (or all of them)                         |
| `terminal-code memory notes [approve\|discard <id>]`     | notes from full-autonomy runs waiting for you, and your decision |
| `terminal-code morning [--hours N]`                      | the morning report                                               |

Each takes `--json`. In the control center: Settings › Memory (where it lives, handoffs and morning report, protected folders), Projects › Handoffs, Home. `terminal-code doctor` checks the store too: whether Claude Code uses it, its history and remote, and its last sync.

## Settings

| Setting                     | Default | What it does                                                                                               |
| --------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `memory.store`              | none    | written by the setup: `place`, `dir`, `remote`, `repo`, `git`, `sync` (`auto`/`pull`/`manual`), `handoffs` |
| `memory.handoff.enabled`    | `true`  | handoff notes at all                                                                                       |
| `memory.handoff.onCompact`  | `true`  | a note from each compaction's summary                                                                      |
| `memory.handoff.onEnd`      | `true`  | a note from what code measured on `/clear` and at a session's end                                          |
| `memory.handoff.keep`       | `20`    | notes kept per project in the folder                                                                       |
| `memory.handoff.maxAgeDays` | `14`    | older notes are not offered                                                                                |
| `memory.morning.enabled`    | `true`  | the morning report's line                                                                                  |
| `memory.morning.afterHours` | `6`     | how long without a prompt counts as away                                                                   |

## Limits

- **One memory for all projects.** Claude Code's `autoMemoryDirectory` is one folder; per-project memory folders under `~/.claude/projects/` are not synced. The setup brings existing ones in; afterwards Claude writes to the shared folder.
- **Conflicts need you.** Two computers changing the same note between syncs can conflict; the conflict is shown, never resolved by guessing.
- **A note written on `/clear` or at the end has no summary.** For a full one, type `handoff` before you clear.
- **Secrets are found by patterns and entropy**, as the secret scanner finds them elsewhere: a password written in plain words is not recognised. Keep secrets out of memory.
- **Commits that need you are not made.** A memory whose git signs commits with a key that asks for a passphrase cannot be committed in the background; the commit fails and is reported.
- **Old notes are pruned by the safety-net hook** at a session's start (the plugin cannot delete files).
- **GitHub is the only host the setup creates repositories on.** Another host works with an address you give; its privacy cannot be checked.

## Measured

On the author's Windows 11 machine and in the WSL2 distribution of [autonomy.md](autonomy.md), Claude Code 2.1.296, 2026-10-13:

| What                    | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live, headless sessions | a store kept in sync with a bare repository standing for GitHub. A note another clone pushed after this one last pulled reached Claude before it answered. One run in WSL2 did not: Claude Code had loaded the index before the start's pull landed, so Claude answered from the old one; with what came in told at the first prompt, the runs since (Windows and WSL2) answered from the new note. `devir` had Claude write the note through the handoff tool; it was committed (`memory: 1 added (session …)`) and pushed. The next session, asked whether a note was waiting, repeated its next step word for word. Windows 11 of 11 live checks ($0.024); WSL2 14 of 14 ($0.039), full autonomy included |
| The setup               | driven through its questions with real git and a stand-in GitHub (bare repositories reached through `url.insteadOf`, `gh` answered in process): this computer only; a new private repository with per-project memories brought in; a second computer bringing the memory down, then the same setup run again; a public repository refused and a name GitHub would not take explained; signing in; the GitHub CLI installed through winget, or declined; a secret held back; a settings file that is not JSON left alone; no to the list changing nothing                                                                                                                                                     |
| The sync                | on real repositories: a change committed and sent and brought in on the other clone; a rejected push pulled once and sent; a conflict undone with the files as they were and nothing forced; a secret and a large file held back; a store inside a larger repository committing only its own files; an unreachable remote, then its first push setting the upstream. Every branch also with git answered by script                                                                                                                                                                                                                                                                                           |
| Mutation testing        | the four core modules (the store, the sync, handoff notes, the morning report): 213 changes, 211 caught and 2 explained as equivalent in `test/mutation-equivalents.json`; the memory's settings, the doctor's check and the keyword in their modules, all caught                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Found while building it | `git remote get-url` returns the address after `url.insteadOf` rewrites it, so a clone was not recognised as one (the configured `remote.origin.url` is read instead); git's trimmed output had cut the first letter off the first uncommitted file in a note; the engine's test kit listed no folders, so runs and handoff folders looked empty there; Claude Code may load the index before the start's pull lands (a live run answered from the old index), so what a pull brings in is now told with the next prompt                                                                                                                                                                                     |

## Plan and status

Written 2026-10-13, kept as a checklist:

- [x] Core: the store's settings (`memory.store`, `memory.handoff`, `memory.morning`), parsed and checked; the project key; the store's layout; repository names checked against GitHub's rules.
- [x] Core: the sync as one function over an injected command runner (commit with a message, pull, push; secrets and large files held back; conflicts undone and reported; a rejected push pulled once; offline kept for later), shared by the plugin, the hook and the command line.
- [x] Core: the handoff note (compose, parse, the newest per project, pruning, the check of Claude's parts, the line and the whole note for Claude), the morning report, the decisions on run notes.
- [x] Keywords `handoff` / `devir`; `wrap up` asks for a handoff too.
- [x] Node: git and the GitHub CLI found or installed (per platform and package manager), signing in, the repository viewed, created or cloned; `autoMemoryDirectory` written with a backup; existing memory brought in.
- [x] The setup as steps with a question interface, driven by the terminal and by the control center; refused under an agent.
- [x] Plugin: the sync at session start and after a turn, the handoff tool and its triggers (keyword, wrap up, compaction, `/clear` and end, runs), the first prompt's handoff line, the whole note on continue, the morning line, approved notes handed over once.
- [x] Safety-net hook: the sync and the handoff line on the first prompt, the sync at Stop, when the plugin is not loaded; pruning at every session start.
- [x] Command line: `memory`, `memory setup`, `memory sync`, `memory handoff`, `memory notes`, `morning`; control center: Settings › Memory, Projects › Handoffs, Home; the doctor's check.
- [x] Tests in every layer: unit, real git against a local bare repository, git answered by script, a stand-in GitHub, the setup driven through its questions, the command line as a process, the hook as a process, the control center, the engine's test kit, mutation targets and coverage floors, live sessions.
- [x] Docs: README in both languages, keywords, command reference, architecture, testing, changelog.
- [x] Measured: a live session that pulls a change made elsewhere and answers from it, writes a handoff on the keyword and has it taken over by the next session; on Windows and in WSL2.
