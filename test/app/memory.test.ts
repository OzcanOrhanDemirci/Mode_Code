// SPDX-License-Identifier: Apache-2.0
/**
 * The memory as the command line and the control center read it (app/memory.ts): handoff notes of every
 * project newest first, the morning report's window and facts, where the memory lives.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allHandoffs, handoffsSince, memoryView, morningFacts, morningWindow, recentMorning } from '../../src/app/memory.js';
import { cloneDefaults, setConfigValue } from '../../src/core/config.js';
import { layout } from '../../src/core/layout.js';
import type { AppContext } from '../../src/app/context.js';

const NOW = Date.parse('2026-10-13T08:00:00Z');
const note = (project: string, at: string, next: string) =>
  `---\ntype: handoff\nproject: ${project}\nmachine: mac\nsession: s\nat: ${at}\ntrigger: compact\n---\n\n## Next\n\n${next}\n`;

function setup(store = true) {
  const root = mkdtempSync(join(tmpdir(), 'tc-appmem-')).replace(/\\/g, '/');
  const l = layout(`${root}/data`);
  mkdirSync(l.stateDir, { recursive: true });
  let config = cloneDefaults();
  if (store) config = setConfigValue(config, 'memory.store', { place: 'local', dir: `${root}/mem`, git: false }).config;
  const handoffs = store ? `${root}/mem/handoffs` : l.handoffsDir;
  for (const [p, name, at, next] of [
    ['app', '20261012-080000-a.md', '2026-10-12T08:00:00Z', 'Older.'],
    ['app', '20261013-070000-b.md', '2026-10-13T07:00:00Z', 'Newest in app.'],
    ['car', '20261012-120000-c.md', '2026-10-12T12:00:00Z', 'In car.'],
  ] as const) {
    mkdirSync(`${handoffs}/${p}`, { recursive: true });
    writeFileSync(`${handoffs}/${p}/${name}`, note(p, at, next));
  }
  writeFileSync(`${handoffs}/app/README.md`, '# not a note');
  writeFileSync(`${handoffs}/app/20261011-000000-x.md`, 'not a handoff at all');
  const ctx: AppContext = { layout: l, config, problems: [], lang: 'en', cwd: root };
  return { root, l, ctx, done: () => rmSync(root, { recursive: true, force: true }) };
}

test('handoff notes of every project, newest first; files that are not notes are left out', () => {
  const s = setup();
  try {
    const all = allHandoffs(s.ctx);
    assert.deepEqual(
      all.map((h) => [h.project, h.next]),
      [
        ['app', 'Newest in app.'],
        ['car', 'In car.'],
        ['app', 'Older.'],
      ],
    );
    assert.equal(all[0]!.trigger, 'compact');
    assert.equal(allHandoffs(s.ctx, 1).length, 1);
    assert.deepEqual(
      handoffsSince(s.ctx, Date.parse('2026-10-12T10:00:00Z')).map((h) => h.project),
      ['car', 'app'],
    );
  } finally {
    s.done();
  }
  // Without a store the notes are in terminal-code's own folder.
  const n = setup(false);
  try {
    assert.equal(allHandoffs(n.ctx).length, 3);
  } finally {
    n.done();
  }
  const empty = setup();
  try {
    rmSync(`${empty.root}/mem`, { recursive: true, force: true });
    assert.deepEqual(allHandoffs(empty.ctx), []);
    assert.deepEqual(handoffsSince(empty.ctx, 0), []);
  } finally {
    empty.done();
  }
});

test("the morning report's window: the last gap while it is recent, else the last hours asked for", () => {
  const s = setup();
  try {
    assert.deepEqual(morningWindow(s.ctx, NOW, 24), { since: NOW - 24 * 3_600_000, until: NOW });
    assert.equal(recentMorning(s.ctx, NOW, { index: false }), null);
    writeFileSync(s.l.activity, JSON.stringify({ lastPromptAt: NOW - 60_000, away: { from: NOW - 10 * 3_600_000, to: NOW - 60_000 } }));
    assert.deepEqual(morningWindow(s.ctx, NOW), { since: NOW - 10 * 3_600_000, until: NOW });
    const m = recentMorning(s.ctx, NOW, { index: false })!;
    assert.equal(m.since, NOW - 10 * 3_600_000);
    assert.deepEqual(
      m.facts.handoffs.map((h) => h.project),
      ['app'],
      'only what was written since the gap began',
    );
    // A gap that ended long ago is not reported again.
    assert.equal(recentMorning(s.ctx, NOW + 13 * 3_600_000, { index: false }), null);
    assert.deepEqual(morningWindow(s.ctx, NOW + 25 * 3_600_000, 6), { since: NOW + 19 * 3_600_000, until: NOW + 25 * 3_600_000 });
  } finally {
    s.done();
  }
});

test('the facts: the store without git has no local state; Claude Code using another folder is said', () => {
  const s = setup();
  try {
    mkdirSync(`${s.root}/claude`);
    writeFileSync(`${s.root}/claude/settings.json`, JSON.stringify({ autoMemoryDirectory: `${s.root}/elsewhere` }));
    process.env.CLAUDE_CONFIG_DIR = `${s.root}/claude`;
    const v = memoryView(s.ctx, s.root);
    assert.deepEqual([v.store?.place, v.inUse, v.local?.isRepo, v.pendingNotes], ['local', false, false, 0]);
    writeFileSync(`${s.root}/claude/settings.json`, JSON.stringify({ autoMemoryDirectory: `${s.root}/mem` }));
    assert.equal(memoryView(s.ctx, s.root).inUse, true);
    const f = morningFacts(s.ctx, NOW - 3_600_000, NOW, { index: false });
    assert.deepEqual([f.memory?.place, f.memory?.conflicts, f.belt, f.quota, f.notes], ['local', [], { blocked: 0, asked: 0 }, null, 0]);
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    s.done();
  }
});
