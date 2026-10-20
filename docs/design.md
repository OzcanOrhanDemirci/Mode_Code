# Design

How Mode_Code looks, speaks and behaves, on every surface: the strip above Claude Code's prompt, the cockpit beside the conversation, the windows it opens inside Claude Code, the control center, and the command line. This page is the contract the code is held to; each rule names the test that keeps it.

**The motto:** push what an AI can build to its limit. Mode_Code is written by an AI under a person's direction, and it is about a person directing an AI. Both should show.

## Who it is for

Two people, at once:

- **Ayşe, 54**, who uses a computer every day but has never opened a terminal on purpose. She must be able to read any screen and know what she is looking at, change a setting and know what will happen, and undo it if she was wrong.
- **Özcan**, who builds software with Claude every day. He must feel at home: fast, keyboard first, nothing hidden from him, nothing in his way.

Neither should ever feel a question mark. When the two pull apart, Ayşe wins the first screen and Özcan wins the second press.

## The four questions

Every element on every surface answers four questions where it stands, without a search:

1. **What is this?** One plain sentence.
2. **How is it now?** In words, not only a colour.
3. **What exactly happens if I change it?** For each value, before it is applied.
4. **Can I take it back?** And how.

The catalog (`src/core/ux/catalog.ts`) holds the four answers for every setting and every control of the strip (the `/` commands are its controls), in both languages, and every window a control opens (`WINDOWS`: its pane, its title, what it is for, its action); the kinds of background event have their lines in `src/core/ux/activity.ts`. Every surface draws them from there: the control center's card under a setting, `mode-code config explain`, the `/` menu, the cockpit's quick settings, and the line under the strip, where the card of the control under the pointer or the keyboard says itself in one line (`src/core/ux/say.ts`); none writes its own.

## The contract

1. **Four questions, answered in place.** (Above.)
2. **Information and controls look different.** What can be changed looks like a control, with its kind's mark. Information is plain text. No line leaves you wondering whether it can be changed.
3. **The look tells the kind.** Four kinds of control, four looks, the same on every surface:

   | Kind   | Look                                           | Does                                                |
   | ------ | ---------------------------------------------- | --------------------------------------------------- |
   | Switch | `● On` · `○ Off`                               | flips at once, and says so                          |
   | Choice | `◉ one  ○ two  ○ three` or `‹ value ›`         | picks one of several                                |
   | Action | `[ Start ]`, or `▶ full autonomy` on the strip | does something now                                  |
   | Opener | `Agents…`                                      | opens a window; nothing changes until you act there |

4. **One way to act.** Mouse and keyboard do the same thing everywhere:

   | You                                        | Does                                                                                                                                |
   | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
   | click · Enter · Space                      | act on what is under the pointer or the focus                                                                                       |
   | point at it (hover) · move the focus to it | show its card: the four answers                                                                                                     |
   | wheel                                      | scroll what is under the pointer                                                                                                    |
   | Esc                                        | back, or close the window                                                                                                           |
   | `?`                                        | what is this, and why is it so                                                                                                      |
   | `u`                                        | undo the last change                                                                                                                |
   | arrows                                     | move. **Arrows never change a value.**                                                                                              |
   | digits                                     | jump to the numbered control; at Claude Code's prompt `/3` presses the strip's 3, and a digit typed alone stays a message to Claude |

   Every click target shows its key; everything reachable by a key can be clicked; pointing only explains, it never acts.

   In the control center the mouse is the terminal's own (`src/tui/pointer.ts`: xterm's reporting, the SGR encoding, taken out of the input before Ink reads it, and turned off again on every way out). Whatever the pointer rests on that a click presses is underlined, and the bar at the bottom says what it is (or what was just done, with its undo), and shows the keys that work where you are, each one a click as well. Hold Shift to select text as usual; `mode-code --no-mouse` leaves the mouse to the terminal.

5. **Say, do, undo.** The effect is said before it is applied. Once applied: _"Changed · undo (u)"_. Every setting shows its default and can go back to it (a preview first: `d` one setting, `D` its page). Every change is recorded with who made it (`src/core/ux/changes.ts`, `state/changes.jsonl`), and the history of changes is a page (Activity › History of changes, `mode-code config history`). Only what cannot be undone asks for a confirmation.
6. **No invisible work.** Everything Mode_Code does in the background writes an activity line: what, when, **why** (the setting or rule behind it) and a way to change it. Mo and the strip say what runs now.
7. **"Why is it so?" is always answered.** The reason for any state is worked out by code from the settings and the session, not guessed, and shown in one press. Something switched off is not hidden: it is dimmed and says why.
8. **The person is in command.** The AI proposes, the person decides: only the person's press changes a setting. What Claude may do right now is visible at a glance. Every autonomous run is visible and can be stopped.
9. **No silent press.** Every press gives a visible result: changed, opened, or why not.
10. **One idea, one name, one mark, one colour.** The glossary below. Colours exclude one another, and colour never carries meaning alone: there is always a mark and a word.
11. **Calm and layered.** Every page opens with one sentence on what it is for, then its few most important items. Depth opens on request. Nothing is removed to make a page calmer; only density goes down.
12. **Graceful in every terminal.** From 60 columns to 200. Without a mouse, the keyboard does everything. Without colour (`NO_COLOR`, plain mode) the marks and words say everything. With reduced motion, nothing moves. On a phone (Remote Control), every control still reads.
13. **A grid, and things on it.** Every block sits on columns: a label column, a value column, and a trailing column (a time, a count, a button, `›`) aligned to the right. In one block every right edge ends in the same column. Wrapped text never starts a line with a space.

## Grid and spacing

- **Columns.** A row is `label · value · trailing`. The label column is as wide as the block's longest label plus two (at most 40); the value column follows; the trailing column is right-aligned to the block's edge. A label too long for its column is cut with `…`, never run into its value.
- **Rows.** One blank row between groups, none inside a group. Two meters never touch: a blank row, or a track that shows where each ends.
- **Margins.** One column inside every frame. Text never touches a border.
- **Wrapping.** Prose wraps at word boundaries and never begins a line with a space (`wrapText` in `src/core/ux/text.ts`; Ink's own wrap keeps the space a break falls on).

## Colour and marks

| Meaning                 | Colour    | Mark    | Plain          |
| ----------------------- | --------- | ------- | -------------- |
| on, done, healthy       | green     | `●` `✓` | `[on]` `[ok]`  |
| off, idle, not set      | grey      | `○` `·` | `[off]` `[--]` |
| asks you, needs a look  | yellow    | `?` `!` | `[?]` `[!]`    |
| blocked, danger, failed | red       | `✗` `▲` | `[x]` `[!!]`   |
| focus, selected, link   | cyan      | `▸` `›` | `>`            |
| bypass (no questions)   | red, bold | `⚡`    | `[bypass]`     |
| agents                  | blue      | `👥`    | `[agents]`     |

Only the 16 basic colours, so the person's terminal theme decides the contrast; Mo alone is drawn in 24-bit colour. High contrast swaps in the bright variants. `NO_COLOR` turns colour off everywhere and changes nothing else.

## Voice

- **You and now.** Second person, short sentences, the outcome first and the mechanism after: _"Claude starts no helper agents until you give a number"_, not _"The agents gate is enabled"_.
- **The word before the term.** A technical name comes after the plain one, in brackets: _"rewrites the shared history (force push)"_.
- **One line for a toast.** A toast fits one line of 40 columns; anything longer goes to the activity, the card or the cockpit.
- **Every empty page says what will appear there, and the one thing that makes it appear.**
- **Every error says what to do next.**
- **Turkish is not translated English.** Both languages are written for their reader; Turkish uses Turkish words where they exist (_bypass_ stays a name, but its card says _"sormadan çalış"_).
- **No long dashes.**

## Glossary

| Idea                                               | English                       | Turkish                                         | Not (✓: the test refuses it)  |
| -------------------------------------------------- | ----------------------------- | ----------------------------------------------- | ----------------------------- |
| the protection that stops risky commands           | safety belt                   | emniyet kemeri                                  | hook (Claude Code's own part) |
| a session where the safety belt asks nothing       | bypass (works without asking) | bypass (sormadan çalış)                         | izinsiz ✓                     |
| a task Claude carries to its end alone             | full-autonomy run             | tam otonom iş                                   | koşu ✓                        |
| what keeps such a task's writes in the project     | write limits                  | yazma sınırları                                 | fence ✓, çit ✓                |
| research → plan → approve → code                   | flow                          | akış (adım adım iş)                             |                               |
| helper Claudes that run beside the main one        | agents                        | ajanlar (yardımcı Claude'lar)                   | subagent ✓, alt ajan ✓        |
| Anthropic's usage limit                            | quota                         | kota                                            |                               |
| the ceiling you set on it                          | budget                        | bütçe                                           | hedef                         |
| the 5-hour and weekly periods of the quota         | period                        | dönem                                           | window ✓, pencere ✓           |
| a summary Claude makes to shorten the conversation | summary (compaction)          | özet (sıkıştırma)                               |                               |
| notes left for the next session                    | handoff note                  | devir notu                                      |                               |
| the part Mode_Code adds inside Claude Code         | the plugin                    | Mode_Code'un Claude Code'daki parçası (eklenti) |                               |
| Claude Code's own add-ons                          | Claude Code plugins           | Claude Code eklentileri                         |                               |
| a connection to an outside tool                    | outside tool (MCP)            | dış araç (MCP)                                  |                               |
| thousands of tokens                                | 250K tokens                   | 250 bin token                                   | 250 B ✓                       |

The rows marked ✓ live in `src/core/ux/glossary.ts`, and `test/core/ux-glossary.test.ts` reads every message of both languages against them. The rest guide the writing and are not refused:

- "The belt" and "kemer" may stand for the safety belt once a screen has named it in full; a page title under Security reads in that light.
- "Sınır" stays for limits of time and writes ("Süre sınırı", "yazma sınırları"); the ceiling the person sets on the quota is always "bütçe".
- "Eklenti" names both the plugin and Claude Code's add-ons, because Claude Code calls both plugins; where it means Mode_Code's part, the sentence names Mode_Code or Claude Code beside it.

## Components

One kit, two hosts (`src/core/ux/kit.ts`). Each component is written once against a host that makes a box, a text and a pressable, so the same code draws in the control center (Ink, `src/tui/kit.tsx`) and inside Claude Code (its elements, `src/mod/kit-host.ts`; the band above the prompt is drawn with it). The marks, the colours of each meaning in both hosts and the toast lengths are one table, `src/core/ux/tokens.ts`.

| Component           | Anatomy                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| **Switch**          | label · `● On` / `○ Off` · default badge · changed dot                                |
| **Choice**          | label · options with `◉` / `○`, each one a press, or `‹ value ›`                      |
| **Number**          | label · value · unit · range in its card                                              |
| **Action**          | `[ Verb ]`, primary drawn in the accent                                               |
| **Opener**          | label `…` · what it opens in its card                                                 |
| **Row**             | label column · value column · trailing column (right-aligned)                         |
| **Card**            | title · what it is · now · each value's effect · undo · what it affects · keys        |
| **Meter**           | label · track `███░░░` · value · threshold mark · words for the level                 |
| **Activity line**   | time · mark · what · why `›`                                                          |
| **Permission line** | `✓` / `?` / `✗` · what Claude may do · why (on hover)                                 |
| **Toast**           | one line, three lengths: note (4 s), result (8 s), attention (15 s)                   |
| **Empty state**     | what will appear · the one action that makes it appear                                |
| **Window**          | title · one sentence · now · controls · _"If you apply: …"_ · primary action · cancel |

## The cockpit

The panel you open beside Claude Code's conversation (`/0`, or `0 ≡ cockpit` on the strip, a switch): in the fullscreen layout from 110 columns it stands beside the conversation from top to bottom; narrower, it opens above the prompt with its sections side by side. Left open, the next session opens it in its place where the screen leaves room. Worked out by code from the settings and the session (`src/core/ux/cockpit.ts`), drawn with the kit (`src/core/ux/cockpit-view.ts`), it holds:

- **A line that says.** It opens with one sentence on what the cockpit is for. The card of whatever the pointer rests on, or the keyboard, takes its place there, so every line says itself without a press. Its height never changes.
- **Claude right now.** What Claude may do in this session, in words, each line marked ✓ it does, ? it asks you first, ✗ it cannot, or · it waits for you: change the project's files, take a risky step, delete outside the project, touch its own protection (locked), the way of working, helper agents; and while they hold, outside content read and the quota near its limit. Each line follows the mode in force (a flow's step and Claude Code's plan mode included), the way of working, the safety belt's rules, bypass, a freeze and the agents. A press opens its reasons, the why engine's chain, and what changes it.
- **At work now.** Claude's state in words; the call running, its time counted by the surface (`src/mod/cockpit-clock.ts`); each agent at work with **Open** (its conversation in the main view, the cockpit staying beside it) and **Stop**; a flow's step; a full-autonomy run's.
- **Waiting for you, or In this session.** The session's activity, what waits for you first, five lines; a line whose rule or setting has a place opens the control center there, and **All activity…** opens the whole.
- **Quota.** The two periods as meters, where the work wraps up marked on each track, and when each starts over; the weekly budget, and **Budget…**.
- **Quick settings.** The controls whose permission is a setting (bypass, the agents, full autonomy) and the freeze, both doors in one row. Not allowed yet, the row says so, and a press first says what allowing it means, with **Allow** and **Cancel**; allowed, a press is the strip's own. A permission allowed here is written as the control center writes it, recorded as the cockpit's in the history of changes, and **Undo** takes it back. **Control center…** opens everything else.

Only your press changes anything in the cockpit: Claude has no way to press.

## The control center

The map follows what a person comes for, not the parts of the system (`src/tui/nav.ts`, `src/tui/tree.tsx`): **Now** · **Activity** (what happened: in the background, while you were away, in a day or a week, to the settings) · **Working** (how Claude works: modes, keywords, flows, and the ways of working you turn on) · **Protection** · **Memory and projects** · **Quota** · **Claude Code** (its own setup) · **Settings** (this tool's own). Digits 1 to 8 jump to them. Every page has an address; an address of the map before 1.2 still leads to its page, and the palette (Ctrl+K) finds a page by its name in either language and by its old place.

**Now** is the first screen, beside the list before anything is opened (`src/tui/screens/now.tsx`). Mo says the one thing that matters most and leads there with a press: protection that does not work, a flow or a run waiting for you, what happened while you were away, a run at work, a quota near its limit, a session at work, or calm (`src/core/ux/now.ts`). Under it, the goals people come for, each one a press: leave Claude on a task, work in parallel, guard the quota, what happened, and why is it so (every line below then shows its reasons). Then, after a long gap, the morning report; **Claude right now** for the session at work on this computer (the cockpit's own lines, worked out from what the session keeps on disk; with several, `s` shows the next; with none, as a new session starts); what is at work (sessions, flows, runs); what waits for you and today's numbers; and the quota. The keys walk every press in order; the line under Mo shows the card of the one they rest on.

**A page of settings** opens with what it holds now, in words: that every setting is at its default, or which ones differ and from what, with **All back to defaults** (`D`), which shows what goes back before it does. Each row ends with where it stands: `default`, `• changed`, or `no effect now` when another setting keeps it from mattering; such a setting stands indented under the one it depends on, dimmed while that one is off, and its card says which and where.

**Every empty page leads on:** it says what will appear there, and a press (Enter, or a click) opens the page where that is done. **It is live:** what a session writes into the data folder (its state, an event, the quota, a flow, the settings) shows at once, without `r`. The location bar keeps its crumbs whole beside the protection and the quota: on a narrow terminal the middle ones give way to `…`.

**The view level** decides how many pages the lists show, never what can be reached: Simple lists the everyday pages, Recommended all but four for experts, Detailed every one. A list that leaves pages out says how many, and a click there opens the setting; the palette and an address reach every page, and a page opened so shows in its list.

## Where it is enforced

A row whose test is still to come names the stage that brings it; `test/core/design-doc.test.ts` holds every other path to a file that exists.

| Rule                                                                             | Test                                                                                                  |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Four questions for every setting and every control of the strip                  | `test/core/ux-catalog.test.ts`, `test/tui/settings-card.test.tsx`                                     |
| The command line gives the same answers, and names a page as the screen does     | `test/process/human.test.ts`, `test/tui/settings-card.test.tsx`                                       |
| Every reference like _"Settings › Features"_ leads to a real place               | `test/tui/references.test.tsx`                                                                        |
| One idea, one name                                                               | `test/core/ux-glossary.test.ts`                                                                       |
| No wrapped line starts with a space                                              | `test/core/ux-text.test.ts` (`wrapText`); the control center's own wrap: `test/tui/grid.test.tsx`     |
| Mouse and keyboard reach the same result                                         | `test/tui/pointer.test.tsx`                                                                           |
| Everything a click presses shows the pointer resting on it                       | `test/tui/places.test.tsx`                                                                            |
| Every old address leads to its page; the view hides nothing from reach           | `test/tui/places.test.tsx`                                                                            |
| A page of settings says what it holds; empty pages lead on; crumbs fit           | `test/tui/pages.test.tsx`                                                                             |
| The control center shows what changes on disk                                    | `test/tui/live.test.ts`                                                                               |
| No state told by colour alone                                                    | `test/core/ux-kit.test.ts`, `test/tui/grid.test.tsx` (`NO_COLOR`), `test/tui/widths.test.tsx` (plain) |
| Right edges of a block line up                                                   | `test/tui/grid.test.tsx`                                                                              |
| The kit sets only what Claude Code's elements take                               | `test/core/ux-kit.test.ts`; the installed version's declarations: `src/mod/kit-host.ts`               |
| Every background job writes an activity line                                     | `test/core/ux-activity.test.ts` (every kind written has its line)                                     |
| Every control of the strip has its card, for the pointer and the keyboard        | `test/core/ux-say.test.ts`, the engine kit (`test/mod/controls.kit.ts`)                               |
| The look tells the kind on the strip, on every layout                            | `test/core/controls.test.ts`                                                                          |
| Every window is drawn to one pattern, and no window takes a value by arrow       | `test/core/ux-kit.test.ts`, `test/core/ux-catalog.test.ts`, the engine kit (`test/mod/agents.kit.ts`) |
| Every change to a setting is recorded and can be taken back                      | `test/core/ux-changes.test.ts`, `test/tui/ledger.test.tsx`                                            |
| "Why is it so" is worked out by code, from the settings and the session          | `test/core/ux-why.test.ts` (30 situations), the engine kit (`/why`, the `why` tool)                   |
| What Claude may do now is worked out by code, in every situation that changes it | `test/core/ux-cockpit.test.ts` (31 situations)                                                        |
| Every line of the cockpit says itself to the pointer and to the keyboard         | `test/core/ux-cockpit.test.ts`, the engine kit (`test/mod/cockpit.kit.ts`)                            |
| A permission allowed in the cockpit is recorded, and taken back                  | the engine kit (`test/mod/cockpit.kit.ts`)                                                            |
| From 60 to 200 columns                                                           | `test/tui/widths.test.tsx`, `test/core/controls.test.ts`                                              |
