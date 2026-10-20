// SPDX-License-Identifier: Apache-2.0
/**
 * This computer's part of the shared place (core/sync-export.ts, docs/sync.md), over a file access held in
 * memory: what it writes into its own folder and only there, history copied with secrets masked and only
 * when it changed, the months kept, summaries of flows, the settings in effect read back from the
 * other computers' files, and the record of a sync.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, type Config } from '../../src/core/config.js';
import { layout } from '../../src/core/layout.js';
import { nextExport, sharedValues } from '../../src/core/sync.js';
import {
  exportMachine,
  mergeFromTexts,
  monthStart,
  newestShared,
  otherMachines,
  parseSharedRecord,
  settingsInEffect,
  syncDue,
  type SharedRecord,
  type SyncFs,
} from '../../src/core/sync-export.js';

/** Files in memory: path → text and modification time; folders are the paths' prefixes. */
function memoryFs(now = () => 1) {
  const files = new Map<string, { text: string; mtimeMs: number }>();
  const writes: string[] = [];
  const fs: SyncFs = {
    async read(p) {
      return files.get(p)?.text ?? null;
    },
    async write(p, text) {
      writes.push(p);
      files.set(p, { text, mtimeMs: now() });
    },
    async list(dir) {
      const out = new Map<string, { name: string; kind: 'file' | 'dir'; mtimeMs: number }>();
      for (const [p, f] of files) {
        if (!p.startsWith(dir + '/')) continue;
        const rest = p.slice(dir.length + 1);
        const name = rest.split('/')[0]!;
        out.set(name, rest.includes('/') ? { name, kind: 'dir', mtimeMs: 0 } : { name, kind: 'file', mtimeMs: f.mtimeMs });
      }
      return [...out.values()];
    },
  };
  return { fs, files, writes, put: (p: string, text: string, mtimeMs = 1) => files.set(p, { text, mtimeMs }) };
}

const NOW = Date.parse('2026-10-13T12:00:00Z');
const L = layout('/data');
const config = (raw: object = {}): Config => normalizeConfig({ sync: { place: 'folder', dir: '/s', machine: { id: 'pc-0000', name: 'PC' } }, ...raw }).config;
const input = (over: object = {}) => ({
  dir: '/s',
  machine: { id: 'pc-0000', name: 'PC' },
  platform: 'win32',
  app: '0.5.0',
  now: NOW,
  layout: L,
  local: config(),
  keepMonths: 3,
  ...over,
});
const key = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';

test('machine.json says where each project is kept, asking its repository again only when its folder moved or none was found', async () => {
  const m = memoryFs();
  const asked: string[] = [];
  const hint = async (path: string) => {
    asked.push(path);
    return path.endsWith('/3d') ? { remote: 'github.com/ada/arduino', sub: '3d' } : path.endsWith('/car') ? { remote: 'github.com/ada/car', sub: '' } : {};
  };
  const projects = [
    { id: 'araba', names: ['araba'], path: 'C:/dev/car' },
    { id: '3d', names: ['3d'], path: 'C:/dev/arduino/3d' },
    { id: 'notes', names: ['notes'], path: 'C:/notes' },
    { id: 'srv', names: ['srv'], path: '/srv' },
    { id: 'elsewhere', names: ['elsewhere'] },
  ];
  await exportMachine(m.fs, input({ local: config({ projects }), hint }));
  const info = () => JSON.parse(m.files.get('/s/machines/pc-0000/machine.json')!.text).projects;
  assert.deepEqual(info(), {
    araba: { folder: 'car', parent: 'dev', remote: 'github.com/ada/car', sub: '' },
    '3d': { folder: '3d', parent: 'arduino', remote: 'github.com/ada/arduino', sub: '3d' },
    notes: { folder: 'notes', parent: 'C:' },
    srv: { folder: 'srv', parent: '' },
  });
  assert.deepEqual(asked, ['C:/dev/car', 'C:/dev/arduino/3d', 'C:/notes', '/srv']);
  asked.length = 0;
  const moved = projects.map((p) => (p.id === 'araba' ? { ...p, path: 'C:/work/car' } : p));
  await exportMachine(m.fs, input({ now: NOW + 1000, local: config({ projects: moved }), hint }));
  assert.deepEqual(asked, ['C:/work/car', 'C:/notes', '/srv']);
  assert.equal(info().araba.parent, 'work');
});
const flowJson = (id: string, updatedAt: number) =>
  JSON.stringify({
    v: 1,
    id,
    variant: 'research',
    task: `Find out ${key}`,
    project: null,
    cwd: '/dev/app',
    createdAt: 1,
    updatedAt,
    status: 'waiting',
    current: 1,
    steps: [
      { kind: 'research', status: 'done', startedAt: 1, doneAt: 2 },
      { kind: 'plan', status: 'active', startedAt: 2, doneAt: null },
    ],
    sessionId: null,
    workDir: '/w',
    reportPath: '/w/r.md',
    planPath: '/w/p.md',
    approval: null,
    verification: [],
    history: [],
  });

test("this computer's files: who it is, its settings with their times, its history masked, its flows; nothing outside its folder", async () => {
  const m = memoryFs(() => 50);
  m.put('/data/events/2026-10/s1.mod.jsonl', `{"at":1,"kind":"belt","reasons":["${key}"]}\nnot json\n`, 10);
  m.put('/data/events/2026-06/old.mod.jsonl', '{"at":1}\n', 10);
  m.put('/data/events/notes/x.jsonl', '{"at":1}\n', 10);
  m.put('/data/events/2026-10/readme.txt', 'x', 10);
  m.put('/data/flows/20261013-0900-a/flow.json', flowJson('20261013-0900-a', NOW - 1000), 10);
  m.put('/data/flows/20260101-0900-old/flow.json', flowJson('20260101-0900-old', Date.parse('2026-01-01')), 10);
  m.put('/data/flows/20261013-0901-broken/flow.json', '{', 10);
  m.put('/data/flows/BAD ID/flow.json', flowJson('x', NOW), 10);
  // A run an older version left is not shared: this version has none.
  m.put('/data/runs/20261013-0900-r/run.json', '{"v":1}', 10);
  m.put('/s/machines/pc-0000/events/2026-05/gone.jsonl', '{"at":1}\n', 1);
  const r = await exportMachine(m.fs, input({ local: config({ footer: { mode: 'off' } }), firstStamp: (k: string) => (k === 'footer.mode' ? 7 : 0) }));
  assert.ok(
    m.writes.every((p) => p.startsWith('/s/machines/pc-0000/')),
    m.writes.join('\n'),
  );
  assert.deepEqual(r.stale, ['/s/machines/pc-0000/events/2026-05']);
  const info = JSON.parse(m.files.get('/s/machines/pc-0000/machine.json')!.text);
  assert.deepEqual(info, { v: 1, id: 'pc-0000', name: 'PC', platform: 'win32', app: '0.5.0', since: NOW, projects: {} });
  const settings = JSON.parse(m.files.get('/s/machines/pc-0000/settings.json')!.text);
  assert.deepEqual(settings.entries['footer.mode'], { value: 'off', at: 7 });
  const events = m.files.get('/s/machines/pc-0000/events/2026-10/s1.mod.jsonl')!.text;
  assert.ok(!events.includes(key) && !events.includes('not json'));
  assert.ok(!m.files.has('/s/machines/pc-0000/events/2026-06/old.mod.jsonl'), 'a month past those kept is not copied');
  assert.ok(!m.files.has('/s/machines/pc-0000/events/2026-10/readme.txt'));
  const summary = JSON.parse(m.files.get('/s/machines/pc-0000/flows/20261013-0900-a.json')!.text);
  assert.deepEqual([summary.status, summary.step, summary.task.includes(key)], ['waiting', 'plan', false]);
  assert.ok(!m.files.has('/s/machines/pc-0000/flows/20260101-0900-old.json'), 'a flow last changed before the months kept is left out');
  assert.equal([...m.files.keys()].filter((p) => p.includes('/flows/') && p.startsWith('/s/')).length, 1);
  assert.ok(![...m.files.keys()].some((p) => p.includes('/runs/') && p.startsWith('/s/')));

  // Again with nothing new: nothing written; who it is keeps the time it was set up. A kept month, or a file, is not stale.
  m.put('/s/machines/pc-0000/events/readme.txt', 'x');
  m.writes.length = 0;
  const again = await exportMachine(m.fs, input({ now: NOW + 5000, local: config({ footer: { mode: 'off' } }) }));
  assert.deepEqual([again.written, m.writes, again.stale], [[], [], ['/s/machines/pc-0000/events/2026-05']]);
  // A changed history file is copied again; a setting changed here gets the time it was first seen.
  m.put('/data/events/2026-10/s1.mod.jsonl', '{"at":2,"kind":"keyword"}\n', 100);
  const third = await exportMachine(m.fs, input({ now: NOW + 9000, local: config({ footer: { mode: 'draw' } }), app: '0.5.1' }));
  assert.deepEqual(third.written.sort(), [
    '/s/machines/pc-0000/events/2026-10/s1.mod.jsonl',
    '/s/machines/pc-0000/machine.json',
    '/s/machines/pc-0000/settings.json',
  ]);
  assert.equal(JSON.parse(m.files.get('/s/machines/pc-0000/machine.json')!.text).since, NOW);
  assert.deepEqual(JSON.parse(m.files.get('/s/machines/pc-0000/settings.json')!.text).entries['footer.mode'], { value: 'draw', at: NOW + 9000 });
});

test('flows are summarized too; a copy as new as its source is left alone', async () => {
  const m = memoryFs(() => 500);
  m.put('/data/flows/20261013-0900-f/flow.json', flowJson('20261013-0900-f', NOW), 10);
  m.put('/data/events/2026-10/a.mod.jsonl', '{"at":1}\n', 10);
  m.put('/s/machines/pc-0000/events/2026-10/a.mod.jsonl', 'older copy\n', 20);
  m.put('/data/events/2026-10/b.mod.jsonl', '{"at":2}\n', 30);
  m.put('/s/machines/pc-0000/events/2026-10/b.mod.jsonl', 'copied at the same moment\n', 30);
  // A flow last changed right at the start of the oldest month kept is still in.
  m.put('/data/flows/20260801-0000-edge/flow.json', flowJson('20260801-0000-edge', monthStart(NOW, 3)), 10);
  const r = await exportMachine(m.fs, input());
  assert.ok(r.written.includes('/s/machines/pc-0000/flows/20261013-0900-f.json'));
  assert.equal(m.files.get('/s/machines/pc-0000/events/2026-10/a.mod.jsonl')!.text, 'older copy\n', 'its copy is newer than the source');
  assert.equal(m.files.get('/s/machines/pc-0000/events/2026-10/b.mod.jsonl')!.text, 'copied at the same moment\n', 'as new as its source');
  assert.ok(r.written.includes('/s/machines/pc-0000/flows/20260801-0000-edge.json'));
  assert.equal(JSON.parse(m.files.get('/s/machines/pc-0000/flows/20261013-0900-f.json')!.text).step, 'plan');
});

test("the settings in effect, read from the shared place: the others' newer changes; a file under another computer's name is not taken", async () => {
  const local = config();
  const m = memoryFs();
  m.put('/s/machines/pc-0000/settings.json', JSON.stringify(nextExport(null, sharedValues(local), 'pc-0000', 0)));
  const mac = nextExport(null, sharedValues(config({ view: 'simple' })), 'mac-0000', 0, (k) => (k === 'view' ? 900 : 0));
  m.put('/s/machines/mac-0000/settings.json', JSON.stringify(mac));
  m.put('/s/machines/copied-0000/settings.json', JSON.stringify({ ...mac, entries: { ...mac.entries, language: { value: 'tr', at: 990 } } }));
  m.put('/s/machines/Bad Name/settings.json', JSON.stringify(mac));
  assert.deepEqual(await otherMachines(m.fs, '/s', 'pc-0000'), ['copied-0000', 'mac-0000']);
  const merged = await settingsInEffect(m.fs, local, '/data/state/sync-ignored.json');
  assert.equal(merged.config.view, 'simple');
  assert.equal(merged.config.language, 'auto', 'the file in copied-0000 names mac-0000');
  // Without a sync, its own; a shared place that cannot be read, its own.
  const none = normalizeConfig({}).config;
  assert.equal((await settingsInEffect(m.fs, none, '/x')).config, none);
  const broken: SyncFs = { ...m.fs, list: async () => Promise.reject(new Error('gone')) };
  assert.equal((await settingsInEffect(broken, local, '/x')).config, local);
  assert.equal(mergeFromTexts(local, null, [{ id: 'mac-0000', text: 'not json' }], 'nor this').config, local);
});

test("the record of a sync, the newest of the writers', when the next one is due; the oldest month kept", () => {
  const rec: SharedRecord = { at: 5, trigger: 'turn', session: 's', written: 2, result: null, error: null };
  assert.deepEqual(parseSharedRecord(JSON.stringify(rec)), rec);
  const withGit = parseSharedRecord(
    JSON.stringify({ ...rec, result: { repo: true, commit: 'ok', pull: 'ok', push: 'ok', committed: 1, held: [], conflicts: [], pulled: [], detail: '' } }),
  );
  assert.equal(withGit?.result?.push, 'ok');
  const loose = parseSharedRecord(JSON.stringify({ at: 1, trigger: 'odd', session: 3, written: 'x', error: 4 }))!;
  assert.deepEqual([loose.trigger, loose.session, loose.written, loose.error, loose.result], ['manual', null, 0, null, null]);
  for (const t of [null, '', 'x', '{}', '{"at":"1"}', '{"at":1,"result":{"commit":"ok"}}']) assert.equal(parseSharedRecord(t), null, String(t));
  for (const trigger of ['start', 'turn', 'end', 'manual', 'setup']) assert.equal(parseSharedRecord(JSON.stringify({ ...rec, trigger }))?.trigger, trigger);
  const a: SharedRecord = { ...rec, at: 10 };
  const b: SharedRecord = { ...rec, at: 20 };
  assert.equal(newestShared([a, null, b])?.at, 20);
  assert.equal(newestShared([null]), null);
  assert.equal(
    newestShared([
      { ...a, trigger: 'start' },
      { ...a, trigger: 'end' },
    ])?.trigger,
    'start',
    'the first of equals stays',
  );
  assert.equal(syncDue([], 0, 30), true);
  assert.equal(syncDue([a], 10 + 30 * 60_000 - 1, 30), false);
  assert.equal(syncDue([a], 10 + 30 * 60_000, 30), true);
  assert.equal(monthStart(NOW, 3), Date.parse('2026-08-01T00:00:00Z'));
  assert.equal(monthStart(Date.parse('2026-02-10T00:00:00Z'), 3), Date.parse('2025-12-01T00:00:00Z'));
});
