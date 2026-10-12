// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectKeyword, messageWithoutKeyword, reservedWords, type ProjectRef } from '../../src/core/keywords.js';

const projects: ProjectRef[] = [
  { id: 'terminal_code', names: ['terminal'] },
  { id: 'checklist', names: ['checklist'] },
  { id: 'car', names: ['araba'] },
];
const d = (s: string) => detectKeyword(s, projects);

test('project continue, in the spellings people actually type', () => {
  assert.equal(d('terminal devam')?.project, 'terminal_code');
  assert.equal(d('termınal devam')?.project, 'terminal_code'); // the way this project's first session began
  assert.equal(d('TERMİNAL DEVAM')?.project, 'terminal_code');
  assert.equal(d('terminal devam edelim')?.project, 'terminal_code');
  assert.equal(d('terminal continue')?.project, 'terminal_code');
  assert.equal(d('araba devam')?.project, 'car');
});

test('a keyword at the end of a message counts; inside a sentence it does not', () => {
  assert.equal(d('Şu hatayı da düzelt. terminal devam')?.project, 'terminal_code');
  assert.equal(d('notları okudum\nterminal devam')?.kind, 'continue');
  assert.equal(d('terminal devam ederken bir şey sormak istiyorum'), null);
  assert.equal(d('dur bakalım ne olacak'), null);
});

test('continue and a weekly budget in one line', () => {
  const m = d('terminal devam kota 40');
  assert.equal(m?.kind, 'continue');
  assert.equal(m?.project, 'terminal_code');
  assert.deepEqual(m?.budget, { n: 40, plus: false });
  assert.deepEqual(d('Bunu bitir. araba devam kota +8')?.budget, { n: 8, plus: true });
  assert.equal(d('kota 40')?.kind, 'quota');
  assert.equal(d('bunu dene kota 40')?.kind, undefined); // a sentence before the budget is not a keyword
});

test('one typo away is a suggestion, not a match', () => {
  const m = d('chechlist devam');
  assert.equal(m?.kind, 'continue');
  assert.equal(m?.project, null);
  assert.equal(m?.suggestion, 'checklist');
});

test('words that are not a project do not become one', () => {
  assert.equal(d('şimdi testleri yazmaya devam'), null);
  assert.deepEqual(d('devam'), { lang: 'tr', text: 'devam', standalone: true, kind: 'continue' });
  assert.equal(d('yeniproje devam')?.project, null); // single unknown word: an unregistered project
});

test('manual, chat, status, help', () => {
  assert.equal(d('manuel terminal devam')?.kind, 'manual');
  assert.equal(d('manuel terminal devam')?.project, 'terminal_code');
  assert.equal(d('sohbet')?.kind, 'chat');
  assert.equal(d('durum')?.kind, 'status');
  assert.equal(d('yardım')?.kind, 'help');
  assert.equal(d('terminal yardım')?.project, 'terminal_code');
});

test('stop and wrap up count only as the whole message', () => {
  assert.equal(d('dur')?.kind, 'stop');
  assert.equal(d('Dur!')?.kind, 'stop');
  assert.equal(d('toparla')?.kind, 'wrapUp');
  assert.equal(d('toparlayalım')?.kind, 'wrapUp');
  assert.equal(d('bunu bitirince dur'), null);
  assert.equal(d('wrap up')?.kind, 'wrapUp');
});

test('quota targets', () => {
  assert.deepEqual(d('kota 40'), { lang: 'tr', text: 'kota 40', standalone: true, kind: 'quota', plus: false, n: 40 });
  assert.equal(d('kota +8')?.plus, true);
  assert.equal(d('terminal devam. kota 39')?.n, 39);
  assert.equal(d('quota 50')?.n, 50);
});

test('notifications are never keywords, and keywords are reserved', () => {
  assert.equal(d('<task-notification>dur</task-notification>'), null);
  const r = reservedWords();
  for (const w of ['dur', 'devam', 'kota', 'sohbet', 'stop', 'continue']) assert.ok(r.has(w), w);
});

test('mode keywords: the whole message or its end, in both languages', () => {
  assert.equal(d('araştırma')?.kind, 'research');
  assert.equal(d('Araştır')?.kind, 'research');
  assert.equal(d('plan')?.kind, 'plan');
  assert.equal(d('kod')?.kind, 'code');
  assert.equal(d('serbest')?.kind, 'free');
  assert.equal(d('research')?.kind, 'research');
  assert.equal(d('code')?.kind, 'code');
  assert.equal(d('Girişe iki aşamalı doğrulama nasıl eklenir?\nplan')?.kind, 'plan');
  assert.equal(d('Girişe iki aşamalı doğrulama nasıl eklenir?\nplan')?.standalone, false);
  assert.equal(d('bunun için bir plan'), null); // the last sentence must be the keyword alone
  assert.equal(d('bu hatanın nedenini araştır'), null);
});

test('flow keywords: start the full flow, the plan flow, the research flow, or cancel', () => {
  assert.deepEqual([d('akış')?.kind, d('akış')?.flow], ['flow', 'full']);
  assert.equal(d('Girişe iki aşamalı doğrulama ekle. akış')?.flow, 'full');
  assert.equal(d('akış plan')?.flow, 'plan');
  assert.equal(d('AKIŞ ARAŞTIRMA')?.flow, 'research');
  assert.equal(d('akış iptal')?.flow, 'cancel');
  assert.equal(d('flow')?.flow, 'full');
  assert.equal(d('flow plan')?.flow, 'plan');
  assert.equal(d('flow cancel')?.flow, 'cancel');
  assert.equal(d('akış nasıl çalışıyor'), null);
  assert.equal(d('akış kod'), null); // no such flow
});

test('approval counts only as the whole message', () => {
  assert.equal(d('onay')?.kind, 'approve');
  assert.equal(d('Onaylıyorum.')?.kind, 'approve');
  assert.equal(d('approve')?.kind, 'approve');
  assert.equal(d('Planı okudum. onay'), null);
  assert.equal(d('bu onay'), null);
});

test('the message without its keyword is the task of a flow', () => {
  assert.equal(messageWithoutKeyword('Girişe iki aşamalı doğrulama ekle. akış'), 'Girişe iki aşamalı doğrulama ekle.');
  assert.equal(messageWithoutKeyword('Ekran görüntülerine bak.\nTasarımı değiştir.\n\nakış plan\n'), 'Ekran görüntülerine bak.\nTasarımı değiştir.');
  assert.equal(messageWithoutKeyword('akış'), '');
  assert.equal(messageWithoutKeyword('   '), '');
});

test('the new words are reserved for projects too', () => {
  const r = reservedWords();
  for (const w of ['akis', 'onay', 'plan', 'kod', 'arastirma', 'serbest', 'flow', 'approve', 'research', 'iptal']) assert.ok(r.has(w), w);
});
