// SPDX-License-Identifier: Apache-2.0
/**
 * `terminal-code memory` and `terminal-code morning` as separate processes (docs/memory.md): before any
 * setup, the setup's refusals, a local store's status and sync, handoff notes, notes from runs approved and
 * discarded, the morning report; each with its --json contract.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
    assert.equal(s.json?.schema, 'terminal-code.memory/1');
    assert.deepEqual([s.json?.store, s.json?.setting, s.json?.inUse, s.json?.handoff], [null, null, false, null]);
    const text = cli(w, ['memory']);
    assert.match(text.out, /Memory · not set up/);
    assert.match(text.out, /terminal-code memory setup/);
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
    assert.equal(cli(w, ['memory', 'frob']).code, 2);
  } finally {
    w.done();
  }
});

test('memory: a local store with a history: status, sync, handoffs, notes from runs, the morning report', { skip: !hasGit && 'git is not installed' }, () => {
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
    // Notes a full-autonomy run left: listed, approved, gone from the list; another discarded.
    const run = (id: string) => {
      const notes = slash(join(w.root, 'runs-work', id, 'notes.md'));
      mkdirSync(join(w.root, 'runs-work', id), { recursive: true });
      writeFileSync(notes, `Notes of ${id}.\n`);
      mkdirSync(join(w.data, 'runs', id), { recursive: true });
      writeFileSync(
        join(w.data, 'runs', id, 'run.json'),
        JSON.stringify({
          v: 1,
          id,
          task: `Task ${id}`,
          status: 'done',
          phase: 'finish',
          createdAt: 1,
          updatedAt: Date.now(),
          aliveAt: 1,
          notesPath: notes,
          workDir: '',
          planPath: '',
          reportPath: '',
          milestones: [],
          deferred: [],
          blockers: [],
          refusals: [],
          history: [],
          budget: { weeklyTarget: 50, source: '50' },
          start: { commit: 'a', branch: 'main', ref: 'r', untracked: [] },
          cwd: '/x',
          sessionId: 's',
          project: null,
          plan: null,
          finish: null,
          pause: null,
        }),
      );
    };
    run('20261012-0800-a');
    run('20261012-0900-b');
    const pending = cli(w, ['memory', 'notes', '--json']);
    assert.equal(pending.json?.pending?.length, 2, pending.err + pending.out);
    assert.match(cli(w, ['memory']).out, /Notes\s+2 note file\(s\) from full-autonomy runs wait for you/);
    assert.match(cli(w, ['memory', 'notes']).out, /Notes of 20261012-0800-a\./);
    assert.equal(cli(w, ['memory', 'notes', 'approve', '20261012-0800-a']).code, 0);
    assert.equal(cli(w, ['memory', 'notes', 'discard', '20261012-0900']).code, 0, 'a unique start of the id is enough');
    assert.equal(cli(w, ['memory', 'notes', 'approve', 'nope']).code, 1);
    const decided = JSON.parse(readFileSync(join(w.data, 'state', 'notes.json'), 'utf8'));
    assert.deepEqual(
      [decided['20261012-0800-a'].decision, decided['20261012-0900-b'].decision, decided['20261012-0800-a'].delivered],
      ['approved', 'discarded', null],
    );
    assert.match(cli(w, ['memory', 'notes']).out, /No notes from full-autonomy runs wait for you\./);
    w.env.CLAUDECODE = '1';
    assert.equal(cli(w, ['memory', 'notes', 'approve', '20261012-0800-a']).code, 1, 'an agent cannot approve what enters the memory');
    delete w.env.CLAUDECODE;
    // The morning report over the last day.
    const m = cli(w, ['morning', '--json', '--hours', '24']);
    assert.equal(m.json?.schema, 'terminal-code.morning/1');
    assert.ok((m.json?.lines as { text: string }[]).some((l) => /Task 20261012-0800-a · done/.test(l.text)));
    const mt = cli(w, ['morning', '--hours', '24']).out;
    assert.match(mt, /While you were away · since/);
    assert.match(mt, /Handoffs\s+.*\(1\)/);
  } finally {
    w.done();
  }
});
