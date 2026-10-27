# Quota

Claude Code reports two windows after each answer: five hours and a week. Mode_Code reads them, guards the work against them, and measures what each task took of them on your computer. Nothing here changes how you work unless you turn it on: the guard keeps to the budgets you set, and the rest are hints and measurements.

## The guard

- **Budgets.** Wrap-up at 95% of the five-hour window and a stop at 99%. A weekly budget you give (`quota 40`, `kota +8`) wraps up one point before it and stops one point past it; with none, the week wraps up at 97% and stops at 99%. Settings: `quota.*` in `mode-code config`, or Quota › Budget and limits (and Settings › Answer summary) in the control center.
- **Wrap-up.** Past a budget the strip says so, and new heavy work is refused: a subagent, a workflow, a web search or fetch. Claude finishes the step it is on and reports.
- **Stop.** At the limit only reading, notes, the memory and committing what is done run.
- **Resume.** Autonomous work that stopped at the limit goes on one minute after the window resets (`quota.autoResume`).

## Reset at a task boundary

In autonomous work and full autonomy Mode_Code resets the conversation itself where one piece of work ends and the next begins, so that the next task does not pay, call after call, for everything before it.

- **When.** A commit or a push of the main conversation with a context of 200K tokens or more (`quota.resetTokens`) arms it. The calls that finish that piece of work pass: the memory's notes and their commit, the project's commit, both pushes, the pull request and its checks, a handoff note, a flow's step, the to-do list. The first call that starts the next task is refused, with a line saying why, and the reset runs. A turn that ends by itself (Claude waits for you) does not reset: the strip says `/clear` instead.
- **How.** The note is asked of the conversation itself, from its cache, with every tool denied (Claude Code's `$.model.fork`): what was done, what is open, the decisions (yours in your own words), the next step. Code adds what it measures (the branch, the session's commits, what is uncommitted, your last request) and keeps it as a handoff note (`trigger: reset`, [memory.md](memory.md)). Then the turn ends, `/clear` runs once it has ended, and the new conversation starts with a prompt from Mode_Code: why it was reset, not to redo what is done, the session's state, and the note whole.
- **What goes with it.** The way of working (full autonomy too: the reset is Mode_Code's, not a choice of yours), the mode, a flow at its step, the project, your weekly budget, the quota's resume time (not moved), parallel agents, a frozen folder, and what the safety belt knows: that the session read outside content, and the record of where things came from (your words, the project's remotes, what was read from outside, the clear requests). Not the approvals: each was for one call. The prompt the new conversation starts with is Mode_Code's and is never taken for your words ([threat-model.md](threat-model.md)). Your own `/clear` carries none of this: the conversation after it starts as a new session does ([modes.md](modes.md)).
- **When not.** In Manual; while agents or background work run (it waits for the next boundary); within 15 minutes of the last reset; at the quota's stop; while the work wraps up; when the note cannot be had, comes back incomplete or holds a secret, or Claude Code does not clear. The work then goes on in the same conversation, a failure says so in a toast, and each is a line in the activity.
- **Why 200K.** Measured on the author's 30 days of Claude Code use (55,288 calls, 2,028 tasks) and two real projects: a reset at a task boundary past 200K saves 14 to 19% of the whole quota, and half of that is at the boundaries where Claude goes on without you typing, which only a reset of Mode_Code's own reaches. After a reset the new conversation read 22 to 41K tokens again (the rules, the memory) before its first change; at those costs 200K lost at most 0.32 points of the best saving, while under 150K and over 300K lost clearly more. A reset in the middle of a task was measured too, and is not made: 2.3 points more, for 122 tasks cut in their middle.
- **Settings.** `quota.autoReset` (on) and `quota.resetTokens` (200000, from 20000 to 900000), in Quota › Budget and limits. What each reset cost is in the activity: the context at the new conversation's first call and at its first change.

## What costs context, and the hints

Every call reads the whole context again, so a long session costs more per step than a short one doing the same work. Two hints, each said once:

- **After a commit or a push**, when the context is past `quota.resetTokens` (200K) and no reset follows (in Manual, or when one cannot be made), the line above the prompt says that `/clear` would start the next task small, until you type again. You type `/clear` yourself, and a handoff note (`/devir`, `handoff`) keeps what the next task needs. Off with `quota.clearHint: false`.
- **A large file read whole** (about 10K tokens or more, no `offset` or `limit`): Claude is told once to find the place first (Grep, `grep -n`) and read that part, the region it will edit in full. Reading through the shell (`cat`, `sed -n`, `grep -rn`) has the same hint toward Claude Code's own tools.

Claude Code's own commands help too: `/btw` asks a side question without adding it to the conversation, `/compact` takes instructions, and `/advisor` lets Claude consult a stronger model at key moments (those are calls of that model, counted in the quota like any). `/voice` turns on voice input, and `/remote-control` (`/rc`) lets you follow and steer the session from your phone or claude.ai/code ([autonomy.md](autonomy.md#away-from-the-computer)). The `compact-keep` rule template (`mode-code template apply compact-keep`) puts a line in the project's `CLAUDE.md` asking every compaction to keep the decisions word for word, paths with line ranges, error messages exactly, what is not verified and the next step. Mode_Code also asks each compaction to keep the session's own state (mode, flow, run) and restates it after.

## What a task costs

```sh
mode-code measure [--days 7] [--project <part of the folder>] [--json]
```

Reads what is already on the computer and writes nothing: Claude Code's transcripts (`~/.claude/projects`, each API call once, though it takes a line per content block) and Mode_Code's quota readings (`~/.mode-code/events`). Each session is cut into tasks at the calls that commit or push; each call is priced at the API's rates for its model and weighed by what the quota was measured to count (per dollar, against a cache write: a read 0.76, output 1.92; a regression of 533 readings, 2026-10-16). The table gives each task's calls, largest context, quota units and the weekly points they come to, from the units a point took between the readings of each week. Calls made elsewhere (another computer, the web) raise the readings too, so a point's units are a floor.

How the work went, as far as the transcript shows it, beside each task:

| Trace              | What it counts                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| tested             | a test or check command ran in the task (`npm test`, `pytest`, `flutter test`, `node --test` …)                               |
| read again         | the same part of a file read again with no write to it in between                                                             |
| refused            | tool calls refused by a hook, a permission or a mode                                                                          |
| cache rebuilt      | a call past the session's first that wrote most of a large prompt anew (the cache had run out, or was cleared)                |
| past 400k          | calls whose prompt was past 400K tokens                                                                                       |
| file changed again | a file the task wrote that a later task wrote again within 48 hours                                                           |
| fixed later        | what the task committed was fixed or taken back by a later `fix:` or `revert:` on the same code, within 48 hours (or 14 days) |
| after a reset      | the task began a conversation that a reset at a task boundary started, with what it read again before its first change        |

Under the table: the units by model with the subagents' share, tool output by tool (what fills the context), and the MCP servers configured but not called in these days (each one's tool list rides in every session unless tool search defers it; `mode-code doctor` says whether it does). Then how the committed work held, the units per task that held, and the resets:

- **How the work held.** A task's own commits are those whose subject its commit command wrote, in the repository that command worked in (`git -C`, `cd`, else the session's folder), read from `git log` of every local branch. Another commit within 48 hours (and 14 days) whose subject starts `fix:` or `revert:` (git's own `Revert` too) and that shares a code file with one of them marks it fixed; notes, logs, lock files and the changelog tie nothing. A task too recent for the window is not judged, and the memory's own repository is left out.
- **Per task that held.** All the units over the closed tasks not fixed within 48 hours: the quota a piece of work that stood took, the measure a saving has to lower without the work holding less.
- **Resets** at a task boundary: how many, the median context read again before the new conversation's first change, and the units they saved, an estimate (what each call of the new conversation no longer read, less the new start written once).

## Comparing two ways of working

A change that should save quota (a `/clear` at each commit, subagents on a smaller model, reading in parts) is measured, not assumed:

1. Two weeks as you work now, for the baseline: `mode-code measure --days 14 --json > before.json`.
2. Then the change alone, on alternate days, at least 20 tasks on each side.
3. Per task, compare the median units and the traces together: a saving that brings more files changed again or fewer tested tasks is no saving.

Expect a middle of 15 to 20% from the context levers together and a wide range (8 to 30%); a number is said only once it was measured here.

## Not yet

- **Subagents on a smaller model.** Claude Code's own Explore runs on the session's model (Opus when you work with Opus; Claude Code 2.1.302 caps it there). Routing searches to Sonnet waits until the readings show what a Sonnet call weighs in the quota; `mode-code measure` shows the subagents' share by model to decide it from. Meanwhile parallel agents set to exactly N take a model per agent ([agents.md](agents.md)).
- **A hook that filters test and build output.** Measured elsewhere with mixed results; `mode-code measure` shows how much of the context tool output takes before one is built.
