// SPDX-License-Identifier: Apache-2.0
/**
 * A connected service's tool is judged by the words in its name (src/core/belt/check.ts, `checkOutward`; the words:
 * src/core/belt/tool-words.ts), whatever style its author wrote it in. The same name in snake, kebab, camel, Pascal and
 * upper case gets the same verdict; a payment is a tool that moves money and nothing the person says relaxes it; a name
 * that holds none of the words is not judged, by construction: no vocabulary is complete.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateToolCall } from '../../src/core/belt/evaluate.js';
import type { Level } from '../../src/core/belt/types.js';
import { emptyProvenance, withSaid } from '../../src/core/provenance.js';
import { winCtx } from '../helpers/belt.js';
import { styles } from '../helpers/tool-names.js';

const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const judge = async (name: string, input: Record<string, unknown> = {}, level: Level = 'manual', said = '') => {
  const prov = said ? withSaid(emptyProvenance(), said) : emptyProvenance();
  const d = await evaluateToolCall(`mcp__shop__${name}`, input, winCtx({ level, prov }));
  return { verdict: d.verdict, rules: d.findings.map((f) => f.rule) };
};

test('the same name has the same verdict in snake, kebab, camel, Pascal and upper case', async () => {
  const names: [string, string, string[]][] = [
    ['send_email', 'ask', ['outbound.send']],
    ['share_file', 'ask', ['outbound.send']],
    ['invite_user_to_team', 'ask', ['outbound.send']],
    ['create_calendar_event', 'ask', ['outbound.send']],
    ['update_calendar_event', 'ask', ['outbound.send']],
    ['delete_calendar_event', 'ask', ['outbound.send']],
    ['delete_file', 'ask', ['outbound.delete']],
    ['trash_thread', 'ask', ['outbound.delete']],
    ['create_refund', 'ask', ['outbound.payment']],
    ['cancel_subscription', 'ask', ['outbound.payment']],
    ['create_payment_link', 'ask', ['outbound.payment']],
    ['confirm_payment_intent', 'ask', ['outbound.payment']],
    ['send_money', 'ask', ['outbound.payment', 'outbound.send']],
    ['schedule_transaction', 'ask', ['outbound.payment']],
    ['update_scheduled_transaction', 'ask', ['outbound.payment']],
    ['add_user_to_channel', 'ask', ['outbound.send']],
    ['grant_member_access', 'ask', ['outbound.send']],
    ['add_calendar_event_participants', 'ask', ['outbound.send']],
    ['list_payment_intents', 'allow', []],
    ['get_scheduled_transactions', 'allow', []],
    ['get_users_in_channel', 'allow', []],
    ['search_threads', 'allow', []],
  ];
  for (const [snake, verdict, rules] of names)
    for (const name of styles(snake)) assert.deepEqual(await judge(name, { to: 'x@example.org' }), { verdict, rules }, name);
});

test('the secrets rule judges a name in any style as it judges the snake_case one', async () => {
  for (const snake of ['create_file', 'update_document', 'upload_file', 'append_values']) {
    for (const name of styles(snake)) assert.deepEqual(await judge(name, { content: `token: ${TOKEN}` }), { verdict: 'deny', rules: ['secrets.exfil'] }, name);
    // The same words, no secret in what is carried: nothing to say.
    for (const name of styles(snake)) assert.deepEqual(await judge(name, { content: 'meeting notes' }), { verdict: 'allow', rules: [] }, name);
  }
  // A reading is no write; the secret in what it is asked is not what leaves.
  for (const name of [...styles('read_file'), ...styles('search_files')])
    assert.deepEqual(await judge(name, { query: TOKEN }), { verdict: 'allow', rules: [] }, name);
  // A send carries it out as well, and both are said.
  const sent = await judge('sendMessage', { body: `here it is ${TOKEN}` });
  assert.equal(sent.verdict, 'deny');
  assert.deepEqual(new Set(sent.rules), new Set(['secrets.exfil', 'outbound.send']));
});

test('names with digits and acronyms are read word by word', async () => {
  assert.deepEqual(await judge('v2Send'), { verdict: 'ask', rules: ['outbound.send'] });
  assert.deepEqual(await judge('sendV2'), { verdict: 'ask', rules: ['outbound.send'] });
  assert.deepEqual(await judge('send2Slack'), { verdict: 'ask', rules: ['outbound.send'] });
  assert.deepEqual(await judge('sendHTTPRequest'), { verdict: 'ask', rules: ['outbound.send'] });
  assert.deepEqual(await judge('add2User'), { verdict: 'ask', rules: ['outbound.send'] });
  assert.deepEqual(await judge('v2CreateRefund'), { verdict: 'ask', rules: ['outbound.payment'] });
  assert.deepEqual(await judge('createACHTransaction'), { verdict: 'ask', rules: ['outbound.payment'] });
  assert.deepEqual(await judge('s3Upload', { content: `token: ${TOKEN}` }), { verdict: 'deny', rules: ['secrets.exfil'] });
  assert.deepEqual(await judge('getURLList'), { verdict: 'allow', rules: [] });
  assert.deepEqual(await judge('getUserID'), { verdict: 'allow', rules: [] });
  assert.deepEqual(await judge('parseHTMLString'), { verdict: 'allow', rules: [] });
  assert.deepEqual(await judge('base64Decode'), { verdict: 'allow', rules: [] });
});

test('a word that only sits inside a longer one is no word of the vocabulary', async () => {
  // Each holds a vocabulary word (post, set, add, create, send, update, delete, money, transaction) inside a longer one,
  // and carries a secret, which a false split into the shorter word would have blocked.
  for (const name of [
    'getPostgresVersion',
    'list_postgres_databases',
    'listSettings',
    'readAddressBook',
    'getCreatedAt',
    'showResendCount',
    'list_updates_available',
    'readDeletedItems',
    'getMoneyness',
    'getTransactional',
    'compostStatus',
    'sendgridStatus',
    'unsetFlag',
    'upsert',
    'sendemail',
    'deletefile',
    'createrefund',
  ])
    assert.deepEqual(await judge(name, { content: `token: ${TOKEN}` }), { verdict: 'allow', rules: [] }, name);
});

test('a money tool is a payment: always asked, and nothing the person said lets it through', async () => {
  const to = { to: 'ada@example.org', amount: 50 };
  const said = 'pay ada@example.org 50 for the books';
  for (const name of ['send_money', 'sendMoney', 'schedule_transaction', 'ScheduleTransaction', 'update_scheduled_transaction', 'create_refund'])
    for (const level of ['manual', 'auto', 'full'] as const) {
      const d = await evaluateToolCall(`mcp__shop__${name}`, to, winCtx({ level, prov: withSaid(emptyProvenance(), said) }));
      const pay = d.findings.find((f) => f.rule === 'outbound.payment');
      assert.ok(pay, `${name} ${level}`);
      assert.equal(pay.act, level === 'full' ? 'self' : 'ask', `${name} ${level}`);
      assert.notEqual(d.verdict, 'allow', `${name} ${level}`);
    }
  // A message to the same person, named by them, goes on with a note: only the payment is never relaxed.
  assert.deepEqual(await judge('send_message', to, 'auto', said), { verdict: 'warn', rules: ['outbound.send'] });
});

test('adding a person is inviting them: asked; reading who is there, or adding something else, is not', async () => {
  const asked = ['add_user_to_channel', 'add_member', 'add_collaborator', 'add_participants', 'add_attendee', 'add_guest', 'grant_user_access', 'grant_guest'];
  for (const snake of asked)
    for (const name of styles(snake))
      assert.deepEqual(await judge(name, { user: 'ada', channel: 'general' }), { verdict: 'ask', rules: ['outbound.send'] }, name);
  for (const snake of [
    'get_users_in_channel',
    'list_members',
    'add_label',
    'add_issue_comment',
    'add_item',
    'grant_permission',
    'remove_member_note',
    'update_user_info',
    'create_user',
  ])
    for (const name of styles(snake)) assert.equal((await judge(name, { user: 'ada' })).rules.includes('outbound.send'), false, name);
});

test('what the belt deliberately leaves out stays out: reserving, booking, and account or credential data', async () => {
  for (const snake of ['reserve_hotel', 'book_flight', 'reserve_car_rental', 'update_password', 'update_user_info', 'create_user', 'reset_credentials'])
    for (const name of styles(snake)) assert.deepEqual(await judge(name, { id: '7' }), { verdict: 'allow', rules: [] }, name);
});

test('every word of the vocabulary does what the docs say it does, spelled two ways', async () => {
  const both = (snake: string) => [snake, styles(snake)[2]!];
  const rulesOf = async (name: string, input: Record<string, unknown> = {}) => (await judge(name, input)).rules;
  // Verbs that reach other people.
  for (const verb of ['send', 'reply', 'forward', 'share', 'invite', 'respond', 'post', 'publish'])
    for (const name of both(`${verb}_item`)) assert.deepEqual(await rulesOf(name), ['outbound.send'], name);
  // Verbs that delete there.
  for (const verb of ['delete', 'trash', 'remove', 'destroy', 'purge', 'wipe'])
    for (const name of both(`${verb}_item`)) assert.deepEqual(await rulesOf(name), ['outbound.delete'], name);
  // Verbs that write: a secret in what they carry is blocked.
  for (const verb of ['send', 'reply', 'forward', 'share', 'post', 'publish', 'create', 'update', 'write', 'upload', 'insert', 'append', 'set', 'put'])
    for (const name of both(`${verb}_item`)) assert.ok((await rulesOf(name, { content: `token: ${TOKEN}` })).includes('secrets.exfil'), name);
  for (const verb of ['add', 'edit', 'comment', 'batch', 'draft', 'save', 'import', 'copy'])
    for (const name of both(`${verb}_item`)) assert.ok((await rulesOf(name, { content: `token: ${TOKEN}` })).includes('secrets.exfil'), name);
  // A payment: something paid or money, and an act on it; each noun with one act, each act with one noun.
  const nouns = ['charge', 'charges', 'payment', 'payments', 'refund', 'refunds', 'payout', 'payouts', 'transfer', 'transfers', 'invoice', 'invoices'];
  nouns.push('subscription', 'subscriptions', 'checkout', 'purchase', 'purchases', 'transaction', 'transactions', 'money');
  const acts = ['create', 'update', 'confirm', 'capture', 'cancel', 'pay', 'finalize', 'void', 'send', 'refund', 'purchase', 'buy', 'schedule'];
  for (const noun of nouns) for (const name of both(`create_${noun}`)) assert.ok((await rulesOf(name)).includes('outbound.payment'), name);
  for (const act of acts) for (const name of both(`${act}_invoice`)) assert.ok((await rulesOf(name)).includes('outbound.payment'), name);
  // Adding a person: add or grant, with each kind of person.
  const people = [
    'user',
    'users',
    'member',
    'members',
    'collaborator',
    'collaborators',
    'participant',
    'participants',
    'attendee',
    'attendees',
    'guest',
    'guests',
  ];
  for (const person of people)
    for (const verb of ['add', 'grant']) for (const name of both(`${verb}_${person}`)) assert.deepEqual(await rulesOf(name), ['outbound.send'], name);
  // The one word alone is no more than what it is: a noun with no act, an act with no noun, a person with no verb.
  for (const name of ['charges', 'money', 'transaction', 'schedule', 'buy', 'users', 'guest', 'grant', 'add_item', 'scheduleMeeting'])
    assert.deepEqual(await rulesOf(name), [], name);
});

test('a name with none of the words is not judged, however it is spelled', async () => {
  for (const name of ['frobnicate', 'doIt', 'run_job', 'launch', 'execute_workflow', 'MoveFunds', 'wire', 'sendemail'])
    assert.deepEqual(await judge(name, { to: 'x@example.org' }), { verdict: 'allow', rules: [] }, name);
});
