// SPDX-License-Identifier: Apache-2.0
/**
 * Every test layer that can run on this machine, in order, with one line each at the end: what ran, what
 * it found, how long it took. A layer that cannot run here (Claude Code missing, live tests not asked for)
 * says "skipped" and why; it never counts as passed.
 *
 * Usage: node scripts/verify.mjs [--fast] [--live]
 *   --fast   leaves out mutation testing (about a minute) and the renamed copy's tests in the rename rehearsal
 *   --live   adds the live sessions (uses a little of the person's quota)
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fast = process.argv.includes('--fast');
const live = process.argv.includes('--live');
const isWin = process.platform === 'win32';

function run(cmd, args) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, args, { cwd: root, shell: isWin && cmd === 'npx', windowsHide: true, env: process.env });
    let out = '';
    child.stdout.on('data', (b) => {
      out += b;
      process.stdout.write(b);
    });
    child.stderr.on('data', (b) => {
      out += b;
      process.stderr.write(b);
    });
    child.on('close', (code) => resolve({ code, out, ms: Date.now() - started }));
  });
}

const node = process.execPath;
const layers = [
  { name: 'L0 types', cmd: node, args: [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], counts: () => 'strict TypeScript' },
  { name: 'L0 format', cmd: node, args: [join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs'), '--check', '.'], counts: () => 'Prettier' },
  { name: 'L0 build', cmd: node, args: ['scripts/build.mjs'], counts: (o) => (/built [^\n]*/.exec(o)?.[0] ?? '').replace(/^built /, '') },
  {
    name: 'L1–L9 tests + coverage',
    cmd: node,
    args: ['scripts/coverage.mjs'],
    counts: (o) => {
      const m = /mean line coverage ([\d.]+)% over (\d+) source files/.exec(o);
      return m ? `mean line coverage ${m[1]}% over ${m[2]} files, every file at or above its floor` : '';
    },
  },
  { name: 'L8 mod types', cmd: node, args: ['scripts/typecheck-mod.mjs'], counts: (o) => (/typecheck-mod: (.*)/.exec(o)?.[1] ?? '').trim() },
  {
    name: 'L8 inside Claude Code',
    cmd: node,
    args: ['scripts/test-mod.mjs'],
    counts: (o) => {
      const p = /(\d+) pass/.exec(o);
      const f = /(\d+) fail/.exec(o);
      // Only the script's own "skipped" line: a test may have the word in its name.
      return /^test-mod: skipped/m.test(o)
        ? (/test-mod: (skipped.*)/.exec(o)?.[1] ?? 'skipped')
        : p
          ? `${p[1]} passed, ${f?.[1] ?? 0} failed in the engine's own test kit`
          : '';
    },
  },
  {
    name: 'L12 package',
    cmd: node,
    args: ['scripts/test-package.mjs'],
    counts: (o) => ([...o.matchAll(/^test-package: (.*)$/gm)].pop()?.[1] ?? '').trim(),
  },
  {
    name: 'L13 rename rehearsal',
    cmd: node,
    args: ['scripts/rename-rehearsal.mjs', ...(fast ? ['--no-tests'] : [])],
    counts: (o) => (/^rename-rehearsal: (.*)$/m.exec(o)?.[1] ?? '').trim(),
  },
  {
    name: 'doctor self-check',
    cmd: node,
    args: ['dist/cli.mjs', 'doctor', '--self-check', '--json'],
    counts: (o) => {
      try {
        const r = JSON.parse(o.slice(o.indexOf('{')));
        const noticed = r.faults.filter((f) => f.detected).length;
        const repaired = r.faults.filter((f) => f.repaired === true).length;
        const repairable = r.faults.filter((f) => f.repaired !== null).length;
        return `${r.faults.length} faults injected in a sandbox: ${noticed} noticed, ${repaired} of ${repairable} repairable ones repaired and checked again`;
      } catch {
        return '';
      }
    },
  },
  ...(fast ? [] : [{ name: 'L11 mutation', cmd: node, args: ['scripts/mutate.mjs'], counts: (o) => (/mutation score [^\n(]*/.exec(o)?.[0] ?? '').trim() }]),
  ...(live
    ? [{ name: 'L10 live sessions', cmd: node, args: ['scripts/test-live.mjs', '--yes'], counts: (o) => (/test-live: ([^\n]*)/.exec(o)?.[1] ?? '').trim() }]
    : []),
];

const results = [];
for (const l of layers) {
  console.log(`\n── ${l.name} ──`);
  const r = await run(l.cmd, l.args);
  const skipped = /skipped:/.test(r.out) && r.code === 0;
  results.push({ name: l.name, status: r.code === 0 ? (skipped ? 'skipped' : 'passed') : 'FAILED', detail: l.counts(r.out), ms: r.ms });
  if (r.code !== 0 && l.name.startsWith('L0')) break; // nothing after a broken build means anything
}
if (fast) results.push({ name: 'L11 mutation', status: 'skipped', detail: 'left out with --fast', ms: 0 });
if (!live) results.push({ name: 'L10 live sessions', status: 'skipped', detail: 'opt-in: --live (uses a little quota)', ms: 0 });

console.log('\n── verify ──');
const w = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.status.padEnd(8)} ${r.name.padEnd(w)}  ${(r.ms / 1000).toFixed(1).padStart(6)} s  ${r.detail}`);
const failed = results.filter((r) => r.status === 'FAILED');
console.log(failed.length ? `\n${failed.length} layer(s) failed.` : '\nEvery layer that ran here passed.');
process.exit(failed.length ? 1 : 0);
