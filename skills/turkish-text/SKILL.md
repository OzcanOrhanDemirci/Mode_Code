---
name: turkish-text
description: Check Turkish text in this project (docs, app strings, store listings) for long dashes and the question particle's vowel harmony, then read for what a script cannot judge; run by the person.
disable-model-invocation: true
argument-hint: '[files or folders]'
---

Check the Turkish text of $ARGUMENTS (else the project's Turkish documents and app strings: `*.md`, `*.arb`, store listing texts). Change nothing until the person says which to fix.

1. **Run the checker:** `node "${CLAUDE_SKILL_DIR}/check.mjs" <files or folders>`. It lists every long dash (the em and the en dash, which the person's documents do not use) and every question particle written apart whose vowel does not follow the word before it (`geldi mı` → `geldi mi`, `kitap mi` → `kitap mı`, with its endings: `mısın`, `miydi` …). Code in Markdown is left out. A foreign word is read by its spelling, not its sound (`cat mi` for "ket mi"): judge those.
2. **Read for what a script cannot judge:** a particle written joined to its word (`geldimi?`; but `anlamı` and `durumu` are words), `ı`/`i` and `I`/`İ` (an uppercase word in code: `toUpperCase()` without the Turkish locale turns `i` into `I`), suffixes after names and numbers with an apostrophe (`Claude'un`, `2026'da`), `de`/`da` and `ki` written apart or joined by their meaning, and sentences that carry more than one idea.
3. **Report** by file and line, each with the fix; group the long dashes. Fix only what the person approves, keeping the meaning.
