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

The mode and the way of working are always in view: on the strip above the prompt, and beside Claude Code's own mode labels under it (💬 chat, 🔍 research, 📐 plan, 🔨 code, free; manual, autonomous, full auto), with the flow's progress when a flow runs. They are changed from the keyboard, the strip or a phone alike: see [Session controls](#session-controls). At the strip's left sits [Mo](mo.md), the mascot, who shows at a glance what Claude is doing.

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

A mode keyword counts **only as the whole message**: `plan` switches to plan mode, "Bu bir plan." is a sentence. Plan, code, chat and research are everyday words, and a mode that changes by accident is worse than one more keystroke (decided with the author, 2026-10-13). Matching ignores case, accents and Turkish keyboard variants ([keywords.md](keywords.md)).

- **Outside a flow** a mode keyword sets the session's mode until another one. `continue` / `devam` keeps every mode, chat included: a mode is left by picking another (the person, 2026-10-13: "it must not change when I did not write it, or choosing it means nothing").
- **While a flow runs** the flow sets the mode. A mode keyword is an explicit choice: the flow is paused at its step and the session switches to that mode (`continue`, or the flow on the strip, resumes the flow).

## Session controls

The mode and the **way of working** are what a person changes all the time, so they are always in view and change in one step, the same way from three places:

| Where                                    | How                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The strip above the prompt**           | every control with its number, those in effect highlighted, its look telling its kind: the mode, the way of working, and apart from them at the far end the cockpit (`0 ≡ cockpit ○`) and closing (`00 ✕`), which belong to neither; click one (in a terminal that reports clicks), or ctrl+x tab to reach the strip, then Tab or the arrows and Enter; the line under it says what the one you point at does |
| **A slash command**                      | `/1` … `/8`, `/0`, `/00`, `/devam`, `/kota`, `/akis`, `/tam-otonom` and their English names: from the keyboard, and from a phone, where clicking is awkward                                                                                                                                                                                                                                                   |
| **A keyword typed as the whole message** | `plan`, `otonom`, `manuel` …: as above                                                                                                                                                                                                                                                                                                                                                                        |

| Command                      | Does                                                                                          | With text after it                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `/1`                         | 💬 chat                                                                                       | `/1 text`: switch, then send the text as your own message                        |
| `/2`                         | 🔍 research                                                                                   | the same                                                                         |
| `/3`                         | 📐 plan                                                                                       | the same                                                                         |
| `/4`                         | 🔨 code                                                                                       | the same                                                                         |
| `/5`                         | free                                                                                          | the same                                                                         |
| `/6` (`/akis`)               | the flow: off, its window (which steps, the task now or next); on, closes it; paused, goes on | `/6 the task`: the flow last used in this folder                                 |
| `/7`                         | way of working: **manual**                                                                    | the same                                                                         |
| `/8`                         | way of working: **autonomous**                                                                | the same                                                                         |
| `/tam-otonom` (`/full-auto`) | way of working: **full auto** (its window), once turned on; on, ends the run                  | `/tam-otonom kota +10 the task`: the window filled in                            |
| `/0`                         | shows the cockpit, or hides it; the control center is one press from it                       |                                                                                  |
| `/00` (`/kapat`)             | closes the session cleanly, with its tab                                                      |                                                                                  |
| `/devam` (`/continue`)       | lists every project and folder to continue                                                    | `/devam 3`, `/devam terminal`, `/devam 3 kota 29`                                |
| `/kota` (`/quota`)           | its window: pick or type the weekly budget                                                    | `/kota 70`, `/kota +5`                                                           |
| `/ajan` (`/parallel`)        | parallel agents: the window, once turned on under Automation                                  | `/ajan 5`, `/ajan tam 7`, `/ajan kapat`, `/ajan dur`; see [agents.md](agents.md) |

- **Ways of working.** **Manual**: Claude does what the message asks, says what it did and what would come next, and waits; it asks when something needs your decision. Claude Code's own questions stay yours, and a commit or a push waits for your yes ([safety-belt.md](safety-belt.md#ways-of-working)). A session starts manual, which is how Claude Code works by default. Only you change it: `continue`, a budget, `stop` and the end of a full-autonomy run leave it as you chose it (a run gives back the way of working it took over). **Autonomous**: Claude goes on without asking between steps and stops only for a decision that is yours; Claude Code's own questions are answered once the safety belt let the call through. **Full auto**: a run that works to its end without asking ([autonomy.md](autonomy.md)); it starts only where its checks pass, and `/tam-otonom` says which failed before anything opens. It has no number and is not on the strip until it is turned on (Automation in the control center): a special way of working, not an everyday one. Pressed, it opens its window (below); pressed while a run is attached, it ends the run, as `full auto cancel` does.
- **The cockpit.** `/0` (or `0` on the strip, a switch: `0 ≡ cockpit ●` while it shows) opens the cockpit beside the conversation in Claude Code's fullscreen layout from 110 columns, above the prompt otherwise; again, it closes it. It says what Claude may do now, what is at work, what waits for you, the quota, and the controls whose permission is a setting, both doors in one row ([design.md](design.md#the-cockpit)). Left open, the next session opens it in its place where the screen leaves room beside the conversation.
- **The control center beside the session.** The cockpit's **Control center** (and, where no surface draws a pane, such as a session with no screen, `/0` itself) opens the control center in a new tab of the terminal the session runs in, in the session's folder. It opens the command-line program the installation recorded (`doctor` checks the record and `doctor --fix` writes it), and it asks the terminal by the variables the terminal sets for the programs it runs:

  | The session runs in               | The control center opens                                      | Measured              |
  | --------------------------------- | ------------------------------------------------------------- | --------------------- |
  | Windows Terminal (`WT_SESSION`)   | a new tab of the same window (`wt -w 0 new-tab`)              | by hand, Windows 11   |
  | another Windows console           | a window of the default terminal (PowerShell `Start-Process`) | by hand, Windows 11   |
  | tmux, any platform but Windows    | a new window of the same tmux                                 | yes, tmux 3.4 in WSL2 |
  | iTerm2 / any other macOS terminal | a tab of iTerm2 / a Terminal window (AppleScript)             | not yet on a Mac      |
  | WezTerm, Konsole, GNOME Terminal  | a new tab, by each one's own command                          | not yet               |

  Windows Terminal is run by its alias's full path (`%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe`), not by its name: Claude Code looks a name up itself and refuses what it finds in that folder whenever the session's folder contains it, as a session opened in the home folder does ("not found or is in an unsafe location", Claude Code 2.1.296). The folder is under the home folder, so only a link is taken there, which is what Windows' aliases are; with no alias, the name goes to Claude Code. "By hand" above is the same command run outside Claude Code; the first `/0` in a real session, opened at home, failed this way, and a failed `/0` keeps its reason in the event log.

  Nothing opens where the person would not see it (a session over SSH outside tmux, inside WSL outside tmux, a Linux session with no display, a terminal not listed): the row then says the command to type, the menu follows. From the phone (Remote Control) `/0` says where the session stands and lists every command, since the cockpit and a tab opened on the computer cannot be seen there.

- **Closing the session.** `/00` (`/kapat`, `/close`, or `00 ✕` at the end of the strip) closes the session the way a computer shuts down, not the way its power button cuts it: the row says so, the steps the session's end runs run first (the handoff note of a session that changed something, the sync), with no clock over them, and then Claude Code exits as it does for `/exit`, its own end hooks included. Claude Code gives a session's end only a short time, which a sync over the network can run past (a tab closed with its ✕ cut one so); and a tab closed with its ✕ has left Claude Code running behind it, unseen and still counted as working in its folder.

  On Windows the tab closes too. The shell Claude Code was started from would hold it open, and a shell killed instead leaves the tab on "[process exited with code 1]", so a helper is started first: it waits up to a minute for Claude Code to end, then types `exit` into that shell, which ends as if the person had typed it, and the terminal closes the tab as it does for any shell that ends normally (Windows Terminal's `closeOnExit`, "graceful" for what it starts itself; a console window closes with its last program). The helper types only into a shell it knows (PowerShell, cmd, bash, sh, zsh, fish, nu) that is Claude Code's own parent and shares its console; a Claude Code the terminal started directly closes with its tab anyway, and one started by another program, or in a console of its own, is left alone. Elsewhere the row says the tab stays open.

  While Claude works, `/00` asks first ("Claude is working right now. Stop it and close the session?"); only "Close" stops the turn. Idle, it closes at once. From the phone it closes the session on the computer, its tab included. Each close is in the event log, with whether the helper was started (`tab: armed`) or why not.

- **Freezing the edits to one folder.** `/freeze <folder>` (`/dondur`), or `/freeze` alone for the session's folder: every write a call names (a file tool's path, a redirect, a copy, a move, a delete, `sed -i`) must land inside it or in the temporary folders, or it is refused; a program that writes what it decides (a build, an installer) is not judged. `❄ <folder>` shows on the strip while it holds; `/freeze off` (or `/freeze` again) ends it. Only you set it or end it.
- **Why is it so.** `/why` (`/neden`) shows how each part is now and the settings and choices behind it, each with the page it is changed on; `/why agents` (any part, or a rule of the belt by its id) that part alone, `/why last` the last call refused in the session and its rule. It changes nothing. Claude asks the same through its `why` tool before telling you why something was blocked or is off.
- **Only you, or a script of yours.** A control command (`/1` … `/8`, `/0`, `/00`, `/devam`, `/kota`, `/akis`) is taken from your keyboard, your phone, the strip or a headless run of yours (`claude -p`). One that Claude Code stamps as coming from anywhere else (a prompt Claude scheduled for itself, another session's message, a background notice, another plugin) is refused: none of them can change the mode, raise the budget or close the session Claude works in. Full autonomy, a freeze and parallel agents take only your keyboard, phone or strip.
- **The look tells the kind.** A choice is lit when it is the one in effect (one mode, one way of working); a switch says its state, `❄ <folder> ●` while a freeze holds, `0 ≡ cockpit ○` off and `0 ≡ cockpit ●` on; an opener ends in `…` and opens a window where nothing changes until you act (full auto, the agents, and the flow while it is off); the cockpit is a switch too, `0 ≡ cockpit ●` while it shows; closing acts at once.
- **The line under the strip.** It says what Claude does now, in words: "📐 plan: reads and plans; writes the plan only · manual: one step, then it waits for you", then what else holds (a flow, a freeze, the agents). Point at a control and its card shows there instead, in one line: how it is now, what a press does, how it is taken back, and its command ("Press: Claude develops, tests and commits … · Undo: pick another mode · /4"); the line keeps its height, so nothing moves under the pointer, and below 120 columns it is two rows, so a card is read whole. With the keyboard on the strip (ctrl+x tab, then Tab), the card of the control under the focus shows the same way, marked `▸`; Claude Code does not say when Esc takes the keyboard back, so the card leaves when you type at the prompt or after twenty seconds. At its end, `activity N…` counts what Mode_Code did in this session that a person reads, and once something waits for you it reads `? N waiting for you…` in the colour of a question; a press opens the cockpit, or brings it forward (where no pane can be drawn, the control center at Activity › Activity feed; from the phone it says where it opens). Pointing at [Mo](mo.md) says its state in words, and a click on Mo opens the cockpit too. While an agent's conversation is in view, the line says so and **Back to the main conversation** returns.
- **Under the keyboard nothing breathes.** The mode a running flow's step works in breathes while Claude works; with the keyboard on the strip it is drawn as the other buttons are, so Tab reaches it (a module of its own takes no focus).
- **A plain digit is a message.** The strip's buttons have no digit shortcuts, so typing `3` sends "3" to Claude; `/3` is the command. Claude Code would press a band's button for a digit typed alone into an empty prompt, so a digit shortcut would turn an answer to Claude's "1, 2 or 3?" into a change of mode.
- **The brake.** The mode, the way of working, the cockpit, the budget and closing act at once, while Claude works too: switch to chat in the middle of a change and the next write is refused. A press on the strip changes the strip and the rules at once; Claude is told a moment after the last press (or with your next message), and only the end state: presses close together count as the last one, so changing your mind twice is not three notes.
- **Values are given in a window when not typed.** At the computer each opens a window drawn the same way: what it is for, how it is now, its options (each a press; the arrows only move between them), what applying will do, said before it does, then the main action and **Cancel** (Esc too). `/kota` offers +5, +10 and +20, each with the weekly limit it sets, or a number you type; one the week has passed is said in the window, which stays. `/6` offers the steps (research ▶ plan → approval → code, plan → approval → code, research only, research ▶ plan with no code) and a task: written there, the flow starts with it now; left empty, your next message is its task. `/tam-otonom` runs its start checks and opens its window, where the budget is picked (+5, +10 or +20, each with the weekly limit it sets) and the task written; **Start** or Enter sends the task as your message ending in the keyword (`… full auto quota +10`), so the run starts exactly as a typed one does, and Esc closes the window with the task kept for the next time. From the phone, which draws no window, each asks instead. The tasks given full autonomy, the last three, are kept under Working › Recent tasks in the control center, to copy one again. On a phone, which draws no field, it asks for the budget, asks once more, and takes your next message as the task. The order of a flow's steps is fixed: research comes before the plan, and the approval before any code, kept by code.
- **Everything to continue.** `/devam` lists the registered projects first (★), then every folder Claude Code was used in, newest first, with how long ago; each row is pressable too. A folder that is not registered is continued under its own project key, so its handoff notes are found.
- **The folder's last choice.** A new session (and the one after /clear) starts in the mode and way of working last used in the same folder, says so, and tells Claude with the first prompt. A full-autonomy run never comes back by itself: the way of working returns as it was before the run.
- **Each change is confirmed** in a line under the command ("Now: 📐 plan · autonomous"), or in a toast for a press, and Claude is told what changed in the same words a typed keyword gets.
- **Separate from Claude Code's own modes.** Claude Code's permission modes (auto, accept edits, bypass permissions, its plan mode under shift+tab) stay Claude Code's and keep their labels. They work together: 📐 plan is bridged to Claude Code's plan mode, and full auto requires a permission mode that never stops to ask.

## Flows

| Keyword (English / Turkish)                  | Steps                                        |
| -------------------------------------------- | -------------------------------------------- |
| `flow` / `akış`                              | 🔍 research ▶ 📐 plan → ⏸ approval → 🔨 code |
| `flow plan` / `akış plan`                    | 📐 plan → ⏸ approval → 🔨 code               |
| `flow research` / `akış araştırma`           | 🔍 research                                  |
| `flow research plan` / `akış araştırma plan` | 🔍 research ▶ 📐 plan, no code               |

Write the task and end the message with the keyword ("Add two-factor sign-in to the login page. flow"); a keyword alone starts the flow on the task under discussion. `/6` does the same with a question instead of a keyword.

A flow is one of the modes on the strip (`6`), the one that moves between the others by itself, so the strip shows it as one:

| The flow            | Its button               | The modes                                                       |
| ------------------- | ------------------------ | --------------------------------------------------------------- |
| off                 | `6 flow`                 | the mode you chose, lit                                         |
| chosen, no task yet | `6 flow …`, lit          | none lit: your next message is its task                         |
| working             | `6 flow 2/4`, lit        | the mode of the step it is on **breathes**; the others are dark |
| waiting for you     | `6 flow · approve?`, lit | none breathes: the plan waits for your approval                 |
| paused              | `6 flow ⏸ 2/4`           | the mode you switched to, lit                                   |

Pressing it: off, it asks which steps; on, it closes the flow (its record stays under Working › Flows); paused, it goes on from where it stopped. The breathing goes from gray to white and back, never filled as the lit flow is, and is drawn on Claude Code's own clock, as Mo is, while Claude works. Between turns, when you may be typing (each frame drawn blinks the terminal's cursor), with less motion asked for (Settings › Accessibility), and on a phone, the step's mode is marked instead, bold and underlined.

The rules of a flow:

- **No step is skipped.** Claude finishes a step by calling the tool `mcp__mode-code__flow_step` with the step's name; the plugin refuses a step that is not the current one.
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

The check: at least one step; steps numbered 1, 2, 3 … without gaps; every step has a non-empty `Acceptance:` line (`Kabul:` in Turkish); a Verification section (`Doğrulama`) with at least one command; every command parses and is not one the safety belt would refuse. A command is the first text in backticks on its line (later backticks on the line are notes about it, such as an expected output), or a line of a fenced block (`#` comments left out). Numbered list items under Steps work as well as `###` headings.

Where the plan is: the flow's work file, or, while Claude Code's plan mode is on, the plan file Claude Code names. Plan mode can be switched on after the flow started, so when both exist the one that passes the check is taken.

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
| a mode keyword, `/1` … `/5`, or a press    | pauses the flow and switches to that mode                                                                                                                  |

After a quota reset, autonomous work resumes by itself as before, except while a flow waits for approval: then the person is notified instead.

### Where the files are

| What                                               | Where                                                                | Written by      |
| -------------------------------------------------- | -------------------------------------------------------------------- | --------------- |
| work files (the report and plan drafts)            | `<temporary folder>/mode-code/flows/<id>/` (setting `modes.workDir`) | Claude          |
| the flow's record                                  | `~/.mode-code/flows/<id>/flow.json`                                  | the plugin only |
| checked copies of the report and the approved plan | `~/.mode-code/flows/<id>/research.md`, `plan.md`                     | the plugin only |

The record and the copies live in the tool's own folder, which the safety belt keeps Claude from writing: what was checked and approved stays as it was checked and approved.

### Seeing a flow

- Under the prompt: the step (`📐 plan · flow 2/4`); above the prompt, while a plan waits for approval, one line that says so and how to approve.
- The control center: Home lists plans waiting for approval; Working › Flows lists every flow with its steps, evidence and files.
- `mode-code flow` and `mode-code flow show <id>` (also `--json`).

## Limits

- **An accident preventer, not a sandbox.** A program run inside a temporary folder can still write anywhere; the classes above stop mistakes, not a determined agent (see [safety-belt.md](safety-belt.md)).
- **Known programs only.** A harmless program the tool does not know is refused outside allowed folders in restricted modes. How often that happens on real sessions is measured (below), not guessed.
- **Form, not meaning.** Code checks that every finding cites an existing source, not that the source supports it; that every step has acceptance criteria, not that they are met. What it can run, the verification commands, it runs.
- **Web addresses are checked for form, not fetched**: the tool opens no network connection.
- **Needs the plugin.** Modes and flows run in the plugin. Where the plugin is not loaded (an older Claude Code, plugins turned off by policy), the safety-net hook says so when a mode or flow keyword is typed; the safety belt runs either way.
- **Claude Code's plan dialog needs an interactive session.** Headless sessions (`claude -p`) wait for `approve` / `onay` instead.
- **A project inside a temporary folder is a temporary folder.** The restricted modes allow writes in temporary folders, and on Windows Git Bash's `/tmp` is the user's temporary folder, so a project kept there is writable in every mode.
- **A command is a run of its own in a headless session.** In `claude -p`, `/2 <text>` switches the mode and ends the run: the text is sent only in an interactive session, the moment it is idle. Headless, send the command and the task as two messages (`--input-format stream-json`), as the live tests do.
- **Clicks need a terminal that reports them.** Claude Code passes a click on the strip to the plugin where the terminal reports mouse clicks (its fullscreen layout); elsewhere, and on a phone, the slash commands and the keywords do the same.
- **Plan mode's own questions stay.** In Claude Code's plan mode, a write outside its plan file asks the person first (Claude Code's rule, not this tool's); the guidance sends the plan to Claude Code's plan file there so that no such question comes up.

## Measured

All on the author's Windows 11 machine with Claude Code 2.1.296, 2026-10-13.

| What                                         | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The classifier over 30 days of real sessions | 29,825 shell commands: 42% only read (they run in every mode), 4% write named files, 45% change things around their folder, 5% reach outside, 4% unknown or not readable in full. `mode-code belt replay` prints the same line for your own sessions.                                                                                                                                                                                                                                                                   |
| Forms the classifier knows                   | 297 command forms, each with its class, reason, files and folder, reviewed one by one and kept as a test                                                                                                                                                                                                                                                                                                                                                                                                                |
| Reading commands in restricted modes         | 172 reading commands (147 Bash, 25 PowerShell) run in chat, research and plan mode on Windows, macOS and Linux: no false alarm. 115 changing commands: none passes as a read                                                                                                                                                                                                                                                                                                                                            |
| Mutation testing of the deciding code        | 483 of 483 changes caught in the classifier, modes, guard, flow and flow checks; 15 equivalents explained in `test/mutation-equivalents.json`                                                                                                                                                                                                                                                                                                                                                                           |
| The flow_step tool's cost                    | 224 input tokens per request (the tool's name, description and schema in every request, mostly read from the prompt cache)                                                                                                                                                                                                                                                                                                                                                                                              |
| Live, headless (`npm run test:live`)         | research mode refused a project write; a research flow ended only after its report passed the check (sources measured on disk)                                                                                                                                                                                                                                                                                                                                                                                          |
| Live, headless, the controls (2026-10-13)    | `/3` alone set plan mode in the real engine and answered "Now: 📐 plan · manual"; `/2` then a task in one session: research mode refused the write. Windows, Claude Code 2.1.296, 15 of 15, $0.028                                                                                                                                                                                                                                                                                                                      |
| Live, interactive, `/00` (2026-10-14)        | Claude Code 2.1.299, a real session in a new Windows Terminal window, keys typed into its console: `/0` opened the menu, not `/00`; `/00` idle closed Claude Code, its PowerShell and the window in 4.7 s; `/00` mid-answer asked, and "Close" stopped the turn and closed all three in 4.9 s. Before it, a throwaway plugin measured that `$.command.run({ command: 'exit' })` ends the session as `/exit` does (`prompt_input_exit`) and that a helper started by `Start-Process` is outside Claude Code's job object |
| Live, interactive (driven by hand)           | the plugin's approval dialog and Claude Code's plan dialog each approved a plan; the flow moved to its code step only after                                                                                                                                                                                                                                                                                                                                                                                             |

## Plan and status

The plan this page was written from (2026-10-12), kept as a checklist:

- [x] Core: the five modes, what each allows, the effective mode (a turn's mode, the flow's step, Claude Code's plan mode, the session's mode).
- [x] Core: the command classifier (five classes, the working folder followed through `cd`), and the mode guard for shell, file, MCP and Claude Code tools.
- [x] Core: mode, flow and approval keywords in both languages. (2026-10-13: a mode keyword counts only as the whole message; the turn-only mode inside a flow went with it.)
- [x] Core: the flow state machine (start, step done, approval, revision, pause, resume, cancel), its record, and the checks of the report and the plan.
- [x] Plugin: the `flow_step` tool, the approval dialog, running the verification commands, Claude Code's plan dialog as an approval, plan-mode notes, labels and the approval line, flows across sessions and through compaction, quota resume that waits for approval.
- [x] Safety-net hook: records Claude Code's permission mode; says when a mode keyword cannot be honoured because the plugin is not loaded.
- [x] `mode-code flow`, Working › Flows, pending approvals on Home.
- [x] Tests in every layer of [testing.md](testing.md): unit, properties (no sequence of events completes a step out of order or without its check), the false-alarm corpus for the classifier, the engine's test kit, live sessions; mutation targets and coverage floors for the new deciding code.
- [x] Measured: the classifier over real sessions, the cost of the tool definition in tokens.
- [x] An interactive session, driven by hand: Claude Code's plan dialog as the approval, the plugin's dialog.
- [x] Docs: keywords, architecture, command reference, README in both languages, changelog.
- [x] Also built: the doctor's self-tests include the modes; `belt replay` shows what the restricted modes would run.
