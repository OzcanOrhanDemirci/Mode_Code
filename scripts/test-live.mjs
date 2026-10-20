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
 *   6. full autonomy (/9): Claude Code's own question about a write is answered, and a command the belt would ask
 *      about is left to the person with its command while the rest of the task is done;
 *   7. there too, the end of a turn reaches the person away from the computer through their ntfy topic;
 *   8. the memory: a change made elsewhere is pulled at the start and reaches Claude before it answers, the
 *      handoff keyword has Claude write a note that is kept and sent, and the next session is told about it;
 *   9. sync across computers: one computer's plugin sends a softened belt rule and a handoff note, the other
 *      takes the note over, and the rule waits for the person;
 *  10. a session closed without ending (its process killed, as a shut window does): while it runs, the next
 *      session in its folder is told of it; once it is gone, the next is not, and writes the note it owed;
 *  11. no bypass (1.2.0): in Claude Code's default permission mode a headless session cannot answer its question,
 *      so a command not approved beforehand is refused, also where an older version recorded bypass on;
 *  12. a compound command whose every part the project's allow rules cover runs in the default permission mode;
 *  13. the tool packs: a pack's skill loads and its use is recorded; the catalog tool, behind tool search, is found;
 *  14. what the skills cost: the person's own skills add nothing, or almost nothing, to the session's context;
 *  15. a short command in Turkish reaches the plugin, which runs its skill and records it;
 *  16. Claude Code's auto mode: a command the belt allows runs unasked, one it asks about still goes to the person;
 *  17. parallel agents: with the mode off a working agent is refused and a read-only helper runs; set to exactly N,
 *      the person's task for a row reaches the agent word for word, whatever Claude wrote for it.
 *
 * Usage: node scripts/test-live.mjs --yes      (opt-in; without --yes it only says what it would do)
 *        add --only-bypass to run case 11 alone (two sessions): a bypass an older version recorded lifts nothing
 *        add --only-auto to run cases 6 and 7 alone (two sessions): full autonomy as a way of working
 *        add --only-parts to run case 12 alone (one session): a compound command whose parts are allowed
 *        add --only-packs to run case 13 alone (two sessions): the tool packs
 *        add --only-skills to run cases 14 and 15 alone (three sessions): the skills
 *        add --only-automode to run case 16 alone (two sessions): Claude Code's auto mode with the belt
 *        add --only-agents to run case 17 alone (two sessions): parallel agents in the real engine
 *        add --only-memory to run case 8 alone (three sessions): the memory, pulled, handed off and told
 *        add --keep to leave the sessions' folders in place
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const fwd = (p) => p.replace(/\\/g, '/');
if (!process.argv.includes('--yes')) {
  console.log(
    'test-live: opt-in. Runs twenty-eight short headless Claude Code sessions (cheapest model, capped spend), with this build loaded. Run with --yes (--only-bypass, --only-auto: two).',
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
function session(
  prompt,
  settingsFile = settings,
  tools = 'Bash,Write,Read,Edit,Glob,Grep,mcp__mode-code__flow_step',
  extraEnv = {},
  cwd = project,
  extraArgs = [],
  pluginDir = join(dist, 'plugin'),
) {
  const { args, input } = sessionArgs(prompt, settingsFile, tools, pluginDir);
  args.push(...extraArgs);
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
function sessionArgs(prompt, settingsFile, tools, pluginDir = join(dist, 'plugin')) {
  const many = Array.isArray(prompt);
  const args = [
    '-p',
    ...(many ? ['--input-format', 'stream-json'] : [prompt]),
    '--plugin-dir',
    pluginDir,
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
 * 6. Full autonomy (docs/autonomy.md), chosen with /9, in Claude Code's default permission mode, where a headless
 * session has no one to answer. Claude Code's own question about a file write is answered by the way of working; a
 * command the belt would ask about (`git clean`) is left to the person, with its command, and does not run.
 */
function fullAutonomyLeft() {
  const dir = join(work, 'full-project');
  const home = join(work, 'full-data');
  mkdirSync(dir);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'en' }));
  const g = (...a) =>
    spawnSync('git', ['-C', dir, '-c', 'user.name=live', '-c', 'user.email=live@example.com', '-c', 'commit.gpgsign=false', ...a], {
      encoding: 'utf8',
      windowsHide: true,
    });
  g('init', '-q');
  writeFileSync(join(dir, 'README.md'), '# Full\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'start');
  writeFileSync(join(dir, 'build.tmp'), 'left over\n');
  const r = session(
    [
      '/9',
      'Do both steps, in this order. First use the Write tool to write the text hi to the file notes.txt in the current folder. Then use the Bash tool to run exactly this command: git clean -f build.tmp . Then reply with the single word DONE.',
    ],
    settings,
    'Read',
    { MODE_CODE_HOME: home },
    dir,
    ['--permission-mode', 'default'],
  );
  const months = existsSync(join(home, 'events')) ? readdirSync(join(home, 'events')) : [];
  const logged = months.flatMap((m) => readdirSync(join(home, 'events', m)).map((x) => readFileSync(join(home, 'events', m, x), 'utf8'))).join('\n');
  check(
    "full autonomy: Claude Code's own question about a write is answered, and the file is written",
    existsSync(join(dir, 'notes.txt')) && /"kind":"permission"[^\n]*"answer":"full"/.test(logged),
    existsSync(join(dir, 'notes.txt')) ? '' : (r.final?.result?.slice?.(0, 120) ?? r.stderr.slice(0, 200)),
  );
  check(
    'full autonomy: a command the belt would ask about is left to the person with its command, and does not run',
    existsSync(join(dir, 'build.tmp')) && /"kind":"belt"[^\n]*"left":true/.test(logged) && /Full autonomy asks nobody/.test(r.text),
    existsSync(join(dir, 'build.tmp')) ? (/"left":true/.test(logged) ? '' : 'not recorded as left') : 'the command ran',
  );
  return r;
}

/**
 * 7. The person away from the computer (docs/autonomy.md): a turn in full autonomy that ends is said on their ntfy
 * topic, sent with curl from the plugin. The topic here is a server on this computer that keeps what it receives.
 */
async function fullAutonomyNotify() {
  const home = join(work, 'notify-data');
  mkdirSync(home, { recursive: true });
  const got = join(work, 'notify-received.txt');
  const ready = join(work, 'notify-port.txt');
  const server = spawn(
    process.execPath,
    [
      '-e',
      `const fs = require('node:fs');
const s = require('node:http').createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', () => {
    fs.appendFileSync(${JSON.stringify(got)}, b + '\\n');
    res.end('ok');
  });
});
s.listen(0, '127.0.0.1', () => fs.writeFileSync(${JSON.stringify(ready)}, String(s.address().port)));`,
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  const until = async (ok, ms) => {
    for (const end = Date.now() + ms; !ok() && Date.now() < end;) await new Promise((r) => setTimeout(r, 100));
  };
  await until(() => existsSync(ready), 10_000);
  const port = existsSync(ready) ? readFileSync(ready, 'utf8').trim() : '9';
  writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'en', notify: { ntfy: `http://127.0.0.1:${port}/live` } }));
  const r = session(['/9', 'Reply with the single word OK.'], settings, 'Read', { MODE_CODE_HOME: home });
  await until(() => existsSync(got), 15_000);
  server.kill();
  const body = existsSync(got) ? readFileSync(got, 'utf8') : '';
  check(
    'full autonomy: the end of a turn reaches the person away, on their ntfy topic',
    /Full autonomy (?:is done|stopped)/.test(body),
    body.slice(0, 120) || `nothing received (${r.final?.result?.slice?.(0, 80) ?? r.stderr.slice(0, 120)})`,
  );
  return r;
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
  const toast = told.events.some((e) => e.type === 'system' && e.subtype === 'ui_toast' && /it lowers a protection: belt\.verdicts/.test(e.text ?? ''));
  const inEffect = laptop.cli('config', 'get', 'belt.verdicts').stdout.replace(/\s+/g, '');
  check(
    'sync: the softened rule waited for the person, who was told, and is not in effect',
    toast && inEffect === '{}',
    `${toast ? 'told' : 'not told'}; in effect ${inEffect}`,
  );
  return [handed, told];
}

/**
 * 11. No bypass (1.2.0). Claude Code in its default permission mode asks before a command that was not approved
 * beforehand, and a headless session has no one to answer, so the command is refused. Bypass, which once had the
 * plugin answer that question, is gone: a settings file and a session record an older version wrote with it on
 * change nothing (--only-bypass).
 */
function bypassCases() {
  const home = join(work, 'bypass-data');
  mkdirSync(join(home, 'state', 'sessions'), { recursive: true });
  writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'en', bypass: { enabled: true, maxHours: 2 } }));
  const ask = (file) => `Use the Bash tool to run exactly this command and nothing else: echo ok > ${file} . Then reply with the single word DONE.`;
  const run = (id, file) => session(ask(file), settings, 'Read', { MODE_CODE_HOME: home }, project, ['--session-id', id, '--permission-mode', 'default']);
  const offId = randomUUID();
  const off = run(offId, 'bypass-off.txt');
  const onId = randomUUID();
  const now = Date.now();
  // Bypass on for this session as an older plugin recorded it.
  writeFileSync(
    join(home, 'state', 'sessions', `${onId}.mod.json`),
    JSON.stringify({
      v: 1,
      sessionId: onId,
      aliveAt: now,
      endedAt: null,
      modVersion: 'live',
      mode: 'free',
      turnMode: null,
      flowId: null,
      runId: null,
      nativePlan: null,
      interaction: 'default',
      interactionBefore: null,
      project: null,
      weeklyTarget: null,
      weeklyTargetSource: null,
      wrapUp: false,
      resumeAt: null,
      approvals: [],
      blocks: {},
      work: null,
      bypass: { since: now, until: now + 3_600_000, count: 0 },
    }),
  );
  const on = run(onId, 'bypass-on.txt');
  const months = existsSync(join(home, 'events')) ? readdirSync(join(home, 'events')) : [];
  const logged = months.flatMap((m) => readdirSync(join(home, 'events', m)).map((x) => readFileSync(join(home, 'events', m, x), 'utf8'))).join('\n');
  check(
    "without bypass, Claude Code's question in a headless session is refused and the command does not run",
    !existsSync(join(project, 'bypass-off.txt')),
    existsSync(join(project, 'bypass-off.txt')) ? 'the file was created' : '',
  );
  check(
    'a bypass an older version recorded lifts nothing: the question is refused there too, and nothing is recorded as bypass',
    !existsSync(join(project, 'bypass-on.txt')) && !/"kind":"bypass"/.test(logged),
    existsSync(join(project, 'bypass-on.txt')) ? 'the file was created' : /"kind":"bypass"/.test(logged) ? 'a bypass record was written' : '',
  );
  return [off, on];
}

/**
 * 12. Permission fatigue (docs/safety-belt.md, "What else runs"): a compound command whose every part the project's
 * allow rules cover. In the default permission mode a headless session cannot answer a question, so the command runs
 * only if no question is left: Claude Code allowed it itself, or the plugin answered that each part was allowed. Which
 * of the two is recorded: the engine's own reading could change in any release.
 */
function partsCase() {
  const dir = join(work, 'parts-project');
  const home = join(work, 'parts-data');
  mkdirSync(join(dir, '.claude'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(mkdir:*)'] } }));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'en' }));
  const ask = 'Use the Bash tool to run exactly this command and nothing else: mkdir parts-a && mkdir parts-b . Then reply with the single word DONE.';
  const r = session(ask, settings, 'Read', { MODE_CODE_HOME: home }, dir, ['--permission-mode', 'default']);
  const months = existsSync(join(home, 'events')) ? readdirSync(join(home, 'events')) : [];
  const logged = months.flatMap((m) => readdirSync(join(home, 'events', m)).map((x) => readFileSync(join(home, 'events', m, x), 'utf8'))).join('\n');
  const ran = existsSync(join(dir, 'parts-a')) && existsSync(join(dir, 'parts-b'));
  check(
    'a compound command whose every part the project allows runs without a question',
    ran,
    ran
      ? /"kind":"permission"[^\n]*"answer":"parts"/.test(logged)
        ? 'the plugin answered'
        : 'Claude Code allowed it itself'
      : (r.final?.result?.slice?.(0, 120) ?? r.stderr.slice(0, 200)),
  );
  return r;
}

/**
 * 13. The tool packs (docs/packs.md) in the real engine: a pack loaded from its built folder offers its skill, whose
 * use the plugin records as the pack's; and the catalog tool, registered behind tool search, is found and answers.
 */
function packsCases() {
  const dir = join(work, 'packs-project');
  const home = join(work, 'packs-data');
  mkdirSync(dir, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(dir, 'report.typ'), '= Report\n');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'en' }));
  const pack = ['--plugin-dir', join(dist, 'packs', 'plugins', 'mode-code-typst')];
  const skill = session(
    'Use the Skill tool to load the skill named mode-code-typst:typst, then reply with the single word LOADED and nothing else.',
    settings,
    'Read,Skill',
    { MODE_CODE_HOME: home },
    dir,
    pack,
  );
  const months = existsSync(join(home, 'events')) ? readdirSync(join(home, 'events')) : [];
  const logged = months.flatMap((m) => readdirSync(join(home, 'events', m)).map((x) => readFileSync(join(home, 'events', m, x), 'utf8'))).join('\n');
  const used = /"kind":"pack","pack":"typst","via":"skill"/.test(logged);
  // What the model called, for a failure's detail: the skill not called at all is the model's, not the plugin's.
  const calls = skill.events.flatMap((e) =>
    e.type === 'assistant'
      ? (e.message?.content ?? []).filter((b) => b.type === 'tool_use').map((b) => `${b.name}(${JSON.stringify(b.input).slice(0, 80)})`)
      : [],
  );
  check(
    "a pack's skill loads from its plugin, and its use is recorded as the pack's",
    used,
    used ? '' : `${calls.join(' ') || 'no tool called'} · ${skill.final?.result?.slice?.(0, 80) ?? skill.stderr.slice(0, 200)}`,
  );
  const catalog = session(
    'Find the mcp__mode-code__catalog tool (search for it if it is not loaded), call it with need "PDF documents", then reply with only the id of the first pack it lists.',
    settings,
    'Read,mcp__mode-code__catalog',
    { MODE_CODE_HOME: home },
    dir,
  );
  const called = catalog.events.some(
    (e) => e.type === 'assistant' && (e.message?.content ?? []).some((b) => b.type === 'tool_use' && b.name === 'mcp__mode-code__catalog'),
  );
  check(
    'the catalog tool, behind tool search, is found and answers',
    called && /typst/i.test(catalog.final?.result ?? ''),
    called ? (catalog.final?.result?.slice?.(0, 120) ?? '') : 'the tool was not called',
  );
  return [skill, catalog];
}

/**
 * 14. What the skills cost (docs/skills.md). The same prompt in two sessions: with Mode_Code's skills, and with only
 * those Claude may use itself. The difference in what the request carried is what the person's own skills add;
 * Claude Code's documentation says their descriptions are not in the context.
 */
function skillsCost() {
  const lean = join(work, 'plugin-lean');
  cpSync(join(dist, 'plugin'), lean, { recursive: true });
  const theirs = readdirSync(join(lean, 'skills')).filter((d) =>
    /^disable-model-invocation:\s*true/m.test(readFileSync(join(lean, 'skills', d, 'SKILL.md'), 'utf8')),
  );
  for (const d of theirs) rmSync(join(lean, 'skills', d), { recursive: true, force: true });
  const sent = (r) => {
    const u = r.final?.usage ?? {};
    return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  };
  const ask = 'Reply with the single word OK.';
  const all = session(ask, settings, 'Read');
  const few = session(ask, settings, 'Read', {}, project, [], lean);
  const diff = sent(all) - sent(few);
  check(
    "the person's own skills add nothing, or almost nothing, to the session's context",
    sent(all) > 0 && sent(few) > 0 && Math.abs(diff) < 10 * theirs.length,
    `${diff} tokens for ${theirs.length} skills (${sent(all)} with them, ${sent(few)} without)`,
  );
  return [all, few];
}

/**
 * 15. A short command (docs/skills.md): `/kemer` in a Turkish session reaches the plugin in the real engine, which
 * answers that Mode_Code's `belt` skill is running and records it. The skill's text then goes as the person's message,
 * which a headless session does not send (as with `/2 <text>`, case 4): that part is the engine kit's to check.
 */
function shortCommandCase() {
  const home = join(work, 'short-data');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'tr' }));
  const r = session('/kemer', settings, 'Read', { MODE_CODE_HOME: home, MODE_CODE_LANG: 'tr' });
  const months = existsSync(join(home, 'events')) ? readdirSync(join(home, 'events')) : [];
  const logged = months.flatMap((m) => readdirSync(join(home, 'events', m)).map((x) => readFileSync(join(home, 'events', m, x), 'utf8'))).join('\n');
  const ran = /"kind":"skill","skill":"mode-code:belt","via":"short"/.test(logged) && /mode-code:belt çalışıyor/.test(r.text);
  check(
    'a short command in Turkish reaches the plugin, which runs its skill and records it',
    ran,
    ran ? '' : (r.final?.result?.slice?.(0, 120) ?? r.stderr.slice(0, 200)),
  );
  return r;
}

/**
 * 16. Claude Code's auto mode with the belt (docs/safety-belt.md, "Auto mode"): in auto mode a classifier answers
 * Claude Code's permission questions in the person's place. A command the belt allows runs unasked there; a command
 * the belt asks about must still reach the person, and a headless session has no one to answer, so it is refused.
 * The mode the session really ran in is read from its own start: an account or model without auto mode is said.
 */
function autoModeCase() {
  const dir = join(work, 'automode-project');
  mkdirSync(dir);
  spawnSync('git', ['init', '-q', dir], { windowsHide: true });
  const ask = (subject, flags) =>
    `Use the Bash tool to run exactly this command and nothing else: git -c user.name=live -c user.email=live@example.com commit ${flags}--allow-empty -m ${subject} . Then reply with the single word DONE.`;
  const run = (subject, flags) => session(ask(subject, flags), settings, 'Read', {}, dir, ['--permission-mode', 'auto']);
  const plain = run('plain', '');
  const asked = run('asked', '--no-verify ');
  const subjects = (spawnSync('git', ['-C', dir, 'log', '--format=%s'], { encoding: 'utf8', windowsHide: true }).stdout ?? '').split('\n').filter(Boolean);
  const mode = (r) => r.events.find((e) => e.type === 'system' && e.subtype === 'init')?.permissionMode ?? 'not reported';
  const months = existsSync(join(data, 'events')) ? readdirSync(join(data, 'events')) : [];
  const logged = months.flatMap((m) => readdirSync(join(data, 'events', m)).map((x) => readFileSync(join(data, 'events', m, x), 'utf8'))).join('\n');
  check(
    'auto mode: a command the belt allows runs without a question',
    mode(plain) === 'auto' && subjects.includes('plain'),
    `mode ${mode(plain)}${subjects.includes('plain') ? '' : ` · not run: ${(plain.final?.result ?? plain.stderr).slice(0, 120)}`}`,
  );
  check(
    "auto mode: the belt's question still goes to the person, so a headless session refuses the command",
    mode(asked) === 'auto' && !subjects.includes('asked') && /git\.no-verify/.test(logged),
    subjects.includes('asked') ? 'the command ran: the question was answered in the person’s place' : `mode ${mode(asked)}`,
  );
  return [plain, asked];
}

/**
 * 17. Parallel agents (docs/agents.md) in the real engine, where `agent.spawn` decides each agent's start. With the
 * mode turned on and the session's default (off), a working agent is refused with its reason and a read-only helper
 * runs. Set to exactly 1 (as the strip's window records it), the row's task reaches the agent word for word: Claude
 * is not told the task, so the word the agent answers can only have come from the row.
 */
function agentsCases() {
  const dir = join(work, 'agents-project');
  const home = join(work, 'agents-data');
  mkdirSync(dir);
  mkdirSync(join(home, 'state', 'sessions'), { recursive: true });
  spawnSync('git', ['init', '-q', dir], { windowsHide: true });
  writeFileSync(join(dir, 'marker.txt'), 'The marker is HERON-5521.\n');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'en', agents: { enabled: true } }));
  const tools = 'Agent,Task,Read,Glob,Grep';
  const run = (prompt, id) => session(prompt, settings, tools, { MODE_CODE_HOME: home }, dir, ['--session-id', id]);
  const logged = () =>
    (existsSync(join(home, 'events')) ? readdirSync(join(home, 'events')) : [])
      .flatMap((m) => readdirSync(join(home, 'events', m)).map((x) => readFileSync(join(home, 'events', m, x), 'utf8')))
      .join('\n')
      .split('\n')
      .filter((l) => l.includes('"kind":"agents"'))
      .map((l) => JSON.parse(l));
  // Each Agent call the main session made, with the type it asked for and what came back to it.
  const agentCalls = (r) => {
    const uses = r.events.flatMap((e) =>
      e.type === 'assistant' ? (e.message?.content ?? []).filter((b) => b.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task')) : [],
    );
    const back = new Map(
      r.events
        .flatMap((e) => (e.type === 'user' && Array.isArray(e.message?.content) ? e.message.content : []))
        .filter((b) => b.type === 'tool_result')
        .map((b) => [b.tool_use_id, b]),
    );
    return uses.map((u) => ({
      type: u.input?.subagent_type ?? '',
      error: back.get(u.id)?.is_error === true,
      text: JSON.stringify(back.get(u.id)?.content ?? ''),
    }));
  };
  const calls = (r) =>
    r.events.flatMap((e) =>
      e.type === 'assistant' ? (e.message?.content ?? []).filter((b) => b.type === 'tool_use').map((b) => `${b.name}(${b.input?.subagent_type ?? ''})`) : [],
    );

  const offId = randomUUID();
  const off = run(
    'This checks a setting. First use the Agent tool once with subagent_type general-purpose and the prompt: reply with the word PING. Whatever happens, then use the Agent tool once with subagent_type Explore, run_in_background false, and the prompt: read marker.txt and answer with the marker word only. Wait for its answer, then reply with the marker word the Explore agent found, or NONE.',
    offId,
  );
  const denied = logged().filter((e) => e.action === 'deny' && e.why === 'off' && e.type === 'general-purpose').length;
  // The helper let through is the plugin's part; whether the model then waits for it (it may run it in the background
  // and end the headless session first) is the model's, so its answer is reported, not required.
  const explore = agentCalls(off).filter((x) => x.type === 'Explore');
  const helperRefused = logged().filter((e) => e.action === 'deny' && e.type === 'Explore').length;
  const answered = explore.filter((x) => !x.error && /HERON-5521/.test(x.text)).length;
  check(
    'parallel agents off: a working agent is refused with its reason, a read-only helper runs',
    denied >= 1 && explore.some((x) => !x.error) && helperRefused === 0,
    `${calls(off).join(' ') || 'no tool called'} · refused ${denied} · Explore refused ${helperRefused}, answered ${answered} · ${(off.final?.result ?? off.stderr).slice(0, 80)}`,
  );

  const onId = randomUUID();
  const now = Date.now();
  writeFileSync(
    join(home, 'state', 'sessions', `${onId}.mod.json`),
    JSON.stringify({
      v: 1,
      sessionId: onId,
      aliveAt: now,
      endedAt: null,
      modVersion: 'live',
      mode: 'free',
      interaction: 'default',
      agents: {
        mode: 'assigned',
        n: 1,
        rows: [{ task: 'Reply with exactly the word ZEBRA-42 and nothing else.', kind: 'code', model: 'haiku' }],
        batch: null,
        untold: false,
        ultracode: false,
      },
    }),
  );
  const on = run(
    'Use the Agent tool once with subagent_type general-purpose, run_in_background false, and the prompt: do the task you were given. Wait for its answer, then reply with exactly what the agent answered, and nothing else.',
    onId,
  );
  const assigned = logged().filter((e) => e.action === 'assign' && e.row === 1 && e.of === 1 && e.task === true && e.model === 'haiku').length;
  check(
    "exactly N: the row's task reaches the agent word for word, with the row's model",
    assigned === 1 && agentCalls(on).some((x) => !x.error && /ZEBRA-42/.test(x.text)),
    `${calls(on).join(' ') || 'no tool called'} · assigned ${assigned} · ${(on.final?.result ?? on.stderr).slice(0, 80)}`,
  );
  return [off, on];
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`);
};

try {
  if (process.argv.includes('--only-bypass')) {
    const b = bypassCases();
    const cost = b.reduce((n, x) => n + (x.final?.total_cost_usd ?? 0), 0);
    console.log(`test-live: ${results.filter((r) => r.ok).length} of ${results.length} passed · cost reported by Claude Code: $${cost.toFixed(3)}`);
    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
  } else if (process.argv.includes('--only-skills')) {
    const k = [...skillsCost(), shortCommandCase()];
    const cost = k.reduce((n, x) => n + (x.final?.total_cost_usd ?? 0), 0);
    console.log(`test-live: ${results.filter((r) => r.ok).length} of ${results.length} passed · cost reported by Claude Code: $${cost.toFixed(3)}`);
    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
  } else if (process.argv.includes('--only-packs')) {
    const p = packsCases();
    const cost = p.reduce((n, x) => n + (x.final?.total_cost_usd ?? 0), 0);
    console.log(`test-live: ${results.filter((r) => r.ok).length} of ${results.length} passed · cost reported by Claude Code: $${cost.toFixed(3)}`);
    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
  } else if (process.argv.includes('--only-automode')) {
    const a = autoModeCase();
    const cost = a.reduce((n, x) => n + (x.final?.total_cost_usd ?? 0), 0);
    console.log(`test-live: ${results.filter((r) => r.ok).length} of ${results.length} passed · cost reported by Claude Code: $${cost.toFixed(3)}`);
    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
  } else if (process.argv.includes('--only-memory')) {
    const m = memoryCases();
    const cost = m.reduce((n, x) => n + (x.final?.total_cost_usd ?? 0), 0);
    console.log(`test-live: ${results.filter((r) => r.ok).length} of ${results.length} passed · cost reported by Claude Code: $${cost.toFixed(3)}`);
    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
  } else if (process.argv.includes('--only-agents')) {
    const a = agentsCases();
    const cost = a.reduce((n, x) => n + (x.final?.total_cost_usd ?? 0), 0);
    console.log(`test-live: ${results.filter((r) => r.ok).length} of ${results.length} passed · cost reported by Claude Code: $${cost.toFixed(3)}`);
    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
  } else if (process.argv.includes('--only-parts')) {
    const p = partsCase();
    console.log(
      `test-live: ${results.filter((r) => r.ok).length} of ${results.length} passed · cost reported by Claude Code: $${(p.final?.total_cost_usd ?? 0).toFixed(3)}`,
    );
    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
  } else if (process.argv.includes('--only-auto')) {
    const runs = [fullAutonomyLeft(), await fullAutonomyNotify()];
    const cost = runs.reduce((n, x) => n + (x?.final?.total_cost_usd ?? 0), 0);
    console.log(`test-live: ${results.filter((r) => r.ok).length} of ${results.length} passed · cost reported by Claude Code: $${cost.toFixed(3)}`);
    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
  } else {
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
    const six = fullAutonomyLeft();
    const seven = await fullAutonomyNotify();
    const eight = memoryCases();
    const nine = syncCases();
    const eleven = bypassCases();
    const twelve = partsCase();
    const thirteen = packsCases();
    const fourteen = [...skillsCost(), shortCommandCase()];
    const sixteen = autoModeCase();
    const seventeen = agentsCases();
    const cost = [
      one,
      two,
      three,
      plan,
      four,
      five,
      six,
      seven,
      ...eight,
      ...nine,
      ...ten,
      ...eleven,
      twelve,
      ...thirteen,
      ...fourteen,
      ...sixteen,
      ...seventeen,
    ]
      .filter(Boolean)
      .reduce((n, s) => n + (s.final?.total_cost_usd ?? 0), 0);
    console.log(`test-live: ${results.filter((r) => r.ok).length} of ${results.length} passed · cost reported by Claude Code: $${cost.toFixed(3)}`);
  }
} finally {
  if (process.argv.includes('--keep')) console.log(`test-live: kept ${fwd(work)}`);
  else rmSync(work, { recursive: true, force: true });
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
