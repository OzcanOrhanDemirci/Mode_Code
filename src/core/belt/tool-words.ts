// SPDX-License-Identifier: Apache-2.0
/**
 * The words of a connected service's tool name. The belt knows what such a tool does only by the words in its name
 * (src/core/belt/check.ts, `checkOutward`), and servers spell a name in every style: `send_email`, `send-email`,
 * `sendEmail`, `SendEmail`. All four are the same words here, so a rule does not depend on the author's style.
 * Pure.
 */

/**
 * Where a word starts: a capital followed by lower case, an acronym (a run of capitals that is not followed by lower
 * case, or all but the last capital of one that is: `URLList` is `URL` and `List`), or a run of digits. Anything else
 * (`_`, `-`, and what a name must not hold anyway) only separates.
 */
const WORD = /[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g;

/**
 * The lower-case words of a tool's own name: what follows the server in `mcp__<server>__<tool>`, as Claude Code reads
 * it (a `__` inside the tool's name stays in it; the server's name says nothing of what a call does). Split at `_`
 * and `-`, where the case changes (`sendEmail`, `getURLList`) and where letters meet digits (`v2Send` is `v`, `2`,
 * `send`). A word that only sits inside a longer one (`post` in `postgres`, `set` in `settings`) is no word of its
 * own, and a name written without any separator or capital (`sendemail`) is one word: the vocabulary stays by
 * construction a list of words, and no list is complete.
 */
export function toolWords(tool: string): string[] {
  return (tool.split('__').slice(2).join('__').match(WORD) ?? []).map((w) => w.toLowerCase());
}
