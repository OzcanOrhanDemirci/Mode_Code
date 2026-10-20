// SPDX-License-Identifier: Apache-2.0
/**
 * `mode-code memory` and `mode-code morning` as separate processes (docs/memory.md): before any
 * setup, the setup's refusals, a local store's status and sync, handoff notes, the morning report; each with
 * its --json contract.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli, world } from '../helpers/proc.js';
import { handoffName } from '../../src/core/handoff.js';

const hasGit = spawnSync('git', ['--version']).status === 0;
const slash = (p: string) => p.replace(/\\/g, '/');

test('memory: before a setup, and the setup refused without a terminal or under an agent', () => {
  const w = world();
  try {
    const s = cli(w, ['memory', '--json']);
    assert.equal(s.code, 0, s.err);
    assert.equal(s.json?.schema, 'mode-code.memory/1');
    assert.deepEqual([s.json?.store, s.json?.setting, s.json?.inUse, s.json?.handoff], [null, null, false, null]);
    const text = cli(w, ['memory']);
    assert.match(text.out, /Memory · not set up/);
    assert.match(text.out, /mode-code memory setup/);
    const piped = cli(w, ['memory', 'setup']);
    assert.equal(piped.code, 2);
    assert.match(piped.out, /run it in a terminal/);
    w.env.CLAUDECODE = '1';
    const agent = cli(w, ['memory', 'setup']);
    delete w.env.CLAUDECODE;
    assert.equal(agent.code, 1);
    assert.match(agent.out, /Claude Code session/i);
    const sync = cli(w, ['memory', 'sync', '--json']);
    assert.deepEqual([sync.code, sync.json?.ok, sync.json?.reason], [1, false, 'not-set-up']);
    const syncText = cli(w, ['memory', 'sync']);
    assert.equal(syncText.code, 1);
    assert.match(syncText.out, /The memory is not set up yet: mode-code memory setup/);
    // No handoff note anywhere yet: said in words, and an empty list in JSON.
    assert.match(cli(w, ['memory', 'handoff', '--all', '--project', 'app']).out, /No handoff note for app yet\./);
    const none = cli(w, ['memory', 'handoff', '--all', '--project', 'app', '--json']);
    assert.deepEqual([none.code, none.json?.project, none.json?.notes], [0, 'app', []]);
    assert.equal(cli(w, ['memory', 'frob']).code, 2);
  } finally {
    w.done();
  }
});

test('memory: a local store with a history: status, sync, handoffs, the morning report', { skip: !hasGit && 'git is not installed' }, () => {
  const w = world();
  try {
    const mem = slash(join(w.root, 'mem'));
    mkdirSync(mem);
    const git = (...a: string[]) => spawnSync('git', ['-C', mem, ...a], { encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.name', 'Ada');
    git('config', 'user.email', 'ada@example.com');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(mem, 'MEMORY.md'), '# Memory\n');
    mkdirSync(w.data, { recursive: true });
    writeFileSync(join(w.data, 'config.json'), JSON.stringify({ language: 'en', memory: { store: { place: 'local', dir: mem, git: true } } }));
    writeFileSync(join(w.claudeDir, 'settings.json'), JSON.stringify({ autoMemoryDirectory: mem }));
    const sync = cli(w, ['memory', 'sync', '--json']);
    assert.equal(sync.code, 0, sync.err + sync.out);
    assert.deepEqual([sync.json?.ok, sync.json?.result?.commit, sync.json?.result?.committed], [true, 'ok', 1]);
    assert.match(cli(w, ['memory', 'sync']).out, /✓ nothing to do/);
    const status = cli(w, ['memory', '--json']);
    assert.deepEqual([status.json?.store?.place, status.json?.inUse, status.json?.local?.isRepo, status.json?.last?.trigger], ['local', true, true, 'manual']);
    const text = cli(w, ['memory']).out;
    assert.match(text, /Memory · this computer only/);
    assert.match(text, /Claude Code\s+✓ writes its memory here/);
    // A handoff note for the folder the command runs in.
    const project = slash(w.root).split('/').pop()!.toLowerCase();
    mkdirSync(join(mem, 'handoffs', project), { recursive: true });
    // Written an hour ago, so the morning report of the last day counts it.
    const at = Date.now() - 3_600_000;
    const name = handoffName(at, 'abc');
    writeFileSync(
      join(mem, 'handoffs', project, name),
      `---\ntype: handoff\nproject: ${project}\nmachine: mac\nsession: abc\nat: ${new Date(at).toISOString()}\ntrigger: keyword\n---\n\n## Next\n\nWrite the setup.\n`,
    );
    const h = cli(w, ['memory', 'handoff', '--json']);
    assert.equal(h.code, 0, h.err);
    assert.ok(String(h.json?.path).endsWith(name));
    assert.match(cli(w, ['memory', 'handoff']).out, /## Next\n\nWrite the setup\./);
    assert.ok(cli(w, ['memory', 'handoff', '--all']).out.includes(name));
    assert.equal(cli(w, ['memory', 'handoff', '--project', 'nothing-here']).code, 1);
    assert.match(cli(w, ['memory']).out, /Handoff\s+.*Write the setup\./);
    // A step full autonomy left to the person, an hour ago.
    const month = new Date(at).toISOString().slice(0, 7);
    mkdirSync(join(w.data, 'events', month), { recursive: true });
    writeFileSync(
      join(w.data, 'events', month, 's1.mod.jsonl'),
      JSON.stringify({ at, kind: 'belt', tool: 'Bash', verdict: 'deny', left: true, rules: ['git.push-pr-only'], reasons: ['Pushes to main'] }) + '\n',
    );
    // The morning report over the last day.
    const m = cli(w, ['morning', '--json', '--hours', '24']);
    assert.equal(m.json?.schema, 'mode-code.morning/1');
    assert.ok(
      (m.json?.lines as { text: string }[]).some((l) => /^1 step\(s\) full autonomy left to you/.test(l.text)),
      JSON.stringify(m.json?.lines),
    );
    const mt = cli(w, ['morning', '--hours', '24']).out;
    assert.match(mt, /While you were away · since/);
    assert.match(mt, /Handoffs\s+.*\(1\)/);
  } finally {
    w.done();
  }
});
