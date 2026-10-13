// SPDX-License-Identifier: Apache-2.0
/**
 * Runs the mod's tests inside Claude Code's own engine (`claude plugin test`), against the built plugin:
 * dist/plugin is copied to a temporary folder together with test/mod/*.kit.ts (as tests/*.test.ts), and
 * the engine loads the plugin from there exactly as a session would. Also checks the plugin the way Claude
 * Code reads it (`claude plugin validate --strict`), and that the guard on tool calls fails closed.
 *
 * Usage: node scripts/test-mod.mjs          (needs Claude Code on PATH and a build)
 * Exit: 0 passed · 1 failed · 0 with "skipped" when Claude Code is not installed (nothing to run against).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = join(root, 'dist', 'plugin');
if (!existsSync(join(plugin, '.claude-plugin', 'plugin.json'))) {
  console.error('test-mod: no build (run npm run build first)');
  process.exit(1);
}

const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE') delete env[k];
const claude = (args, opts = {}) => {
  let r = spawnSync('claude', args, { encoding: 'utf8', env, windowsHide: true, timeout: 300_000, ...opts });
  if (r.error && process.platform === 'win32')
    r = spawnSync(['claude', ...args].join(' '), { encoding: 'utf8', env, shell: true, windowsHide: true, timeout: 300_000, ...opts });
  return r;
};

const version = claude(['--version']);
if (version.error || version.status !== 0) {
  console.log('test-mod: skipped: Claude Code is not installed (the claude command does not run)');
  process.exit(0);
}
console.log(`test-mod: Claude Code ${version.stdout.trim()}`);

// ── the plugin as Claude Code reads it ──
const validate = claude(['plugin', 'validate', '--json', '--strict', plugin]);
let report;
try {
  report = JSON.parse(validate.stdout);
} catch {
  console.error(`test-mod: validate did not answer in JSON:\n${validate.stdout}${validate.stderr}`);
  process.exit(1);
}
if (validate.status !== 0) {
  console.error(`test-mod: claude plugin validate --strict failed:\n${JSON.stringify(report, null, 2)}`);
  process.exit(1);
}
// The guard on tool calls must have a .catch that answers when the hook fails: a protection that fails open is none.
const gates = (report.contents ?? []).flatMap((c) => c.gatingHooks ?? []);
const toolGate = gates.find((g) => g.hook === 'tool.call');
if (!toolGate || toolGate.hasCatch !== true) {
  console.error(`test-mod: the tool.call guard has no .catch, so a failing guard would let calls through: ${JSON.stringify(gates)}`);
  process.exit(1);
}
// What the mod reaches through $: a new noun (a network call, a process spawn) must be a reviewed decision.
const ALLOWED = new Set([
  'clock.after',
  'clock.now',
  'env.get',
  'fs.list',
  'fs.read',
  'fs.stat',
  'fs.write',
  'process.run',
  'prompt.submit',
  'session.append',
  'session.cwd',
  'session.id',
  'session.root',
  'state.get',
  'state.set',
  // Flows: the flow_step tool is registered, and the code step runs the approved plan's verification
  // commands through Claude Code's own shell tool (found with tool.list), so the belt and the permission
  // rules judge them as any command; the band above the prompt is drawn from the surface's elements.
  'tool.call',
  'tool.list',
  'tool.register',
  'ui.ask',
  'ui.notify',
  'ui.resolve',
  'ui.toast',
  // Full autonomy (docs/autonomy.md): the start checks read Claude Code's merged settings (the sandbox keys)
  // and whether WSL's interop entry exists; a run's request may come from the person's last message; the
  // independent review of a milestone is one model call through Claude Code's own client, to the session's
  // provider, with the session's model unless the person names another (no other network use).
  'fs.exists',
  'model.complete',
  'session.messages',
  'session.model',
  'settings.read',
  // The controls (docs/modes.md, "Controls"): the slash commands /0 to /9, /devam, /kota and /akis are
  // registered and answered; a press on the strip above the prompt runs the same command.
  'command.register',
  'command.run',
]);
const notes = (report.contents ?? []).flatMap((c) => c.notes ?? []);
const callsNote = notes.find((n) => / calls: /.test(n)) ?? '';
// The validator cuts a long list ("$.tool.re… [+96 chars]"): only whole names count from it, and the
// bundle itself is read too, so a call past the cut is still seen.
const listed = [...callsNote.matchAll(/\$\.([a-z]+\.[a-zA-Z]+)(?![a-zA-Z…])/g)].map((m) => m[1]);
const source = readFileSync(join(plugin, 'hooks', 'register.js'), 'utf8');
const read = [...source.matchAll(/\$\.([a-z]+\.[a-zA-Z]+)\s*\(/g)].map((m) => m[1]);
const calls = [...new Set([...listed, ...read])];
const unexpected = calls.filter((c) => !ALLOWED.has(c));
if (!calls.length || unexpected.length) {
  console.error(`test-mod: the mod calls ${unexpected.length ? `something not reviewed: ${unexpected.join(', ')}` : 'nothing the validator could list'}`);
  process.exit(1);
}
const envWrites = notes.find((n) => / env writes: /.test(n)) ?? '';
if (!/env writes: nothing/.test(envWrites)) {
  console.error(`test-mod: the mod changes environment variables: ${envWrites}`);
  process.exit(1);
}
console.log(`test-mod: validate --strict passed · tool.call guard fails closed · ${calls.length} kinds of $ calls, all reviewed`);

// ── the tests, in the engine ──
const work = mkdtempSync(join(tmpdir(), 'tc-modtest-'));
try {
  cpSync(plugin, work, { recursive: true });
  mkdirSync(join(work, 'tests'));
  const kits = readdirSync(join(root, 'test', 'mod')).filter((f) => f.endsWith('.kit.ts'));
  for (const f of kits) cpSync(join(root, 'test', 'mod', f), join(work, 'tests', f.replace(/\.kit\.ts$/, '.test.ts')));
  for (const f of readdirSync(join(root, 'test', 'mod')).filter((x) => x.endsWith('.ts') && !x.endsWith('.kit.ts')))
    cpSync(join(root, 'test', 'mod', f), join(work, 'tests', f));
  const r = claude(['plugin', 'test', work], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
} finally {
  rmSync(work, { recursive: true, force: true });
}
