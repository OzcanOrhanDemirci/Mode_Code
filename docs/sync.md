# Sync across computers

Mode_Code keeps its own settings and history on each computer it runs on. With **sync**, the computers you work on share them: a setting you change on one reaches the others, each sees what the others did (runs that finished, flows that wait, what the belt stopped), and handoff notes written on one are taken over on another, even when your memory is not managed by Mode_Code.

You choose where the shared copy lives and what it is called. Nothing is shared until you set it up, and nothing leaves your computers except to the place you chose.

## Where it lives

You pick one of two places:

|                     | 1 · A private repository on your GitHub                                                                                                      | 2 · A folder another service keeps in sync                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| What it is          | a repository you name (new, or one you already have); if it holds other files, Mode_Code keeps its own in a folder of it, which you name too | any folder that something else copies between your computers: iCloud Drive, OneDrive, Dropbox, Syncthing, a network share |
| On this computer    | a copy of the repository, in a folder you pick (`~/.mode-code/sync` unless you say otherwise), or a copy you already have                    | the folder itself                                                                                                         |
| What Mode_Code does | records what changed (git commits), brings in what the other computers sent, sends its own; nothing is forced                                | writes this computer's files into the folder and reads the others'; the service does the copying                          |
| What it needs       | git and the GitHub CLI; the setup finds them or installs them with your system's installer, and signs you in                                 | nothing                                                                                                                   |

Either way, **each computer writes only into its own folder** inside the shared place (`machines/<computer>/`), and handoff notes are new files with names no other computer uses. Two computers never change the same file, so neither git nor a sync service ever has to choose between them.

A repository on GitHub must be **private**: the setup checks, and refuses a public one.

## Setting it up

```
mode-code sync setup
```

or in the control center: Settings › Sync, then `s`. It is a short conversation in your terminal, like the memory setup, and it changes nothing until you have seen the whole list of changes and said yes once. Run it on each computer.

1. **Where:** 1 or 2.
2. **GitHub:** the setup finds git and the GitHub CLI (or offers to install them) and signs you in. Then it asks for the **repository**: a new name (it suggests `mode-code-sync`), or one you have. A new one is created private. An existing one is checked: private, and either empty, already used for sync, or holding other files (then it asks for the **folder** inside it to use). Last, where the **copy on this computer** goes: a new folder, or a copy of that repository you already have (a copy of your memory's repository, for example).
3. **A folder:** where it is. The setup reads it and shows which computers are in it already.
4. **This computer's name**, as the others will show it (your computer's name, unless you give another). A computer that was set up before is recognized, or you can say which of the listed ones this is.
5. **Handoff notes:** when your memory does not keep them, whether they go into the shared place, so every computer sees them.
6. **Settings that differ:** when other computers are there already and their settings differ from this one's, the setup shows the differences and asks whether to **take theirs** (the usual choice for a new computer) or **send this computer's** to them. With GitHub this comes after the download, before anything is sent.

## What travels

|                                                                                                                                   | Travels                                                        |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Settings: language, view, modules, footer, quota, keywords, the belt, handoff and morning-report settings, full autonomy's limits | yes, as described below                                        |
| Projects: their ids, names and definition of done                                                                                 | yes; a project's **folder** is each computer's own (see below) |
| Where things are on this computer: project folders, the memory folder, flows' work folder, the sync itself                        | no                                                             |
| Full autonomy switched on, bypass switched on                                                                                     | no: each computer is switched on by you, there                 |
| History: the belt's and the keywords' events, runs and flows (their summaries)                                                    | yes: each computer adds its own; the others read it            |
| Handoff notes, when the memory does not keep them                                                                                 | yes, in `handoffs/<project>/`                                  |
| The session index, the quota reading, sessions' live state, backups, installed programs                                           | no                                                             |

**The quota reading is not shared.** Rate limits belong to an account, and a reading does not say whose it is: two computers may well use two accounts. Each computer measures its own with its first answer.

**A project from another computer** arrives without a folder here. It still answers to its name in keywords; give it its folder on this computer with `mode-code sync project <id> <folder>`.

## How settings meet

Each computer keeps its settings in its own `config.json`, as before, and puts the shared part in its own file in the shared place, with the time each setting was last changed there. When computers disagree about a setting, **the newest change wins**, and every computer comes to the same value. A change you just made here wins at once, before it is even sent.

A setting from another computer never **lowers a protection** here without you. It waits instead, and you are told: on your first prompt, in the morning report, in `mode-code sync` and in Settings › Sync. `mode-code sync approve` takes it (in your own terminal; a Claude Code session cannot), `mode-code sync ignore` keeps yours until that computer changes it again. Making a protection stricter, and every other setting, applies by itself.

Lowering a protection means:

- the belt: switching a rule off, softening a rule's verdict, removing a protected branch or a repository from the pull-request-only or single-branch lists, turning the Docker volumes pack off;
- the modules that protect: the quota guard, the secret scanner, modes;
- the quota: raising the five-hour or weekly stop and wrap-up lines, trusting a reading for longer, resuming by itself;
- full autonomy: more hours, more minutes before a stall, another review model;
- projects: fewer commands in a definition of done, or a project that had one removed;
- keywords: a phrase added (a phrase can start autonomous work).

Settings that are lists (the belt's verdicts, the protected branches) count as one setting each.

## When it syncs

| When                                                         | What happens                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| A session starts                                             | this computer's new history and settings go into its folder; with GitHub they are committed, the others' changes brought in, and sent |
| After a turn, at most every 30 minutes (`sync.everyMinutes`) | the same, when there is something new                                                                                                 |
| A session ends                                               | the same                                                                                                                              |
| You run `mode-code sync now`                                 | the same, at once, and says where things stand                                                                                        |

The plugin does it inside Claude Code, and your first prompt waits for the start's sync, so a handoff note written on another computer is there when the session looks for one. Where the plugin is not loaded, the safety-net hook does it at the first prompt and after turns. A computer that is offline keeps working; what it has goes when the network is back.

History is kept for `sync.keepMonths` (3) months per computer in the shared place; older months leave it when a session starts (with GitHub, the history keeps them).

## Memory you already keep in sync

Many people keep their memory in a repository of their own and commit and push it themselves. `mode-code memory setup` now handles that as well: when the folder you pick is already kept in sync with a repository, it asks how Mode_Code should look after it.

| Mode                       | When a session starts                                                                                           | After a turn                   | Files Mode_Code adds to the folder    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------- |
| Everything (`auto`)        | records what was left, brings in changes (a fetch, then `git rebase`), sends                                    | records and sends what changed | handoff notes, if they are kept there |
| Only bring in (`pull`)     | brings in changes, and only when that needs no merge (a fetch, then `git merge --ff-only`); you commit and push | nothing                        | none                                  |
| Leave git to me (`manual`) | nothing                                                                                                         | nothing                        | none                                  |

Changes are brought in with a fetch that leaves `FETCH_HEAD` alone and a join with the branch the folder follows, not with `git pull`: a pull reads `FETCH_HEAD`, and when two fetch at the same moment (your own start hook, a second session) git finds several branches there and refuses ("Cannot fast-forward to multiple branches"). This way neither Mode_Code nor your own pull trips on the other.

The default is **Everything** for a repository Mode_Code set up, and **Only bring in** for one of your own. In every mode, what arrived since this computer's last session (whoever brought it in: Mode_Code, your own hook, you) is **told to Claude** with the first prompt, because Claude Code may have loaded the index before it arrived.

**Handoff notes** go into the memory folder only when you want them there (`memory.store.handoffs`); otherwise Mode_Code keeps them itself, in the shared place when sync is set up.

## Commands

| Command                                       | What it does                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| `mode-code sync`                              | where it lives, this computer and the others, the last sync, what waits for you |
| `mode-code sync setup`                        | the setup above                                                                 |
| `mode-code sync now`                          | a sync now                                                                      |
| `mode-code sync approve [<setting>…] [--all]` | takes settings from other computers that lower a protection                     |
| `mode-code sync ignore <setting>…`            | keeps this computer's value                                                     |
| `mode-code sync project <id> [<folder>]`      | a project's folder on this computer (the current folder unless you give one)    |

Each takes `--json`. `setup`, `approve`, `ignore` and `project` run only in your own terminal.

## Settings

| Setting                 | Default | What it does                                                                              |
| ----------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `sync.everyMinutes`     | `30`    | how often a session sends after its turns (5 to 1440)                                     |
| `sync.keepMonths`       | `3`     | months of history each computer keeps in the shared place (1 to 24)                       |
| `sync.handoffs`         | `true`  | handoff notes go into the shared place (when the memory does not keep them)               |
| `memory.store.sync`     | `auto`  | `auto`, `pull` or `manual` (above)                                                        |
| `memory.store.handoffs` | `true`  | handoff notes go into the memory folder; asked by the setup for a memory you keep in sync |

The whole `sync` section is this computer's own: the setup writes where the shared place is and what this computer is called, and the three settings above stay as each computer has them.

## Safety

- **Only you lower a protection.** Above.
- **Claude cannot write the computers' folders.** The belt protects `machines/` in the shared place like Mode_Code's own data folder.
- **Secrets stay home.** History is copied with secrets masked; a file that still looks like it holds one is held back from GitHub.
- **Private only, nothing forced.** A public repository is refused; a push is never forced; a pull that cannot be joined is undone and shown.

## Limits

- Two computers changing the same setting between two syncs: the newer change wins.
- A sync service that copies slowly delays what the other computers see; Mode_Code cannot tell how far behind it is.
- The other computers' history is what they last sent: a computer that is switched off shows what it did until then.
- A setting is compared as a whole: two computers changing different rules of the belt's verdicts between two syncs keep the newer list.

## Measured

On the author's Windows 11 machine and in the WSL2 distribution of [autonomy.md](autonomy.md), Claude Code 2.1.296, 2026-10-13:

| What                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live, headless sessions    | two computers' data folders through a bare repository standing for GitHub. One softened a belt rule; its plugin sent the change when its session started, and the handoff note the keyword had Claude write when the session ended. The other took the note over, and the softened rule waited: the person was told by a notice, and it was not in effect. Windows 14 of 14 live checks ($0.033); WSL2 17 of 17 ($0.048) |
| The settings' merge        | as properties over 300 generated cases each: every computer comes to the same value for every setting whatever the times, equal ones included; nothing that lowers a protection applies by itself                                                                                                                                                                                                                        |
| The shared place           | on real repositories: two computers' settings, history (a secret masked) and a handoff note travelling both ways, nothing ever joined with a merge commit; a repository with other files committing only its folder and leaving the person's uncommitted file as it was; a folder another service syncs; history past the months kept removed                                                                            |
| The setup                  | driven through its questions with real git and a stand-in GitHub: a new repository named by the person; a second computer shown where its settings differ (a softened rule named as such) and taking the others'; one sending its own; a repository holding other files, used through a folder of it and the person's own copy; a folder with a computer set up there before; refusals                                   |
| A memory kept by its owner | a fast-forward brought in on real repositories, both sides moved or a local edit in the way leaving everything as it was; what the owner's own pull brought in since the last session told with the first prompt, in the hook and in the plugin                                                                                                                                                                          |
| Mutation testing           | the sync's core and its export: 207 changes, all caught, four explained as equivalent; the memory's sync, settings and the doctor's checks again at 100%                                                                                                                                                                                                                                                                 |

## Plan and status

Written 2026-10-13, kept as a checklist:

- [x] This guide, then the decisions in [architecture.md](architecture.md).
- [x] Memory: the `pull` and `manual` modes for a memory you keep in sync yourself, asked by the setup; nothing added to such a folder; handoff notes where you want them; what arrived since the last session told to Claude whoever brought it in; the doctor's message about a memory set outside Mode_Code.
- [x] Core: the shared settings, their times, the newest change winning, lowering a protection held for approval; what is copied and kept.
- [x] The shared place on disk and in git: this computer's files, the others' read back, the sync through the same engine as the memory's.
- [x] The setup, both places, with the GitHub steps shared with the memory setup.
- [x] The command line, the plugin and the hook (when it syncs, settings read with the others' changes, the first-prompt notice), handoff notes in the shared place.
- [x] The control center (Settings › Sync, the morning report and Home with the other computers), the doctor, the belt protecting the shared place.
- [x] Tests in every layer, mutation targets and coverage floors; live: two computers' data folders through a bare repository.
- [x] README, changelog, testing.md; measured.
