// SPDX-License-Identifier: Apache-2.0
/**
 * Mode_Code's own tools are known by their exact names (src/core/belt/tools.ts), not by the plugin's server name: any
 * MCP server can be named like this plugin, and the tools it carries are a connected service's like any other. The list
 * is held against the tools the mod registers (src/mod/register.ts), in both directions, so that a tool added there
 * without being listed here, or listed here and not registered, fails this test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_NAME } from '../../src/core/app.js';
import { evaluateToolCall } from '../../src/core/belt/evaluate.js';
import { isOutwardTool, isOwnTool, OWN_TOOLS } from '../../src/core/belt/tools.js';
import { ROOT } from '../helpers/proc.js';
import { winCtx } from '../helpers/belt.js';

const own = (name: string) => `mcp__${PLUGIN_NAME}__${name}`;
const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';

/**
 * The names of the tools a mod's source registers: each `$.tool.register(X)`, X a constant defined with its `name` first
 * or an object written in place. Anything else cannot be read, and fails.
 */
function registeredIn(source: string): string[] {
  const names: string[] = [];
  for (const m of source.matchAll(/\$\.tool\.register\(\s*([^)]*?)\s*\)/g)) {
    const arg = m[1]!;
    const def = /^\w+$/.test(arg) ? new RegExp(`\\bconst ${arg}\\s*=\\s*\\{\\s*name:\\s*'([^']+)'`).exec(source) : /^\{\s*name:\s*'([^']+)'/.exec(arg);
    assert.ok(def, `cannot read the name of what is registered: ${arg}`);
    names.push(def[1]!);
  }
  return [...new Set(names)].sort();
}

test('the tools the mod registers are exactly the tools listed as its own', () => {
  const registered = registeredIn(readFileSync(join(ROOT, 'src/mod/register.ts'), 'utf8'));
  assert.ok(registered.length >= 5, registered.join(', '));
  assert.deepEqual(
    registered.filter((n) => !OWN_TOOLS.includes(n)),
    [],
    'registered, and missing from OWN_TOOLS (src/core/belt/tools.ts)',
  );
  assert.deepEqual(
    OWN_TOOLS.filter((n) => !registered.includes(n)),
    [],
    'listed in OWN_TOOLS, and not registered by the mod',
  );
  assert.equal(new Set(OWN_TOOLS).size, OWN_TOOLS.length, 'a name listed twice');
});

test('the reader of the mod finds a tool added without being listed, and one it cannot read', () => {
  const source = [
    'const A_TOOL = {',
    "  name: 'alpha',",
    '};',
    "const B = { name: 'beta' };",
    'await $.tool.register(A_TOOL);',
    'await $.tool.register( B );',
    "await $.tool.register({ name: 'gamma', isDeferred: true });",
    'await $.tool.register(B);',
  ].join('\n');
  assert.deepEqual(registeredIn(source), ['alpha', 'beta', 'gamma']);
  assert.deepEqual(registeredIn('no tools here'), []);
  assert.throws(() => registeredIn('await $.tool.register(makeTool());'), /cannot read the name of what is registered/);
  assert.throws(() => registeredIn('await $.tool.register(NOT_DEFINED);'), /cannot read the name of what is registered: NOT_DEFINED/);
  // A tool that is listed and was not registered, and one that was registered and not listed, are told apart.
  const listed = ['alpha', 'beta'];
  const registered = registeredIn(source);
  assert.deepEqual(
    registered.filter((n) => !listed.includes(n)),
    ['gamma'],
  );
  assert.deepEqual(
    [...listed, 'delta'].filter((n) => !registered.includes(n)),
    ['delta'],
  );
});

test("a tool is Mode_Code's own by its exact name: the listed ones, and no other under the same server name or the same name elsewhere", () => {
  for (const name of OWN_TOOLS) {
    assert.equal(isOwnTool(own(name)), true, name);
    assert.equal(isOutwardTool(own(name)), false, name);
  }
  const notOwn = [
    own('update_notes'),
    own('handoff_all'),
    own('handoff '),
    own('Handoff'),
    own(''),
    `mcp__${PLUGIN_NAME}__`,
    `mcp__${PLUGIN_NAME}_handoff`,
    `mcp__${PLUGIN_NAME}x__handoff`,
    `mcp__${PLUGIN_NAME.toUpperCase()}__handoff`,
    `mcp__${PLUGIN_NAME.replace(/-/g, '_')}__handoff`,
    `mcp__plugin_${PLUGIN_NAME}_${PLUGIN_NAME}__handoff`,
    'mcp__other__handoff',
    'mcp__other__why',
    `${PLUGIN_NAME}__handoff`,
    'handoff',
    'Bash',
    '',
  ];
  for (const tool of notOwn) assert.equal(isOwnTool(tool), false, tool);
  // Of those, the MCP tools are a connected service's: judged, a source of outside content, refused in a restricted mode.
  for (const tool of notOwn.filter((t) => t.startsWith('mcp__'))) assert.equal(isOutwardTool(tool), true, tool);
  for (const tool of ['Bash', 'Read', 'handoff', '']) assert.equal(isOutwardTool(tool), false, tool);
});

test("a tool that only carries Mode_Code's server name is judged like any connected service's; its five are left alone", async () => {
  const judge = async (tool: string, input: Record<string, unknown> = {}) => {
    const d = await evaluateToolCall(tool, input, winCtx());
    return [d.verdict, d.findings.map((f) => f.rule)];
  };
  // The server named like ours, a name not listed: asked and blocked as any other service's.
  assert.deepEqual(await judge(own('send_message'), { to: 'x@example.org' }), ['ask', ['outbound.send']]);
  assert.deepEqual(await judge(own('delete_notes'), { name: 'a' }), ['ask', ['outbound.delete']]);
  assert.deepEqual(await judge(own('create_refund')), ['ask', ['outbound.payment']]);
  assert.deepEqual(await judge(own('create_file'), { content: `token: ${TOKEN}` }), ['deny', ['secrets.exfil']]);
  assert.deepEqual(await judge(own('update_notes'), { content: 'notes' }), ['allow', []], 'a write with nothing to ask about');
  // A server named like ours in another spelling, and a pack's server: never exempt, as before.
  for (const server of [PLUGIN_NAME.replace(/-/g, '_'), PLUGIN_NAME.toUpperCase(), `${PLUGIN_NAME}2`, `plugin_${PLUGIN_NAME}_${PLUGIN_NAME}`])
    assert.deepEqual(await judge(`mcp__${server}__send_message`, { to: 'x@example.org' }), ['ask', ['outbound.send']], server);
  // The five, the same inputs: nothing to judge.
  for (const name of OWN_TOOLS) assert.deepEqual(await judge(own(name), { to: 'x@example.org', content: `token: ${TOKEN}` }), ['allow', []], name);
  // Another server's tool under one of the five names is judged by its words, as before.
  assert.deepEqual(await judge('mcp__other__handoff', { content: `token: ${TOKEN}` }), ['allow', []]);
  assert.deepEqual(await judge('mcp__other__send_request', { to: 'x@example.org' }), ['ask', ['outbound.send']]);
});
