---
name: memory-care
description: Check the memory folder for what no longer loads, repeats or contradicts itself, and propose the fixes; run by the person.
disable-model-invocation: true
---

Review the person's memory folder (`mode-code memory` says where it is) and propose its upkeep. Propose only: every change to the memory is approved by the person first, and nothing is deleted without their yes.

1. **The index first.** Claude Code loads only the start of `MEMORY.md` (about 200 lines or 25 KB): measure it (`wc -l`, `wc -c`). If it is near or over, find what makes it long: entries holding details instead of pointing to a file.
2. **Each entry:** does the file it points to exist; does a file exist that no entry points to; do two files say the same thing; do two say opposite things (quote both); is something dated that has since changed (a version, a "next step" long done).
3. **Secrets:** run `mode-code secrets` over the folder; a finding is shown masked, never repeated in full.
4. **Report** a list of proposed changes, each with its reason and the exact edit (which lines move where, which file merges into which). Apply only what the person approves, then run `mode-code memory sync` if the memory is synced.
