// SPDX-License-Identifier: Apache-2.0
/**
 * Test coverage, per file, with floors. Runs the test suite with V8 recording what each test process ran,
 * joins the records, prints every source file's line, branch and function coverage, and fails when a file
 * falls below its floor in test/coverage-floors.json. `--update` writes the floors from what was measured
 * (rounded down, with a margin), so coverage can be ratcheted up and never quietly slide back.
 *
 * Why not Node's own table (--experimental-test-coverage): it merges the test processes in the order it
 * reads their records, and the merge overwrites, so a file several processes load gets numbers that
 * depend on that order. It also lays the offsets of tsx's compiled code over the source text unless source
 * maps are on, so the lines it names are not the lines that ran. On CI (Windows, Node.js 24) the same
 * commit measured src/tui/screens/measure.tsx at 99.1% and at 74.7% of its lines, every test passing,
 * and 40 orders of one run's records gave 10 files more than one result. Here each process is read on its
 * own, through the source maps tsx records, and something counts as run when some process ran it; the
 * order cannot matter.
 *
 * - A line counts when the source map ties compiled code to it (comments, blank lines and types do not).
 *   It ran when the innermost range V8 reports around some of that code has a count above zero.
 * - A function counts unless it is a module's top level or code the compiler added. It ran when the
 *   code at its start did.
 * - A branch is a block V8 reports inside a function because it ran a different number of times than
 *   the code around it (one side of an if, a ?: or an &&, the code after an early return). A block that
 *   always ran exactly as often as its function is not reported by V8 and not counted.
 *
 * Usage: node scripts/coverage.mjs [--update]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const floorsPath = join(root, 'test', 'coverage-floors.json');
const reportPath = join(root, 'coverage', 'report.txt');
const tablePath = join(root, 'coverage', 'coverage.txt');
const recordsDir = join(root, 'coverage', 'v8');
mkdirSync(join(root, 'coverage'), { recursive: true });
rmSync(recordsDir, { recursive: true, force: true });

const run = spawnSync(
  process.execPath,
  [
    '--import',
    'tsx',
    '--test',
    '--test-reporter=spec',
    `--test-reporter-destination=${reportPath}`,
    '--test-reporter=dot',
    '--test-reporter-destination=stdout',
    'test/**/*.test.ts',
    'test/**/*.test.tsx',
  ],
  { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, NODE_V8_COVERAGE: recordsDir } },
);
if (run.status !== 0) {
  console.error('coverage: the tests failed; coverage is not judged on a failing run');
  process.exit(1);
}

const B64 = new Map([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((c, i) => [c, i]));

/** A source map's mappings, decoded: [generated line, generated column, source, original line, original column]. */
function decode(mappings) {
  const out = [];
  let line = 0;
  let column = 0;
  let source = 0;
  let oLine = 0;
  let oColumn = 0;
  let i = 0;
  while (i < mappings.length) {
    if (mappings[i] === ';') {
      line++;
      column = 0;
      i++;
      continue;
    }
    if (mappings[i] === ',') {
      i++;
      continue;
    }
    const fields = [];
    while (i < mappings.length && mappings[i] !== ',' && mappings[i] !== ';') {
      let shift = 0;
      let value = 0;
      let digit;
      do {
        digit = B64.get(mappings[i++]);
        value += (digit & 31) * 2 ** shift;
        shift += 5;
      } while (digit & 32);
      fields.push(value % 2 ? -Math.floor(value / 2) : value / 2);
    }
    column += fields[0];
    if (fields.length < 4) continue;
    source += fields[1];
    oLine += fields[2];
    oColumn += fields[3];
    out.push([line, column, source, oLine, oColumn]);
  }
  return out;
}

/**
 * The code positions of one compiled version of a file, in the order of the compiled code: where each
 * starts (an offset in the compiled code, as V8 counts) and the source line and column it came from.
 */
const versions = new Map();
function positions(url, cached) {
  const known = versions.get(cached.data.mappings);
  if (known) return known;
  const starts = [];
  let offset = 0;
  for (const length of cached.lineLengths) {
    starts.push(offset);
    offset += length + 1;
  }
  const own = cached.data.sources.map((s) => s === url.split('?')[0]);
  const list = decode(cached.data.mappings)
    .filter(([line, , source]) => own[source] && starts[line] !== undefined)
    .map(([line, column, , oLine, oColumn]) => ({ at: starts[line] + column, line: oLine, key: `${oLine}:${oColumn}` }))
    .sort((a, b) => a.at - b.at);
  versions.set(cached.data.mappings, list);
  return list;
}

/** The first code position in [start, end), or null. */
function firstIn(list, start, end) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].at < start) lo = mid + 1;
    else hi = mid;
  }
  return lo < list.length && list[lo].at < end ? list[lo] : null;
}

/** Per source file: its lines, functions and branches (by source position), whether each ran, and the positions that ran. */
const files = new Map();
const records = readdirSync(recordsDir).filter((n) => /^coverage-\d+-\d+-\d+\.json$/.test(n));
for (const name of records) {
  const record = JSON.parse(readFileSync(join(recordsDir, name), 'utf8'));
  const maps = record['source-map-cache'] ?? {};
  for (const script of record.result) {
    if (!script.url.startsWith('file:')) continue;
    const file = relative(root, fileURLToPath(script.url)).split(sep).join('/');
    if (!file.startsWith('src/')) continue;
    const cached = maps[script.url];
    if (!cached?.data) {
      console.error(`coverage: ${file} ran without a source map (${name}); its code cannot be placed`);
      process.exit(1);
    }
    const list = positions(script.url, cached);
    let f = files.get(file);
    if (!f) files.set(file, (f = { lines: new Map(), functions: new Set(), branches: new Set(), ran: new Set() }));

    const ranges = [];
    script.functions.forEach((fn, j) =>
      fn.ranges.forEach((range, k) => {
        ranges.push(range);
        const first = firstIn(list, range.startOffset, range.endOffset);
        if (first && !(j === 0 && k === 0)) (k === 0 ? f.functions : f.branches).add(first.key);
      }),
    );
    // V8's ranges nest. Outer before inner, then a walk along the code keeps the ranges around each position.
    ranges.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
    const around = [];
    let next = 0;
    for (const p of list) {
      while (next < ranges.length && ranges[next].startOffset <= p.at) {
        const range = ranges[next++];
        while (around.length && around.at(-1).endOffset <= range.startOffset) around.pop();
        around.push(range);
      }
      while (around.length && around.at(-1).endOffset <= p.at) around.pop();
      const ran = (around.at(-1)?.count ?? 0) > 0;
      f.lines.set(p.line, (f.lines.get(p.line) ?? false) || ran);
      if (ran) f.ran.add(p.key);
    }
  }
}
rmSync(recordsDir, { recursive: true, force: true });

const percent = (part, all) => (all ? (part / all) * 100 : 100);
const src = [...files]
  .map(([file, f]) => {
    const lines = [...f.lines].filter(([, ran]) => ran).length;
    return {
      file,
      lines: percent(lines, f.lines.size),
      branches: percent([...f.branches].filter((k) => f.ran.has(k)).length, f.branches.size),
      functions: percent([...f.functions].filter((k) => f.ran.has(k)).length, f.functions.size),
      missed: [...f.lines].filter(([, ran]) => !ran).map(([line]) => line + 1),
    };
  })
  .sort((a, b) => a.file.localeCompare(b.file));
if (!src.length) {
  console.error(`coverage: no source file in the ${records.length} records of the test processes`);
  process.exit(1);
}

/** Line numbers as ranges: 3 4 5 9 → 3-5 9. */
function spans(numbers) {
  const out = [];
  for (const n of numbers.sort((a, b) => a - b)) {
    const last = out.at(-1);
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(' ');
}

const floors = existsSync(floorsPath) ? JSON.parse(readFileSync(floorsPath, 'utf8')) : { mean: 0, files: {} };
const below = [];
const table = [`${'lines'.padStart(6)} ${'branch'.padStart(6)} ${'funcs'.padStart(6)}  file`];
for (const f of src) {
  const floor = floors.files?.[f.file];
  const low = floor && (f.lines < floor.lines || f.branches < floor.branches || f.functions < floor.functions);
  if (low)
    below.push(`${f.file}: ${f.lines.toFixed(1)}/${f.branches.toFixed(1)}/${f.functions.toFixed(1)} < ${floor.lines}/${floor.branches}/${floor.functions}`);
  table.push(
    `${f.lines.toFixed(1).padStart(6)} ${f.branches.toFixed(1).padStart(6)} ${f.functions.toFixed(1).padStart(6)}  ${f.file}${low ? '  ✗ below its floor' : ''}`,
  );
}
const mean = src.reduce((t, f) => t + f.lines, 0) / src.length;
table.push('', `mean line coverage ${mean.toFixed(1)}% over ${src.length} source files`);
console.log(`\n${table.join('\n')}`);
// The table again with the lines that did not run, for the CI artifact.
writeFileSync(
  tablePath,
  [...table, '', 'lines that did not run:', ...src.filter((f) => f.missed.length).map((f) => `${f.file}: ${spans(f.missed)}`)].join('\n') + '\n',
);
// A source file no test reaches any more drops out of the table: that is a fall too.
for (const f of Object.keys(floors.files ?? {})) if (!src.some((s) => s.file === f)) below.push(`${f}: not reached by any test any more`);
if (mean < (floors.mean ?? 0)) below.push(`mean ${mean.toFixed(1)}% < ${floors.mean}%`);

if (process.argv.includes('--update')) {
  const next = { mean: Math.floor(mean) - 2, files: {} };
  // A margin below what was measured: Windows, Linux and macOS take different paths, and some code runs a
  // different number of times from run to run, which can show or hide a branch. The floor catches a real
  // fall, such as a file whose tests were lost, without flaking.
  const floor = (x, margin) => Math.max(0, Math.floor(x) - margin);
  for (const f of src) next.files[f.file] = { lines: floor(f.lines, 6), branches: floor(f.branches, 8), functions: floor(f.functions, 6) };
  writeFileSync(floorsPath, JSON.stringify(next, null, 2) + '\n');
  console.log(`coverage: floors written to ${relative(root, floorsPath)}`);
  process.exit(0);
}
if (below.length) {
  console.error(`coverage: below the floor:\n  ${below.join('\n  ')}\n(lines that did not run: ${relative(root, tablePath)})`);
  process.exit(1);
}
console.log('coverage: every file at or above its floor');
