# Tool packs

A **tool pack** extends Claude for one kind of work: building a Flutter app, working with Firebase, preparing a store release, testing a web page, writing a Typst document, rendering a 3D model, cutting a video. Each pack is a Claude Code plugin with a guide (a skill) and, for some, a local server. A pack is **on only in the projects that need it**: elsewhere it is not loaded and costs nothing.

You do not have to know the packs. With **Automatic use** on (the default, asked at install), a project turns on the packs its files call for as a session starts there, and Claude can turn one on when the work needs it. Store uploads and payments stay yours: they are asked every time, bypass or not.

## The packs

| Pack         | For                                                                                                   | Needs on this computer                                  | While on   |
| ------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------- |
| `flutter`    | Flutter and Dart: the Dart SDK's own MCP server (analysis, tests, pub, a running app), how to verify  | Dart 3.9 or newer (Flutter 3.35)                        | ~67 tokens |
| `firebase`   | Firestore, Auth, rules, Crashlytics through the Firebase CLI's MCP server, pinned to `15.34.0`        | Node.js (`npx`); you sign in with `firebase login`      | ~70 tokens |
| `store`      | App Store Connect (`asc`), Google Play (`gplay`), Maestro UI flows: checks, metadata, builds          | the ones you use; their keys stay out of the repository | ~59 tokens |
| `browser`    | A real browser from the command line (`agent-browser`): open, read, click, fill, screenshot           | `agent-browser` 0.39.1                                  | ~57 tokens |
| `typst`      | Typst documents: compile, check the PDF, Turkish text                                                 | `typst` 0.15.1                                          | ~47 tokens |
| `typescript` | Diagnostics after each edit, through Anthropic's official `typescript-lsp` plugin                     | `typescript-language-server`                            | none       |
| `python`     | Type checking after each edit, through Anthropic's official `pyright-lsp` plugin                      | `pyright`                                               | none       |
| `openscad`   | OpenSCAD models rendered from the command line, with the errors that do not change the exit code read | `openscad`                                              | ~52 tokens |
| `ffmpeg`     | Audio and video: inspect, convert, cut, measure loudness, never overwriting the original              | `ffmpeg`                                                | ~70 tokens |

"While on" is what a pack adds to every session in that project, as `claude plugin details` projects it (Claude Code 2.1.302, 2026-10-18): its skill's line. A server's tools sit behind tool search; a language server adds diagnostics only when an edit has some. `mode-code packs guide <pack>` prints a pack's guide and how to install what it needs; installing a program is yours, never Claude's.

## How a pack is turned on

A pack is turned on for one project the way Claude Code does it itself: `claude plugin install <pack> --scope local`, run in that project's folder. Claude Code then names it in the project's `.claude/settings.local.json` and loads it there, and only there (measured in `scripts/test-packs.mjs`, against the real Claude Code in a configuration folder of its own). A pack turned on during a session loads when you type `/reload-plugins`, or in the next session.

- **As a session starts**, with Automatic use on: the project's top-level files say what it is (`pubspec.yaml` → `flutter`, `firebase.json` → `firebase`, `ios` and `android` → `store`, `*.typ` → `typst`, `tsconfig.json` → `typescript` …), and each matching pack that is not on yet is turned on. A pack whose server needs a program that is not on this computer waits: it would only fail to start. You see one line saying which.
- **When Claude asks**, through the catalog (below): within the same rules, and never in a session that has read outside content (a web page, an issue, another service's data): there a new pack waits for you.
- **By you**: `mode-code packs on <pack>` in the project's folder, or `off`.

Each pack also has a mode, set in the control center (Claude Code › Tool packs) or with `mode-code packs set <pack> <mode>`:

| Mode        | Means                                                                  |
| ----------- | ---------------------------------------------------------------------- |
| `automatic` | As Automatic use says (the default)                                    |
| `always`    | On in every project as a session starts there, whatever its files      |
| `me`        | Only when you turn it on; Claude can read its guide but not turn it on |
| `never`     | Never on, and no hints about it                                        |

What Mode_Code turned on is kept in `~/.mode-code/state/packs.json`; `mode-code uninstall` turns each off again where it was turned on, and takes out the empty `enabledPlugins` Claude Code leaves behind.

## How Claude knows

Claude does not read the packs' guides until it needs one, so knowing about them costs almost nothing:

1. **The first note** of a session (and again after `/clear` or a compaction) says, in one sentence, which kinds of packs exist. The whole note is at most 1,000 characters (a test holds it there).
2. **A one-line hint** when the work matches a pack that is not on: a word in your message (`typst`, `firestore`, `TestFlight`), a program a command runs, a file type it touches, or a program the shell could not find (then with how you install it). One hint per pack in a session; none for a pack set to `never`; nothing at all when nothing matches.
3. **The catalog tool** (`catalog`, behind Claude Code's tool search, so its description costs nothing until it is looked up): the packs that match a need, a pack's guide with what it needs, and turning one on.

Each pack turned on is told to you in a toast; each pack's first use in a session is recorded in the events. `mode-code packs` shows when each was last used, and names the packs turned on in that folder that have not been used for 30 days, with the command that turns one off: nothing is turned off by itself.

## Trust

Every pack keeps eight rules, checked by `test/core/packs.test.ts` on every change:

1. **Pinned.** What a pack runs itself is an exact version (`firebase-tools@15.34.0`); nothing at `latest`, no `npx -y` without a version. What you install is named with its minimum version. Anthropic's official Firebase and Playwright plugins run `@latest`, so the Firebase pack is Mode_Code's own, pinned.
2. **No script piped into a shell** to install anything: a package manager (`winget`, `brew`, `npm`) or a release whose files carry checksums.
3. **Usage reporting off** where a program reports by default (`ASC_TELEMETRY_DISABLED=1`, `MAESTRO_CLI_NO_ANALYTICS=1`), said in the guide and set in a pack's server.
4. **What writes elsewhere or sends is the belt's.** A pack that works with an account or with other people's text is not "free": its steps go through the safety belt like any other.
5. **Local.** Servers run on this computer, over standard input; none is reached over the network.
6. **Outside content.** A browser page or a database is someone else's text: using those tools marks the session as having read outside content ([safety-belt.md](safety-belt.md)). The Dart SDK's server works on the project itself and does not.
7. **Source.** Mode_Code's own marketplace or Anthropic's official one; never a community marketplace.
8. **No known hole.** A program with a published security hole is named at the version that closed it.

What the record cannot show was checked by hand on 2026-10-18: each program's owner, licence and latest release (`npm view`, `winget show`, the GitHub releases), and the telemetry switches in their documentation.

## Settings

```json
"packs": { "autoUse": true, "items": { "store": "me", "ffmpeg": "always" } }
```

`autoUse` and the modes are yours alone: Claude cannot change them (`mode-code packs` refuses inside a Claude Code session, and the settings file is the safety belt's to protect). Synced across computers, turning Automatic use on or letting a pack further waits for you ([sync.md](sync.md)).

## Limits

- A pack turned on mid-session loads only after `/reload-plugins` or in the next session; until then Claude works from its guide through the catalog.
- The markers are a project's top-level names only; a monorepo whose app sits in a subfolder is matched from that folder.
- The hints read words, programs and file types: they can miss work described otherwise, and they never force anything.
- The packs were measured in Claude Code's own tools (validation, `plugin details`, a local install in an isolated configuration) and in its engine's test kit; their programs were not run here.
