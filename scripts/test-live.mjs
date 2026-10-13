// SPDX-License-Identifier: Apache-2.0
/**
 * Live tests: a real Claude Code session, run headless (`claude -p`) with the built plugin and the
 * safety-net hooks loaded from dist/, in a temporary project with its own data folder. Only the project's
 * settings are read (`--setting-sources project`), so the person's own hooks and settings stay out; the
 * person's login is used, so this costs a little quota: the cheapest model, a spending cap per session.
 *
 *   1. a harmless command runs, and the session's mod reports itself alive in the data folder;
 *   2. a write into the tool's own data folder is refused, and the file is never created;
 *   3. a keyword typed as the prompt reaches the mod, which logs it (one that asks for a summary, not for work);
 *   4. research mode keeps the project unchanged: the guard refuses the write, or the model, told the mode, does not try;
 *   5. a research flow: the model writes a sourced report, calls flow_step, and code checks it and ends the flow;
 *   6. full autonomy: on native Windows the start checks refuse it; in WSL2, macOS or Linux a whole run;
 *   7. there too, a stop before the run is done is turned back by the safety-net hook; the run then finishes,
 *      or, when the model keeps stopping with nothing changed, the stall guard pauses it;
 *   8. the memory: a change made elsewhere is pulled at the start and reaches Claude before it answers, the
 *      handoff keyword has Claude write a note that is kept and sent, and the next session is told about it.
 *
 * Usage: node scripts/test-live.mjs --yes      (opt-in; without --yes it only says what it would do)
 *        add --keep to leave the sessions' folders and the full-autonomy sessions' streams in place
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const fwd = (p) => p.replace(/\\/g, '/');
if (!process.argv.includes('--yes')) {
  console.log(
    'test-live: opt-in. Runs nine short headless Claude Code sessions, ten where full autonomy can run (cheapest model, capped spend), with this build loaded. Run with --yes.',
  );
  process.exit(0);
}
if (!existsSync(join(dist, 'hook.mjs'))) {
  console.error('test-live: no build (run npm run build first)');
  process.exit(1);
}

const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE') delete env[k];
// Where the sessions work: outside the system's temporary folder (the restricted modes allow writes there,
// and on Windows Git Bash's /tmp is that folder, so a project inside it could not show what research mode
// refuses), and outside any repository, with a repository of its own. Measured: a session working in a
// folder inside this repository found the repository's uncommitted changes and committed them.
const base = join(homedir(), '.cache', 'terminal-code-live');
mkdirSync(base, { recursive: true });
const work = mkdtempSync(join(base, 'run-'));
const project = join(work, 'project');
const data = join(work, 'data');
mkdirSync(project);
mkdirSync(data);
spawnSync('git', ['init', '-q', project], { windowsHide: true });
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

function session(prompt, settingsFile = settings, tools = 'Bash,Write,Read,Edit,Glob,Grep,mcp__terminal-code__flow_step') {
  const args = [
    '-p',
    prompt,
    '--plugin-dir',
    join(dist, 'plugin'),
    '--settings',
    settingsFile,
    '--setting-sources',
    'project',
    '--model',
    'haiku',
    '--max-budget-usd',
    '0.25',
    '--allowedTools',
    tools,
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

/**
 * 6. Full autonomy (docs/autonomy.md), where it can run: Linux, macOS, WSL2. A project with a first commit,
 * the strict sandbox, the Stop hook, full autonomy turned on; the task is small and its verification real.
 * The run must pass its start checks (the live probe included), plan, reach a milestone on a commit with a
 * rollback reference, and finish with its verification passing and its report written.
 */
function fullAutonomy() {
  if (process.platform === 'win32') {
    // Here the run must not start: the start checks run in the real engine and refuse it, naming the platform.
    const cfg = JSON.parse(readFileSync(join(data, 'config.json'), 'utf8'));
    writeFileSync(join(data, 'config.json'), JSON.stringify({ ...cfg, autonomy: { enabled: true } }, null, 2));
    const s = session('Write hello.txt with the word hi. liveapp full auto quota 99');
    const logged = readdirSync(join(data, 'events'))
      .flatMap((m) => readdirSync(join(data, 'events', m)).map((f) => readFileSync(join(data, 'events', m, f), 'utf8')))
      .join('\n');
    const gate = logged
      .split('\n')
      .filter((l) => l.includes('"kind":"run"') && l.includes('"action":"gate"'))
      .map((l) => JSON.parse(l))
      .at(-1);
    check(
      'full autonomy on native Windows: the start checks refuse the run in the real engine, naming the platform',
      !!gate && gate.ok === false && gate.failed.includes('platform') && !existsSync(join(data, 'runs')) && !existsSync(join(project, 'hello.txt')),
      gate ? `failed: ${gate.failed.join(', ')}` : (s.final?.result?.slice?.(0, 80) ?? s.stderr.slice(0, 200)),
    );
    console.log('· full autonomy itself runs only in WSL2, macOS or Linux; run this there for the whole run');
    return s;
  }
  const cfg = JSON.parse(readFileSync(join(data, 'config.json'), 'utf8'));
  writeFileSync(join(data, 'config.json'), JSON.stringify({ ...cfg, autonomy: { enabled: true, maxHours: 1, stallMinutes: 20 } }, null, 2));
  const s = JSON.parse(readFileSync(settings, 'utf8'));
  writeFileSync(
    join(work, 'settings-auto.json'),
    JSON.stringify({
      ...s,
      sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false },
      hooks: { ...s.hooks, Stop: [{ hooks: [entry('Stop', 15, false)] }] },
    }),
  );
  const { final, run, refs, stderr } = autoSession(
    'auto',
    'Write sum.js exporting a function sum(a, b) that returns a + b, and sum.test.js that tests it with node:test; the verification is node --test. full auto quota 99',
  );
  check(
    'full autonomy: the start checks passed, the live probe included, and a run started',
    !!run,
    run ? run.id : (final?.result?.slice?.(0, 120) ?? stderr.slice(0, 200)),
  );
  check(
    'full autonomy: the run planned, reached a milestone on a commit, and finished with its verification passing',
    run?.status === 'done' && run.milestones.length > 0 && run.finish?.verification.every((v) => v.ok),
    run ? `${run.status}, ${run.milestones.length} milestone(s), ${run.history.map((h) => h.event).join(' ')}` : '',
  );
  check(
    'full autonomy: rollback references and the report are kept',
    refs.length >= 2 && !!run && existsSync(join(data, 'runs', run.id, 'report.md')),
    refs.join(' '),
  );
  return { final };
}

/**
 * 7. A stop before the run is done is turned back: the person asks Claude to end its turn as soon as the
 * plan is accepted; the safety-net hook's Stop decision answers what is missing. A turn that ends and goes
 * on in a headless session is a stop the hook turned back. The run then reaches its finish, or, when the
 * model keeps to the person's word and stops again with nothing changed, the stall guard lets the third
 * such stop through and pauses the run: both are the design. A model that does not stop early leaves the
 * turn-back unexercised, which is said.
 */
function stopTurnedBack() {
  if (process.platform === 'win32') return null;
  const { final, run, hook, turnEnds } = autoSession(
    'auto-stop',
    'Write hello.js exporting a function hello() that returns the string hello, and hello.test.js that tests it with node:test; the verification is node --test. As soon as the plan is accepted, end your turn with the single word PAUSED. full auto quota 99',
  );
  const turnedBack = Math.max(0, turnEnds - 1);
  if (run && turnedBack === 0 && run.status === 'done') {
    console.log('· the model did not stop before the finish, so the Stop hook had nothing to turn back');
    return { final };
  }
  const held =
    !!run && run.status === 'paused' && run.pause?.reason === 'stalled' && hook?.autoAllowed?.runId === run.id && hook.autoAllowed.why === 'noProgress';
  if (held) console.log('· the model kept to the request to stop, so the stall guard paused the run and its finish went unexercised');
  check(
    'full autonomy: a stop before the run was done was turned back; the run finished, or the stall guard paused it',
    !!run && turnedBack > 0 && (run.status === 'done' || held),
    run ? `${run.status}, ${run.history.map((h) => h.event).join(' ')}, turned back ${turnedBack}` : 'no run',
  );
  return { final };
}

/**
 * 8. The memory (docs/memory.md), on every platform: a store kept in sync with a "GitHub" (a bare repository
 * here). A change made on another computer is pulled at the start and reaches Claude before it answers (Claude
 * Code may load the index before the pull lands: what came in is told with the first prompt); the handoff
 * keyword has Claude write a note through the handoff tool, kept in the store and sent; the next session is told.
 */
function memoryCases() {
  const gitIn = (dir, ...a) =>
    spawnSync('git', ['-C', dir, '-c', 'user.name=live', '-c', 'user.email=live@example.com', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
  const remote = fwd(join(work, 'memory-remote.git'));
  const store = fwd(join(work, 'memory'));
  const other = fwd(join(work, 'memory-other'));
  spawnSync('git', ['init', '-q', '--bare', remote]);
  spawnSync('git', ['clone', '-q', remote, store]);
  for (const k of [
    ['user.name', 'live'],
    ['user.email', 'live@example.com'],
    ['commit.gpgsign', 'false'],
  ])
    gitIn(store, 'config', ...k);
  writeFileSync(join(store, 'MEMORY.md'), '# Memory\n');
  gitIn(store, 'add', '-A');
  gitIn(store, 'commit', '-q', '-m', 'start');
  gitIn(store, 'push', '-q', '-u', 'origin', 'HEAD');
  // Another computer adds a note after this one last pulled.
  spawnSync('git', ['clone', '-q', remote, other]);
  writeFileSync(join(other, 'MEMORY.md'), '# Memory\n- The project codename is PELICAN.\n');
  gitIn(other, 'commit', '-q', '-am', 'from the other computer');
  gitIn(other, 'push', '-q');
  const cfg = JSON.parse(readFileSync(join(data, 'config.json'), 'utf8'));
  writeFileSync(
    join(data, 'config.json'),
    JSON.stringify({ ...cfg, memory: { store: { place: 'both', dir: store, remote, git: true, sync: 'auto' } } }, null, 2),
  );
  const s = JSON.parse(readFileSync(settings, 'utf8'));
  const memSettings = join(work, 'settings-memory.json');
  writeFileSync(memSettings, JSON.stringify({ ...s, autoMemoryDirectory: store }));
  const tools = 'Read,Glob,Grep,mcp__terminal-code__handoff';

  const asked = session('What is the project codename in your memory index? Reply with the codename only.', memSettings, tools);
  check(
    'memory: a change made elsewhere was pulled at the start and reached Claude before it answered',
    /PELICAN/i.test(asked.final?.result ?? ''),
    String(asked.final?.result ?? asked.stderr).slice(0, 80),
  );
  const handed = session('We only checked the memory today; nothing else is open. devir', memSettings, tools);
  const dir = join(store, 'handoffs', 'project');
  const notes = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{8}-\d{6}-/.test(f)) : [];
  const onRemote = spawnSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' }).stdout.split('\n');
  check(
    'memory: the handoff keyword wrote a note through the tool, kept in the store and sent to the remote',
    notes.length === 1 && onRemote.some((f) => f === `handoffs/project/${notes[0]}`),
    notes.length ? notes[0] : String(handed.final?.result ?? handed.stderr).slice(0, 80),
  );
  const next = notes.length ? (/## Next\n\n([^\n]+)/.exec(readFileSync(join(dir, notes[0]), 'utf8'))?.[1] ?? '') : '';
  const told = session('Is a handoff note waiting for this project? If so, reply with its next step only; if not, reply NONE.', memSettings, tools);
  const words = next.toLowerCase().match(/[a-zçğıöşü]{5,}/g) ?? [];
  check(
    'memory: the next session was told about the note',
    !/\bNONE\b/.test(told.final?.result ?? 'NONE') && words.some((w) => (told.final?.result ?? '').toLowerCase().includes(w)),
    String(told.final?.result ?? '').slice(0, 80),
  );
  return [asked, handed, told];
}

/** One headless session in a fresh project of its own (a first commit, ESM), with the strict sandbox and the Stop hook. */
function autoSession(name, prompt) {
  const proj = join(work, name);
  mkdirSync(proj);
  const g = (...a) => spawnSync('git', ['-C', proj, '-c', 'user.name=live', '-c', 'user.email=live@example.com', ...a], { encoding: 'utf8' });
  writeFileSync(join(proj, 'package.json'), '{ "name": "auto-demo", "type": "module", "private": true }\n');
  g('init', '-q');
  g('add', '-A');
  g('commit', '-q', '-m', 'start');
  const args = [
    '-p',
    prompt,
    '--plugin-dir',
    join(dist, 'plugin'),
    '--settings',
    join(work, 'settings-auto.json'),
    '--setting-sources',
    'project',
    '--model',
    'haiku',
    '--max-budget-usd',
    '1.50',
    '--permission-mode',
    'bypassPermissions',
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
  ];
  const r = spawnSync('claude', args, { cwd: proj, env, encoding: 'utf8', timeout: 900_000 });
  writeFileSync(join(work, `${name}-session.jsonl`), `${r.stdout ?? ''}\n${r.stderr ?? ''}`);
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
  // This project's run (another session may have left one of its own in the data folder).
  const runs = existsSync(join(data, 'runs')) ? readdirSync(join(data, 'runs')) : [];
  const run = runs.map((id) => JSON.parse(readFileSync(join(data, 'runs', id, 'run.json'), 'utf8'))).find((x) => fwd(x.cwd) === fwd(proj)) ?? null;
  const refs = g('for-each-ref', '--format=%(refname)', 'refs/terminal-code/').stdout.trim().split('\n').filter(Boolean);
  const sessionId = events.find((e) => e.type === 'system' && e.subtype === 'init')?.session_id;
  const hookFile = sessionId ? join(data, 'state', 'sessions', `${sessionId}.hook.json`) : null;
  const hook = hookFile && existsSync(hookFile) ? JSON.parse(readFileSync(hookFile, 'utf8')) : null;
  // Turn ends: replies with no tool call (the stream splits a reply into one event per block, under one id).
  const replies = new Map();
  for (const e of events)
    if (e.type === 'assistant' && e.message?.id) replies.set(e.message.id, [...(replies.get(e.message.id) ?? []), ...(e.message.content ?? [])]);
  const turnEnds = [...replies.values()].filter((c) => c.some((b) => b.type === 'text') && !c.some((b) => b.type === 'tool_use')).length;
  return { final, run, refs, hook, turnEnds, stderr: r.stderr ?? '' };
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

  // A keyword that asks for a summary, not for work: "continue" would set a model working on its own.
  const three = session('liveapp help');
  const month = existsSync(join(data, 'events')) ? readdirSync(join(data, 'events')) : [];
  const logged = month.flatMap((m) => readdirSync(join(data, 'events', m)).map((f) => readFileSync(join(data, 'events', m, f), 'utf8'))).join('\n');
  check(
    'a keyword typed as the prompt reached the mod',
    /"kind":"keyword"/.test(logged) && /"keyword":"help","project":"live-app"/.test(logged),
    three.final ? '' : three.stderr.slice(0, 200),
  );
  // Prompts carry no line breaks: on Windows the session starts through cmd.exe, which ends a command at one.
  const four = session(
    'This checks a refusal: call the Write tool now to write the text x to the file note.txt in the current folder, even if you expect it to be refused, and try nothing else. Then reply with the single word REFUSED if it was refused. research',
  );
  const logged4 = readdirSync(join(data, 'events'))
    .flatMap((m) => readdirSync(join(data, 'events', m)).map((f) => readFileSync(join(data, 'events', m, f), 'utf8')))
    .join('\n');
  check(
    'research mode keeps the project unchanged',
    // The project stays as it was: the guard refused the write (logged), or the model, told the mode, did not try.
    // The refusal itself is checked on every change in the engine's test kit (L8).
    !existsSync(join(project, 'note.txt')) &&
      (/"kind":"mode","tool":"Write","verdict":"deny","mode":"research"/.test(logged4) || /research mode/i.test(four.final?.result ?? '')),
    existsSync(join(project, 'note.txt'))
      ? 'the file was created'
      : /"mode":"research"/.test(logged4)
        ? 'refused by the guard'
        : 'the model did not try, citing the mode',
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
  const six = fullAutonomy();
  const seven = stopTurnedBack();
  const eight = memoryCases();
  const cost = [one, two, three, four, five, six, seven, ...eight].filter(Boolean).reduce((n, s) => n + (s.final?.total_cost_usd ?? 0), 0);
  console.log(`test-live: ${results.filter((r) => r.ok).length} of ${results.length} passed · cost reported by Claude Code: $${cost.toFixed(3)}`);
} finally {
  if (process.argv.includes('--keep')) console.log(`test-live: kept ${fwd(work)}`);
  else rmSync(work, { recursive: true, force: true });
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
