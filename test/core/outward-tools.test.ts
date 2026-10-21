// SPDX-License-Identifier: Apache-2.0
/**
 * What counts as outward in a connected service's tool name is said once (src/core/belt/tool-words.ts). The belt asks
 * about a payment, a send (a message, a share, an invitation, a person added, a calendar event) and a delete by those
 * words; the restricted modes refuse, and the footer counts as a change outside, the same tools and every write by a
 * broader word besides. On a fixed list of names (test/helpers/tool-names.ts), written in five styles, the two agree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateToolCall } from '../../src/core/belt/evaluate.js';
import { actsOutside, outwardKinds, toolWords } from '../../src/core/belt/tool-words.js';
import { checkMode, type ModeGuard } from '../../src/core/guard.js';
import { classifyTurn, type ClassifyEnv } from '../../src/core/footer.js';
import { taintedAct } from '../../src/core/taint.js';
import type { WorkMode } from '../../src/core/modes.js';
import { winCtx } from '../helpers/belt.js';
import { asTool, NAMES, styles } from '../helpers/tool-names.js';

const BELT_RULES = new Set(['outbound.payment', 'outbound.send', 'outbound.delete']);
/** What the belt asks about a tool: the rules it names for it, among the three that reach outside. */
const asked = async (tool: string): Promise<string[]> =>
  (await evaluateToolCall(tool, {}, winCtx())).findings.map((f) => f.rule).filter((r) => BELT_RULES.has(r));

test('the belt and the restricted modes agree on every name, in every style: what the belt asks about is outward, and only what is broader besides', async () => {
  for (const [snake, rule, outward] of NAMES)
    for (const name of styles(snake)) {
      const tool = asTool(name);
      const rules = await asked(tool);
      // A money tool is a payment and, by its verb, a send as well; the list names the first.
      if (rule) assert.ok(rules.includes(rule), `belt: ${name} (${rules.join(', ')})`);
      else assert.deepEqual(rules, [], `belt: ${name}`);
      assert.equal(actsOutside(tool), outward, `outward: ${name}`);
      // Whatever the belt asks about, the modes refuse: they are never laxer.
      if (rules.length) assert.equal(actsOutside(tool), true, name);
    }
});

test('the kinds a name has, by its words', () => {
  const kinds = (name: string) => outwardKinds(toolWords(asTool(name)));
  assert.deepEqual(kinds('send_money'), { pays: true, sends: true, deletes: false, writes: true });
  assert.deepEqual(kinds('scheduleTransaction'), { pays: true, sends: false, deletes: false, writes: false });
  assert.deepEqual(kinds('add_user_to_channel'), { pays: false, sends: true, deletes: false, writes: true });
  assert.deepEqual(kinds('grantMemberAccess'), { pays: false, sends: true, deletes: false, writes: false });
  assert.deepEqual(kinds('create_calendar_event'), { pays: false, sends: true, deletes: false, writes: true });
  assert.deepEqual(kinds('remove_member'), { pays: false, sends: false, deletes: true, writes: false });
  assert.deepEqual(kinds('get_users_in_channel'), { pays: false, sends: false, deletes: false, writes: false });
  assert.deepEqual(kinds('sendemail'), { pays: false, sends: false, deletes: false, writes: false });
});

test('the modes also catch a name the words do not split, and a piece of a longer word, as they always did', () => {
  // Pieces anywhere in the whole name, the server's too: broader than the belt's words, and kept so.
  assert.equal(actsOutside('mcp__shop__sendemail'), true);
  assert.equal(actsOutside('mcp__shop__deletefile'), true);
  assert.equal(actsOutside('mcp__shop__getCreatedAt'), true, 'a piece of created: the modes err toward refusing');
  assert.equal(actsOutside('mcp__db__postgres_query'), true, 'a piece of postgres, likewise');
  assert.equal(actsOutside('mcp__send_it__list_items'), true, "the server's name counts, as before");
  // Each piece the modes have always looked for, inside a name nothing splits.
  for (const piece of ['send', 'create', 'update', 'delete', 'trash', 'share', 'reply', 'forward', 'label', 'mark', 'write', 'upload', 'publish', 'post'])
    assert.equal(actsOutside(asTool(`x${piece}y`)), true, piece);
  // The belt reads words only: these it does not judge.
  assert.deepEqual(outwardKinds(toolWords('mcp__shop__sendemail')), { pays: false, sends: false, deletes: false, writes: false });
  // What no piece and no word names.
  for (const name of ['frobnicate', 'doIt', 'run_job', 'launch', 'moveFunds', 'wire']) assert.equal(actsOutside(asTool(name)), false, name);
  // Not an MCP tool name: no words, only pieces.
  assert.equal(actsOutside('Bash'), false);
  assert.equal(actsOutside('send_money'), true, 'a piece');
});

const env: ClassifyEnv = { platform: 'linux', home: '/home/u', cwd: '/home/u/proj', memoryRoots: [], ignore: ['/tmp'] };
const guard = (mode: WorkMode): ModeGuard => ({
  mode,
  zones: { temp: ['/tmp'], work: ['/home/u/work'], plan: ['/home/u/.claude/plans'] },
  env: { TMPDIR: '/tmp' },
  flowStep: null,
  words: { code: 'code', free: 'free' },
});

test('chat, research and plan refuse a payment, a send, a person added and a delete in any style, and let a read through', () => {
  for (const mode of ['chat', 'research', 'plan'] as const)
    for (const [snake, , outward] of NAMES)
      for (const name of styles(snake)) {
        const refusal = checkMode(asTool(name), {}, guard(mode), env, 'en');
        assert.equal(refusal?.what ?? 'allow', outward ? 'tool' : 'allow', `${mode}: ${name}`);
      }
  // Free and code modes add nothing.
  for (const mode of ['free', 'code'] as const) assert.equal(checkMode(asTool('send_money'), {}, guard(mode), env, 'en'), null);
});

test('the footer counts them as a change outside, and a read as none', () => {
  const external = (names: string[]) =>
    classifyTurn(
      names.map((name) => ({ name: asTool(name), input: {} })),
      env,
    ).external;
  const outward = NAMES.filter(([, , o]) => o).map(([n]) => n);
  const reads = NAMES.filter(([, , o]) => !o).map(([n]) => n);
  assert.equal(external(outward), outward.length);
  assert.equal(external(reads), 0);
  assert.equal(external(['sendMoney', 'ScheduleTransaction', 'add-user-to-channel', 'GRANT_MEMBER_ACCESS']), 4);
});

test('a tainted session counts the same tools as a send', () => {
  const act = (name: string) => taintedAct(asTool(name), {}, { platform: 'linux', home: '/home/u', cwd: '/home/u/proj', memoryDirs: [] })?.act ?? null;
  for (const [snake, , outward] of NAMES) for (const name of styles(snake)) assert.equal(act(name), outward ? 'send' : null, name);
});
