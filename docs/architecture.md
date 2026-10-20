# Architecture

```
            ┌──────────────────────────── Claude Code ─────────────────────────────┐
  you  ───► │  prompt ─► plugin (in-process mod) ─► tool call ─► settings hook ─► tool │
            │              keywords · belt · quota       (safety net: same belt)       │
            │              footer · quiet work · modes · flows (the flow_step tool)    │
            └──────────────┬───────────────────────────────────┬──────────────────────┘
                           │ writes                             │ writes
                           ▼                                    ▼
                 ~/.mode-code/  state/  events/  config.json  (one writer per file)
                           ▲
                           │ reads                ~/.claude/projects/*.jsonl (read-only)
                           │                                    │
            ┌──────────────┴──── mode-code (CLI + control center) ◄────┘
            │  index.db (SQLite, incremental) · health checks · installer
```

## Layers

| Layer                  | Where it runs                                          | Source               | Built to                                       |
| ---------------------- | ------------------------------------------------------ | -------------------- | ---------------------------------------------- |
| Core                   | everywhere; pure TypeScript, no Node APIs              | `src/core`           | bundled into the three programs                |
| Mod (plugin)           | inside Claude Code, through its `$` interface; no Node | `src/mod`            | `dist/plugin/hooks/register.js`, `mo-strip.js` |
| Hook                   | a short Node process per event                         | `src/hook`           | `dist/hook.mjs`                                |
| Node adapters          | the hook and the CLI                                   | `src/node`           |                                                |
| App services           | the CLI and the control center                         | `src/app`            |                                                |
| CLI and control center | your terminal (Ink + React)                            | `src/cli`, `src/tui` | `dist/cli.mjs`                                 |

The core holds every decision: the shell parsers and the belt, keywords, quota assessment, footer lines, settings parsing, session state transitions, messages in both languages. The mod and the hook only adapt it to their environment, so they decide identically.

Claude Code does not read a hooks module over 1 MiB, and then the plugin does nothing at all, with no error shown. So the build gives the plugin only the messages its own code names (`scripts/plugin-words.mjs`: about four in ten, since most belong to the control center and the command line), refuses a module over the limit and warns above 90%. `test/dist/plugin-words.test.ts` holds the built plugin to its sources.

## Data folder

| Path                                             | Writer                  | Contents                                                                                                        |
| ------------------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `config.json`                                    | you, the control center | settings                                                                                                        |
| `state/quota.json`                               | the mod                 | the latest rate-limit reading                                                                                   |
| `state/sessions/<id>.mod.json`                   | the mod                 | mode, budget, approvals, block counts, flow of one session                                                      |
| `state/sessions/<id>.hook.json`                  | the hook                | the hook's own counters, Claude Code's permission mode as hooks receive it, and the process the session runs in |
| `flows/<id>/flow.json`, `research.md`, `plan.md` | the mod                 | a flow's record, the checked report and the approved plan                                                       |
| `memory/<repository>/`                           | the memory setup        | the working copy of a memory kept on GitHub only ([memory.md](memory.md))                                       |
| `handoffs/<project>/`                            | the mod                 | handoff notes, when no memory store is set up (else inside the store)                                           |
| `state/memory-sync.<mod\|hook\|cli>.json`        | one writer each         | the last sync of the memory store                                                                               |
| `state/memory-seen.<mod\|hook\|cli>.json`        | one writer each         | the commit the memory store was last seen at (what arrived since is told)                                       |
| `state/sync.<mod\|hook\|cli>.json`               | one writer each         | the last sync across computers ([sync.md](sync.md))                                                             |
| `state/sync-ignored.json`                        | the CLI                 | settings from other computers the person kept their own value for                                               |
| `state/activity.json`                            | the mod                 | when you last typed, and the last long gap (the morning report)                                                 |
| `state/notes.json`, `state/notes-delivered.json` | the CLI, the mod        | your decisions on notes from runs, and which were handed to a session                                           |
| `events/<yyyy-mm>/<id>.<writer>.jsonl`           | mod, hook               | belt, keyword and quota events, append-only                                                                     |
| `index.db`                                       | the CLI                 | the session index                                                                                               |
| `bin/hook.mjs`, `marketplace/`                   | the installer           | the installed programs                                                                                          |
| `install/manifest.json`, `install/backups/`      | the installer           | what was installed; settings backups                                                                            |

Every runtime file has exactly one writer, so no two processes race on a file; writes are atomic (a temporary file and a rename).

## Decisions worth knowing

- **Mod first, hooks as a net.** Claude Code's mods API runs the plugin in-process (no process start per call, direct quota figures, dialogs, notices). Settings hooks are slower and simpler, so they carry only what must survive when the plugin is missing: the belt, keyword context, the footer check.
- **Exec-form hooks with an absolute Node path and `onFailure: "block"`.** No shell in between (faster, no quoting), and a hook that cannot start blocks instead of letting the call through.
- **Approvals by `tool_use_id`.** When you allow a call the belt asked about, the approval names that call's id, which the model cannot choose; it expires in ten minutes.
- **Drawn, not written.** Footer lines are added to the drawing of the answer (a render hook) and the mode and quota to the prompt footer, so they cost no tokens and carry no notice prefix. The session state (autonomous work, project, budget, chat mode) is restated through a compaction and reset by /clear.
- **Modes are judged before the call, in the plugin.** A restricted mode's guard runs after the safety belt in the plugin's tool hook: the same command analysis, then a classifier that sorts each program into reads, writes named files, changes around its folder, changes outside, or unknown. What it cannot place, it refuses. After the call, Claude Code's own read-only verdict is compared with the classifier's and a disagreement is logged.
- **One protection, three ways of working.** The belt's rules are the same in manual, autonomous and full autonomy; the way of working only says how much is asked (`src/core/belt/rules.ts`: each rule's act in each). Full autonomy asks nobody: a step the belt or the person's own rules would ask about is refused, recorded with its command and left to the person, in the plugin's tool hook, and Claude Code's own questions are answered once the belt let the call through. See [autonomy.md](autonomy.md).
- **The memory's sync is one function over a command runner.** `core/memory-sync.ts` decides every step (commit what changed, holding back secrets; pull with a rebase, undoing a conflict; push, pulling once on a rejection) and runs git through whatever runner it is given: Claude Code's `$.process.run` in the plugin, child processes in the hook and the command line. So the plugin, the hook (where the plugin is not loaded) and `mode-code memory sync` behave identically, and every branch is tested with git answered by script as well as on real repositories. See [memory.md](memory.md).
- **Computers share settings without sharing a file.** Each computer writes only its own folder of the shared place: its settings with the time each changed there, its history, summaries of its flows. The settings in effect are computed where they are read (the plugin, the hook's every call, the command line): `config.json` stays this computer's own, and the newest change of each setting wins, the same on every computer; one that lowers a protection waits for the person. So neither git nor a sync service ever has to choose between two computers' versions of a file, and nothing another computer sends can weaken a protection here. See [sync.md](sync.md).
- **A flow's record has one writer.** Only the plugin writes `flows/<id>/`, which the belt keeps the model from writing; the model finishes a step through a tool the plugin registers (`mcp__mode-code__flow_step`, served in-process), and the plugin checks the step before the record moves. The verification commands run through Claude Code's own shell tool, so the belt and the permission rules see them as any command.
- **Claude Code's permission mode comes from the hooks.** Claude Code hands `permission_mode` to settings hooks, not to plugins: the safety-net hook records it in its own state file, and the plugin reads it, together with the plan-mode notes Claude Code adds to the conversation. The order matters: Claude Code runs the plugin's prompt hook before the settings hooks' `UserPromptSubmit`, and `SessionStart` carries no permission mode (measured, Claude Code 2.1.296), so what the hook records with a prompt is there for the plugin only from that prompt's first tool call on.
- **Whether a session is still open is asked of its process.** A session marks itself ended first thing when it ends, but a window shut by its close button ends it without that, so its record alone would read as working for the next 15 minutes. The safety-net hook is Claude Code's child (exec form), so its parent is the session's own process: it records that process and its program when the session starts. Whoever counts another session as working (the same-folder warning, taking over a flow or a run, Now) looks the process up first: `tasklist` by its full path on Windows, `ps` elsewhere. Windows hands a freed process number out again soon, so there the program must match too. A lookup that cannot tell keeps the session counted: a warning too many, never one too few.
- **The folder never chooses what Mode_Code runs.** The belt asks git for facts it decides on (the branch, the remote, an alias), and the plugin, the hook and the command line read a project's state on their own, often before anyone has looked at the folder. A repository's own settings can name programs git runs while it only reads, and Windows looks a program up in the working folder before PATH. So every git call goes through `core/git-safe.ts`: the file system monitor and signature checks off; where the work tree is read, each filter driver the repository's own settings define switched off by name (the person's own, Git LFS among them, keep working; a name the command line cannot say stops the call); no converter or outside diff program; status stays out of submodules. The hook and the command line run git by its file in PATH's absolute folders, and every Node entry point turns off the working-folder lookup for itself and what it starts (`NoDefaultCurrentDirectoryInExePath`, as Claude Code does for its own process, where the plugin runs). Measured on Windows with git 2.55 and Node 24: each of those settings runs its program under plain git and none under Mode_Code's calls (`test/node/git.test.ts`).
- **Mo moves on Claude Code's clock, not the hooks'.** The hooks only say what they know (calls running, a question open, when something last happened) in one value of the session's state; a surface module (`src/mod/mo-strip.ts`) that Claude Code draws on its own frame clock works out the look on every tick and draws it. So an animation costs no hook calls, what just happened gives way by itself, and nothing Mo does can stand in the way of a call: its bookkeeping in the tool hook catches every failure. See [mo.md](mo.md).
- **Tokens counted per API message.** Transcripts repeat a message's usage on each content block; the index deduplicates by message id.
- **No runtime dependencies.** Each program is one bundled file; bundled third-party code is listed in `THIRD_PARTY_NOTICES.md`, and the build fails on a license outside the allowed list.

## Testing

`npm test` runs the core, the hook (as a process, with sample events), the index (on synthetic transcripts) and the control center (drawn into a fake terminal and driven with keys). Nothing in the tests runs a risky command: the belt is only ever asked about commands, never given them to run.
