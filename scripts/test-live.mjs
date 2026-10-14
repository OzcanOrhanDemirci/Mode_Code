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
 *      handoff keyword has Claude write a note that is kept and sent, and the next session is told about it;
 *   9. sync across computers: one computer's plugin sends a softened belt rule and a handoff note, the other
 *      takes the note over, and the rule waits for the person;
 *  10. a session closed without ending (its process killed, as a shut window does): while it runs, the next
 *      session in its folder is told of it; once it is gone, the next is not, and writes the note it owed.
 *
 * Usage: node scripts/test-live.mjs --yes      (opt-in; without --yes it only says what it would do)
 *        add --keep to leave the sessions' folders and the full-autonomy sessions' streams in place
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const fwd = (p) => p.replace(/\\/g, '/');
if (!process.argv.includes('--yes')) {
  console.log(
    'test-live: opt-in. Runs fourteen short headless Claude Code sessions, sixteen where full autonomy can run (cheapest model, capped spend), with this build loaded. Run with --yes.',
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
const base = join(homedir(), '.cache', 'mode-code-live');
mkdirSync(base, { recursive: true });
const work = mkdtempSync(join(base, 'run-'));
const project = join(work, 'project');
const data = join(work, 'data');
mkdirSync(project);
mkdirSync(data);
spawnSync('git', ['init', '-q', project], { windowsHide: true });
writeFileSync(join(data, 'config.json'), JSON.stringify({ language: 'en', projects: [{ id: 'live-app', names: ['liveapp'] }] }, null, 2));
env.MODE_CODE_HOME = data;
env.MODE_CODE_LANG = 'en';

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

/**
 * One headless session. `prompt` is the prompt, or a list of messages sent one after the other into the same
 * session (stream-json input): a slash command, then a task.
 */
function session(prompt, settingsFile = settings, tools = 'Bash,Write,Read,Edit,Glob,Grep,mcp__mode-code__flow_step', extraEnv = {}, cwd = project) {
  const { args, input } = sessionArgs(prompt, settingsFile, tools);
  const runEnv = { ...env, ...extraEnv };
  let r = spawnSync('claude', args, { cwd, env: runEnv, encoding: 'utf8', timeout: 240_000, windowsHide: true, input });
  if (r.error && process.platform === 'win32') {
    const q = (a) => (/^[\w@./:=,-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);
    r = spawnSync(['claude', ...args.map(q)].join(' '), {
      cwd,
      env: runEnv,
      encoding: 'utf8',
      timeout: 240_000,
      windowsHide: true,
      shell: true,
      input,
    });
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
  const id = events.find((e) => e.session_id)?.session_id ?? null;
  return { status: r.status, events, final, id, text: JSON.stringify(events), stderr: r.stderr ?? '' };
}

/** The command line of a headless session, and its input when the prompt is a list of messages. */
function sessionArgs(prompt, settingsFile, tools) {
  const many = Array.isArray(prompt);
  const args = [
    '-p',
    ...(many ? ['--input-format', 'stream-json'] : [prompt]),
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
  const input = many ? prompt.map((text) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } })).join('\n') + '\n' : undefined;
  return { args, input };
}

/**
 * 10. A session closed without ending. Its process is killed mid-turn, after it changed a file, as a window
 * shut by its close button does: nothing of its own end runs. While it runs, a session started in the same
 * folder is told another is working there; once it is gone, the next session is not, and it writes the note
 * the closed one owed, from what that one kept as it went.
 */
async function closedCases() {
  const dir = join(work, 'project-closed');
  mkdirSync(dir);
  spawnSync('git', ['init', '-q', dir], { windowsHide: true });
  const sessionsDir = join(data, 'state', 'sessions');
  const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
  const eventsOf = (id) =>
    readdirSync(join(data, 'events'))
      .flatMap((m) => {
        const f = join(data, 'events', m, `${id}.mod.jsonl`);
        return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
      })
      .map((l) => JSON.parse(l));
  const { args } = sessionArgs(
    'Do exactly two things, in this order. First use the Write tool to write the text hi to the file a.txt in the current folder. Then use the Bash tool to run this exact command and wait for it to finish: sleep 100 . Then reply with the single word DONE.',
    settings,
    'Bash,Write,Read',
  );
  const x = spawn('claude', args, { cwd: dir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  x.stdout.on('data', (d) => (out += d));
  x.stderr.on('data', () => {});
  let failed = false;
  const exited = new Promise((resolve) => {
    x.on('close', resolve);
    x.on('error', () => {
      failed = true;
      resolve();
    });
  });
  const idOf = () => /"session_id":"([^"]+)"/.exec(out)?.[1] ?? null;
  // Until it has changed something: its record keeps that at the change itself.
  const deadline = Date.now() + 150_000;
  let mine = null;
  while (Date.now() < deadline && x.exitCode === null && !failed) {
    const id = idOf();
    mine = id ? read(join(sessionsDir, `${id}.mod.json`)) : null;
    if (mine?.work?.changedAt > 0 && existsSync(join(dir, 'a.txt'))) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const id = idOf();
  const host = id ? read(join(sessionsDir, `${id}.hook.json`))?.host : null;
  check(
    "closed: the hook recorded the session's own process, Claude Code's",
    !!host && host.pid === x.pid && !/^(cmd|bash|sh|zsh|dash|powershell|pwsh)(\.exe)?$/i.test(host.name ?? ''),
    host ? `${host.pid} ${host.name} · spawned ${x.pid}` : `no record (${out.slice(0, 120)})`,
  );
  check('closed: the turn kept its change before it ended', mine?.work?.changedAt > 0, mine?.work ? '' : 'no change kept');
  const during = session('Reply with the single word OK.', settings, 'Read', {}, dir);
  const toldDuring = during.id ? eventsOf(during.id).some((e) => e.kind === 'conflict' && e.sessions.includes(id)) : false;
  check('closed: while it runs, a session in the same folder is told of it', toldDuring, during.id ?? during.stderr.slice(0, 120));
  // Its window shut: the process ends at once, nothing of its own end runs.
  if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(x.pid)], { windowsHide: true });
  else x.kill('SIGKILL');
  await exited;
  const after = session('Reply with the single word OK.', settings, 'Read', {}, dir);
  const logged = after.id ? eventsOf(after.id) : [];
  const notes = existsSync(join(data, 'handoffs'))
    ? readdirSync(join(data, 'handoffs')).flatMap((k) => readdirSync(join(data, 'handoffs', k)).map((n) => join(data, 'handoffs', k, n)))
    : [];
  const note = notes.find((n) => id && n.endsWith(`-${id.replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}.md`));
  check(
    'closed: once it is gone, the next session is not told of it, and writes the note it owed',
    !logged.some((e) => e.kind === 'conflict') &&
      logged.some((e) => e.kind === 'handoff' && e.trigger === 'closed' && e.of === id) &&
      !!note &&
      /trigger: closed\n/.test(readFileSync(note, 'utf8')),
    `${after.id ?? after.stderr.slice(0, 80)} · ${logged.map((e) => e.kind).join(' ')} · ${note ? 'note' : 'no note'}`,
  );
  return [during, after];
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
  const tools = 'Read,Glob,Grep,mcp__mode-code__handoff';

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
/**
 * 9. Sync across computers (docs/sync.md), on every platform: two computers' data folders through a bare
 * repository standing for GitHub. One computer softens a belt rule; its plugin sends the change when its
 * session starts and the handoff note the keyword had Claude write when the session ends. The other computer
 * takes the note over; the softened rule waits for the person, who is told, and is not in effect.
 */
function syncCases() {
  const remote = fwd(join(work, 'sync-remote.git'));
  spawnSync('git', ['init', '-q', '--bare', remote]);
  const computer = (name) => {
    const dir = fwd(join(work, `sync-${name}`));
    spawnSync('git', ['clone', '-q', remote, dir]);
    for (const [k, v] of [
      ['user.name', 'live'],
      ['user.email', 'live@example.com'],
      ['commit.gpgsign', 'false'],
    ])
      spawnSync('git', ['-C', dir, 'config', k, v]);
    const home = fwd(join(work, `data-${name}`));
    mkdirSync(home, { recursive: true });
    const write = (raw) =>
      writeFileSync(
        join(home, 'config.json'),
        JSON.stringify({ language: 'en', ...raw, sync: { place: 'github', dir, remote, machine: { id: `${name}-0000`, name } } }, null, 2),
      );
    const cli = (...args) => spawnSync(node, [join(dist, 'cli.mjs'), ...args], { env: { ...env, MODE_CODE_HOME: home }, encoding: 'utf8', windowsHide: true });
    return { dir, home, write, cli };
  };
  const show = (path) => spawnSync('git', ['--git-dir', remote, 'show', `HEAD:${path}`], { encoding: 'utf8' }).stdout;
  const tools = 'Read,Glob,Grep,mcp__mode-code__handoff';

  const desk = computer('desk');
  desk.write({});
  const first = desk.cli('sync', 'now', '--json');
  desk.write({ belt: { verdicts: { 'git.clean': 'warn' } } });
  const handed = session('We set up sync today; nothing else is open. devir', settings, tools, { MODE_CODE_HOME: desk.home });
  const onRemote = spawnSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' }).stdout.split('\n');
  const note = onRemote.find((f) => /^handoffs\/project\/\d{8}-\d{6}-[a-z0-9]+\.md$/.test(f)) ?? null;
  const verdicts = (() => {
    try {
      return JSON.parse(show('machines/desk-0000/settings.json')).entries['belt.verdicts'];
    } catch {
      return null;
    }
  })();
  check(
    "sync: a computer's plugin sent its changed setting when its session started and the handoff note when it ended",
    first.status === 0 && verdicts?.value?.['git.clean'] === 'warn' && verdicts.at > 0 && !!note,
    note ?? `setting ${JSON.stringify(verdicts)}; ${String(handed.final?.result ?? handed.stderr).slice(0, 60)}`,
  );

  const laptop = computer('laptop');
  laptop.write({});
  laptop.cli('sync', 'now', '--json');
  const told = session('Is a handoff note waiting for this project? If so, reply with its next step only; if not, reply NONE.', settings, tools, {
    MODE_CODE_HOME: laptop.home,
  });
  const next = note ? (/## Next\n\n([^\n]+)/.exec(show(note))?.[1] ?? '') : '';
  const words = next.toLowerCase().match(/[a-zçğıöşü]{5,}/g) ?? [];
  check(
    'sync: the other computer took the handoff note over',
    !/\bNONE\b/.test(told.final?.result ?? 'NONE') && words.some((w) => (told.final?.result ?? '').toLowerCase().includes(w)),
    String(told.final?.result ?? told.stderr).slice(0, 80),
  );
  const toast = told.events.some(
    (e) => e.type === 'system' && e.subtype === 'ui_toast' && /it would lower a protection here: belt\.verdicts/.test(e.text ?? ''),
  );
  const inEffect = laptop.cli('config', 'get', 'belt.verdicts').stdout.replace(/\s+/g, '');
  check(
    'sync: the softened rule waited for the person, who was told, and is not in effect',
    toast && inEffect === '{}',
    `${toast ? 'told' : 'not told'}; in effect ${inEffect}`,
  );
  return [handed, told];
}

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
  const refs = g('for-each-ref', '--format=%(refname)', 'refs/mode-code/').stdout.trim().split('\n').filter(Boolean);
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
  // A slash command alone: the plugin's own command, answered without a model turn (docs/modes.md, "Session controls").
  const plan = session('/3');
  const states = () =>
    existsSync(join(data, 'state', 'sessions'))
      ? readdirSync(join(data, 'state', 'sessions'))
          .filter((f) => f.endsWith('.mod.json'))
          .map((f) => JSON.parse(readFileSync(join(data, 'state', 'sessions', f), 'utf8')))
      : [];
  check(
    '/3 switches the session to plan mode in the real engine and says so',
    states().some((s) => s.mode === 'plan') && /📐 plan/.test(JSON.stringify(plan.events ?? plan.final ?? '')),
    plan.final?.result?.slice?.(0, 80) ?? plan.stderr.slice(0, 200),
  );
  // Prompts carry no line breaks: on Windows the session starts through cmd.exe, which ends a command at one.
  // A mode word now counts only as the whole message: "/2", then the task, in one session. (In a headless run a
  // command is a run of its own, so "/2 <text>" sends no text there: the text is sent once an interactive session is idle.)
  const four = session([
    '/2',
    'This checks a refusal: call the Write tool now to write the text x to the file note.txt in the current folder, even if you expect it to be refused, and try nothing else. Then reply with the single word REFUSED if it was refused.',
  ]);
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
        : `the model did not try, citing the mode: ${(four.final?.result ?? '').slice(0, 160)} · assistant turns ${four.events.filter((e) => e.type === 'assistant').length}`,
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
  const ten = await closedCases();
  const six = fullAutonomy();
  const seven = stopTurnedBack();
  const eight = memoryCases();
  const nine = syncCases();
  const cost = [one, two, three, plan, four, five, six, seven, ...eight, ...nine, ...ten]
    .filter(Boolean)
    .reduce((n, s) => n + (s.final?.total_cost_usd ?? 0), 0);
  console.log(`test-live: ${results.filter((r) => r.ok).length} of ${results.length} passed · cost reported by Claude Code: $${cost.toFixed(3)}`);
} finally {
  if (process.argv.includes('--keep')) console.log(`test-live: kept ${fwd(work)}`);
  else rmSync(work, { recursive: true, force: true });
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
