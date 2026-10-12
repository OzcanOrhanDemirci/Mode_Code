# Modes and mode flows

A **mode** says what kind of work a session is doing; a **flow** chains modes into steps that cannot be skipped. Both are enforced by code inside Claude Code (the plugin), not by a request Claude may or may not follow: a write that the mode forbids is refused before it runs, and a step counts as done only when code has checked what it produced.

## Modes

| Mode        | Keyword (English / Turkish) | Can                                                                                         | Is refused (by code)                                                                                      |
| ----------- | --------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Free        | `free` / `serbest`          | whatever your instructions and the safety belt allow; the default                           | nothing beyond the safety belt                                                                            |
| 💬 Chat     | `chat` / `sohbet`           | talk, read, measure, experiment in a temporary folder                                       | changing the project or the memory, commits, writing outside temporary folders, outward actions           |
| 🔍 Research | `research` / `araştırma`    | read, search the web, write reports in the work folder and in temporary folders             | the same as chat                                                                                          |
| 📐 Plan     | `plan` / `plan`             | read, write the plan (the flow's plan file, or the plan file Claude Code's plan mode names) | the same as chat                                                                                          |
| 🔨 Code     | `code` / `kod`              | develop, test, commit                                                                       | nothing beyond the safety belt and the project locks (protected branches, pull-request-only repositories) |

Chat, research and plan are the **restricted modes**. The safety belt and the project locks hold in every mode; a mode can only add restrictions.

"Outward actions" are tool calls that act on something outside the machine: MCP tools whose names say they send, create, update, delete, publish or post, and Claude Code tools that create worktrees or schedule work.

The mode is shown beside Claude Code's own mode labels under the prompt (💬 chat, 🔍 research, 📐 plan, 🔨 code), with the flow's progress when a flow runs.

### How a shell command is judged in a restricted mode

Each program a command runs (after `&&`, `|`, `$(…)`, `bash -c`, script blocks and wrappers like `sudo` or `xargs` are followed) is put in one of five classes:

| Class                         | Examples                                                                                                             | In a restricted mode                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **reads**                     | `ls`, `cat`, `rg`, `git log`, `git diff`, `jq`, `Get-ChildItem`, `npm view`, `curl` without upload, `node --version` | runs                                                                             |
| **writes named files**        | `> out.txt`, `mkdir`, `touch`, `cp a b`, `tee`, `Set-Content`                                                        | runs when every file it writes is in an allowed folder                           |
| **changes around its folder** | `npm install`, `npm test`, `make`, `node script.js`, `python x.py`, `git commit`                                     | runs only when the command runs inside an allowed folder (an experiment in temp) |
| **changes outside**           | `git push`, `npm publish`, `npm install -g`, `gh pr create`, `curl -X POST`, `docker run`                            | refused                                                                          |
| **unknown**                   | a program the tool does not know                                                                                     | runs only inside an allowed folder; elsewhere refused, and the refusal says why  |

When the tool cannot tell, it refuses and says so: the refusal names the program and the reason, and tells Claude what to do instead (read with a known command, experiment in a temporary folder, or ask the person to switch modes). Allowed folders: the temporary folders in every restricted mode, the work folder in research and plan, Claude Code's plan file in plan.

After a command runs, Claude Code itself reports whether it held the command read-only. Where the tool said "reads" and Claude Code did not agree, the plugin records it, so a gap in the tool's list shows up in the log instead of going unnoticed.

### Claude Code's plan mode

📐 Plan is bridged to Claude Code's own plan mode (shift+tab):

- When Claude Code's plan mode is on, the session is in 📐 plan. The source is the permission mode Claude Code hands every hook (`permission_mode`), recorded by the safety-net hook, and the plan-mode notes Claude Code adds to the conversation, which the plugin reads.
- Leaving Claude Code's plan mode with an approved plan ends 📐 plan outside a flow, and completes the plan and approval steps inside one. Before Claude Code's plan dialog is shown, the plugin checks the plan; a plan that does not meet the plan step's definition never reaches the dialog.
- The tool never turns Claude Code's plan mode on by itself: entering it asks the person's consent, which would stop autonomous work in the middle. 📐 plan is enforced by the tool's own guard either way.

### Mode keywords

Mode keywords follow the rules of every keyword ([keywords.md](keywords.md)): they count as the whole message or at its end, and matching ignores case, accents and Turkish keyboard variants.

- **Outside a flow** a mode keyword sets the session's mode until another mode keyword. `continue` / `devam` leaves chat, as before; it keeps research, plan and code.
- **While a flow runs** the flow sets the mode. A mode keyword at the end of a longer message changes **only that turn**. A mode keyword as the **whole message** is an explicit choice: the flow is paused at its step and the session switches to that mode (`continue` resumes the flow).

## Flows

| Keyword (English / Turkish)        | Steps                                        |
| ---------------------------------- | -------------------------------------------- |
| `flow` / `akış`                    | 🔍 research ▶ 📐 plan → ⏸ approval → 🔨 code |
| `flow plan` / `akış plan`          | 📐 plan → ⏸ approval → 🔨 code               |
| `flow research` / `akış araştırma` | 🔍 research                                  |

Write the task and end the message with the keyword ("Add two-factor sign-in to the login page. flow"); a keyword alone starts the flow on the task under discussion.

The rules of a flow:

- **No step is skipped.** Claude finishes a step by calling the tool `mcp__terminal-code__flow_step` with the step's name; the plugin refuses a step that is not the current one.
- **Claude cannot leave the flow.** Only the person pauses, resumes or cancels it.
- **Each step's definition of done is checked by code** (below). A step that fails the check stays open, and Claude reads exactly what is missing.
- **The approval is the person's**, given in a dialog, in Claude Code's plan dialog, or by typing `approve` / `onay`. A message from Claude, a tool result or a file cannot approve.

### Definitions of done

**🔍 Research: a sourced report.** A Markdown file in the flow's work folder, in this shape:

```markdown
# <title>

## Question

<what was asked>

## Findings

- <a finding> [1]
- <another finding> [2][3]

## Sources

1. https://example.org/page: <what it says>
2. src/core/guard.ts:42: <what it shows>
3. docs/architecture.md
```

The check: a Findings section with at least one item; every finding cites at least one source as `[n]`; every cited number exists among the sources; every source is either a web address (`http` or `https`, checked for form) or a file that exists (a `:line` must lie inside the file). Section names may be English or Turkish (`Bulgular`, `Kaynaklar`, `Soru`).

**📐 Plan: steps with acceptance criteria and a way to verify.** A Markdown file in this shape:

```markdown
# <title>

## Steps

### 1. <step>

<what changes>
Acceptance: <how we know this step is right>

### 2. <step>

…

## Verification

- `npm test`
```

The check: at least one step; steps numbered 1, 2, 3 … without gaps; every step has a non-empty `Acceptance:` line (`Kabul:` in Turkish); a Verification section (`Doğrulama`) with at least one command in backticks; every command parses and is not one the safety belt would refuse. Numbered list items under Steps work as well as `###` headings.

**⏸ Approval: the person said yes.** Through the dialog the plugin opens when the plan step is done, through Claude Code's plan dialog when Claude Code's plan mode is on, or by typing `approve` / `onay` (headless sessions, a phone, a dismissed dialog). In the dialog the person can also ask for changes (the flow goes back to the plan step with their words) or pause the flow. The approved plan is copied into the flow's record; the verification commands are taken from that copy, so a later edit of the work file cannot change them.

**🔨 Code: the verification passes.** When Claude calls `flow_step` for the code step, the plugin runs each verification command of the approved plan through Claude Code's own shell tool (the safety belt and the permission rules apply as to any command) and counts the step done only when every command exits with 0. A failure stays open with the command and the end of its output.

### Controls

| You type                                   | While a flow runs                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approve` / `onay`                         | approves the plan waiting for approval (whole message only)                                                                                                |
| `stop` / `dur`, `wrap up` / `toparla`      | pauses the flow at its step, as well as doing what they always do                                                                                          |
| `continue` / `devam`, `<project> continue` | resumes a paused flow at its step; in a new session, `<project> continue` picks up that project's paused flow, and `continue` alone the flow of the folder |
| `flow cancel` / `akış iptal`               | ends the flow; its record stays                                                                                                                            |
| `status` / `durum`                         | Claude reports, with the flow's steps                                                                                                                      |
| a mode keyword as the whole message        | pauses the flow and switches to that mode                                                                                                                  |

After a quota reset, autonomous work resumes by itself as before, except while a flow waits for approval: then the person is notified instead.

### Where the files are

| What                                               | Where                                                                    | Written by      |
| -------------------------------------------------- | ------------------------------------------------------------------------ | --------------- |
| work files (the report and plan drafts)            | `<temporary folder>/terminal-code/flows/<id>/` (setting `modes.workDir`) | Claude          |
| the flow's record                                  | `~/.terminal-code/flows/<id>/flow.json`                                  | the plugin only |
| checked copies of the report and the approved plan | `~/.terminal-code/flows/<id>/research.md`, `plan.md`                     | the plugin only |

The record and the copies live in the tool's own folder, which the safety belt keeps Claude from writing: what was checked and approved stays as it was checked and approved.

### Seeing a flow

- Under the prompt: the step (`📐 plan · flow 2/4`); above the prompt, while a plan waits for approval, one line that says so and how to approve.
- The control center: Home lists plans waiting for approval; Projects › Flows lists every flow with its steps, evidence and files.
- `terminal-code flow` and `terminal-code flow show <id>` (also `--json`).

## Limits

- **An accident preventer, not a sandbox.** A program run inside a temporary folder can still write anywhere; the classes above stop mistakes, not a determined agent (see [safety-belt.md](safety-belt.md)).
- **Known programs only.** A harmless program the tool does not know is refused outside allowed folders in restricted modes. How often that happens on real sessions is measured (below), not guessed.
- **Form, not meaning.** Code checks that every finding cites an existing source, not that the source supports it; that every step has acceptance criteria, not that they are met. What it can run, the verification commands, it runs.
- **Web addresses are checked for form, not fetched**: the tool opens no network connection.
- **Needs the plugin.** Modes and flows run in the plugin. Where the plugin is not loaded (an older Claude Code, plugins turned off by policy), the safety-net hook says so when a mode or flow keyword is typed; the safety belt runs either way.
- **Claude Code's plan dialog needs an interactive session.** Headless sessions (`claude -p`) wait for `approve` / `onay` instead.

## Measured

_Filled in from the runs that produced them._

## Plan and status

The plan this page was written from (2026-10-12), kept as a checklist:

- [ ] Core: the five modes, what each allows, the effective mode (a turn's mode, the flow's step, Claude Code's plan mode, the session's mode).
- [ ] Core: the command classifier (five classes, the working folder followed through `cd`), and the mode guard for shell, file, MCP and Claude Code tools.
- [ ] Core: mode, flow and approval keywords in both languages; a mode keyword ending a message during a flow changes that turn only.
- [ ] Core: the flow state machine (start, step done, approval, revision, pause, resume, cancel), its record, and the checks of the report and the plan.
- [ ] Plugin: the `flow_step` tool, the approval dialog, running the verification commands, Claude Code's plan dialog as an approval, plan-mode notes, labels and the approval line, flows across sessions and through compaction, quota resume that waits for approval.
- [ ] Safety-net hook: records Claude Code's permission mode; says when a mode keyword cannot be honoured because the plugin is not loaded.
- [ ] `terminal-code flow`, Projects › Flows, pending approvals on Home.
- [ ] Tests in every layer of [testing.md](testing.md): unit, properties (no sequence of events completes a step out of order or without its check), the false-alarm corpus for the classifier, the engine's test kit, live sessions; mutation targets and coverage floors for the new deciding code.
- [ ] Measured: the classifier over real sessions, the cost of the tool definition in tokens.
- [ ] An interactive session, driven by hand: Claude Code's plan dialog as the approval, the plugin's dialog.
- [ ] Docs: keywords, architecture, command reference, README in both languages, changelog.
