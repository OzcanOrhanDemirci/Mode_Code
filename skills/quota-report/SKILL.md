---
name: quota-report
description: Report how the Claude Code quota is being spent, from Mode_Code's measurements; run by the person.
disable-model-invocation: true
argument-hint: '[days]'
---

Report the quota as Mode_Code measured it, for the last week (or $ARGUMENTS days).

1. Run `mode-code quota` (the windows, their resets and the person's budget), `mode-code tokens --days 7 --by cwd` and `mode-code tokens --days 7 --by model`, and `mode-code report --week`. If `mode-code` is not found, say so and ask the person to run them.
2. Report: where each window stands and when it resets; which projects and models took the most; the cache hit rate; what the subagents took. Numbers come from those outputs only, with their units.
3. If something stands out (one project far above the rest, a low cache hit rate, subagents taking a large share), say it as an observation with its number, and the one change that would help most. Change no setting yourself: the budget and the quota settings are the person's.
