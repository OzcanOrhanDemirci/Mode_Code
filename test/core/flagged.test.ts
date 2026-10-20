// SPDX-License-Identifier: Apache-2.0
/**
 * When Anthropic's safeguards stop an answer (src/core/flagged.ts): told from a turn's end both ways it comes (a
 * refusal the API reported, an API error carrying Claude Code's text for it), and said in the person's language with
 * the three ways on. The text is the shape Claude Code wrote in the nine records of 2026-10 (versions 2.1.296 to
 * 2.1.299), its request and message ids made up.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagInText, flagLines, flagOfTurn } from '../../src/core/flagged.js';

/** Claude Code's text for the flag, as its records keep it: the error row and the user row it is copied into. */
const RECORDED = [
  "API Error: Opus 5.5's safeguards flagged this session (https://www.anthropic.com/legal/aup). You may be seeing this for the first time: Opus 5.5 is more capable and has stronger safeguards as a result, which can sometimes flag non-cybersecurity work. We're improving these safeguards to reduce the amount of incorrectly flagged messages. Claude Code can't respond to your last message with Opus 5.5.\n\nDouble press esc to edit your last message, or try a different model with /model.\n\nSend feedback with /feedback or learn more: https://support.claude.com/en/articles/8106465\n\nDetails: `[cyber]`\n\nRequest ID: req_000\n\nMessage ID: msg_000",
  "API Error: Opus 5.5's safeguards flagged this session (https://www.anthropic.com/legal/aup). You may be seeing this for the first time.\nDouble press esc to edit your last message, or try a different model with /model.\nSend feedback with /feedback or learn more: https://support.claude.com/en/articles/8106465\nDetails: [cyber]\nRequest ID: req_000",
];

test("Claude Code's text for the flag is told, with the model and what the classifier named", () => {
  for (const text of RECORDED) assert.deepEqual(flagInText(text), { category: 'cyber', model: 'Opus 5.5' });
  assert.deepEqual(flagInText("Sonnet 5.5's safeguards flagged this session."), { category: null, model: 'Sonnet 5.5' });
  for (const text of [null, undefined, '', 'API Error: 529 overloaded', 'The tests flagged three files.']) assert.equal(flagInText(text), null);
});

test('a turn ended by a refusal is the flag, its category from the API; an error is only when its text says so', () => {
  assert.deepEqual(flagOfTurn({ reason: 'refusal', refusal: { category: 'cyber' }, answer: '' }), { category: 'cyber', model: null });
  assert.deepEqual(flagOfTurn({ reason: 'refusal', refusal: { category: null }, answer: RECORDED[0] }), { category: 'cyber', model: 'Opus 5.5' });
  assert.deepEqual(flagOfTurn({ reason: 'refusal' }), { category: null, model: null });
  assert.deepEqual(flagOfTurn({ reason: 'error', answer: RECORDED[1] }), { category: 'cyber', model: 'Opus 5.5' });
  assert.equal(flagOfTurn({ reason: 'error', answer: 'API Error: 500 server error' }), null);
  // An answer that quotes the text is an answer: only an ended turn is the flag.
  assert.equal(flagOfTurn({ reason: 'answer', answer: RECORDED[0] }), null);
  assert.equal(flagOfTurn({ reason: 'aborted', answer: RECORDED[0] }), null);
});

test('said calmly in both languages: who said it, that nothing was lost, and the three ways on', () => {
  const tr = flagLines({ category: 'cyber', model: 'Opus 5.5' }, 'tr');
  assert.equal(tr[0], "Bu cevabı Anthropic'in güvenlik denetimi durdurdu (cyber).");
  assert.match(tr[1]!, /ne model ne Claude Code ne Mode_Code/);
  assert.match(tr[1]!, /yalnız bu cevap yazılmadı/);
  assert.deepEqual(
    tr.slice(3).map((l) => /Esc|\/model|\/feedback/.exec(l)?.[0]),
    ['Esc', '/model', '/feedback'],
  );
  const en = flagLines({ category: null, model: null }, 'en');
  assert.equal(en[0], "Anthropic's safeguards stopped this answer.");
  assert.equal(en.length, 6);
  for (const l of [...tr, ...en]) assert.doesNotMatch(l, /\{\w+\}|\bflag\.\w/);
});
