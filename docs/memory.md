# Memory and handoffs

Claude Code's **auto memory** is a folder of markdown notes Claude keeps for itself: a `MEMORY.md` index loaded into every session (its first 200 lines or 25 KB) and one topic file per memory, read when needed. By default it lives under `~/.claude/projects/<project>/memory/`, one folder per repository, on one machine only ([How Claude remembers your project](https://code.claude.com/docs/en/memory#auto-memory)).

terminal-code lets you choose where that memory lives, keeps it in sync, and carries your work from one session to the next with **handoff notes** kept inside the same memory. It guides you through the setup and does the parts that can be done for you; it never publishes your memory, and it holds anything that looks like a secret back from GitHub.

## Where your memory lives

You pick one of three places:

|                          | 1 · This computer only                                                          | 2 · Your GitHub only                                                                 | 3 · This computer and your GitHub                                     |
| ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Where the notes are      | a folder you choose (`~/claude-memory` by default)                              | a private repository in your GitHub account                                          | a folder you choose, and a private repository it is kept in sync with |
| On this computer         | the folder, with its own change history (git, local only) when git is installed | a working copy terminal-code keeps in its own data folder; you never need to open it | the folder                                                            |
| When you are offline     | nothing changes                                                                 | sessions work from the working copy; changes go up when the network is back          | sessions work from the folder; changes go up when the network is back |
| On a new computer        | nothing to bring                                                                | run the setup, pick the same repository: everything comes back                       | run the setup, pick the same repository and a folder                  |
| If this computer is lost | the memory is lost with it                                                      | nothing is lost                                                                      | nothing is lost                                                       |

Claude Code reads memory from files on the computer it runs on, so with GitHub there is always a copy here: in choice 2 it is terminal-code's to manage, in choice 3 it is a folder of yours. The repository is always **private**; the setup refuses to use a public one.

All three make Claude Code use **one memory for all your projects**: the folder is set as Claude Code's `autoMemoryDirectory` in your user settings. One index keeps what you teach Claude in one project available in the others; per-project memories you already have are brought in under `projects/<name>/` (below).

## Setting it up

```
terminal-code memory setup
```

or in the control center under Settings › Memory. The setup is a short conversation in your terminal; it changes nothing until you have seen the whole list of changes and said yes once.

1. **What is there now.** Claude Code's `autoMemoryDirectory` if you set one, the per-project memories under `~/.claude/projects/`, and whether the folder is a git repository with a remote.
2. **Where it should live:** 1, 2 or 3. A folder that is already a git repository with a GitHub remote can be kept as it is.
3. **The folder** (1 and 3): an empty folder or one that already holds memory.
4. **GitHub** (2 and 3):
   - git and the GitHub CLI (`gh`): when one is missing, the setup shows the command that installs it on your system (winget on Windows, Homebrew on macOS, your package manager on Linux) and runs it if you say so; where none fits, it names the download page;
   - signing in: `gh auth login` in your terminal, then `gh auth setup-git` so git uses the same login;
   - the repository: a name (`claude-memory` by default; it is checked against GitHub's naming rules and against your account), created **private**; or an existing private repository of yours, which is cloned;
   - without the GitHub CLI you can give the address of an empty private repository instead; its privacy cannot be checked then, and the setup says so.
5. **Memory you already have:** the notes in the folder Claude Code used until now are copied into the new place, per-project memories under `projects/<name>/` with a line for each in `MEMORY.md`. Nothing is moved or deleted; the old folders stay as they were.
6. **The list of changes**, then one confirmation. Your Claude Code settings file is backed up before `autoMemoryDirectory` is written; the first commit is checked for secrets before anything goes to GitHub.

The setup runs only in your own terminal: inside a Claude Code session it refuses, as the other commands that change protections do. `terminal-code memory setup` again changes the place later (from 1 to 3, say); `terminal-code memory` shows where things stand.

## Keeping it in sync

With a git history (all three, when git is installed):

| When                                       | What terminal-code does                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| A session starts                           | brings in what changed on GitHub (`git pull --rebase`), before Claude reads the index                                            |
| A turn ended and the memory folder changed | records the change (`git commit`, a message that says what changed and in which session) and, with GitHub, sends it (`git push`) |
| You run `terminal-code memory sync`        | the same, at once, and says where things stand                                                                                   |

- **Secrets are held back.** Before a commit, the changed files are scanned with the secret scanner; a file that looks like it holds a key or a token is not committed, and you are told which file and what to do.
- **Nothing is forced.** When the same note changed here and on another computer and git cannot join the changes, the pull is undone, your files stay as they are, and `terminal-code memory` says which files need you. terminal-code never force-pushes or rewrites the memory's history (the safety belt keeps Claude from doing it, too).
- **Offline is normal.** A pull or push that cannot reach GitHub is tried again at the next start or turn; the status says how many changes wait to go up.
- **Manual sync.** With `memory.store.sync` set to `manual`, terminal-code only shows the status; you run `terminal-code memory sync` when you want.

## Handoffs

A **handoff note** says where the work stands so that the next session, here or on another computer, goes on from there instead of starting over.

**What is in it.** What Claude wrote: a summary, what is still open, the decisions taken, and the next step. What code measured: the project and its branch, the commits of the session, files left uncommitted, an open flow or full-autonomy run, the quota, the machine and the time.

**When one is written:**

| When                                                                                | Who writes it                                                                                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| You type `handoff` / `devir` (alone or at the end of a message)                     | Claude writes the four parts through the tool `mcp__terminal-code__handoff`; code checks that they are there, adds what it measured and saves the note |
| You type `wrap up` / `toparla`                                                      | the same, as part of wrapping up                                                                                                                       |
| Before Claude Code compacts the conversation                                        | the compaction's own summary, with what code measured: no extra model call                                                                             |
| On `/clear` and when the session ends, if no note was written since the last change | what code measured and your last request (no summary: there is no one left to write it)                                                                |
| When a full-autonomy run pauses or ends                                             | the run's state, with the path of its report                                                                                                           |

**Where it is kept:** in the memory, under `handoffs/<project>/`, one file per note, synced like the rest. `<project>` is the project's name in terminal-code's settings, else its GitHub repository (`owner-repo`), else its folder name, so the same project on two computers shares its handoffs. The newest 20 per project stay in the folder; older ones remain in the memory's git history.

**How the next session takes it.** On the first prompt of a session in that project, Claude is told in one line that a handoff exists, when and where it was written, its next step and its path. When you type `<project> continue` / `<proje> devam`, the whole note goes to Claude with your prompt. Notes older than 14 days are not mentioned. `terminal-code memory handoff` shows the newest, `terminal-code memory handoff --all` lists them.

Handoff notes are not memory entries: they are not added to `MEMORY.md`, and Claude is told not to index them.

## The morning report

When you come back after a while (6 hours by default), the first session tells you in one line what happened while you were away, and `terminal-code morning` shows it in full:

- full-autonomy runs that ended, paused or got stuck, with their reports, and the steps they deferred to you;
- flows waiting for your approval;
- sessions that ran, by project, and the handoff notes they left;
- what the safety belt blocked or asked about;
- the quota used;
- the memory: changes that still wait to go up, a pull that needs you, a file held back for a secret;
- notes from full-autonomy runs waiting for your approval (below).

The control center's Home shows the same under "While you were away".

## Notes from full-autonomy runs

During a full-autonomy run Claude does not write the memory (the run's guard refuses it); its notes go to the run's notes file instead. They wait for you: `terminal-code memory notes` lists them, `approve <id>` hands an approved note to the next session, where Claude merges it into the memory by the memory's own rules, and `discard <id>` drops it. Nothing from an unattended run enters your memory without you.

## Commands

| Command                                                   | What it does                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| `terminal-code memory`                                    | where the memory lives, its sync state, the newest handoff here |
| `terminal-code memory setup`                              | the setup above                                                 |
| `terminal-code memory sync`                               | pull, commit and push now                                       |
| `terminal-code memory handoff [--all] [--project <name>]` | the newest handoff note (or all)                                |
| `terminal-code memory notes [approve\|discard <id>]`      | notes from full-autonomy runs waiting for you                   |
| `terminal-code morning`                                   | the morning report                                              |

Each takes `--json`.

## Limits

- **One memory for all projects.** Claude Code's `autoMemoryDirectory` is one folder; per-project memory folders under `~/.claude/projects/` are not synced. The setup brings existing ones in; afterwards Claude writes to the shared folder.
- **The pull happens when a session starts.** Two sessions writing the same note on two computers at once can still conflict; the conflict is shown, never resolved by guessing.
- **A handoff written on `/clear` or at the end has no summary.** For a full one, type `handoff` before you clear.
- **Secrets are found by patterns and entropy**, as the secret scanner finds them elsewhere: a password written in plain words is not recognised. Keep secrets out of memory.
- **GitHub is the only host the setup creates repositories on.** Another git host works through choice 3 with a remote you add yourself; the setup then keeps it in sync but cannot check its privacy.

## Plan and status

Written 2026-10-13, kept as a checklist:

- [ ] Core: the store's settings (`memory.store`: place, folder, remote, sync; `memory.handoff`; `memory.morning`), parsed and checked; the project key; the store's layout; repository names checked against GitHub's rules.
- [ ] Core: the sync as one function over an injected command runner (pull, commit with a message, push; secrets held back; conflicts undone and reported; offline kept for later), shared by the plugin, the hook and the command line.
- [ ] Core: the handoff note (compose, parse, the newest per project, the check of Claude's parts, the line and the full note for Claude), the morning report, the approval of run notes.
- [ ] Keywords `handoff` / `devir`; `wrap up` asks for a handoff too.
- [ ] Node: git and the GitHub CLI found or installed (per platform and package manager), signing in, the repository viewed, created or cloned; `autoMemoryDirectory` written with a backup; existing memory brought in.
- [ ] The setup as steps with a question interface, driven by the terminal and by the control center; refused under an agent.
- [ ] Plugin: the pull at session start, the commit and push after a turn, the handoff tool and its triggers (keyword, wrap up, compaction, `/clear` and end, runs), the first prompt's handoff line, the full note on continue, the morning line, approved notes.
- [ ] Safety-net hook: the pull and the handoff line at session start, the commit and push at Stop, when the plugin is not loaded.
- [ ] Command line: `memory`, `memory setup`, `memory sync`, `memory handoff`, `memory notes`, `morning`; control center: Settings › Memory, Sessions › Handoffs, Home's "While you were away"; doctor checks for the store.
- [ ] Tests in every layer: unit, properties, real git against a local bare repository, a stand-in `gh`, the setup driven through its questions, the command line as a process, the control center, the engine's test kit, mutation targets and coverage floors, live sessions.
- [ ] Docs: README in both languages, keywords, command reference, architecture, testing, changelog.
- [ ] Measured: the setup end to end on a local remote; a live session that pulls a change before Claude reads the index, writes a handoff on the keyword and takes it over in the next session.
