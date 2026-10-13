// SPDX-License-Identifier: Apache-2.0
/**
 * A rename, rehearsed end to end before the real one (docs/release.md, "Renaming"):
 *   1. today's build is installed into a temporary home (a stand-in `claude`, its own Claude Code folder),
 *      with a setting changed, a history file and a memory kept inside the data folder, as a person has;
 *   2. a copy of this work tree is renamed by scripts/rename.ts, built, type-checked and tested;
 *   3. the renamed build installs over the old installation, and what a person relies on is checked: the
 *      settings and history came along, the hooks were swapped, the old plugin and folder are gone, the
 *      memory folder moved with Claude Code's setting, the doctor finds nothing of the old name left.
 * Nothing outside the temporary folder is touched.
 *
 * Usage: node scripts/rename-rehearsal.mjs [--no-tests] [--keep]   (needs a build: npm run build)
 *   --no-tests  leaves out the renamed copy's tests (about a minute)
 *   --keep      keeps the renamed copy, to look at what failed
 * Exit: 0 passed · 1 failed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEW = 'rehearsal-tool';
const OLD = /export const APP_ID = '([^']+)';/.exec(readFileSync(join(root, 'src', 'core', 'app.ts'), 'utf8'))[1];
const UPPER = (id) => id.replace(/-/g, '_').toUpperCase();
const tests = !process.argv.includes('--no-tests');
const keep = process.argv.includes('--keep');
const started = Date.now();

if (!existsSync(join(root, 'dist', 'cli.mjs'))) {
  console.error('rename-rehearsal: no build (run npm run build first)');
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'tc-rename-'));
// The renamed copy lives under this checkout's .tmp/ (ignored by git): Node finds this checkout's
// node_modules by walking up from it, with no link to follow, and nothing outside the checkout is written.
mkdirSync(join(root, '.tmp'), { recursive: true });
const copyBase = mkdtempSync(join(root, '.tmp', 'rename-rehearsal-'));
const fwd = (p) => p.replace(/\\/g, '/');
const checks = [];
const check = (what, ok, detail = '') => {
  checks.push({ what, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? ` · ${detail}` : ''}`);
};

/** PATH without any folder that holds a real `claude`: Windows finds a claude.exe before the stand-in's .cmd. */
const withoutClaude = (path) =>
  path
    .split(delimiter)
    .filter((d) => {
      try {
        return !readdirSync(d).some((f) => /^claude(?:\.exe|\.cmd|\.bat)?$/i.test(f));
      } catch {
        return true;
      }
    })
    .join(delimiter);

/** A child process with no variable of a Claude Code session this may run in, and the stand-in as the only claude on PATH. */
function env(extra) {
  const e = {};
  for (const [k, v] of Object.entries(process.env))
    if (!k.startsWith('CLAUDE_CODE_') && k !== 'CLAUDECODE' && k !== 'NODE_OPTIONS' && k !== 'FORCE_COLOR') e[k] = v;
  const pk = Object.keys(e).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  e[pk] = join(tmp, 'bin') + delimiter + withoutClaude(e[pk] ?? '');
  return { ...e, NO_COLOR: '1', CLAUDE_CONFIG_DIR: join(tmp, 'home', '.claude'), FAKE_CLAUDE_STATE: join(tmp, 'claude.json'), ...extra };
}
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 900_000, ...opts });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const json = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

let code = 0;
try {
  const home = join(tmp, 'home');
  const oldData = join(home, `.${OLD}`);
  const newData = join(home, `.${NEW}`);
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(tmp, 'bin'));
  const fake = join(root, 'test', 'helpers', 'fake-claude.mjs');
  if (process.platform === 'win32') writeFileSync(join(tmp, 'bin', 'claude.cmd'), `@"${process.execPath}" "${fake}" %*\r\n`);
  else {
    writeFileSync(join(tmp, 'bin', 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`);
    chmodSync(join(tmp, 'bin', 'claude'), 0o755);
  }
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  writeFileSync(join(tmp, 'claude.json'), JSON.stringify({ version: '2.1.296', pluginVersion: version, plugins: [], calls: [] }));

  // ── 1. today's build, installed, lived in ──
  const oldEnv = env({ [`${UPPER(OLD)}_HOME`]: oldData, [`${UPPER(OLD)}_LANG`]: 'en' });
  const oldCli = join(root, 'dist', 'cli.mjs');
  const i1 = run(process.execPath, [oldCli, 'install', '--yes', '--json'], { cwd: home, env: oldEnv });
  check(`${OLD} installed from today's build`, i1.code === 0 && json(i1.out)?.ok === true, i1.code === 0 ? '' : (i1.out + i1.err).slice(0, 400));
  run(process.execPath, [oldCli, 'config', 'set', 'view', '"detailed"'], { cwd: home, env: oldEnv });
  mkdirSync(join(oldData, 'events', '2026-10'), { recursive: true });
  writeFileSync(join(oldData, 'events', '2026-10', 'rehearsal.cli.jsonl'), '{"t":1,"kind":"rehearsal"}\n');
  // A memory kept on GitHub only lives inside the data folder, and Claude Code's setting points into it.
  const memory = join(oldData, 'memory', 'notes');
  mkdirSync(memory, { recursive: true });
  writeFileSync(join(memory, 'MEMORY.md'), '# Memory\n');
  const settingsFile = join(home, '.claude', 'settings.json');
  const settings = json(readFileSync(settingsFile, 'utf8'));
  writeFileSync(settingsFile, JSON.stringify({ ...settings, autoMemoryDirectory: fwd(memory) }, null, 2));

  // ── 2. a copy of this work tree, renamed, built, checked ──
  const copy = join(copyBase, 'repo');
  const files = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  for (const f of files) if (existsSync(join(root, f))) cpSync(join(root, f), join(copy, f));
  const git = (args) => run('git', ['-c', 'user.name=rehearsal', '-c', 'user.email=rehearsal@localhost', '-c', 'core.autocrlf=false', ...args], { cwd: copy });
  git(['init', '-q']);
  git(['add', '-A']);
  git(['commit', '-qm', 'before the rename']);
  const r = run(process.execPath, ['--import', 'tsx', 'scripts/rename.ts', '--to', NEW, '--apply'], { cwd: copy, env: env({}) });
  check(
    `the copy renamed to ${NEW}`,
    r.code === 0,
    (/rename: [^\n]*replacements[^\n]*/.exec(r.out)?.[0] ?? (r.out + r.err).slice(-400)).replace(/^rename: /, ''),
  );
  const left = run('git', ['grep', '-n', '-I', '-E', `${OLD}|${UPPER(OLD)}`], { cwd: copy })
    .out.split('\n')
    .filter(Boolean);
  // What may keep the old name: the record of it, and the changelog line that says it changed.
  const allowed = left.filter((l) => /^src\/core\/app\.ts:.*PREVIOUS_NAMES|^src\/core\/app\.ts:.*\{ id: '|^CHANGELOG\.md:.*it was /.test(l));
  check(
    'nothing else in the renamed copy carries the old name',
    left.length === allowed.length,
    left
      .filter((l) => !allowed.includes(l))
      .slice(0, 5)
      .join(' | '),
  );
  const b = run(process.execPath, ['scripts/build.mjs'], { cwd: copy });
  check('the renamed copy builds', b.code === 0, (/built [^\n]*/.exec(b.out)?.[0] ?? b.err.slice(0, 400)).trim());
  const tc = run(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], { cwd: copy });
  check('the renamed copy type-checks', tc.code === 0, (tc.out + tc.err).slice(0, 400));
  const fmt = run(process.execPath, [join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs'), '--check', '.'], { cwd: copy });
  check('the renamed copy is formatted', fmt.code === 0, fmt.code === 0 ? '' : (fmt.out + fmt.err).slice(-400));
  if (tests) {
    // The doctor's golden reports gain a line under a new name (nothing installed under the earlier one):
    // they are rewritten, as the person rewrites and reviews them after the real rename.
    const t = run(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', 'test/**/*.test.ts', 'test/**/*.test.tsx'], {
      cwd: copy,
      env: env({ UPDATE_GOLDEN: '1' }),
    });
    const golden = run('git', ['status', '--porcelain', '--', 'test/golden'], { cwd: copy }).out.split('\n').filter(Boolean);
    check('the golden reports a rename changes', true, `${golden.length} rewritten: ${golden.map((l) => l.slice(3).replace('test/golden/', '')).join(', ')}`);
    const n = (k) => new RegExp(`ℹ ${k} (\\d+)`).exec(t.out)?.[1] ?? '?';
    // The spec reporter lists each failing test again after "failing tests:", once.
    const failing = [...new Set([...t.out.slice(t.out.indexOf('failing tests:')).matchAll(/^✖ (.*?) \(\d/gm)].map((m) => m[1]))].slice(0, 8);
    check(
      'the renamed copy passes its tests',
      t.code === 0,
      `${n('pass')} passed, ${n('fail')} failed, ${n('skipped')} skipped${failing.length ? `: ${failing.join(' | ')}` : ''}`,
    );
  }

  // ── 3. the renamed build installs over the old installation ──
  const newEnv = env({ [`${UPPER(NEW)}_HOME`]: newData, [`${UPPER(NEW)}_LANG`]: 'en' });
  const newCli = join(copy, 'dist', 'cli.mjs');
  const plan = json(run(process.execPath, [newCli, 'install', '--dry-run', '--json'], { cwd: home, env: newEnv }).out);
  const kinds = plan?.plan?.steps?.map((s) => s.kind) ?? [];
  check('the plan shows the move before anything is done', kinds[0] === 'migrate' && kinds.at(-1) === 'retire-previous', kinds.join(', '));
  const i2 = run(process.execPath, [newCli, 'install', '--yes', '--json'], { cwd: home, env: newEnv });
  const res = json(i2.out);
  check(
    `${NEW} installed over ${OLD}`,
    i2.code === 0 && res?.ok === true,
    (res?.steps ?? []).map((s) => `${s.ok ? '✓' : '✗'} ${s.kind}${s.ok ? '' : `: ${s.detail}`}`).join(', '),
  );
  check(`${OLD}'s folder is gone`, !existsSync(oldData));
  const cfg = existsSync(join(newData, 'config.json')) ? json(readFileSync(join(newData, 'config.json'), 'utf8')) : null;
  check('the setting changed under the old name is kept', cfg?.view === 'detailed', `view: ${cfg?.view}`);
  check('the history came along', existsSync(join(newData, 'events', '2026-10', 'rehearsal.cli.jsonl')));
  const after = json(readFileSync(settingsFile, 'utf8'));
  const commands = Object.values(after?.hooks ?? {})
    .flat()
    .flatMap((g) => g.hooks ?? [])
    .map((h) => fwd([h.command, ...(h.args ?? [])].join(' ')));
  check(
    `Claude Code's settings run only ${NEW}'s hooks, one per event`,
    commands.length === 4 && commands.every((c) => c.includes(`/.${NEW}/bin/hook.mjs`)) && !commands.some((c) => c.includes(`/.${OLD}/`)),
    `${commands.length} hooks`,
  );
  check(
    "the memory moved, and Claude Code's setting with it",
    after?.autoMemoryDirectory === fwd(join(newData, 'memory', 'notes')) && existsSync(join(newData, 'memory', 'notes', 'MEMORY.md')),
    String(after?.autoMemoryDirectory),
  );
  const claude = json(readFileSync(join(tmp, 'claude.json'), 'utf8'));
  const ids = claude.plugins.map((p) => p.id);
  check(`only ${NEW}'s plugin is installed`, ids.length === 1 && ids[0] === `${NEW}@${NEW}-local`, ids.join(', '));
  check(
    `${OLD}'s marketplace was removed`,
    claude.calls.some((c) => c.join(' ') === `plugin marketplace remove ${OLD}-local`),
  );
  const doc = json(run(process.execPath, [newCli, 'doctor', '--json'], { cwd: home, env: newEnv }).out);
  const status = (id) => doc?.checks?.find((c) => c.id === id)?.status;
  check(
    'the doctor finds nothing of the old name, and the installation whole',
    status('install.previous') === 'ok' && status('install.hooks') === 'ok' && status('install.manifest') === 'ok' && status('claude.plugin') === 'ok',
    ['install.previous', 'install.manifest', 'install.hooks', 'claude.plugin'].map((id) => `${id} ${status(id)}`).join(', '),
  );
} catch (err) {
  check('the rehearsal ran to its end', false, err.stack?.slice(0, 600));
} finally {
  if (keep) console.log(`rename-rehearsal: kept ${tmp} and ${copyBase}`);
  else for (const d of [tmp, copyBase]) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
}
const failed = checks.filter((c) => !c.ok).length;
if (failed) code = 1;
console.log(
  `rename-rehearsal: ${OLD} → ${NEW}: ${checks.length - failed} of ${checks.length} checks passed${tests ? '' : ' (tests of the renamed copy left out)'} in ${((Date.now() - started) / 1000).toFixed(0)} s`,
);
process.exit(code);
