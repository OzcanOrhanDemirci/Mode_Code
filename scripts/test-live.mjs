// SPDX-License-Identifier: Apache-2.0
/**
 * Live tests: a real Claude Code session, run headless (`claude -p`) with the built plugin and the
 * safety-net hooks loaded from dist/, in a temporary project with its own data folder. Only the project's
 * settings are read (`--setting-sources project`), so the person's own hooks and settings stay out; the
 * person's login is used, so this costs a little quota: the cheapest model, a spending cap per session.
 *
 *   1. a harmless command runs, and the session's mod reports itself alive in the data folder;
 *   2. a write into the tool's own data folder is refused, and the file is never created;
 *   3. a keyword typed as the prompt reaches the mod, which logs it;
 *   4. research mode refuses a write into the project, and the file is never created;
 *   5. a research flow: the model writes a sourced report, calls flow_step, and code checks it and ends the flow.
 *
 * Usage: node scripts/test-live.mjs --yes      (opt-in; without --yes it only says what it would do)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const fwd = (p) => p.replace(/\\/g, '/');
if (!process.argv.includes('--yes')) {
  console.log('test-live: opt-in. Runs five short headless Claude Code sessions (cheapest model, capped spend) with this build loaded. Run with --yes.');
  process.exit(0);
}
if (!existsSync(join(dist, 'hook.mjs'))) {
  console.error('test-live: no build (run npm run build first)');
  process.exit(1);
}

const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE') delete env[k];
// Outside the system's temporary folder: the restricted modes allow writes there, and on Windows Git Bash's
// /tmp is that folder, so a project inside it could not show what research mode refuses.
mkdirSync(join(root, '.tmp'), { recursive: true });
const work = mkdtempSync(join(root, '.tmp', 'live-'));
const project = join(work, 'project');
const data = join(work, 'data');
mkdirSync(project);
mkdirSync(data);
writeFileSync(join(data, 'config.json'), JSON.stringify({ language: 'en', projects: [{ id: 'live-app', names: ['liveapp'] }] }, null, 2));
env.TERMINAL_CODE_HOME = data;
env.TERMINAL_CODE_LANG = 'en';

// The safety-net hooks, as the installer writes them, pointing at the built hook program.
const node = fwd(process.execPath);
const hook = fwd(join(dist, 'hook.mjs'));
const entry = (event, timeout, block) => ({ type: 'command', command: node, args: [hook, event], timeout, ...(block ? { onFailure: 'block' } : {}) });
const settings = join(work, 'settings.json');
writeFileSync(
  settings,
  JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: 'Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit', hooks: [entry('PreToolUse', 15, true)] }],
      UserPromptSubmit: [{ hooks: [entry('UserPromptSubmit', 10, false)] }],
      SessionStart: [{ hooks: [entry('SessionStart', 10, false)] }],
    },
  }),
);

function session(prompt) {
  const args = [
    '-p',
    prompt,
    '--plugin-dir',
    join(dist, 'plugin'),
    '--settings',
    settings,
    '--setting-sources',
    'project',
    '--model',
    'haiku',
    '--max-budget-usd',
    '0.25',
    '--allowedTools',
    'Bash,Write,Read,Edit,Glob,Grep,mcp__terminal-code__flow_step',
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
  ];
  let r = spawnSync('claude', args, { cwd: project, env, encoding: 'utf8', timeout: 240_000, windowsHide: true });
  if (r.error && process.platform === 'win32') {
    const q = (a) => (/^[\w@./:=,-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);
    r = spawnSync(['claude', ...args.map(q)].join(' '), { cwd: project, env, encoding: 'utf8', timeout: 240_000, windowsHide: true, shell: true });
  }
  const events = (r.stdout ?? '')
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const final = events.find((e) => e.type === 'result');
  return { status: r.status, events, final, text: JSON.stringify(events), stderr: r.stderr ?? '' };
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`);
};

try {
  const one = session('Run this exact shell command with the Bash tool, nothing else: echo tc-live-ok . Then reply with the single word DONE.');
  check('a harmless command runs', one.text.includes('tc-live-ok'), one.final?.result?.slice?.(0, 60) ?? one.stderr.slice(0, 200));
  const sessions = existsSync(join(data, 'state', 'sessions')) ? readdirSync(join(data, 'state', 'sessions')).filter((f) => f.endsWith('.mod.json')) : [];
  const mod = sessions.length ? JSON.parse(readFileSync(join(data, 'state', 'sessions', sessions[0]), 'utf8')) : null;
  check('the plugin loaded in the real engine and reported itself alive', !!mod?.aliveAt, mod ? `mod ${mod.modVersion}` : 'no session state');

  const probe = join(data, 'probe.txt');
  const two = session(
    `Use the Write tool to write the text x to the file ${fwd(probe)} . If the write is refused, reply with the single word REFUSED and do not try anything else.`,
  );
  check('a write into the tool data folder is refused', !existsSync(probe), existsSync(probe) ? 'the file was created' : '');
  check('the refusal reached the model with its reason', /own files|self\.tool-files/.test(two.text), two.final?.result?.slice?.(0, 60) ?? '');

  const three = session('liveapp devam');
  const month = existsSync(join(data, 'events')) ? readdirSync(join(data, 'events')) : [];
  const logged = month.flatMap((m) => readdirSync(join(data, 'events', m)).map((f) => readFileSync(join(data, 'events', m, f), 'utf8'))).join('\n');
  check(
    'a keyword typed as the prompt reached the mod',
    /"kind":"keyword"/.test(logged) && /"keyword":"continue"/.test(logged),
    three.final ? '' : three.stderr.slice(0, 200),
  );
  // Prompts carry no line breaks: on Windows the session starts through cmd.exe, which ends a command at one.
  const four = session(
    'Use the Write tool to write the text x to the file note.txt in the current folder. If it is refused, reply with the single word REFUSED and try nothing else. research',
  );
  const logged4 = readdirSync(join(data, 'events'))
    .flatMap((m) => readdirSync(join(data, 'events', m)).map((f) => readFileSync(join(data, 'events', m, f), 'utf8')))
    .join('\n');
  check(
    'research mode refuses a write into the project',
    !existsSync(join(project, 'note.txt')) && /"kind":"mode","tool":"Write","verdict":"deny","mode":"research"/.test(logged4),
    existsSync(join(project, 'note.txt')) ? 'the file was created' : (four.final?.result?.slice?.(0, 60) ?? ''),
  );

  writeFileSync(join(project, 'README.md'), '# Demo\n\nA tiny demo project.\nIt prints hello.\n');
  const five = session('What does this project do? Answer from its files. flow research');
  const flows = existsSync(join(data, 'flows')) ? readdirSync(join(data, 'flows')) : [];
  const record = flows.length ? JSON.parse(readFileSync(join(data, 'flows', flows[0], 'flow.json'), 'utf8')) : null;
  check(
    'a research flow ends only after code checked the report, and keeps a copy',
    record?.status === 'done' && record.steps[0].evidence?.kind === 'research' && existsSync(join(data, 'flows', flows[0], 'research.md')),
    record ? `${record.status}, ${record.history.map((h) => h.event).join(' ')}` : (five.final?.result?.slice?.(0, 80) ?? five.stderr.slice(0, 200)),
  );
  const cost = [one, two, three, four, five].reduce((n, s) => n + (s.final?.total_cost_usd ?? 0), 0);
  console.log(`test-live: ${results.filter((r) => r.ok).length} of ${results.length} passed · cost reported by Claude Code: $${cost.toFixed(3)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
