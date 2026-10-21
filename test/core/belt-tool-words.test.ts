// SPDX-License-Identifier: Apache-2.0
// The words of a connected service's tool name (src/core/belt/tool-words.ts): the same words in every style of writing it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolWords } from '../../src/core/belt/tool-words.js';
import { fc } from '../helpers/prop.js';

const words = (name: string) => toolWords(`mcp__shop__${name}`);

test('one name is the same words in snake, kebab, camel, Pascal and upper case', () => {
  for (const name of [
    'send_email',
    'send-email',
    'sendEmail',
    'SendEmail',
    'SEND_EMAIL',
    'SEND-EMAIL',
    'Send_Email',
    'send_Email',
    'send--email',
    '_send__email_',
  ])
    assert.deepEqual(words(name), ['send', 'email'], name);
  assert.deepEqual(words('get_all_hotels_in_city'), ['get', 'all', 'hotels', 'in', 'city']);
  assert.deepEqual(words('getAllHotelsInCity'), ['get', 'all', 'hotels', 'in', 'city']);
  assert.deepEqual(words('single'), ['single']);
  assert.deepEqual(words('Single'), ['single']);
  assert.deepEqual(words('SINGLE'), ['single']);
});

test('any words, written in any style, come out the same', () => {
  const word = fc.stringMatching(/^[a-z]{2,7}$/);
  fc.assert(
    fc.property(fc.array(word, { minLength: 1, maxLength: 5 }), (list) => {
      const cap = (w: string) => w[0]!.toUpperCase() + w.slice(1);
      const styles = [
        list.join('_'),
        list.join('-'),
        list.map((w, i) => (i ? cap(w) : w)).join(''),
        list.map(cap).join(''),
        list.join('_').toUpperCase(),
        list.map(cap).join('_'),
      ];
      for (const s of styles) assert.deepEqual(words(s), list, s);
    }),
  );
});

test('an acronym is one word, and ends where the next word starts', () => {
  assert.deepEqual(words('getURLList'), ['get', 'url', 'list']);
  assert.deepEqual(words('parseHTMLString'), ['parse', 'html', 'string']);
  assert.deepEqual(words('sendSMS'), ['send', 'sms']);
  assert.deepEqual(words('SMSSend'), ['sms', 'send']);
  assert.deepEqual(words('getUserID'), ['get', 'user', 'id']);
  assert.deepEqual(words('IDLookup'), ['id', 'lookup']);
  assert.deepEqual(words('iPhoneSync'), ['i', 'phone', 'sync']);
  assert.deepEqual(words('HTTP'), ['http']);
});

test('digits are words of their own: letters and digits meet at a boundary', () => {
  assert.deepEqual(words('v2Send'), ['v', '2', 'send']);
  assert.deepEqual(words('sendV2'), ['send', 'v', '2']);
  assert.deepEqual(words('send2Users'), ['send', '2', 'users']);
  assert.deepEqual(words('S3Upload'), ['s', '3', 'upload']);
  assert.deepEqual(words('base64Encode'), ['base', '64', 'encode']);
  assert.deepEqual(words('sha256sum'), ['sha', '256', 'sum']);
  assert.deepEqual(words('send_2fa_code'), ['send', '2', 'fa', 'code']);
  assert.deepEqual(words('2'), ['2']);
});

test('a word inside a longer one is no word of its own, and a name with no boundary is one word', () => {
  for (const [name, expected] of [
    ['postgres', ['postgres']],
    ['getPostgresVersion', ['get', 'postgres', 'version']],
    ['listSettings', ['list', 'settings']],
    ['readAddressBook', ['read', 'address', 'book']],
    ['getCreatedAt', ['get', 'created', 'at']],
    ['showResendCount', ['show', 'resend', 'count']],
    ['sendemail', ['sendemail']],
    ['deletefile', ['deletefile']],
    ['getMoneyness', ['get', 'moneyness']],
  ] as const)
    assert.deepEqual(words(name), expected, name);
});

test("only the tool's own name counts: the server's name is no part of it, and a double underscore inside it stays", () => {
  assert.deepEqual(toolWords('mcp__send_money__list_accounts'), ['list', 'accounts']);
  assert.deepEqual(toolWords('mcp__claude_ai_Gmail__send_message'), ['send', 'message']);
  assert.deepEqual(toolWords('mcp__plugin_mode-code-flutter_flutter__analyze_files'), ['analyze', 'files']);
  // Claude Code reads everything after the server's name as the tool's (a name like `send__it` is not `it` alone).
  assert.deepEqual(toolWords('mcp__shop__send__it'), ['send', 'it']);
  assert.deepEqual(toolWords('mcp__shop__send__'), ['send']);
  assert.deepEqual(toolWords('mcp__shop__'), []);
  assert.deepEqual(toolWords('mcp__shop'), []);
  assert.deepEqual(toolWords('send_email'), []);
  assert.deepEqual(toolWords(''), []);
});

test('what no word makes of a name: nothing', () => {
  for (const name of ['', '_', '-_-', '__', '---', ' ', 'ü', '日本語']) assert.deepEqual(words(name), [], JSON.stringify(name));
});
