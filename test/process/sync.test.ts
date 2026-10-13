// SPDX-License-Identifier: Apache-2.0
/**
 * `terminal-code sync` as separate processes (docs/sync.md): before a setup, a folder another service keeps
 * in sync shared by two computers' data folders, a setting from the other computer that lowers a protection
 * approved or ignored (never under an agent), a project's folder given here, and the --json contracts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextExport, sharedValues } from '../../src/core/sync.js';
import { normalizeConfig } from '../../src/core/config.js';
import { cli, world } from '../helpers/proc.js';

const slash = (p: string) => p.replace(/\\/g, '/');

test('sync: before a setup; the setup refused without a terminal or under an agent; now and approve say there is nothing', () => {
  const w = world();
  try {
    const s = cli(w, ['sync', '--json']);
    assert.equal(s.code, 0, s.err);
    assert.equal(s.json?.schema, 'terminal-code.sync/1');
    assert.deepEqual([s.json?.setting, s.json?.machines, s.json?.pending], [null, [], []]);
    assert.match(cli(w, ['sync']).out, /Sync · not set up[\s\S]*terminal-code sync setup/);
    assert.equal(cli(w, ['sync', 'setup']).code, 2);
    w.env.CLAUDECODE = '1';
    assert.equal(cli(w, ['sync', 'setup']).code, 1);
    assert.equal(cli(w, ['sync', 'approve', '--all']).code, 1);
    assert.equal(cli(w, ['sync', 'project', 'app']).code, 1);
    delete w.env.CLAUDECODE;
    const now = cli(w, ['sync', 'now', '--json']);
    assert.deepEqual([now.code, now.json?.ok, now.json?.reason], [1, false, 'not-set-up']);
    assert.equal(cli(w, ['sync', 'frob']).code, 2);
  } finally {
    w.done();
  }
});

test('sync through a folder: the other computer seen, its newer setting in effect, its lowered protection waiting until approved or ignored; a project given its folder here', () => {
  const w = world();
  try {
    const shared = slash(join(w.root, 'iCloud', 'tc'));
    mkdirSync(w.data, { recursive: true });
    writeFileSync(
      join(w.data, 'config.json'),
      JSON.stringify({ language: 'en', sync: { place: 'folder', dir: shared, machine: { id: 'pc-0000', name: 'PC' } } }),
    );
    // The Mac sent its settings: a newer view, a softer belt rule, a project this computer does not have yet.
    const mac = normalizeConfig({
      view: 'simple',
      belt: { verdicts: { 'git.clean': 'warn' } },
      projects: [{ id: 'car', names: ['car'], path: '/Users/ada/dev/car' }],
    }).config;
    const file = nextExport(null, sharedValues(mac), 'mac-0000', 0, (k) => (['view', 'belt.verdicts', 'projects.car'].includes(k) ? Date.now() - 60_000 : 0));
    mkdirSync(join(shared, 'machines', 'mac-0000', 'events', '2026-10'), { recursive: true });
    writeFileSync(join(shared, 'machines', 'mac-0000', 'settings.json'), JSON.stringify(file));
    writeFileSync(
      join(shared, 'machines', 'mac-0000', 'machine.json'),
      JSON.stringify({ id: 'mac-0000', name: 'MacBook', platform: 'darwin', app: '0.5.0', since: 1 }),
    );
    writeFileSync(
      join(shared, 'machines', 'mac-0000', 'events', '2026-10', 's.mod.jsonl'),
      `${JSON.stringify({ at: Date.now() - 3_600_000, kind: 'keyword' })}\n`,
    );

    const first = cli(w, ['sync', 'now', '--json']);
    assert.equal(first.code, 0, first.err + first.out);
    assert.ok((first.json?.record as { written: number }).written >= 2);
    const status = cli(w, ['sync', '--json']);
    const machines = status.json?.machines as { id: string; name: string; self: boolean; lastSeen: number | null }[];
    assert.deepEqual(
      machines.map((m) => [m.id, m.self]),
      [
        ['pc-0000', true],
        ['mac-0000', false],
      ],
    );
    assert.ok(machines[1]!.lastSeen && machines[1]!.lastSeen > 0);
    assert.deepEqual(
      (status.json?.pending as { key: string }[]).map((p) => p.key),
      ['belt.verdicts'],
    );
    assert.deepEqual(status.json?.homeless, ['car']);
    assert.equal(cli(w, ['config', 'get', 'view']).out.trim(), 'simple', 'the newer setting is in effect here');
    const text = cli(w, ['sync']).out;
    assert.match(text, /Sync · a folder another service keeps in sync/);
    assert.match(text, /Others\s+MacBook · darwin · last seen/);
    assert.match(text, /Waiting\s+belt\.verdicts: from MacBook/);
    assert.match(text, /car: no folder on this computer/);
    // Nothing is taken without its name (or --all); an unknown name is refused.
    assert.equal(cli(w, ['sync', 'approve']).code, 2);
    assert.equal(cli(w, ['sync', 'approve', 'footer.mode']).code, 1);
    // Ignored: kept here until the Mac changes it again.
    const ignored = cli(w, ['sync', 'ignore', 'belt.verdicts', '--json']);
    assert.deepEqual(ignored.json?.done, ['belt.verdicts']);
    assert.deepEqual(cli(w, ['sync', '--json']).json?.pending, []);
    assert.ok(JSON.parse(readFileSync(join(w.data, 'state', 'sync-ignored.json'), 'utf8'))['belt.verdicts'] > 0);
    // The Mac changes it again: it waits again; approved, it is this computer's setting too.
    file.entries['belt.verdicts'] = { value: { 'git.clean': 'warn' }, at: Date.now() };
    writeFileSync(join(shared, 'machines', 'mac-0000', 'settings.json'), JSON.stringify(file));
    assert.equal((cli(w, ['sync', '--json']).json?.pending as unknown[]).length, 1);
    const approved = cli(w, ['sync', 'approve', 'belt.verdicts']);
    assert.equal(approved.code, 0, approved.err);
    assert.match(approved.out, /Taken here: belt\.verdicts/);
    assert.deepEqual(JSON.parse(readFileSync(join(w.data, 'config.json'), 'utf8')).belt.verdicts, { 'git.clean': 'warn' });
    // The Mac's project gets its folder on this computer.
    const here = slash(join(w.root, 'dev', 'car'));
    mkdirSync(here, { recursive: true });
    assert.equal(cli(w, ['sync', 'project', 'car', here]).code, 0);
    assert.equal(cli(w, ['sync', 'project', 'nope', here]).code, 1);
    assert.equal(cli(w, ['sync', 'project', 'car', join(here, 'missing')]).code, 1);
    const saved = JSON.parse(readFileSync(join(w.data, 'config.json'), 'utf8')).projects;
    assert.deepEqual(saved, [{ id: 'car', names: ['car'], path: here }]);
    assert.deepEqual(cli(w, ['sync', '--json']).json?.homeless, []);
  } finally {
    w.done();
  }
});
