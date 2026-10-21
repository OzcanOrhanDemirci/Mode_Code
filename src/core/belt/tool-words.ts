// SPDX-License-Identifier: Apache-2.0
/**
 * What a connected service's tool name says. The belt knows what such a tool does only by the words in its name
 * (src/core/belt/check.ts, `checkOutward`), and servers spell a name in every style: `send_email`, `send-email`,
 * `sendEmail`, `SendEmail`. All four are the same words here, so a rule does not depend on the author's style. The
 * words that make a tool pay, reach people, delete or write are listed here once, for the belt and for the restricted
 * modes and the footer (`actsOutside`). Pure.
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

/**
 * A payment tool, by the words of its name: one that names what is paid or the money itself, and one that acts on it.
 * `get_scheduled_transactions` only reads (scheduled is no `schedule`); reserving or booking and changing account or
 * credential data are no payment kind the belt asks about.
 */
const PAY_NOUN = /^(?:charges?|payments?|refunds?|payouts?|transfers?|invoices?|subscriptions?|checkout|purchases?|transactions?|money)$/;
const PAY_ACT = /^(?:create|update|confirm|capture|cancel|pay|finalize|void|send|refund|purchase|buy|schedule)$/;
/** Verbs that reach other people. */
const OUT_SEND = /^(?:send|reply|forward|share|invite|respond|post|publish)$/;
const OUT_DELETE = /^(?:delete|trash|remove|destroy|purge|wipe)$/;
/** Adding a person to something (a channel, a team, an event) is inviting them: `add_user_to_channel`, `grantMemberAccess`. */
const GIVES_ACCESS = /^(?:add|grant)$/;
const PERSON = /^(?:users?|members?|collaborators?|participants?|attendees?|guests?)$/;
/** Verbs that write something to the service: a secret in what they carry leaves the machine. */
const OUT_WRITE = /^(?:send|reply|forward|share|post|publish|create|update|write|upload|insert|append|set|put|add|edit|comment|batch|draft|save|import|copy)$/;

/** What a tool's words say it does. */
export interface OutwardKinds {
  /** A payment: always the person's. */
  pays: boolean;
  /** It reaches other people and cannot be taken back: a message, a share, an invitation, a person added, a calendar event. */
  sends: boolean;
  /** It deletes there. */
  deletes: boolean;
  /** It writes there: a secret in what it carries leaves the machine. */
  writes: boolean;
}

export function outwardKinds(words: readonly string[]): OutwardKinds {
  const has = (word: RegExp) => words.some((w) => word.test(w));
  return {
    pays: has(PAY_NOUN) && has(PAY_ACT),
    sends: (words.includes('event') && has(/^(?:create|update|delete)$/)) || (has(GIVES_ACCESS) && has(PERSON)) || has(OUT_SEND),
    deletes: has(OUT_DELETE),
    writes: has(OUT_WRITE),
  };
}

/**
 * What the restricted modes refuse in a tool and the footer counts as a change outside, besides what the belt asks about
 * (a payment, a send, a delete): any write to a service, found as a piece of any part of the whole name, the server's
 * included (`sendemail`, `createdAt`, `postgres`), so that a name the words do not split is caught too. Broader than the
 * belt's words, and kept so: these modes refuse where the belt asks, and err toward refusing.
 */
const WRITES_ANYWHERE = /(?:send|create|update|delete|trash|share|reply|forward|label|mark|write|upload|publish|post)/i;

/** Whether a connected service's tool, by its whole name, acts on something outside the machine. */
export function actsOutside(tool: string): boolean {
  const kinds = outwardKinds(toolWords(tool));
  return kinds.pays || kinds.sends || kinds.deletes || WRITES_ANYWHERE.test(tool);
}
