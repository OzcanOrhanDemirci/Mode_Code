---
name: belt
description: Explain the safety belt here: what it stopped, why, and what it would do with a given command; run by the person.
disable-model-invocation: true
argument-hint: '[a command to test]'
---

Explain the safety belt to the person.

1. If they gave a command ($ARGUMENTS), run `mode-code belt test --command "<it>"` (in PowerShell add `--tool PowerShell`) and explain the verdict, the rule and the reason in plain words. Nothing is run by the test.
2. Otherwise run `mode-code belt events --days 7`: what was blocked, asked or noted this week, by rule. For each rule that fired, say what it protects against.
3. If a rule fires on work the person does every day, say so with its count, and how they could change it (`mode-code belt rules`, the control center's Security › Safety belt rules). Changing a rule is theirs; locked rules can only be made stricter.
