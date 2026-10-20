// SPDX-License-Identifier: Apache-2.0
/**
 * The rule refinements the measured false alarms called for (the approved table's ③ column): a branch already
 * merged, a path this session made, a home folder that is a system folder too (`/root`), a test's own data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, evaluateToolCall } from '../../src/core/belt/evaluate.js';
import type { Finding, Level } from '../../src/core/belt/types.js';
import { emptyProvenance, madeHere, madePaths, parseProvenance, PROV_MADE_MAX, withMade } from '../../src/core/provenance.js';
import { fakeGit, linuxCtx, winCtx } from '../helpers/belt.js';

const SECRET = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';

test('a branch already merged into the current one is cleaned up with a note at every level; an unmerged one is asked', async () => {
  const at = async (command: string, merged: string[] | undefined, level: Level = 'manual', verdicts = {}) => {
    const d = await evaluateToolCall('Bash', { command }, winCtx({ level, git: fakeGit({ merged }) }, { verdicts }));
    return `${d.verdict} ${d.findings.map((f) => f.act).join()}`;
  };
  assert.equal(await at('git branch -D old', ['old', 'main']), 'warn note');
  assert.equal(await at('git branch -D old', ['old'], 'full'), 'warn note');
  assert.equal(await at('git branch -D old other', ['old']), 'ask ask');
  assert.equal(await at('git branch -D old', []), 'ask ask');
  assert.equal(await at('git branch -D old', undefined), 'ask ask', 'unknown: asked');
  assert.equal(await at('git branch -D old', ['old'], 'manual', { 'git.branch-force-delete': 'ask' }), 'ask ask', "the person's verdict holds");
  assert.equal(await at('git branch -D', ['old']), 'ask ask', 'no branch named');
});

test('a path this session made is its own to remove, at every level; one it did not make is decided as before', () => {
  const f: Finding = { rule: 'fs.delete-outside-project', verdict: 'allow', reason: 'deletes', unit: { kind: 'path', values: ['C:/dev/scratch/out'] } };
  const made = withMade(emptyProvenance(), ['C:/dev/scratch']);
  for (const level of ['manual', 'auto', 'full'] as const) assert.equal(decide([f], [], { config: {}, level, prov: made }).verdict, 'allow', level);
  assert.equal(decide([f], [], { config: {}, level: 'manual', prov: emptyProvenance() }).verdict, 'ask');
  assert.equal(decide([f], [], { config: { verdicts: { 'fs.delete-outside-project': 'ask' } }, level: 'auto', prov: made }).verdict, 'ask');
  assert.equal(decide([{ ...f, unit: undefined }], [], { config: {}, level: 'manual', prov: made }).verdict, 'ask');
  // Every path must be its own.
  assert.equal(
    decide([{ ...f, unit: { kind: 'path', values: ['C:/dev/scratch/out', 'C:/dev/other'] } }], [], { config: {}, level: 'manual', prov: made }).verdict,
    'ask',
  );
  // Only this rule: a memory file the session wrote is still the memory.
  assert.equal(decide([{ ...f, rule: 'fs.delete-git-dir' }], [], { config: {}, level: 'manual', prov: made }).verdict, 'ask');
});

test('what a call makes: a new file written, the folders mkdir names; the record keeps them, each once', () => {
  const env = { platform: 'win32' as const, home: 'C:/Users/ada', cwd: 'C:/dev/app' };
  assert.deepEqual(madePaths('Write', { file_path: '../scratch/a.txt' }, env, true), ['C:/dev/scratch/a.txt']);
  assert.deepEqual(madePaths('Write', { file_path: 'a.txt' }, env, false), []);
  assert.deepEqual(madePaths('Bash', { command: 'mkdir -p ../out/x ../tmp2 && echo done' }, env, false), ['C:/dev/out/x', 'C:/dev/tmp2']);
  assert.deepEqual(madePaths('PowerShell', { command: 'New-Item -ItemType Directory -Path ..\\stage' }, env, false), ['C:/dev/stage']);
  assert.deepEqual(madePaths('PowerShell', { command: 'New-Item -ItemType File -Path ..\\f.txt' }, env, false), []);
  assert.deepEqual(madePaths('Bash', { command: 'md ../m' }, env, false), ['C:/dev/m']);
  assert.deepEqual(madePaths('Bash', { command: 'mkdir "$DIR"' }, env, false), []);
  assert.deepEqual(madePaths('Read', { file_path: 'a.txt' }, env, true), []);
  assert.deepEqual(madePaths('Bash', {}, env, false), []);
  assert.deepEqual(madePaths('PowerShell', { command: 'New-Item x -ItemType Directory' }, env, false), [], 'a path not named as one');
  let p = withMade(emptyProvenance(), ['C:\\dev\\Scratch\\']);
  assert.ok(madeHere('c:/dev/scratch', p));
  assert.ok(madeHere('C:/dev/scratch/deep/x', p));
  assert.ok(!madeHere('C:/dev/scratchpad', p));
  assert.equal(withMade(p, ['c:/dev/scratch']), p, 'each once');
  for (let i = 0; i < PROV_MADE_MAX + 3; i++) p = withMade(p, [`C:/x/${i}`]);
  assert.equal(p.made.length, PROV_MADE_MAX);
  assert.deepEqual(parseProvenance(JSON.stringify(p)).made, p.made);
});

test("the home folder is the person's own even where it is a system folder too (root in a container)", async () => {
  const ctx = linuxCtx({ home: '/root', cwd: '/root/app', projectDir: '/root/app' });
  const d = await evaluateToolCall('Bash', { command: 'rm -rf /root/other/build' }, ctx);
  assert.deepEqual(
    d.findings.map((f) => f.rule),
    ['fs.delete-outside-project'],
  );
  // The home folder itself, and the system's own folders, are still critical.
  assert.ok((await evaluateToolCall('Bash', { command: 'rm -rf /root' }, ctx)).findings.some((f) => f.rule === 'fs.delete-critical'));
  assert.ok((await evaluateToolCall('Bash', { command: 'rm -rf /usr/lib' }, ctx)).findings.some((f) => f.rule === 'fs.delete-critical'));
});

test("a test's own data: a token in it is no note; the same token in source still is", async () => {
  const rules = async (file_path: string) =>
    (await evaluateToolCall('Write', { file_path, content: `const token = '${SECRET}';\n` }, winCtx())).findings.map((f) => f.rule);
  for (const path of [
    'C:/dev/app/test/fixtures/token.ts',
    'C:/dev/app/src/__tests__/a.ts',
    'C:/dev/app/src/auth.test.ts',
    'C:/dev/app/pkg/auth_test.go',
    'C:/dev/app/testdata/x.json',
  ])
    assert.deepEqual(await rules(path), [], path);
  for (const path of ['C:/dev/app/src/auth.ts', 'C:/dev/app/src/latest.ts', 'C:/dev/app/contest/x.ts'])
    assert.deepEqual(await rules(path), ['secrets.write'], path);
});
