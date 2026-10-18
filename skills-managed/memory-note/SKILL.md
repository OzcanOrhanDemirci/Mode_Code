---
name: memory-note
description: Use when saving something to the person's memory (their autoMemoryDirectory), to keep one fact per file, the index short and secrets out.
---

When you write to the person's memory folder (Mode_Code's memory, Claude Code's `autoMemoryDirectory`):

1. **Is it worth remembering?** A preference, a rule the person stated, a decision with its reason, a fact about a project that the files do not record. Not what the code, git history or docs already say; not what only matters to this conversation.
2. **One fact per file**, in the folder the memory already uses for that project or subject (`projects/<name>/` for a project's own). Before writing, look for a file that covers it: update that one rather than adding a second.
3. **The file:** a short title, the fact, and for a rule or a decision why and how to apply it, with the date written out (`2026-10-18`, never "today"). Quote the person's own words when they stated it.
4. **The index:** `MEMORY.md` gets one line per file: a link and a few words saying when to read it. Never the fact itself: Claude Code loads only the index's first 200 lines or 25 KB, and what does not fit is never read.
5. **Never** write a key, token, password or anything that looks like one, or someone else's personal data. Delete nothing and rewrite no history without the person's yes.
6. Say what you saved, in one line, with the file's path.
