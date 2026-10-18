// SPDX-License-Identifier: Apache-2.0
/**
 * Sync across computers, its pure parts (core/sync.ts, docs/sync.md): which settings the computers share,
 * the times each computer sends with them, how they meet (the newest change wins, a change made here and
 * not sent wins at once), what lowers a protection and waits for the person, and the summaries of history.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneDefaults, normalizeConfig, type Config } from '../../src/core/config.js';
import {
  applyShared,
  changedFromDefaults,
  differences,
  syncCommitMessage,
  flowSummary,
  lowersProtection,
  machineId,
  machineName,
  matchProjects,
  remoteKey,
  machinePaths,
  maskedEvents,
  mergeSettings,
  monthIndex,
  monthKept,
  nextExport,
  parseFlowSummary,
  parseIgnored,
  parseMachineInfo,
  parseMachineSettings,
  parseRunSummary,
  runSummary,
  sharedValues,
  stableJson,
  syncReadme,
  type MachineSettings,
} from '../../src/core/sync.js';

const config = (raw: object = {}): Config => {
  const r = normalizeConfig(raw);
  assert.deepEqual(r.problems, []);
  return r.config;
};
/** A computer's file, every shared key at `at` unless given. */
const sent = (machine: string, c: Config, at = 0, over: Record<string, number> = {}): MachineSettings =>
  nextExport(null, sharedValues(c), machine, 0, (k) => over[k] ?? at);

test('the sync setting: a place, a folder, this computer; github needs a remote; the rest in range', () => {
  const ok = normalizeConfig({
    sync: { place: 'github', dir: ' /s ', remote: 'https://github.com/ada/tc-sync.git', repo: 'ada/tc-sync', machine: { id: 'pc-1a2b', name: ' PC ' } },
  });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.config.sync, {
    place: 'github',
    dir: '/s',
    remote: 'https://github.com/ada/tc-sync.git',
    repo: 'ada/tc-sync',
    machine: { id: 'pc-1a2b', name: 'PC' },
    everyMinutes: 30,
    keepMonths: 3,
    handoffs: true,
  });
  const folder = normalizeConfig({
    sync: {
      place: 'folder',
      dir: '/s',
      remote: 'x',
      repo: 'ada/x',
      machine: { id: 'mac-0000', name: 'Mac' },
      everyMinutes: 5,
      keepMonths: 24,
      handoffs: false,
    },
  });
  assert.deepEqual(
    [folder.config.sync?.remote, folder.config.sync?.repo, folder.config.sync?.everyMinutes, folder.config.sync?.keepMonths, folder.config.sync?.handoffs],
    [null, null, 5, 24, false],
  );
  for (const [raw, path] of [
    ['x', 'sync'],
    [{ place: 'cloud', dir: '/s', machine: { id: 'a-0000', name: 'a' } }, 'sync.place'],
    [{ place: 'folder', dir: '', machine: { id: 'a-0000', name: 'a' } }, 'sync.dir'],
    [{ place: 'folder', dir: '/s', machine: { id: 'A B', name: 'a' } }, 'sync.machine'],
    [{ place: 'folder', dir: '/s', machine: { id: 'a-0000', name: '' } }, 'sync.machine'],
    [{ place: 'folder', dir: '/s', machine: { id: 'a-0000', name: 'x'.repeat(61) } }, 'sync.machine'],
    [{ place: 'folder', dir: '/s', machine: { id: 'a-0000', name: '  ' } }, 'sync.machine'],
    [{ place: 'folder', dir: '/s' }, 'sync.machine'],
    [{ place: 'github', dir: '/s', machine: { id: 'a-0000', name: 'a' } }, 'sync.remote'],
  ] as const) {
    const r = normalizeConfig({ sync: raw });
    assert.equal(r.config.sync, null, path);
    assert.deepEqual(
      r.problems.map((p) => p.path),
      [path],
    );
  }
  const loose = normalizeConfig({
    sync: { place: 'folder', dir: '/s', machine: { id: 'a-0000', name: 'a' }, everyMinutes: 4, keepMonths: 25, handoffs: 1, repo: 'bad repo', extra: 1 },
  });
  assert.deepEqual(loose.problems.map((p) => p.path).sort(), ['sync.everyMinutes', 'sync.extra', 'sync.handoffs', 'sync.keepMonths', 'sync.repo']);
  assert.deepEqual([loose.config.sync?.everyMinutes, loose.config.sync?.keepMonths, loose.config.sync?.handoffs], [30, 3, true]);
  assert.equal(normalizeConfig({ sync: null }).problems.length, 0);
  assert.equal(normalizeConfig({ sync: { place: 'folder', dir: '/s', machine: { id: 'a-0000', name: 'x'.repeat(60) } } }).config.sync?.machine.name.length, 60);
});

test("a computer's id: its name in plain letters and four hex digits; where its files are", () => {
  assert.equal(machineId('Özcan’s İş Bilgisayarı', 'A1B2'), 'ozcan-s-is-bilgisayari-a1b2');
  assert.equal(machineId('MacBook-Pro.local', 'ff'), 'macbook-pro-local-ff00');
});

test('a remote is a place: one form for every way of writing it, never a user or a token', () => {
  for (const url of [
    'https://github.com/Ada/Car.git',
    'https://ada:' + 'tok' + '@github.com/ada/car',
    'ssh://git@github.com/ada/car.git/',
    'git@github.com:ada/car.git',
    'github.com:ada/car',
  ])
    assert.equal(remoteKey(url), 'github.com/ada/car', url);
  assert.equal(remoteKey('https://gitlab.example.com:8443/group/sub/repo.git'), 'gitlab.example.com/group/sub/repo');
  // A host alias from ~/.ssh/config can be two letters; one letter is a Windows drive.
  assert.equal(remoteKey('gh:ada/car'), 'gh/ada/car');
  for (const notRemote of ['C:/dev/car', 'C:\\dev\\car', '/home/ada/car', '../car', 'file:///home/ada/car', '', 'https://github.com/', 'nonsense://'])
    assert.equal(remoteKey(notRemote), null, notRemote);
});

test('projects from the other computers find their folders here: same repository, then folder name, then their own name', () => {
  const hints: Record<string, { folder: string; parent: string; remote?: string; sub?: string }>[] = [
    {
      araba: { folder: 'car', parent: 'dev', remote: 'github.com/ada/car', sub: '' },
      '3d': { folder: '3d', parent: 'arduino', remote: 'github.com/ada/arduino', sub: '3d' },
      hava: { folder: 'weather_app', parent: 'dev' },
      'ezan-vakti': { folder: 'ezan_vakti', parent: 'dev' },
      twin: { folder: 'twin', parent: 'dev' },
      gone: { folder: 'gone', parent: 'dev', remote: 'github.com/ada/gone', sub: '' },
    },
    { 'ezan-vakti': { folder: 'EzanVakti', parent: 'Projects' } },
  ];
  const folders = [
    { path: '/Users/ada/dev/car-mac', name: 'car-mac', remote: 'github.com/ada/car' },
    { path: '/Users/ada/dev/arduino', name: 'arduino', remote: 'github.com/ada/arduino' },
    { path: '/Users/ada/dev/Weather_App', name: 'Weather_App', remote: null },
    { path: '/Users/ada/dev/ezan_vakti', name: 'ezan_vakti', remote: null },
    { path: '/Users/ada/dev/twin', name: 'twin', remote: null },
    { path: '/Users/ada/Projects/twin', name: 'twin', remote: null },
    { path: '/Users/ada/dev/Chefol', name: 'Chefol', remote: null },
    { path: '/Users/ada/dev/linked', name: 'linked', remote: null },
  ];
  const homeless = ['araba', '3d', 'hava', 'ezan-vakti', 'twin', 'gone', 'chefol', 'linked', 'nowhere'].map((id) => ({
    id,
    names: id === 'hava' ? ['hava', 'weather'] : [id],
  }));
  assert.deepEqual(matchProjects(homeless, hints, folders, ['/users/ada/dev/linked'], 'darwin'), [
    { id: 'araba', path: '/Users/ada/dev/car-mac', by: 'remote' },
    { id: '3d', path: '/Users/ada/dev/arduino/3d', by: 'remote' },
    { id: 'hava', path: '/Users/ada/dev/Weather_App', by: 'folder' },
    { id: 'ezan-vakti', path: '/Users/ada/dev/ezan_vakti', by: 'folder' },
    { id: 'chefol', path: '/Users/ada/dev/Chefol', by: 'name' },
  ]);
  // Two projects that would share one folder get neither; on Linux case tells folders apart.
  const shared = [{ x: { folder: 'app', parent: 'dev' }, y: { folder: 'App', parent: 'dev' } }];
  const one = [{ path: '/home/ada/dev/app', name: 'app', remote: null }];
  assert.deepEqual(
    matchProjects(
      [
        { id: 'x', names: [] },
        { id: 'y', names: [] },
      ],
      shared,
      one,
      [],
      'linux',
    ),
    [],
  );
  assert.deepEqual(matchProjects([{ id: 'x', names: [] }], [], one, ['/home/ada/dev/App'], 'linux'), []);
  assert.deepEqual(matchProjects([{ id: 'app', names: [] }], [], one, ['/home/ada/dev/App'], 'linux'), [{ id: 'app', path: '/home/ada/dev/app', by: 'name' }]);
});

test('the name offered for a computer: its first real name, never a network address', () => {
  // The Mac of 2026-10-15: a network that names it made its host name 192.168.1.9.
  assert.equal(machineName(['Özcan’s MacBook Air\n', 'Ozcans-MacBook-Air', '192.168.1.9'], 'darwin'), 'Özcan’s MacBook Air');
  assert.equal(machineName([null, '', '192.168.1.9', '192-168-1-9.local', 'fe80::1', '::1'], 'darwin'), 'Mac');
  assert.equal(machineName([null, null, 'OzcanOrhanMSI', 'OZCANORHANMSI'], 'win32'), 'OzcanOrhanMSI');
  assert.equal(machineName([undefined, 'MacBook-Pro.local'], 'darwin'), 'MacBook-Pro');
  assert.equal(machineName(['ip-172-31-5-9', '10.0.0.1'], 'linux'), 'ip-172-31-5-9');
  assert.equal(machineName([], 'linux'), 'Linux');
  assert.equal(machineName([], 'win32'), 'Windows');
  assert.equal(machineId('???', '12345'), 'computer-1234');
  assert.equal(machineId('x'.repeat(60), 'zz12'), `${'x'.repeat(40)}-1200`);
  assert.equal(machineId('a-'.repeat(30), 'abcd'), `${'a-'.repeat(19)}a-abcd`);
  assert.deepEqual(machinePaths('/s', 'pc-1a2b'), {
    root: '/s/machines/pc-1a2b',
    machine: '/s/machines/pc-1a2b/machine.json',
    settings: '/s/machines/pc-1a2b/settings.json',
    events: '/s/machines/pc-1a2b/events',
    runs: '/s/machines/pc-1a2b/runs',
    flows: '/s/machines/pc-1a2b/flows',
  });
  assert.match(syncReadme(), /machines\/<computer>\//);
});

test('what the computers share: every setting but where things are on this computer; projects without their folder', () => {
  const c = config({
    language: 'tr',
    belt: { verdicts: { 'git.clean': 'warn' } },
    memory: { dirs: ['/m'], store: { place: 'local', dir: '/m' } },
    modes: { workDir: '/w' },
    autonomy: { enabled: true, maxHours: 8 },
    projects: [
      { id: 'app', names: ['app'], path: '/dev/app', verify: ['npm test'] },
      { id: 'notes', names: ['notes'] },
    ],
    sync: { place: 'folder', dir: '/s', machine: { id: 'pc-0000', name: 'pc' } },
  });
  const v = sharedValues(c);
  for (const k of Object.keys(v)) assert.ok(!/^(version|memory\.dirs|memory\.store|modes|autonomy\.enabled|sync|projects$)/.test(k), k);
  assert.deepEqual(v['belt.verdicts'], { 'git.clean': 'warn' }, 'the verdicts are one setting');
  assert.deepEqual([v.language, v['autonomy.maxHours'], v['belt.packs.dockerVolumes'], v['autonomy.reviewModel']], ['tr', 8, false, null]);
  assert.deepEqual(v['projects.app'], { names: ['app'], verify: ['npm test'] });
  assert.deepEqual(v['projects.notes'], { names: ['notes'] });
  assert.equal(stableJson({ b: 1, a: [1, { d: undefined, c: 2 }] }), '{"a":[1,{"c":2}],"b":1}');
});

test('what a computer sends: each setting with when it changed there; a removal kept as such', () => {
  const v1 = { a: 1, b: 'x', 'projects.p': { names: ['p'] } };
  const first = nextExport(null, v1, 'pc-0000', 100, (k) => (k === 'a' ? 50 : 0));
  assert.deepEqual(first, {
    v: 1,
    machine: 'pc-0000',
    entries: { a: { value: 1, at: 50 }, b: { value: 'x', at: 0 }, 'projects.p': { value: { names: ['p'] }, at: 0 } },
  });
  assert.deepEqual(nextExport(null, { a: 1 }, 'pc', 9).entries.a, { value: 1, at: 0 }, 'with no rule, a first file claims nothing');
  const second = nextExport(first, { a: 2, b: 'x' }, 'pc-0000', 200);
  assert.deepEqual(second.entries, { a: { value: 2, at: 200 }, b: { value: 'x', at: 0 }, 'projects.p': { removed: true, at: 200 } });
  const third = nextExport(second, { a: 2, b: 'x' }, 'pc-0000', 300);
  assert.deepEqual(third.entries['projects.p'], { removed: true, at: 200 }, 'a removal keeps its time');
  assert.equal(third.entries.a!.at, 200);
  const back = nextExport(third, { a: 2, b: 'x', 'projects.p': { names: ['p'] } }, 'pc-0000', 400);
  assert.deepEqual(back.entries['projects.p'], { value: { names: ['p'] }, at: 400 });
  // Read back: entries of the wrong shape left out; a file that is not one is none.
  const read = parseMachineSettings(
    JSON.stringify({
      v: 1,
      machine: 'mac',
      entries: { a: { value: 1, at: 5 }, b: { removed: true, at: 6 }, c: { at: 'x' }, d: 7, e: { at: 1 }, f: { value: 1, at: 'x' } },
    }),
  );
  assert.deepEqual(read?.entries, { a: { value: 1, at: 5 }, b: { removed: true, at: 6 } });
  for (const t of [null, '', 'x', '{}', '{"v":2,"machine":"m","entries":{}}', '{"v":1,"entries":{}}', '{"v":1,"machine":"m","entries":[]}'])
    assert.equal(parseMachineSettings(t), null, String(t));
});

test('how settings meet: the newest change wins everywhere; a change made here and not sent wins at once', () => {
  const base = config();
  const pc = sent('pc-0000', base);
  const mac = config({ footer: { mode: 'off' }, language: 'en' });
  const macFile = sent('mac-0000', mac, 0, { 'footer.mode': 500 });
  // The Mac changed the footer later than anything here: taken. Its language was never changed there (0): not.
  const m = mergeSettings(base, pc, [macFile]);
  assert.equal(m.config.footer.mode, 'off');
  assert.equal(m.config.language, 'auto');
  assert.deepEqual(m.applied, [{ key: 'footer.mode', machine: 'mac-0000', at: 500 }]);
  assert.deepEqual(m.pending, []);
  // This computer changed it after: its own wins.
  const pcLater = sent('pc-0000', base, 0, { 'footer.mode': 600 });
  assert.equal(mergeSettings(base, pcLater, [macFile]).config.footer.mode, 'draw');
  // Equal times go to the id that sorts first, as on the other computer: "mac" before "pc", "a" before "mac".
  assert.equal(mergeSettings(base, sent('pc-0000', base, 0, { 'footer.mode': 500 }), [macFile]).config.footer.mode, 'off');
  assert.equal(mergeSettings(base, sent('a-0000', base, 0, { 'footer.mode': 500 }), [macFile]).config.footer.mode, 'draw');
  // A time of 0 claims nothing: equal zeros keep each its own.
  const zero = sent('mac-0000', mac);
  assert.equal(mergeSettings(base, sent('pc-0000', base), [zero]).config.footer.mode, 'draw');
  // A change made here and not sent yet wins, however new the other.
  const here = config({ footer: { mode: 'check' } });
  assert.equal(mergeSettings(here, pc, [macFile]).config.footer.mode, 'check');
  // Without its own file yet, this computer keeps everything it has.
  assert.equal(mergeSettings(base, null, [macFile]).config.footer.mode, 'draw');
  // Two others: the newest; equal times go to the id that sorts first, the same on every computer.
  const a = sent('a-0000', config({ view: 'simple' }), 0, { view: 700 });
  const b = sent('b-0000', config({ view: 'detailed' }), 0, { view: 700 });
  assert.equal(mergeSettings(base, pc, [b, a]).config.view, 'simple');
  const c = sent('c-0000', config({ view: 'detailed' }), 0, { view: 800 });
  assert.equal(mergeSettings(base, pc, [a, c]).config.view, 'detailed');
  assert.equal(mergeSettings(base, pc, [c, a]).config.view, 'detailed');
  // A file with this computer's own id (a copied folder) is not another computer's.
  assert.equal(mergeSettings(base, pc, [sent('pc-0000', config({ view: 'simple' }), 0, { view: 900 })]).config.view, 'recommended');
});

test("a computer joining: the others' changed settings come in, its own defaults claim nothing", () => {
  const windows = config({ language: 'tr', projects: [{ id: 'app', names: ['app'], path: 'C:/dev/app' }] });
  const winFile = sent('win-0000', windows, 0, { language: 100, 'projects.app': 100 });
  const mac = config();
  const macFile = sent('mac-0000', mac);
  const m = mergeSettings(mac, macFile, [winFile]);
  assert.equal(m.config.language, 'tr');
  assert.deepEqual(m.config.projects, [{ id: 'app', names: ['app'] }], 'a project from another computer arrives without a folder here');
  // And the Windows computer is left as it was by the Mac's file.
  assert.deepEqual(mergeSettings(windows, winFile, [macFile]).applied, []);
});

test('projects: new ones arrive without a folder; a change keeps the folder here; a removal goes, unless it lowers a protection', () => {
  const here = config({
    projects: [
      { id: 'app', names: ['app'], path: '/dev/app' },
      { id: 'old', names: ['old'], path: '/dev/old' },
    ],
  });
  const mine = sent('pc-0000', here);
  const other = nextExport(
    sent('mac-0000', here),
    { ...sharedValues(here), 'projects.app': { names: ['app', 'uygulama'] }, 'projects.web': { names: ['web'] }, 'projects.old': undefined },
    'mac-0000',
    900,
  );
  delete other.entries['projects.old'];
  other.entries['projects.old'] = { removed: true, at: 900 };
  const m = mergeSettings(here, mine, [other]);
  assert.deepEqual(m.config.projects, [
    { id: 'app', names: ['app', 'uygulama'], path: '/dev/app' },
    { id: 'web', names: ['web'] },
  ]);
  // A project with a definition of done is not dropped by another computer without the person.
  const guarded = config({ projects: [{ id: 'app', names: ['app'], path: '/dev/app', verify: ['npm test'] }] });
  const gone = sent('mac-0000', guarded);
  gone.entries['projects.app'] = { removed: true, at: 900 };
  const g = mergeSettings(guarded, sent('pc-0000', guarded), [gone]);
  assert.equal(g.config.projects.length, 1);
  assert.deepEqual(
    g.pending.map((p) => [p.key, p.machine, p.incoming]),
    [['projects.app', 'mac-0000', undefined]],
  );
  // Removed here and sent so: a newer one from another computer brings it back, an older one does not.
  const without = config();
  const removed = nextExport(sent('pc-0000', here), sharedValues(without), 'pc-0000', 500);
  const readd = (at: number) => {
    const f = sent('mac-0000', without);
    f.entries['projects.old'] = { value: { names: ['old'] }, at };
    return f;
  };
  assert.deepEqual(
    mergeSettings(without, removed, [readd(600)]).config.projects.map((p) => p.id),
    ['old'],
  );
  assert.deepEqual(mergeSettings(without, removed, [readd(400)]).config.projects, []);
  // A removal of a project this computer does not have: nothing to do.
  const none = config();
  assert.deepEqual(mergeSettings(none, sent('pc-0000', none), [gone]).applied, []);
});

test('lowering a protection waits for the person; making it stricter applies; ignoring keeps this value until that computer changes again', () => {
  const here = config({ belt: { verdicts: { 'git.clean': 'warn' } } });
  const mine = sent('pc-0000', here);
  const softer = sent('mac-0000', config({ belt: { verdicts: { 'git.clean': 'allow' } } }), 0, { 'belt.verdicts': 900 });
  const m = mergeSettings(here, mine, [softer]);
  assert.equal(m.config.belt.verdicts?.['git.clean'], 'warn');
  assert.deepEqual(m.pending, [{ key: 'belt.verdicts', machine: 'mac-0000', at: 900, current: { 'git.clean': 'warn' }, incoming: { 'git.clean': 'allow' } }]);
  assert.deepEqual(mergeSettings(here, mine, [softer], { 'belt.verdicts': 900 }).pending, [], 'ignored');
  assert.equal(mergeSettings(here, mine, [softer], { 'belt.verdicts': 899 }).pending.length, 1, 'changed again since');
  const stricter = sent('mac-0000', config({ belt: { verdicts: { 'git.clean': 'deny' } } }), 0, { 'belt.verdicts': 900 });
  assert.equal(mergeSettings(here, mine, [stricter]).config.belt.verdicts?.['git.clean'], 'deny');
});

test("what is never taken: this computer's own settings, keys this version does not know, values the settings would correct", () => {
  const here = config();
  const mine = sent('pc-0000', here);
  const odd: MachineSettings = {
    v: 1,
    machine: 'mac-0000',
    entries: {
      'autonomy.enabled': { value: true, at: 900 },
      'memory.store': { value: { place: 'local', dir: '/x' }, at: 900 },
      sync: { value: null, at: 900 },
      'modes.workDir': { value: '/x', at: 900 },
      'future.setting': { value: 1, at: 900 },
      'footer.mode': { value: 'loud', at: 900 },
      'footer.showFiveFrom': { value: 250, at: 900 },
      'belt.verdicts': { value: { 'meta.unverifiable': 'allow' }, at: 900 },
      'projects.BAD ID': { value: { names: ['x'] }, at: 900 },
      'projects.ok': { value: { names: 'x' }, at: 900 },
      'projects.fine': { value: { names: ['fine'], path: '/evil' }, at: 900 },
      'projects.text': { value: 'x', at: 900 },
      'projects.dup': { value: { names: ['dup'], id: 'other' }, at: 900 },
      view: { removed: true, at: 900 },
    },
  };
  const m = mergeSettings(here, mine, [odd]);
  assert.deepEqual(m.applied, []);
  assert.deepEqual(m.pending, []);
  assert.deepEqual(m.config, here);
});

test('what lowers a protection, setting by setting', () => {
  const cases: [string, unknown, unknown, boolean][] = [
    ['belt.disabled', [], ['git.clean'], true],
    ['belt.disabled', ['git.clean'], [], false],
    ['belt.disabled', undefined, ['git.clean'], true],
    ['belt.verdicts', {}, { 'git.clean': 'warn' }, true],
    ['belt.verdicts', { 'git.clean': 'warn' }, {}, false],
    ['belt.verdicts', {}, { 'git.clean': 'deny' }, false],
    ['belt.verdicts', { 'git.clean': 'deny' }, { 'git.clean': 'ask' }, true],
    ['belt.verdicts', {}, { 'no.such-rule': 'allow' }, false],
    ['belt.verdicts', {}, { 'git.clean': 'loud' }, false],
    ['belt.verdicts', { 'git.clean': 'warn', 'git.force-push': 'deny' }, { 'git.clean': 'warn', 'git.force-push': 'ask' }, true],
    ['belt.protectedBranches', ['main', 'master'], ['main'], true],
    ['belt.protectedBranches', ['main'], ['main', 'dev'], false],
    ['belt.prOnlyRepos', ['a/b'], [], true],
    ['belt.singleBranchRepos', ['a/b'], ['a/b'], false],
    ['belt.packs.dockerVolumes', true, false, true],
    ['belt.packs.dockerVolumes', false, true, false],
    ['belt.packs.dockerVolumes', false, false, false],
    ['modules.quota', false, false, false],
    ['modules.quota', true, false, true],
    ['modules.secrets', true, false, true],
    ['modules.modes', true, false, true],
    ['modules.quota', false, true, false],
    ['modules.footer', true, false, false],
    ['quota.fiveHourStop', 95, 99, true],
    ['quota.fiveHourStop', 99, 95, false],
    ['quota.fiveHourStop', 95, 95, false],
    ['quota.fiveHourWrapUp', 90, 91, true],
    ['quota.defaultWeeklyTarget', 80, 99, true],
    ['quota.defaultWeeklyWrapUp', 80, 79, false],
    ['quota.staleMinutes', 60, 120, true],
    ['quota.staleMinutes', 60, 'x', true],
    ['quota.autoResume', false, true, true],
    ['quota.autoResume', true, false, false],
    ['quota.autoResume', false, false, false],
    ['autonomy.maxHours', 12, 24, true],
    ['autonomy.stallMinutes', 90, 60, false],
    ['autonomy.reviewModel', null, 'claude-haiku-5-5', true],
    ['autonomy.reviewModel', 'a', 'a', false],
    ['keywords.extra', {}, { en: { continue: ['go on'] } }, true],
    ['keywords.extra', { en: { continue: ['go on'] } }, {}, false],
    ['keywords.extra', { en: { continue: ['go on'] } }, { tr: { continue: ['go on'] } }, true],
    ['projects.app', { names: ['app'], verify: ['npm test', 'npm run lint'] }, { names: ['app'], verify: ['npm test'] }, true],
    ['projects.app', { names: ['app'], verify: ['npm test'] }, { names: ['web'], verify: ['npm test', 'x'] }, false],
    ['projects.app', { names: ['app'], verify: ['npm test'] }, undefined, true],
    ['projects.app', { names: ['app'] }, undefined, false],
    ['footer.mode', 'draw', 'off', false],
    ['language', 'tr', 'en', false],
    ['packs.autoUse', false, true, true],
    ['packs.autoUse', false, undefined, true],
    ['packs.autoUse', true, false, false],
    ['packs.autoUse', undefined, false, false],
    ['packs.items.typst', 'never', undefined, true],
    ['packs.items.typst', 'me', 'always', true],
    ['packs.items.typst', undefined, 'always', true],
    ['packs.items.typst', 'always', 'me', false],
    ['packs.items.typst', undefined, 'never', false],
    ['packs.autoUse', true, true, false],
    ['skills.items.tdd', undefined, 'me', true],
    ['skills.items.tdd', 'me', 'on', true],
    ['skills.items.tdd', 'on', 'me', false],
    ['skills.items.tdd', 'on', undefined, false],
    ['skills.items.tdd', 'me', 'me', false],
    ['packs.items.typst', 'me', 'me', false],
  ];
  for (const [key, from, to, expected] of cases)
    assert.equal(lowersProtection(key, from, to), expected, `${key}: ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
});

test('applying shared values: a project keeps its folder here; a removal drops it; other settings set by key', () => {
  const c = config({ projects: [{ id: 'app', names: ['app'], path: '/dev/app', verify: ['npm test'] }] });
  assert.equal(applyShared(c, {}), c);
  const next = applyShared(c, { 'projects.app': { names: ['app', 'a'] }, 'projects.web': { names: ['web'], verify: ['make'] }, 'footer.mode': 'off' });
  assert.deepEqual(next.projects, [
    { id: 'app', names: ['app', 'a'], path: '/dev/app' },
    { id: 'web', names: ['web'], verify: ['make'] },
  ]);
  assert.equal(next.footer.mode, 'off');
  assert.deepEqual(applyShared(c, { 'projects.app': undefined }).projects, []);
});

test('history: month folders kept, events masked line by line, summaries of runs and flows read back', () => {
  assert.deepEqual(
    [monthIndex('2026-10'), monthIndex('2026-12'), monthIndex('2026-01'), monthIndex('2026-13'), monthIndex('2026-00'), monthIndex('26-10'), monthIndex('x')],
    [2026 * 12 + 9, 2026 * 12 + 11, 2026 * 12, null, null, null, null],
  );
  const now = Date.parse('2026-10-13T12:00:00Z');
  assert.deepEqual(
    ['2026-10', '2026-09', '2026-08', '2026-07', '2027-01', 'x'].map((m) => monthKept(m, now, 3)),
    [true, true, true, false, true, false],
  );
  assert.equal(monthKept('2026-10', now, 1), true);
  assert.equal(monthKept('2026-09', now, 1), false);
  const key = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  const masked = maskedEvents(`{"kind":"belt","reasons":["token ${key}"]}\nnot json\n\n{"kind":"keyword"}\n`);
  assert.ok(!masked.includes(key));
  assert.equal(masked.split('\n').length, 3);
  assert.equal(maskedEvents('not json\n'), '');
  assert.equal(maskedEvents(''), '');
  const run = runSummary({
    id: 'r1',
    task: `Fix it with ${key}\nsecond line`,
    project: 'app',
    cwd: 'C:\\dev\\app\\',
    status: 'paused',
    phase: 'work',
    pause: { reason: 'quota' },
    createdAt: 1,
    updatedAt: 2,
    milestones: [1, 2],
    deferred: [1],
  });
  assert.equal(run.folder, 'app');
  assert.ok(!run.task.includes(key) && !run.task.includes('second'));
  assert.deepEqual(parseRunSummary(JSON.stringify(run)), run);
  assert.equal(runSummary({ ...run, cwd: '/x', task: 't', pause: null, milestones: [], deferred: [] }).reason, null);
  const flow = flowSummary({
    id: 'f1',
    task: 'Plan it',
    project: null,
    status: 'waiting',
    current: 1,
    steps: [{ kind: 'research' }, { kind: 'plan' }],
    updatedAt: 3,
  });
  assert.equal(flow.step, 'plan');
  assert.deepEqual(parseFlowSummary(JSON.stringify(flow)), flow);
  assert.equal(flowSummary({ ...flow, current: 5, steps: [] }).step, null);
  for (const t of [null, 'x', '{}', '{"id":"r","status":"odd"}']) {
    assert.equal(parseRunSummary(t), null);
    assert.equal(parseFlowSummary(t), null);
  }
  const loose = parseRunSummary(JSON.stringify({ id: 'r', status: 'done', createdAt: 'x', project: 3, reason: 4 }))!;
  assert.deepEqual([loose.createdAt, loose.project, loose.reason, loose.task], [0, null, null, '']);
  assert.deepEqual(parseMachineInfo(JSON.stringify({ id: 'mac-0000', name: 'Mac', platform: 'darwin', app: '0.5.0', since: 5 })), {
    id: 'mac-0000',
    name: 'Mac',
    platform: 'darwin',
    app: '0.5.0',
    since: 5,
    projects: {},
  });
  const hinted = parseMachineInfo(
    JSON.stringify({
      id: 'm',
      name: 'M',
      projects: { car: { folder: 'car', parent: 'dev', remote: 'github.com/a/car', sub: '' }, bad: { parent: 'x' }, n: 5 },
    }),
  )!;
  assert.deepEqual(hinted.projects, { car: { folder: 'car', parent: 'dev', remote: 'github.com/a/car', sub: '' } });
  assert.equal(parseMachineInfo('{"id":"m"}'), null);
  assert.deepEqual(parseIgnored('{"a":5,"b":"x","c":Infinity}'.replace('Infinity', 'null')), { a: 5 });
  assert.deepEqual(parseIgnored('[1]'), {});
  assert.deepEqual(parseIgnored(null), {});
  assert.deepEqual(cloneDefaults().sync, null);
});

test("a computer joining: where its settings differ from the others' newest changes; what a first computer chose; the commit message", () => {
  const here = config({ view: 'simple', footer: { mode: 'check' } });
  const a = sent('a-0000', config({ view: 'detailed', language: 'tr' }), 0, { view: 500, language: 500 });
  const b = sent('b-0000', config({ view: 'recommended', footer: { mode: 'check' } }), 0, { view: 500, 'footer.mode': 600 });
  // view: equal times, "a" sorts first; language: only a changed it; footer.mode: b's equals here; defaults (0) claim nothing.
  assert.deepEqual(
    differences(here, [b, a]).map((d) => [d.key, d.here, d.theirs, d.machine, d.at]),
    [
      ['language', 'auto', 'tr', 'a-0000', 500],
      ['view', 'simple', 'detailed', 'a-0000', 500],
    ],
  );
  // A newer change wins whatever the order; a removed project shows as removed; what the settings would refuse is left out.
  const c = sent('c-0000', config({ view: 'recommended' }), 0, { view: 700 });
  c.entries['projects.gone'] = { removed: true, at: 700 };
  c.entries['footer.showFiveFrom'] = { value: 250, at: 700 };
  c.entries['sync'] = { value: null, at: 700 };
  const withProject = config({ view: 'simple', projects: [{ id: 'gone', names: ['gone'] }] });
  assert.deepEqual(
    differences(withProject, [a, c]).map((d) => [d.key, d.theirs]),
    [
      ['language', 'tr'],
      ['projects.gone', undefined],
      ['view', 'recommended'],
    ],
  );
  // The same in any order of the files: equal times to the id that sorts first, a newer change over an older one.
  assert.deepEqual(
    differences(here, [a, b]).map((d) => [d.key, d.machine]),
    [
      ['language', 'a-0000'],
      ['view', 'a-0000'],
    ],
  );
  assert.deepEqual(
    differences(withProject, [c, a]).map((d) => [d.key, d.theirs]),
    [
      ['language', 'tr'],
      ['projects.gone', undefined],
      ['view', 'recommended'],
    ],
  );
  // Only defaults from the others (times of 0): nothing differs that anyone chose.
  assert.deepEqual(differences(here, [sent('d-0000', config())]), []);
  assert.deepEqual(differences(here, []), []);
  assert.deepEqual(differences(config({ view: 'detailed', language: 'tr' }), [a]), [], 'nothing differs');
  // A first computer: what differs from a fresh installation.
  assert.deepEqual([...changedFromDefaults(config({ view: 'simple', projects: [{ id: 'app', names: ['app'] }] }))].sort(), ['projects.app', 'view']);
  assert.deepEqual([...changedFromDefaults(config())], []);
  assert.equal(syncCommitMessage('PC', { added: 2, changed: 1, removed: 3 }), 'sync: PC (2 added, 1 changed, 3 removed)');
  assert.equal(syncCommitMessage('PC', { added: 0, changed: 1, removed: 0 }), 'sync: PC (1 changed)');
  assert.equal(syncCommitMessage('PC', { added: 0, changed: 0, removed: 0 }), 'sync: PC');
});
