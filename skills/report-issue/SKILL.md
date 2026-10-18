---
name: report-issue
description: Draft an issue report for Mode_Code with what the doctor measured, private details taken out; run by the person.
disable-model-invocation: true
argument-hint: '<what went wrong>'
---

Draft a bug report for Mode_Code about: $ARGUMENTS.

1. Run `mode-code doctor --report` (a report with private paths and names taken out) and `mode-code status`. Note Mode_Code's and Claude Code's versions and the operating system.
2. Ask the person, if not clear yet: what they did, what they expected, what happened instead, whether it happens again.
3. Write the report: a short title; the steps; expected and actual; the versions; the doctor lines that matter. Read it once more for anything private (paths with names, tokens, project names they may not want public) and take it out.
4. Show the draft. Opening it (`gh issue create --repo OzcanOrhanDemirci/Mode_Code`, or the issues page) is the person's: nothing is sent without their yes.
