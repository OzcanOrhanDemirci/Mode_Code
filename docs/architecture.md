# Architecture

```
            ┌──────────────────────────── Claude Code ─────────────────────────────┐
  you  ───► │  prompt ─► plugin (in-process mod) ─► tool call ─► settings hook ─► tool │
            │              keywords · belt · quota       (safety net: same belt)       │
            │              footer · quiet work                                         │
            └──────────────┬───────────────────────────────────┬──────────────────────┘
                           │ writes                             │ writes
                           ▼                                    ▼
                 ~/.terminal-code/  state/  events/  config.json  (one writer per file)
                           ▲
                           │ reads                ~/.claude/projects/*.jsonl (read-only)
                           │                                    │
            ┌──────────────┴──── terminal-code (CLI + control center) ◄────┘
            │  index.db (SQLite, incremental) · health checks · installer
```

## Layers

| Layer                  | Where it runs                                          | Source               | Built to                        |
| ---------------------- | ------------------------------------------------------ | -------------------- | ------------------------------- |
| Core                   | everywhere; pure TypeScript, no Node APIs              | `src/core`           | bundled into the three programs |
| Mod (plugin)           | inside Claude Code, through its `$` interface; no Node | `src/mod`            | `dist/plugin/hooks/register.js` |
| Hook                   | a short Node process per event                         | `src/hook`           | `dist/hook.mjs`                 |
| Node adapters          | the hook and the CLI                                   | `src/node`           |                                 |
| App services           | the CLI and the control center                         | `src/app`            |                                 |
| CLI and control center | your terminal (Ink + React)                            | `src/cli`, `src/tui` | `dist/cli.mjs`                  |

The core holds every decision: the shell parsers and the belt, keywords, quota assessment, footer lines, settings parsing, session state transitions, messages in both languages. The mod and the hook only adapt it to their environment, so they decide identically.

## Data folder

| Path                                        | Writer                  | Contents                                             |
| ------------------------------------------- | ----------------------- | ---------------------------------------------------- |
| `config.json`                               | you, the control center | settings                                             |
| `state/quota.json`                          | the mod                 | the latest rate-limit reading                        |
| `state/sessions/<id>.mod.json`              | the mod                 | mode, budget, approvals, block counts of one session |
| `state/sessions/<id>.hook.json`             | the hook                | the hook's own counters                              |
| `events/<yyyy-mm>/<id>.<writer>.jsonl`      | mod, hook               | belt, keyword and quota events, append-only          |
| `index.db`                                  | the CLI                 | the session index                                    |
| `bin/hook.mjs`, `marketplace/`              | the installer           | the installed programs                               |
| `install/manifest.json`, `install/backups/` | the installer           | what was installed; settings backups                 |

Every runtime file has exactly one writer, so no two processes race on a file; writes are atomic (a temporary file and a rename).

## Decisions worth knowing

- **Mod first, hooks as a net.** Claude Code's mods API runs the plugin in-process (no process start per call, direct quota figures, dialogs, notices). Settings hooks are slower and simpler, so they carry only what must survive when the plugin is missing: the belt, keyword context, the footer check.
- **Exec-form hooks with an absolute Node path and `onFailure: "block"`.** No shell in between (faster, no quoting), and a hook that cannot start blocks instead of letting the call through.
- **Approvals by `tool_use_id`.** When you allow a call the belt asked about, the approval names that call's id, which the model cannot choose; it expires in ten minutes.
- **Tokens counted per API message.** Transcripts repeat a message's usage on each content block; the index deduplicates by message id.
- **No runtime dependencies.** Each program is one bundled file; bundled third-party code is listed in `THIRD_PARTY_NOTICES.md`, and the build fails on a license outside the allowed list.

## Testing

`npm test` runs the core, the hook (as a process, with sample events), the index (on synthetic transcripts) and the control center (drawn into a fake terminal and driven with keys). Nothing in the tests runs a risky command: the belt is only ever asked about commands, never given them to run.
