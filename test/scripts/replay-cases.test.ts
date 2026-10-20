// SPDX-License-Identifier: Apache-2.0
// The replay's case format and converters (scripts/replay/cases.ts): public trajectory formats as Claude Code's own calls,
// and a summary that carries counts and digests, never a call's content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '../../src/core/sha256.js';
import {
  digest,
  fromClaudeCode,
  fromOpenHands,
  fromSweAgentXml,
  makeCase,
  mapCall,
  summarize,
  type CaseMeta,
  type Judged,
} from '../../scripts/replay/cases.js';

const META: CaseMeta = { source: 'set', version: 'v1', license: 'MIT', label: 'benign', category: 'swe' };

test('a case: where it came from, the call as Claude Code makes it, a digest of what it carries', () => {
  const c = makeCase(META, 't1', 3, { tool: 'Bash', input: { command: 'ls' } }, '/work');
  assert.deepEqual(c, {
    case_id: 'set:t1:3',
    source: 'set',
    version: 'v1',
    license: 'MIT',
    label: 'benign',
    category: 'swe',
    origin: { trajectory: 't1', step: 3 },
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
    cwd: '/work',
    payload_sha256: sha256Hex('{"command":"ls"}'),
  });
  // The set's folder and system when the call does not say; none at all when neither does.
  const linux = makeCase({ ...META, cwd: '/testbed', platform: 'linux' }, 't', 0, { tool: 'Bash', input: { command: 'ls' } });
  assert.deepEqual([linux.cwd, linux.platform], ['/testbed', 'linux']);
  const bare = makeCase(META, 't', 0, { tool: 'Bash', input: {} });
  assert.equal('cwd' in bare || 'platform' in bare, false);
  assert.equal(digest('set:t1:3'), sha256Hex('set:t1:3').slice(0, 12));
});

test("Claude Code's records: every tool_use of an assistant record, in order, each once, with the record's folder", () => {
  const use = (id: string | undefined, name: string, input: unknown) => ({ type: 'tool_use', ...(id ? { id } : {}), name, input });
  const records = [
    { type: 'user', message: { content: [use('u', 'Bash', { command: 'no' })] } },
    {
      type: 'assistant',
      cwd: '/app',
      message: { content: [{ type: 'text', text: 'hi' }, use('a', 'Bash', { command: 'npm test' }), use('b', 'Read', { file_path: 'x' })] },
    },
    // The same call written again in a later record counts once; a call without an id always counts.
    { type: 'assistant', message: { content: [use('a', 'Bash', { command: 'npm test' }), use(undefined, 'Write', { file_path: 'y', content: '' })] } },
    { type: 'assistant', message: { content: 'text only' } },
    { type: 'assistant', message: { content: [use('c', 'Bash', 'not an object'), { type: 'tool_use', id: 'd', input: {} }, null] } },
    null,
    'junk',
  ];
  const cases = fromClaudeCode(records, 's1', META);
  assert.deepEqual(
    cases.map((c) => [c.case_id, c.tool_name, c.cwd]),
    [
      ['set:s1:0', 'Bash', '/app'],
      ['set:s1:1', 'Read', '/app'],
      ['set:s1:2', 'Write', undefined],
    ],
  );
});

test("an agent's function calls as Claude Code's: the shell and the editor; the rest is not a call", () => {
  assert.deepEqual(mapCall('execute_bash', { command: 'pytest -q' }), { tool: 'Bash', input: { command: 'pytest -q' } });
  assert.deepEqual(mapCall('bash', { command: 'ls' }), { tool: 'Bash', input: { command: 'ls' } });
  // Input typed into a running command, and a command that is not text, are not commands.
  assert.equal(mapCall('execute_bash', { command: 'y', is_input: 'true' }), null);
  assert.equal(mapCall('execute_bash', { command: 'y', is_input: true }), null);
  assert.equal(mapCall('execute_bash', { command: 42 }), null);
  assert.equal(mapCall('execute_bash', { command: '' }), null);
  const ed = (args: Record<string, unknown>) => mapCall('str_replace_editor', { path: '/w/a.py', ...args });
  assert.deepEqual(ed({ command: 'create', file_text: 'x = 1\n' }), { tool: 'Write', input: { file_path: '/w/a.py', content: 'x = 1\n' } });
  assert.deepEqual(ed({ command: 'create' }), { tool: 'Write', input: { file_path: '/w/a.py', content: '' } });
  assert.deepEqual(ed({ command: 'str_replace', old_str: 'a', new_str: 'b' }), {
    tool: 'Edit',
    input: { file_path: '/w/a.py', old_string: 'a', new_string: 'b' },
  });
  assert.deepEqual(ed({ command: 'str_replace' }), { tool: 'Edit', input: { file_path: '/w/a.py', old_string: '', new_string: '' } });
  assert.deepEqual(ed({ command: 'insert', new_str: 'c', insert_line: 3 }), { tool: 'Edit', input: { file_path: '/w/a.py', old_string: '', new_string: 'c' } });
  assert.deepEqual(ed({ command: 'insert' }), { tool: 'Edit', input: { file_path: '/w/a.py', old_string: '', new_string: '' } });
  assert.deepEqual(ed({ command: 'view' }), { tool: 'Read', input: { file_path: '/w/a.py' } });
  assert.equal(ed({ command: 'undo_edit' }), null);
  assert.equal(mapCall('str_replace_editor', { command: 'create', file_text: 'x' }), null);
  for (const name of ['think', 'finish', 'task_tracker', 'submit']) assert.equal(mapCall(name, { command: 'ls' }), null, name);
});

test("OpenHands messages: each assistant message's tool_calls, the arguments read from their JSON text", () => {
  const call = (name: string, args: unknown) => ({ id: 'x', type: 'function', function: { name, arguments: args } });
  const messages = [
    { role: 'system', content: 'You are…' },
    { role: 'user', content: 'Fix it.' },
    { role: 'assistant', content: '', tool_calls: [call('execute_bash', '{"command": "ls -la"}'), call('think', '{"thought": "hmm"}')] },
    { role: 'tool', content: 'out', tool_calls: [call('execute_bash', '{"command": "no"}')] },
    { role: 'assistant', tool_calls: [call('str_replace_editor', { command: 'create', path: '/w/b.py', file_text: '' }), call('execute_bash', '{broken')] },
    { role: 'assistant', tool_calls: [call('execute_bash', '[1]'), { function: { arguments: '{}' } }, null] },
    { role: 'assistant', content: 'done', tool_calls: null },
  ];
  assert.deepEqual(
    fromOpenHands(messages, 'tr', META).map((c) => [c.case_id, c.tool_name, c.tool_input]),
    [
      ['set:tr:0', 'Bash', { command: 'ls -la' }],
      ['set:tr:1', 'Write', { file_path: '/w/b.py', content: '' }],
    ],
  );
});

test("SWE-agent's calls written into the message: <function=…> with its parameters, the format's own line breaks taken off", () => {
  const content = [
    'Let me look.',
    '<function=bash>',
    '<parameter=command>find /testbed -name "*.py"</parameter>',
    '</function>',
    'And write it:',
    '<function=str_replace_editor>',
    '<parameter=command>create</parameter>',
    '<parameter=path>/testbed/r.py</parameter>',
    '<parameter=file_text>',
    'print(1)',
    '',
    '</parameter>',
    '</function>',
    '<function=submit>',
    '</function>',
  ].join('\n');
  const messages = [
    { role: 'system', content: '<function=bash><parameter=command>example</parameter></function>' },
    { role: 'assistant', content },
    { role: 'assistant', content: null },
  ];
  assert.deepEqual(
    fromSweAgentXml(messages, 'sm', META).map((c) => [c.tool_name, c.tool_input]),
    [
      ['Bash', { command: 'find /testbed -name "*.py"' }],
      ['Write', { file_path: '/testbed/r.py', content: 'print(1)\n' }],
    ],
  );
});

test('the summary: counts by label, rule and category, digests of attacks let through, everyday calls stopped; no content', () => {
  const c = (id: string, label: 'attack' | 'benign', category: string, source = 'set') => ({
    ...makeCase({ ...META, source, label, category }, 't', 0, { tool: 'Bash', input: { command: 'secret-looking text' } }),
    case_id: id,
  });
  const judged: Judged[] = [
    { c: c('a1', 'attack', 'exfil'), verdict: 'deny', rules: ['secrets.exfil', 'secrets.exfil'] },
    { c: c('a2', 'attack', 'exfil'), verdict: 'allow', rules: [] },
    { c: c('a3', 'attack', 'persist'), verdict: 'warn', rules: ['secrets.write'] },
    { c: c('b1', 'benign', 'swe'), verdict: 'ask', rules: ['fs.delete-outside-project'] },
    { c: c('b2', 'benign', 'swe'), verdict: 'deny', rules: ['fs.delete-critical'] },
    { c: c('b3', 'benign', 'swe'), verdict: 'warn', rules: ['git.discard-work'] },
    { c: c('b4', 'benign', 'swe'), verdict: null, rules: [] },
    { c: c('o1', 'benign', 'own', 'own'), verdict: 'allow', rules: [] },
  ];
  const s = summarize(judged);
  assert.deepEqual(Object.keys(s), ['set', 'own']);
  assert.deepEqual(s.set, {
    calls: 7,
    judged: 6,
    verdicts: { attack: { deny: 1, allow: 1, warn: 1 }, benign: { ask: 1, deny: 1, warn: 1 } },
    rules: {
      'secrets.exfil': { deny: 1 },
      'secrets.write': { warn: 1 },
      'fs.delete-outside-project': { ask: 1 },
      'fs.delete-critical': { deny: 1 },
      'git.discard-work': { warn: 1 },
    },
    categories: { exfil: { deny: 1, allow: 1 }, persist: { warn: 1 }, swe: { ask: 1, deny: 1, warn: 1 } },
    missed: [digest('a2')],
    stopped: 2,
  });
  assert.equal(JSON.stringify(s).includes('secret-looking'), false);
  // At most `keep` digests of attacks let through.
  const many = Array.from({ length: 5 }, (_, i) => ({ c: c(`m${i}`, 'attack', 'x'), verdict: 'allow', rules: [] }));
  assert.equal(summarize(many, 3).set!.missed.length, 3);
});
