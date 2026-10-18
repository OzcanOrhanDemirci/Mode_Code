---
name: cost-estimate
description: Estimate what a planned task would take of the quota, from this computer's measured past work; run by the person.
disable-model-invocation: true
argument-hint: '<the task>'
---

Estimate the quota the task "$ARGUMENTS" would take, from what was measured here, and say how sure the estimate is.

1. **The measurements:** `mode-code report --week` and `mode-code tokens --days 30 --by cwd` for what past work in this project took; `mode-code quota` for where the windows stand now.
2. **Size the task:** how many files and steps it touches, whether it needs research, a plan, tests, several rounds. Compare it with past tasks in this project of a similar size, if the history shows them.
3. **Say the estimate as a range** (a share of the five-hour window and of the week), the past work it rests on, and what would make it larger (unknown code, failing tests, long files read whole).
4. Say whether it fits before the next reset, and what would make it cheaper without lowering the quality (narrower reads, a fresh session at a natural break). Never present a guess as a measurement.
