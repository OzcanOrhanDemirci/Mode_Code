// SPDX-License-Identifier: Apache-2.0
/**
 * Mutation testing: are the tests sharp enough to notice a change? Small deliberate changes are made to
 * the code that decides things (a comparison flipped, a boundary moved, a condition inverted, a boolean
 * swapped), one at a time, and the tests that cover that code are run against each. A change that no test
 * notices ("a survivor") marks a gap in the tests, or a change that makes no difference.
 *
 * Every mutant runs in a private copy of the source tree, several at once. The report lists the score per
 * file and every survivor with its line, written to coverage/mutation.json and coverage/mutation.txt.
 *
 * Usage: node scripts/mutate.mjs [--workers N] [--only <file>] [--limit N]
 * Exit: 1 when a full run leaves a survivor that test/mutation-equivalents.json does not explain.
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

/** The code under test and the tests that cover it. */
const TARGETS = {
  'src/core/paths.ts': [
    'test/core/paths.test.ts',
    'test/core/belt-edges.test.ts',
    'test/protection/spellings.test.ts',
    'test/core/belt-projects.test.ts',
    'test/corpus/unix-home.test.ts',
  ],
  'src/core/belt/protect.ts': [
    'test/core/belt-refine.test.ts',
    'test/protection/spellings.test.ts',
    'test/corpus/unix-home.test.ts',
    'test/corpus/everyday.test.ts',
    'test/core/belt.test.ts',
    'test/core/belt-edges.test.ts',
    'test/core/belt-projects.test.ts',
  ],
  'src/core/belt/evaluate.ts': [
    'test/core/belt.test.ts',
    'test/core/belt-edges.test.ts',
    'test/core/belt-tiers.test.ts',
    'test/core/belt-levels.test.ts',
    'test/core/belt-net.test.ts',
    'test/core/belt-evidence.test.ts',
    'test/core/belt-request.test.ts',
    'test/core/belt-refine.test.ts',
    'test/corpus/automation-parity.test.ts',
    'test/protection/spellings.test.ts',
  ],
  'src/core/belt/rules.ts': [
    'test/core/belt.test.ts',
    'test/core/belt-edges.test.ts',
    'test/core/belt-tiers.test.ts',
    'test/core/belt-levels.test.ts',
    'test/core/belt-net.test.ts',
    'test/core/belt-evidence.test.ts',
    'test/core/belt-request.test.ts',
    'test/core/belt-refine.test.ts',
    'test/core/config.test.ts',
  ],
  'src/core/keywords.ts': [
    'test/core/keywords.test.ts',
    'test/core/edges.test.ts',
    'test/core/guidance.test.ts',
    'test/core/selftest.test.ts',
    'test/core/memory.test.ts',
  ],
  'src/core/quota.ts': ['test/core/quota-footer.test.ts', 'test/core/edges.test.ts', 'test/core/guidance.test.ts'],
  'src/core/config.ts': [
    'test/core/config.test.ts',
    'test/core/config-edges.test.ts',
    'test/core/templates.test.ts',
    'test/core/memory.test.ts',
    'test/core/sync.test.ts',
  ],
  'src/core/secrets/scan.ts': ['test/core/secrets.test.ts', 'test/core/edges.test.ts', 'test/core/selftest.test.ts'],
  'src/core/version.ts': ['test/core/format.test.ts', 'test/core/selftest.test.ts'],
  'src/app/doctor/checks.ts': ['test/doctor/checks.test.ts', 'test/doctor/checks-golden.test.ts'],
  'src/app/doctor/setup.ts': ['test/doctor/setup.test.ts'],
  // Modes and flows: what a restricted mode lets through, and when a flow's step counts as done.
  'src/core/shell/effects.ts': ['test/core/effects.test.ts', 'test/core/effects-forms.test.ts', 'test/corpus/modes.test.ts', 'test/core/guard.test.ts'],
  'src/core/modes.ts': ['test/core/guard.test.ts', 'test/core/effects.test.ts', 'test/core/modes.test.ts'],
  'src/core/guard.ts': ['test/core/guard.test.ts', 'test/corpus/modes.test.ts'],
  'src/core/flow.ts': ['test/core/flow.test.ts', 'test/core/guidance.test.ts'],
  'src/core/flow-checks.ts': ['test/core/flow-checks.test.ts'],
  // Full autonomy: when a run may start, stop, move on, and what it may do while nobody is there.
  // The memory (docs/memory.md): what is committed, held back, pulled and pushed; the notes handed over.
  'src/core/memory.ts': ['test/core/memory.test.ts', 'test/core/memory-sync-records.test.ts'],
  'src/core/memory-sync.ts': ['test/core/memory-sync-steps.test.ts', 'test/core/memory-sync-records.test.ts'],
  'src/core/handoff.ts': ['test/core/handoff.test.ts'],
  'src/core/morning.ts': ['test/core/morning.test.ts'],
  // Sync across computers (docs/sync.md): how settings meet, and what never applies without the person.
  'src/core/sync.ts': ['test/core/sync.test.ts', 'test/properties/sync.test.ts'],
  'src/core/sync-export.ts': ['test/core/sync-export.test.ts'],
  // A rename (docs/release.md): what of an installation under an earlier name is found, copied and pointed here.
  'src/node/previous.ts': ['test/node/install-previous.test.ts'],
  // The session's controls (docs/modes.md, "Session controls"): commands, budgets, what to continue, the strip.
  'src/core/controls.ts': ['test/core/controls.test.ts', 'test/core/keywords.test.ts'],
  // Full autonomy's start window and Automation › Recent tasks: what is kept, offered and copied back.
  'src/node/clipboard.ts': ['test/node/clipboard.test.ts'],
  // `/0` (docs/modes.md, "Session controls"): which terminal opens the control center, with which arguments.
  'src/core/launch.ts': ['test/core/launch.test.ts'],
  'src/core/update.ts': ['test/core/update.test.ts'],
  'src/core/taint.ts': ['test/core/taint.test.ts', 'test/core/belt-evidence.test.ts'],
  'src/core/hygiene.ts': ['test/core/hygiene.test.ts'],
  'src/core/measure.ts': ['test/core/measure.test.ts'],
  'src/core/permissions.ts': ['test/core/permissions.test.ts'],
  'src/core/mcp-pins.ts': ['test/core/mcp-pins.test.ts'],
  'src/core/trust.ts': ['test/core/trust.test.ts'],
  'src/core/flagged.ts': ['test/core/flagged.test.ts'],
  // What Manual promises before a commit or a push.
  'src/core/manual.ts': ['test/core/belt-levels.test.ts'],
  // The safety net: what is kept before a call, read back, and the steps back.
  'src/core/net.ts': ['test/core/net.test.ts'],
  // Where what a call acts on came from: the person's words, the start record, what was read from outside.
  'src/core/provenance.ts': [
    'test/core/provenance.test.ts',
    'test/core/belt-evidence.test.ts',
    'test/core/belt-request.test.ts',
    'test/core/belt-refine.test.ts',
  ],
  'src/core/config-words.ts': ['test/core/config-words.test.ts', 'test/doctor/render.test.ts'],
  'src/core/packs.ts': ['test/core/packs.test.ts'],
  'src/core/skills.ts': ['test/core/skills.test.ts'],
  'src/core/agents.ts': ['test/core/agents.test.ts'],
  'src/core/mo/state.ts': ['test/core/mo.test.ts'],
  'src/core/mo/cells.ts': ['test/core/mo.test.ts'],
  // What a keyword does to the session: the mode and the way of working change only where the person names them.
  'src/core/session.ts': ['test/core/session.test.ts', 'test/core/modes.test.ts'],
  // Whether a session is still open: its process looked up, the answer read, a freed number told apart.
  'src/core/host.ts': ['test/core/host.test.ts'],
  // Mode_Code's own git calls: nothing the repository's settings name runs, git from PATH's absolute folders only.
  'src/core/git-safe.ts': ['test/core/git-safe.test.ts', 'test/node/git.test.ts'],
  // The UI kit: what each control, meter and notice shows, in every host (docs/design.md, Components).
  'src/core/ux/kit.ts': ['test/core/ux-kit.test.ts'],
  // The mouse: the terminal's pointer sequences read and taken out of the keys.
  'src/tui/pointer.ts': ['test/tui/pointer.test.tsx'],
  // The record of changes, the activity and the reasons (docs/design.md, rules 5 to 7).
  'src/core/ux/changes.ts': ['test/core/ux-changes.test.ts'],
  'src/core/ux/activity.ts': ['test/core/ux-activity.test.ts'],
  'src/core/ux/why.ts': ['test/core/ux-why.test.ts'],
  // The strip in words (docs/modes.md, "The line under the strip"): what Claude does now, each control's card, Mo's state.
  'src/core/ux/say.ts': ['test/core/ux-say.test.ts'],
  // The cockpit (docs/design.md, The cockpit): what Claude may do now, worked out from the settings and the session.
  'src/core/ux/cockpit.ts': ['test/core/ux-cockpit.test.ts'],
  'src/core/ux/cockpit-view.ts': ['test/core/ux-cockpit.test.ts'],
  'src/core/ux/elapsed.ts': ['test/core/ux-cockpit.test.ts'],
  // Now, the control center's first screen: the cockpit's facts for a session on disk, and what Mo says.
  'src/core/ux/now.ts': ['test/core/ux-now.test.ts'],
};

// ── finding mutation sites in TypeScript without a parser: code outside strings, comments and regexes ──

/** For each character, whether it is code (not inside a string, a comment or a regular expression). */
function codeMask(src) {
  const mask = new Uint8Array(src.length);
  let i = 0;
  let prev = ''; // last significant code character, to tell a regex from a division
  let prevWord = '';
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) i += src[i] === '\\' ? 2 : 1;
      i++;
      prev = q;
      continue;
    }
    if (c === '/' && (/[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || prev === '' || /^(?:return|typeof|case|in|of|void|delete|throw|new)$/.test(prevWord))) {
      i++;
      let inClass = false;
      while (i < src.length) {
        const d = src[i];
        if (d === '\\') i += 2;
        else if (d === '[') ((inClass = true), i++);
        else if (d === ']') ((inClass = false), i++);
        else if (d === '/' && !inClass) break;
        else if (d === '\n') break;
        else i++;
      }
      i++;
      while (i < src.length && /[a-z]/.test(src[i])) i++;
      prev = '/';
      continue;
    }
    mask[i] = 1;
    if (!/\s/.test(c)) {
      prev = c;
      if (/[\w$]/.test(c)) {
        let j = i;
        while (j > 0 && /[\w$]/.test(src[j - 1])) j--;
        prevWord = src.slice(j, i + 1);
      } else prevWord = '';
    }
    i++;
  }
  return mask;
}

/** Lines inside interface and type declarations: erased at run time, so changing them proves nothing. */
function typeLines(src) {
  const skip = new Set();
  const lines = src.split('\n');
  let depth = 0;
  let inType = false;
  lines.forEach((line, k) => {
    if (!inType && /^\s*(?:export\s+)?(?:interface|type)\s+\w/.test(line)) {
      inType = true;
      depth = 0;
    }
    if (inType) {
      skip.add(k);
      for (const ch of line) depth += ch === '{' ? 1 : ch === '}' ? -1 : 0;
      if (depth <= 0 && (/[;}]\s*$/.test(line) || !/[{(<,]\s*$/.test(line))) inType = false;
    }
  });
  return skip;
}

const OPERATORS = [
  [/ === /g, ' !== '],
  [/ !== /g, ' === '],
  [/ <= /g, ' < '],
  [/ >= /g, ' > '],
  [/ < /g, ' <= '],
  [/ > /g, ' >= '],
  [/ && /g, ' || '],
  [/ \|\| /g, ' && '],
  [/\btrue\b/g, 'false'],
  [/\bfalse\b/g, 'true'],
  [/\.some\(/g, '.every('],
  [/\.every\(/g, '.some('],
  [/\.startsWith\(/g, '.endsWith('],
  [/ \+ 1\b/g, ' - 1'],
  [/ - 1\b/g, ' + 1'],
  [/(?<=[\s(])!(?=[\w(])/g, ''],
];

function mutantsOf(file) {
  const src = readFileSync(join(root, file), 'utf8');
  const mask = codeMask(src);
  const skipLines = typeLines(src);
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (pos) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const out = [];
  for (const [re, to] of OPERATORS) {
    re.lastIndex = 0;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const at = m.index;
      const line = lineOf(at);
      if (skipLines.has(line)) continue;
      if (!mask[at] || !mask[at + m[0].length - 1]) continue;
      const text = src.slice(lineStarts[line], src.indexOf('\n', at) === -1 ? src.length : src.indexOf('\n', at)).trim();
      if (/^import |^export \{|^\/\/|^\*/.test(text)) continue;
      out.push({ file, at, from: m[0], to, line: line + 1, text: text.slice(0, 140) });
    }
  }
  return { src, mutants: out.sort((a, b) => a.at - b.at) };
}

// ── workers: private copies of the tree, node_modules shared through a link ──

// Inside the repository's ignored .tmp folder, not the system's temporary folder: some antivirus programs lock
// copies of the test files there (measured: a test file full of shell commands could not be read back).
const work = join(root, '.tmp', `mutate-${process.pid}`);
/** Removes the work folder; a file another program still holds is left for the next run to clear. */
function clearWork() {
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    console.error(`mutate: could not remove ${work} (${err.code}); remove it by hand`);
  }
}
function makeWorker(i) {
  const dir = join(work, `w${i}`);
  mkdirSync(dir, { recursive: true });
  for (const p of ['src', 'test', 'packs', 'skills', 'skills-managed', 'skills-external', 'package.json', 'tsconfig.json'])
    cpSync(join(root, p), join(dir, p), { recursive: true });
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return dir;
}

function runTests(dir, tests, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--import', './test/helpers/clean-env.mjs', '--test', '--test-reporter=dot', ...tests], {
      cwd: dir,
      windowsHide: true,
      stdio: 'ignore',
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve('timeout');
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? 'passed' : 'failed');
    });
  });
}

const only = arg('only', null);
const limit = Number(arg('limit', '0'));
const workers = Number(arg('workers', String(Math.max(2, Math.min(12, cpus().length - 2)))));
const files = Object.keys(TARGETS).filter((f) => !only || f === only);
const started = Date.now();
clearWork();
const dirs = Array.from({ length: workers }, (_, i) => makeWorker(i));

const jobs = [];
for (const file of files) {
  const { src, mutants } = mutantsOf(file);
  const picked = limit ? mutants.slice(0, limit) : mutants;
  // Each file's tests must pass unmutated, or the run proves nothing.
  const base = await runTests(dirs[0], TARGETS[file]);
  if (base !== 'passed') {
    console.error(`mutate: the tests of ${file} do not pass unmutated (${base}); fix them first`);
    clearWork();
    process.exit(1);
  }
  for (const m of picked) jobs.push({ ...m, src, tests: TARGETS[file] });
}
console.log(`mutate: ${jobs.length} mutants in ${files.length} files, ${workers} at a time`);

const results = [];
let next = 0;
await Promise.all(
  dirs.map(async (dir) => {
    for (let k = next++; k < jobs.length; k = next++) {
      const j = jobs[k];
      const target = join(dir, j.file);
      writeFileSync(target, j.src.slice(0, j.at) + j.to + j.src.slice(j.at + j.from.length));
      const outcome = await runTests(dir, j.tests);
      writeFileSync(target, j.src);
      results.push({
        file: j.file,
        line: j.line,
        from: j.from.trim() || j.from,
        to: j.to.trim() || '(removed)',
        text: j.text,
        killed: outcome !== 'passed',
        outcome,
      });
      if (results.length % 25 === 0) process.stdout.write(`\r${results.length}/${jobs.length}`);
    }
  }),
);
process.stdout.write('\r');
clearWork();

// Survivors already examined and found not to be gaps: changes that make no difference, branches an agent
// may not write a fixture for, comparisons that only the shipped bundle reaches. Each one says why.
const known = JSON.parse(readFileSync(join(root, 'test', 'mutation-equivalents.json'), 'utf8')).entries;
for (const r of results) {
  if (r.killed) continue;
  const e = known.find((k) => k.file === r.file && k.from === r.from && k.to === r.to && r.text.includes(k.line));
  if (e) r.explained = { kind: e.kind, why: e.why };
}
const scored = results.filter((r) => !r.explained);
const byFile = files.map((f) => {
  const rs = scored.filter((r) => r.file === f);
  const killed = rs.filter((r) => r.killed).length;
  return { file: f, mutants: rs.length, killed, score: rs.length ? Math.round((1000 * killed) / rs.length) / 10 : 100 };
});
const survivors = scored.filter((r) => !r.killed).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
const explained = results.filter((r) => r.explained);
const total = { mutants: scored.length, killed: scored.filter((r) => r.killed).length, explained: explained.length };
mkdirSync(join(root, 'coverage'), { recursive: true });
writeFileSync(join(root, 'coverage', 'mutation.json'), JSON.stringify({ at: new Date().toISOString(), total, byFile, survivors, explained }, null, 2));
const lines = [
  `mutation score ${((100 * total.killed) / Math.max(1, total.mutants)).toFixed(1)}%: ${total.killed} of ${total.mutants} changes caught (${Math.round((Date.now() - started) / 1000)} s; ${total.explained} more survived for reasons listed in test/mutation-equivalents.json)`,
  '',
  ...byFile.map((b) => `${String(b.score).padStart(5)}%  ${String(b.killed).padStart(4)}/${String(b.mutants).padEnd(4)} ${b.file}`),
  '',
  `survivors (${survivors.length}):`,
  ...survivors.map((s) => `  ${s.file}:${s.line}  ${s.from} → ${s.to}   ${s.text}`),
  '',
  `explained (${explained.length}):`,
  ...explained.map((s) => `  ${s.file}:${s.line}  ${s.from} → ${s.to}   [${s.explained.kind}] ${s.explained.why}`),
];
writeFileSync(join(root, 'coverage', 'mutation.txt'), lines.join('\n') + '\n');
console.log(lines.slice(0, byFile.length + 4).join('\n'));
console.log(`survivors: ${survivors.length} (coverage/mutation.txt)`);
for (const s of survivors) console.log(`  ${s.file}:${s.line}  ${s.from} → ${s.to}   ${s.text}`);
// A survivor is a finding: a test to write, or a change to explain in test/mutation-equivalents.json.
// A partial run (--only, --limit) only reports.
process.exit(survivors.length && !only && !limit ? 1 : 0);
