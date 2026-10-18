---
name: packs
description: Show the tool packs, which are on in this project, and what one would add for the work at hand; run by the person.
disable-model-invocation: true
argument-hint: '[a kind of work]'
---

Show the person the tool packs (docs/packs.md) for this project.

1. Run `mode-code packs` in the project's folder: each pack, whether it is on here, the programs it needs that are missing, what it costs while on.
2. If the person named a kind of work ($ARGUMENTS), call the catalog tool with that need and show the packs that match, with the guide of the best one.
3. Say what you would turn on for this project and why, in one line each. Turning a pack on is the person's (`mode-code packs on <pack>`) unless Automatic use allows you; installing a program a pack needs is always theirs.
