// SPDX-License-Identifier: Apache-2.0
/**
 * Test coverage, per file, with floors that only go up. Runs the test suite with Node's coverage, reads
 * its coverage table, prints every source file's line, branch and function coverage, and fails when a
 * file falls below its floor in test/coverage-floors.json. `--update` raises the floors to what was
 * measured (rounded down), so coverage can be ratcheted up and never quietly slide back.
 *
 * A fall must repeat. Node merges the coverage of the test processes in an order that changes between
 * runs, and the merge is not exact: on CI (Windows, Node.js 24) the same commit measured
 * src/tui/screens/measure.tsx at 99.1% and at 74.7% of its lines, with every test passing both times.
 * When a file falls below its floor the suite runs once more, and each file is judged on the better of
 * the two runs; a file whose tests were lost falls in both.
 *
 * Usage: node scripts/coverage.mjs [--update]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const floorsPath = join(root, 'test', 'coverage-floors.json');
const reportPath = join(root, 'coverage', 'report.txt');
mkdirSync(join(root, 'coverage'), { recursive: true });

/** Runs the suite with coverage once and returns Node's coverage table for the source files. */
function measure() {
  const run = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--test',
      '--experimental-test-coverage',
      '--test-coverage-exclude=test/**',
      '--test-coverage-exclude=node_modules/**',
      '--test-coverage-exclude=scripts/**',
      '--test-coverage-exclude=dist/**',
      '--test-reporter=spec',
      `--test-reporter-destination=${reportPath}`,
      '--test-reporter=dot',
      '--test-reporter-destination=stdout',
      'test/**/*.test.ts',
      'test/**/*.test.tsx',
    ],
    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], env: process.env },
  );
  if (run.status !== 0) {
    console.error('coverage: the tests failed; coverage is not judged on a failing run');
    process.exit(1);
  }
  return readTable();
}

/**
 * Node's own coverage table is the source (Node 24's lcov report counts JSX lines differently from it, by
 * a wide margin). Its rows are folders and files, nested by indentation.
 */
function readTable() {
  const files = [];
  const stack = [];
  let inTable = false;
  for (const raw of readFileSync(reportPath, 'utf8').split(/\r?\n/)) {
    if (raw.includes('start of coverage report')) inTable = true;
    else if (raw.includes('end of coverage report')) inTable = false;
    const line = raw.replace(/^ℹ ?/, '');
    if (!inTable || !line.includes('|')) continue;
    const parts = line.split('|');
    const cells = parts.map((c) => c.trim());
    const name = cells[0];
    if (!name || name === 'file' || name === 'all files' || /^-+$/.test(name)) continue;
    const depth = parts[0].length - parts[0].trimStart().length;
    stack.length = depth;
    if (cells[1] === '') {
      stack[depth] = name;
      continue;
    }
    const path = [...stack.slice(0, depth).filter(Boolean), name].join('/');
    files.push({ file: path, lines: Number(cells[1]), branches: Number(cells[2]), functions: Number(cells[3]) });
  }
  const src = files.filter((f) => f.file.startsWith('src/')).sort((a, b) => a.file.localeCompare(b.file));
  if (!src.length) {
    console.error(`coverage: no source file in the coverage table (${relative(root, reportPath)})`);
    process.exit(1);
  }
  return src;
}

const floors = existsSync(floorsPath) ? JSON.parse(readFileSync(floorsPath, 'utf8')) : { mean: 0, files: {} };
const update = process.argv.includes('--update');
const isLow = (f) => {
  const floor = floors.files?.[f.file];
  return Boolean(floor && (f.lines < floor.lines || f.branches < floor.branches || f.functions < floor.functions));
};

let src = measure();
const fell = src.filter(isLow);
if (fell.length && !update) {
  const list = fell.map((f) => `${f.file} ${f.lines}/${f.branches}/${f.functions}`).join(', ');
  console.log(`\ncoverage: ${list} below the floor; a fall must repeat, running once more`);
  const again = new Map(measure().map((f) => [f.file, f]));
  const best = (f) => {
    const g = again.get(f.file);
    return g
      ? { file: f.file, lines: Math.max(f.lines, g.lines), branches: Math.max(f.branches, g.branches), functions: Math.max(f.functions, g.functions) }
      : f;
  };
  src = [...src.map(best), ...[...again.values()].filter((g) => !src.some((f) => f.file === g.file))].sort((a, b) => a.file.localeCompare(b.file));
  for (const f of fell) {
    const g = again.get(f.file);
    console.log(`  ${f.file}: second run ${g ? `${g.lines}/${g.branches}/${g.functions}` : 'not reached'}`);
  }
}

const below = [];
console.log(`\n${'lines'.padStart(6)} ${'branch'.padStart(6)} ${'funcs'.padStart(6)}  file`);
for (const f of src) {
  const floor = floors.files?.[f.file];
  const low = isLow(f);
  if (low) below.push(`${f.file}: ${f.lines}/${f.branches}/${f.functions} < ${floor.lines}/${floor.branches}/${floor.functions}`);
  console.log(
    `${f.lines.toFixed(1).padStart(6)} ${f.branches.toFixed(1).padStart(6)} ${f.functions.toFixed(1).padStart(6)}  ${f.file}${low ? '  ✗ below its floor' : ''}`,
  );
}
const mean = src.reduce((t, f) => t + f.lines, 0) / src.length;
console.log(`\nmean line coverage ${mean.toFixed(1)}% over ${src.length} source files`);
// A source file no test reaches any more drops out of the table: that is a fall too.
for (const f of Object.keys(floors.files ?? {})) if (!src.some((s) => s.file === f)) below.push(`${f}: not reached by any test any more`);
if (mean < (floors.mean ?? 0)) below.push(`mean ${mean.toFixed(1)}% < ${floors.mean}%`);

if (update) {
  const next = { mean: Math.floor(mean) - 2, files: {} };
  // A margin below what was measured: Windows, Linux and macOS take different branches, and Node maps
  // transpiled lines back to the source slightly differently between runs (measured: up to 5 points on a
  // file). The floor catches a real fall, such as a file whose tests were lost, without flaking.
  const floor = (x, margin) => Math.max(0, Math.floor(x) - margin);
  for (const f of src) next.files[f.file] = { lines: floor(f.lines, 6), branches: floor(f.branches, 8), functions: floor(f.functions, 6) };
  writeFileSync(floorsPath, JSON.stringify(next, null, 2) + '\n');
  console.log(`coverage: floors written to ${relative(root, floorsPath)}`);
  process.exit(0);
}
if (below.length) {
  console.error(`coverage: below the floor:\n  ${below.join('\n  ')}`);
  process.exit(1);
}
console.log('coverage: every file at or above its floor');
