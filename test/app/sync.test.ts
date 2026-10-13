// SPDX-License-Identifier: Apache-2.0
/**
 * Sync as the command line and the control center read it (app/sync.ts, docs/sync.md): the computers in
 * the shared place and when each was last seen, where handoff notes go, projects without a folder here,
 * and what the other computers did for the morning report.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { elsewhereFacts, lastEventAt, syncView } from '../../src/app/sync.js';
import type { AppContext } from '../../src/app/context.js';
import { normalizeConfig } from '../../src/core/config.js';
import { layout } from '../../src/core/layout.js';
import { nextExport, sharedValues } from '../../src/core/sync.js';

const NOW = Date.parse('2026-10-13T12:00:00Z');

function setup(raw: object = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tc-appsync-')).replace(/\\/g, '/');
  const shared = `${root}/shared`;
  const l = layout(`${root}/data`);
  mkdirSync(l.stateDir, { recursive: true });
  const config = normalizeConfig({ sync: { place: 'folder', dir: shared, machine: { id: 'pc-0000', name: 'PC' } }, ...raw }).config;
  const ctx: AppContext = { layout: l, config, problems: [], lang: 'en', cwd: root, local: config, pending: [] };
  const mac = `${shared}/machines/mac-0000`;
  mkdirSync(`${mac}/events/2026-10`, { recursive: true });
  mkdirSync(`${mac}/events/2026-09`, { recursive: true });
  mkdirSync(`${mac}/runs`, { recursive: true });
  mkdirSync(`${mac}/flows`, { recursive: true });
  writeFileSync(`${mac}/machine.json`, JSON.stringify({ id: 'mac-0000', name: 'MacBook', platform: 'darwin', app: 'x', since: 1 }));
  return { root, shared, mac, l, ctx, done: () => rmSync(root, { recursive: true, force: true }) };
}

const ev = (at: number, extra: object = {}) => JSON.stringify({ v: 1, at, kind: 'keyword', session: 'm1', ...extra });

test('the computers and when each was last seen; where handoff notes go; projects without a folder here', () => {
  const s = setup({ projects: [{ id: 'app', names: ['app'], path: '/dev/app' }] });
  try {
    writeFileSync(`${s.mac}/events/2026-10/a.mod.jsonl`, `${ev(NOW - 5000)}\n${ev(NOW - 1000)}\n{torn\n`);
    writeFileSync(`${s.mac}/events/2026-10/b.mod.jsonl`, `${ev(NOW - 3000)}\n`);
    writeFileSync(`${s.mac}/events/2026-09/c.mod.jsonl`, `${ev(NOW - 100)}\n`);
    assert.equal(lastEventAt(`${s.mac}/events`), NOW - 1000, 'the newest month that has any, its newest line');
    assert.equal(lastEventAt(`${s.root}/nowhere`), null);
    // The Mac sent a project this computer does not have, and a newer view.
    const mac = normalizeConfig({ view: 'simple', projects: [{ id: 'car', names: ['car'] }] }).config;
    writeFileSync(
      `${s.mac}/settings.json`,
      JSON.stringify(nextExport(null, sharedValues(mac), 'mac-0000', 0, (k) => (k === 'view' || k === 'projects.car' ? 9 : 0))),
    );
    // This computer's own file, as its first sync wrote it (its defaults claim nothing).
    mkdirSync(`${s.shared}/machines/pc-0000`, { recursive: true });
    writeFileSync(`${s.shared}/machines/pc-0000/settings.json`, JSON.stringify(nextExport(null, sharedValues(s.ctx.config), 'pc-0000', 0)));
    const v = syncView(s.ctx);
    assert.deepEqual(
      v.machines.map((m) => [m.id, m.name, m.self, m.lastSeen]),
      [
        ['pc-0000', 'PC', true, null],
        ['mac-0000', 'MacBook', false, NOW - 1000],
      ],
    );
    assert.deepEqual(v.homeless, ['car']);
    assert.deepEqual(v.applied.map((a) => a.key).sort(), ['projects.car', 'view']);
    assert.deepEqual([v.handoffs, v.exists], ['shared', true]);
    const off = setup({ sync: { place: 'folder', dir: '/nowhere', machine: { id: 'pc-0000', name: 'PC' }, handoffs: false } });
    assert.deepEqual([syncView(off.ctx).handoffs, syncView(off.ctx).exists], ['local', false]);
    off.done();
    const memory = setup({ memory: { store: { place: 'local', dir: '/m' } } });
    assert.equal(syncView(memory.ctx).handoffs, 'memory');
    memory.done();
    const none: AppContext = { ...s.ctx, config: normalizeConfig({}).config, local: normalizeConfig({}).config };
    assert.deepEqual(syncView(none).machines, []);
  } finally {
    s.done();
  }
});

test('what the other computers did in a window: runs that ended or paused, flows waiting, sessions, what the belt stopped', () => {
  const s = setup();
  try {
    const run = (id: string, status: string, updatedAt: number) =>
      writeFileSync(
        `${s.mac}/runs/${id}.json`,
        JSON.stringify({
          id,
          task: `Task ${id}`,
          project: 'app',
          folder: 'app',
          status,
          phase: 'finish',
          reason: status === 'paused' ? 'quota' : null,
          createdAt: 1,
          updatedAt,
          milestones: 1,
          deferred: 2,
        }),
      );
    run('r1', 'done', NOW - 3_600_000);
    run('r2', 'paused', NOW - 1_800_000);
    run('r3', 'active', NOW - 1000);
    run('r4', 'done', NOW - 48 * 3_600_000);
    writeFileSync(`${s.mac}/flows/f1.json`, JSON.stringify({ id: 'f1', task: 'Plan', project: null, status: 'waiting', step: 'approval', updatedAt: NOW }));
    writeFileSync(`${s.mac}/flows/f2.json`, JSON.stringify({ id: 'f2', task: 'Done', project: null, status: 'done', step: null, updatedAt: NOW }));
    writeFileSync(`${s.mac}/runs/broken.json`, '{');
    writeFileSync(
      `${s.mac}/events/2026-10/m.mod.jsonl`,
      [
        ev(NOW - 7200_000, { session: 'm1' }),
        ev(NOW - 3600_000, { session: 'm2', kind: 'belt', verdict: 'deny' }),
        ev(NOW - 50 * 3_600_000, { session: 'old' }),
      ].join('\n') + '\n',
    );
    const e = elsewhereFacts(s.ctx, NOW - 10 * 3_600_000, NOW);
    assert.deepEqual(e, [
      {
        machine: 'MacBook',
        runs: [
          { id: 'r1', task: 'Task r1', status: 'done', reason: null, report: null, deferred: 2 },
          { id: 'r2', task: 'Task r2', status: 'paused', reason: 'quota', report: null, deferred: 2 },
        ],
        flows: 1,
        sessions: 2,
        blocked: 1,
      },
    ]);
    // A window with nothing from it: the computer is left out.
    rmSync(`${s.mac}/flows`, { recursive: true });
    assert.deepEqual(elsewhereFacts(s.ctx, NOW - 100 * 3_600_000, NOW - 90 * 3_600_000), []);
    assert.deepEqual(elsewhereFacts({ ...s.ctx, local: normalizeConfig({}).config, config: normalizeConfig({}).config }, 0, NOW), []);
  } finally {
    s.done();
  }
});
