// SPDX-License-Identifier: Apache-2.0
/**
 * Tool packs in the real Claude Code, in a configuration folder of their own (docs/packs.md): the built packs as a
 * local marketplace, one turned on for one project (`claude plugin install … --scope local`, what `mode-code packs`
 * runs), what `claude plugin list --json` then says from that project and from another, and turning it off again.
 * Claude Code's own folder is never touched: CLAUDE_CONFIG_DIR, HOME and USERPROFILE point into a temporary folder,
 * and the person's installed-plugins record is compared before and after. No session starts, so nothing is spent.
 *
 * Usage: node scripts/test-packs.mjs   (after npm run build)
 * Exit: 0 passed · 1 failed.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmdShimLine } from './cmd-line.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packs = join(root, 'dist', 'packs', 'plugins');
if (!existsSync(packs)) {
  console.error('test-packs: build first (npm run build)');
  process.exit(1);
}
const realRecord = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'plugins', 'installed_plugins.json');
const hashOf = (f) => (existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : 'none');
const before = hashOf(realRecord);
const installed = spawnSync('claude', ['--version'], { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' });
if (installed.status !== 0) {
  console.log('test-packs: skipped: Claude Code is not installed here');
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), 'mc-packs-'));
const home = join(work, 'home');
const config = join(home, '.claude');
const market = join(work, 'market');
const project = join(work, 'project');
const other = join(work, 'other');
for (const d of [config, join(market, '.claude-plugin'), project, other]) mkdirSync(d, { recursive: true });
const names = readdirSync(packs);
for (const n of names) cpSync(join(packs, n), join(market, 'plugins', n), { recursive: true });
writeFileSync(
  join(market, '.claude-plugin', 'marketplace.json'),
  JSON.stringify({ name: 'mode-code-test', owner: { name: 'mode-code' }, plugins: names.map((n) => ({ name: n, source: `./plugins/${n}` })) }, null, 2),
);

const env = { ...process.env, CLAUDE_CONFIG_DIR: config, HOME: home, USERPROFILE: home };
for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE') delete env[k];
const claude = (args, cwd = project) => {
  const base = { cwd, env, encoding: 'utf8', timeout: 120_000, windowsHide: true };
  let r = spawnSync('claude', args, base);
  // Where claude is a script (npm's claude.cmd), Windows starts it only through the shell.
  if (r.error && process.platform === 'win32') r = spawnSync(cmdShimLine('claude', args), { ...base, shell: true });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
};
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`);
};
const listIn = (cwd) => {
  const r = claude(['plugin', 'list', '--json'], cwd);
  try {
    return JSON.parse(r.out.slice(r.out.indexOf('[')));
  } catch {
    return null;
  }
};

try {
  // Each built pack as Claude Code reads a plugin, strictly.
  const invalid = names.filter((n) => !claude(['plugin', 'validate', '--strict', join(packs, n)]).ok);
  check(`every pack passes claude plugin validate --strict (${names.length})`, invalid.length === 0, invalid.join(', '));
  const add = claude(['plugin', 'marketplace', 'add', market]);
  check('the packs read as a marketplace', add.ok, add.out.split('\n').pop());
  const id = 'mode-code-typst@mode-code-test';
  const on = claude(['plugin', 'install', id, '--scope', 'local']);
  check('a pack turned on for one project', on.ok, on.out.split('\n').pop());
  const local = JSON.parse(readFileSync(join(project, '.claude', 'settings.local.json'), 'utf8'));
  check("the project's local settings name it", local.enabledPlugins?.[id] === true, JSON.stringify(local.enabledPlugins));
  const here = listIn(project);
  const row = here?.find((p) => p.id === id);
  check('listed from the project', !!row, JSON.stringify(row));
  console.log(`  list --json from the project: ${JSON.stringify(row)}`);
  const there = listIn(other)?.find((p) => p.id === id);
  console.log(`  list --json from another folder: ${JSON.stringify(there ?? null)}`);
  check('another folder does not have it on', !there || there.enabled !== true, JSON.stringify(there ?? null));
  const off = claude(['plugin', 'uninstall', id, '--scope', 'local']);
  check('turned off again', off.ok, off.out.split('\n').pop());
  const after = JSON.parse(readFileSync(join(project, '.claude', 'settings.local.json'), 'utf8'));
  console.log(`  local settings after: ${JSON.stringify(after)}`);
  check('the local settings no longer name it', after.enabledPlugins?.[id] === undefined, JSON.stringify(after.enabledPlugins ?? null));
} finally {
  rmSync(work, { recursive: true, force: true });
}
check("the person's own installed-plugins record is unchanged", hashOf(realRecord) === before);
console.log(`test-packs: ${results.filter(Boolean).length} of ${results.length} passed`);
process.exitCode = results.every(Boolean) ? 0 : 1;
