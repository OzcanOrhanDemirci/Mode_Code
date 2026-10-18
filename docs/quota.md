# Quota

Claude Code reports two windows after each answer: five hours and a week. Mode_Code reads them, guards the work against them, and measures what each task took of them on your computer. Nothing here changes how you work unless you turn it on: the guard keeps to the budgets you set, and the rest are hints and measurements.

## The guard

- **Budgets.** Wrap-up at 95% of the five-hour window and a stop at 99%. A weekly budget you give (`quota 40`, `kota +8`) wraps up one point before it and stops one point past it; with none, the week wraps up at 97% and stops at 99%. Settings: `quota.*` in `mode-code config`, or Settings › Footer and quota in the control center.
- **Wrap-up.** Past a budget the strip says so, and new heavy work is refused: a subagent, a workflow, a web search or fetch. Claude finishes the step it is on and reports.
- **Stop.** At the limit only reading, notes, the memory and committing what is done run.
- **Resume.** Autonomous work that stopped at the limit goes on one minute after the window resets (`quota.autoResume`).

## What a task costs

```sh
mode-code measure [--days 7] [--project <part of the folder>] [--json]
```

Reads what is already on the computer and writes nothing: Claude Code's transcripts (`~/.claude/projects`, each API call once, though it takes a line per content block) and Mode_Code's quota readings (`~/.mode-code/events`). Each session is cut into tasks at the calls that commit or push; each call is priced at the API's rates for its model and weighed by what the quota was measured to count (per dollar, against a cache write: a read 0.76, output 1.92; a regression of 533 readings, 2026-10-16). The table gives each task's calls, largest context, quota units and the weekly points they come to, from the units a point took between the readings of each week. Calls made elsewhere (another computer, the web) raise the readings too, so a point's units are a floor.

How the work went, as far as the transcript shows it, beside each task:

| Trace              | What it counts                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| tested             | a test or check command ran in the task (`npm test`, `pytest`, `flutter test`, `node --test` …)                |
| read again         | the same part of a file read again with no write to it in between                                              |
| refused            | tool calls refused by a hook, a permission or a mode                                                           |
| cache rebuilt      | a call past the session's first that wrote most of a large prompt anew (the cache had run out, or was cleared) |
| past 400k          | calls whose prompt was past 400K tokens                                                                        |
| file changed again | a file the task wrote that a later task wrote again within 48 hours                                            |

Under the table: the units by model with the subagents' share, tool output by tool (what fills the context), and the MCP servers configured but not called in these days (each one's tool list rides in every session unless tool search defers it; `mode-code doctor` says whether it does).

## Comparing two ways of working

A change that should save quota (a `/clear` at each commit, subagents on a smaller model, reading in parts) is measured, not assumed:

1. Two weeks as you work now, for the baseline: `mode-code measure --days 14 --json > before.json`.
2. Then the change alone, on alternate days, at least 20 tasks on each side.
3. Per task, compare the median units and the traces together: a saving that brings more files changed again or fewer tested tasks is no saving.

Expect a middle of 15 to 20% from the context levers together and a wide range (8 to 30%); a number is said only once it was measured here.

## Not yet

- **Subagents on a smaller model.** Claude Code's own Explore runs on the session's model (Opus when you work with Opus; Claude Code 2.1.302 caps it there). Routing searches to Sonnet waits until the readings show what a Sonnet call weighs in the quota; `mode-code measure` shows the subagents' share by model to decide it from.
- **A hook that filters test and build output.** Measured elsewhere with mixed results; `mode-code measure` shows how much of the context tool output takes before one is built.
- **Running full autonomy on the API's monthly credit** waits for where its key would be kept (your decision).
