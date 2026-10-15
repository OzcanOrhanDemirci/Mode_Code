// SPDX-License-Identifier: Apache-2.0
/**
 * Sync across computers on real repositories and real folders (node/sync.ts, docs/sync.md): two computers,
 * each with its own data folder, sharing through a bare repository standing for GitHub, or a plain folder
 * standing for a sync service. Settings meet, history and handoff notes travel, secrets stay home, nothing
 * of the person's is touched in a repository that holds more than the shared place.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeConfig, serializeConfig, type Config } from '../../src/core/config.js';
import { layout, type Layout } from '../../src/core/layout.js';
import { changedFromDefaults } from '../../src/core/sync.js';
import { lastShared, mergedConfig, pruneShared, sharedDue, syncShared } from '../../src/node/sync.js';

const hasGit = spawnSync('git', ['--version']).status === 0;
const skip = !hasGit && 'git is not installed';

const gitHome = mkdtempSync(join(tmpdir(), 'tc-syncgit-'));
after(() => rmSync(gitHome, { recursive: true, force: true }));
const globalConfig = join(gitHome, 'gitconfig');
writeFileSync(globalConfig, '[user]\n\tname = Ada\n\temail = ada@example.com\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n');
process.env.GIT_CONFIG_GLOBAL = globalConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const fwd = (p: string) => p.replace(/\\/g, '/');
const run = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const key = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const NOW = Date.now();
const month = (at: number) => `${new Date(at).getUTCFullYear()}-${String(new Date(at).getUTCMonth() + 1).padStart(2, '0')}`;

/** A computer: its data folder, its settings with the sync section, written to config.json as the setup would. */
function computer(root: string, name: string, sync: object, raw: object = {}): { l: Layout; local: () => Config; set: (raw: object) => void } {
  const l = layout(fwd(join(root, `${name}-data`)));
  mkdirSync(l.stateDir, { recursive: true });
  const set = (r: object) => {
    const c = normalizeConfig({ ...r, sync: { machine: { id: `${name}-0000`, name }, ...sync } });
    assert.deepEqual(c.problems, []);
    writeFileSync(l.config, serializeConfig(c.config));
  };
  set(raw);
  return { l, local: () => normalizeConfig(JSON.parse(readFileSync(l.config, 'utf8'))).config, set };
}

test(
  'two computers through a repository: settings meet, a lowered protection waits, history and handoff notes travel, secrets stay home',
  { skip },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'tc-sync-'));
    try {
      const remote = fwd(join(root, 'github.git'));
      run(root, 'init', '-q', '--bare', remote);
      const aDir = fwd(join(root, 'a-sync'));
      const bDir = fwd(join(root, 'b-sync'));
      run(root, 'clone', '-q', remote, aDir);
      const a = computer(root, 'a', { place: 'github', dir: aDir, remote }, { footer: { mode: 'off' } });
      // A's history: an event naming a secret, a run that ended.
      mkdirSync(join(a.l.eventsDir, month(NOW)), { recursive: true });
      writeFileSync(
        join(a.l.eventsDir, month(NOW), 's1.mod.jsonl'),
        `${JSON.stringify({ v: 1, at: NOW, kind: 'belt', verdict: 'deny', reasons: [`token ${key}`], session: 's1' })}\n`,
      );
      const first = await syncShared(a.local(), a.l, {
        trigger: 'setup',
        session: null,
        writer: 'cli',
        firstStamp: (k) => (changedFromDefaults(a.local()).has(k) ? NOW : 0),
      });
      assert.deepEqual([first?.error, first?.result?.commit, first?.result?.push], [null, 'ok', 'ok']);
      assert.match(run(aDir, 'log', '-1', '--format=%s'), /^sync: a \(\d+ added\)$/);

      // B joins: A's files come down, A's changed setting is in effect there.
      run(root, 'clone', '-q', remote, bDir);
      const b = computer(root, 'b', { place: 'github', dir: bDir, remote });
      const joined = await syncShared(b.local(), b.l, { trigger: 'setup', session: null, writer: 'cli' });
      assert.equal(joined?.result?.push, 'ok');
      assert.equal(mergedConfig(b.local(), b.l).config.footer.mode, 'off');
      const copy = readdirSync(join(bDir, 'machines', 'a-0000', 'events', month(NOW)));
      const text = readFileSync(join(bDir, 'machines', 'a-0000', 'events', month(NOW), copy[0]!), 'utf8');
      assert.ok(text.includes('"kind":"belt"') && !text.includes(key), 'the history came, its secret masked');

      // A lowers a protection and writes a handoff note; B brings both in: the note is there, the setting waits.
      a.set({ footer: { mode: 'off' }, belt: { verdicts: { 'git.clean': 'warn' } } });
      mkdirSync(join(aDir, 'handoffs', 'app'), { recursive: true });
      writeFileSync(join(aDir, 'handoffs', 'app', '20261013-090000-aaaaaaaa.md'), '---\ntype: handoff\n---\n\n## Next\n\nWrite the tests.\n');
      await syncShared(a.local(), a.l, { trigger: 'turn', session: 's1', writer: 'hook', now: NOW + 1000 });
      await syncShared(b.local(), b.l, { trigger: 'start', session: 's2', writer: 'hook' });
      assert.ok(existsSync(join(bDir, 'handoffs', 'app', '20261013-090000-aaaaaaaa.md')));
      const m = mergedConfig(b.local(), b.l);
      assert.deepEqual(
        m.pending.map((p) => [p.key, p.machine]),
        [['belt.verdicts', 'a-0000']],
      );
      assert.equal(m.config.belt.verdicts?.['git.clean'], undefined, 'not in effect until the person takes it');
      // B makes a protection stricter: A takes it by itself.
      b.set({ quota: { fiveHourStop: 90, fiveHourWrapUp: 85 } });
      await syncShared(b.local(), b.l, { trigger: 'manual', session: null, writer: 'cli', now: NOW + 2000 });
      await syncShared(a.local(), a.l, { trigger: 'start', session: 's3', writer: 'hook', now: NOW + 3000 });
      const onA = mergedConfig(a.local(), a.l).config;
      assert.deepEqual([onA.quota.fiveHourStop, onA.quota.fiveHourWrapUp], [90, 85]);
      // Each wrote only its own folder; nothing was forced.
      assert.deepEqual(readdirSync(join(aDir, 'machines')).sort(), ['a-0000', 'b-0000']);
      assert.ok(!run(aDir, 'log', '--format=%s').includes('Merge'), 'joined by rebasing, never a merge commit');
      assert.equal(lastShared(a.l)?.trigger, 'start');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("a repository with other files: only the shared place's own files are committed, the person's left as they were", { skip }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'tc-syncsub-'));
  try {
    const remote = fwd(join(root, 'github.git'));
    run(root, 'init', '-q', '--bare', remote);
    const clone = fwd(join(root, 'notes'));
    run(root, 'clone', '-q', remote, clone);
    mkdirSync(join(clone, 'hafiza'));
    writeFileSync(join(clone, 'hafiza', 'MEMORY.md'), '# Memory\n');
    run(clone, 'add', '-A');
    run(clone, 'commit', '-q', '-m', 'mine');
    run(clone, 'push', '-q', '-u', 'origin', 'HEAD');
    writeFileSync(join(clone, 'hafiza', 'draft.md'), 'not committed yet\n');
    const dir = `${clone}/mode-code`;
    const a = computer(root, 'a', { place: 'github', dir, remote });
    const r = await syncShared(a.local(), a.l, { trigger: 'setup', session: null, writer: 'cli' });
    assert.deepEqual([r?.result?.commit, r?.result?.push], ['ok', 'ok']);
    assert.equal(run(clone, 'status', '--porcelain'), '?? hafiza/draft.md', "the person's file is left as it was");
    assert.ok(
      run(clone, 'show', '--name-only', '--format=', 'HEAD')
        .split('\n')
        .every((f) => f.startsWith('mode-code/machines/a-0000/')),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a folder another service keeps in sync: no git, the same files; history past the months kept leaves it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tc-syncdir-'));
  try {
    const shared = fwd(join(root, 'iCloud', 'mode-code'));
    const a = computer(root, 'a', { place: 'folder', dir: shared }, { view: 'simple' });
    const b = computer(root, 'b', { place: 'folder', dir: shared });
    const r = await syncShared(a.local(), a.l, { trigger: 'setup', session: null, writer: 'cli', firstStamp: () => NOW });
    assert.deepEqual([r?.result, r?.error], [null, null]);
    assert.ok((r?.written ?? 0) >= 2);
    assert.equal(mergedConfig(b.local(), b.l).config.view, 'recommended', 'B has not sent its own file yet: it keeps its own');
    await syncShared(b.local(), b.l, { trigger: 'setup', session: null, writer: 'cli' });
    assert.equal(mergedConfig(b.local(), b.l).config.view, 'simple');
    // An old month of A's history leaves the folder; the current one stays.
    const old = join(shared, 'machines', 'a-0000', 'events', '2020-01');
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, 'x.mod.jsonl'), '{"at":1}\n');
    mkdirSync(join(shared, 'machines', 'a-0000', 'events', month(NOW)), { recursive: true });
    assert.equal(pruneShared(a.local()), 1);
    assert.ok(!existsSync(old));
    assert.ok(existsSync(join(shared, 'machines', 'a-0000', 'events', month(NOW))));
    assert.equal(pruneShared(normalizeConfig({}).config), 0);
    // When the next sync after a turn is due.
    assert.equal(sharedDue(a.local(), a.l, Date.now()), false);
    assert.equal(sharedDue(a.local(), a.l, Date.now() + 31 * 60_000), true);
    assert.equal(sharedDue(normalizeConfig({}).config, a.l), false);
    // A shared place that cannot be written: said in the record, nothing thrown.
    writeFileSync(join(root, 'blocked'), 'a file where the folder should be');
    const blocked = computer(root, 'c', { place: 'folder', dir: fwd(join(root, 'blocked')) });
    const failed = await syncShared(blocked.local(), blocked.l, { trigger: 'manual', session: null, writer: 'cli' });
    assert.ok(failed?.error, 'the reason is kept');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
