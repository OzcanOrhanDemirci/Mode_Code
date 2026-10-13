// SPDX-License-Identifier: Apache-2.0
/**
 * The world beneath the mod in Claude Code's test kit: a file system, the environment, the clock, the
 * session, `uname` and `git`, and the person's answers, all in memory. The hooks registered here sit
 * beneath the plugin, where the engine would be; the test reads back what the plugin did.
 */
import { mock } from 'claude-code/testing';

export interface WorldOptions {
  /** Answer to a question: the first option, the second, the third, words typed under "Other", or 'nobody' when no one can be asked. */
  answer?: 'allow' | 'block' | 'third' | 'nobody' | { typed: string };
  config?: Record<string, unknown>;
  now?: number;
  lang?: 'en' | 'tr';
  windows?: boolean;
  /** The session cannot say where it is: every $.session.cwd call fails. */
  cwdFails?: boolean;
  /** The session started in the home folder instead of the project (its cwd and root). */
  startedAtHome?: boolean;
  /** What a tool beneath the plugin answers, by tool name (default: it ran). */
  results?: Record<string, (e: any) => any>;
  /** More environment variables (WSL_DISTRO_NAME, …). */
  env?: Record<string, string>;
  /** Answers a git call before the defaults do (its arguments after -C <dir> and --no-pager, and that dir); undefined falls through. */
  git?: (
    args: string[],
    dir?: string,
  ) => { exitCode: number; stdout: string; stderr?: string } | Promise<{ exitCode: number; stdout: string; stderr?: string }> | undefined;
  /** Answers any other program the plugin runs (its whole argv); undefined: the program is not found. */
  programs?: (argv: string[]) => { exitCode: number; stdout?: string; stderr?: string } | undefined;
  /** Claude Code's merged settings, as $.settings.read answers them. */
  settings?: Record<string, unknown>;
  /** What an independent review's model call answers (default: a clean PASS). */
  review?: (e: any) => any;
  /** The session's messages, as $.session.messages answers them. */
  messages?: { role: 'user' | 'assistant'; text: string; toolUses: never[] }[];
  /**
   * The permission mode Claude Code hands the safety-net hook with each prompt. When set, the world records it
   * beneath the plugin as the hook does: after the plugin's own prompt hook, so not before its next step.
   */
  promptMode?: string;
}

export const HOME = '/home/ada';
export const DATA = '/home/ada/.terminal-code';
export const PROJECT = '/home/ada/dev/app';
export const SESSION = 'kit-session-1';
/** The same machine on Windows. */
export const WIN = { HOME: 'C:/Users/ada', DATA: 'C:/Users/ada/.terminal-code', PROJECT: 'C:/dev/app' };

/**
 * The engine hands file paths over in the host's own form (C:\home\ada\x on Windows): back to /home/ada/x. A
 * Windows path on a Linux or macOS host is not absolute there, so it arrives under the test's own folder
 * (/tmp/…/C:/Users/ada/x): everything up to its drive goes too.
 */
export function norm(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(?:.*\/)?[A-Za-z]:(?=\/)/, '');
}

export function world(on: any, opts: WorldOptions = {}) {
  const files = new Map<string, { text: string; mtimeMs: number }>();
  const toasts: string[] = [];
  const notes: string[] = [];
  const asked: string[] = [];
  const submitted: string[] = [];
  const clock = mock.clock(on, { now: opts.now ?? Date.parse('2026-10-12T10:00:00Z') });
  /** Every program other than uname and git the plugin ran, as it asked. */
  const ran: string[][] = [];
  const at = opts.windows ? WIN : { HOME, DATA, PROJECT };
  mock.env(on, {
    ...(opts.windows ? { USERPROFILE: at.HOME, OS: 'Windows_NT', TEMP: `${at.HOME}/AppData/Local/Temp` } : { HOME: at.HOME }),
    TERMINAL_CODE_HOME: at.DATA,
    TERMINAL_CODE_LANG: opts.lang ?? 'en',
    ...(opts.env ?? {}),
  });
  const write = (path: string, text: string) => files.set(norm(path), { text, mtimeMs: clock.now() });
  if (opts.config) write(`${at.DATA}/config.json`, JSON.stringify(opts.config));
  on('session.cwd', () => {
    if (opts.cwdFails) throw new Error('the session is gone');
    return { value: opts.startedAtHome ? at.HOME : at.PROJECT };
  });
  on('session.root', () => ({ value: opts.startedAtHome ? at.HOME : at.PROJECT }));
  on('session.id', () => ({ value: SESSION }));
  on('fs.read', (_$: any, e: any) => (files.has(norm(e.path)) ? { value: files.get(norm(e.path))!.text } : { deny: `ENOENT: ${e.path}` }));
  on('fs.write', (_$: any, e: any) => {
    write(norm(e.path), e.text);
    return { value: undefined };
  });
  on('fs.list', (_$: any, e: any) => {
    const dir = norm(e.path).replace(/\/+$/, '');
    const inside = [...files.entries()].filter(([p]) => p.startsWith(dir + '/'));
    const entries = inside
      .filter(([p]) => !p.slice(dir.length + 1).includes('/'))
      .map(([p, f]) => ({ name: p.slice(dir.length + 1), kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs }));
    // Folders exist where files are kept below them, as on a disk.
    const dirs = [
      ...new Set(
        inside
          .map(([p]) => p.slice(dir.length + 1))
          .filter((r) => r.includes('/'))
          .map((r) => r.split('/')[0]!),
      ),
    ];
    return { value: [...entries, ...dirs.map((name) => ({ name, kind: 'dir', size: 0, mtimeMs: 0 }))] };
  });
  on('fs.stat', (_$: any, e: any) => {
    const path = norm(e.path);
    const f = files.get(path);
    if (f) return { value: { kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false } };
    if ([...files.keys()].some((p) => p.startsWith(path.replace(/\/+$/, '') + '/'))) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } };
    return { deny: 'ENOENT' };
  });
  on('process.run', async (_$: any, e: any) => {
    const [cmd, ...rest] = e.argv as string[];
    if (cmd === 'uname') return { value: { exitCode: 0, stdout: 'Linux\n', stderr: '' } };
    if (cmd === 'git') {
      // Past `-C <dir>` and `--no-pager`, whichever of them the caller put first.
      let args = rest[0] === '-C' ? rest.slice(2) : rest;
      if (args[0] === '--no-pager') args = args.slice(1);
      // An answer may take its time (a pull still running when the prompt comes in).
      const own = await opts.git?.(args, rest[0] === '-C' ? rest[1] : undefined);
      if (own) return { value: { stderr: '', ...own } };
      const a = rest.join(' ');
      if (a.includes('symbolic-ref')) return { value: { exitCode: 0, stdout: 'feature\n', stderr: '' } };
      if (a.includes('remote get-url')) return { value: { exitCode: 0, stdout: 'https://example.com/ada/app.git\n', stderr: '' } };
      return { value: { exitCode: 1, stdout: '', stderr: 'not a git repository' } };
    }
    ran.push(e.argv as string[]);
    const own = opts.programs?.(e.argv as string[]);
    if (own) return { value: { stdout: '', stderr: '', ...own } };
    return { value: { exitCode: 127, stdout: '', stderr: 'not found' } };
  });
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  on('ui.notify', (_$: any, e: any) => {
    notes.push(e.text);
    return { value: { delivered: true } };
  });
  // Beneath every plugin: the tools themselves. $.ui.ask is a call of the AskUserQuestion tool, answered
  // here as the person would; every other tool just runs.
  const reached: string[] = [];
  const calls: any[] = [];
  on('tool.call', (_$: any, e: any) => {
    if (e.tool === 'AskUserQuestion') {
      const q = e.questions?.[0];
      asked.push(String(q?.question ?? ''));
      if (opts.answer === 'nobody' || !opts.answer) return { deny: 'no one to ask' };
      const labels: string[] = (q?.options ?? []).map((o: any) => o.label);
      const a = opts.answer;
      const label = typeof a === 'object' ? a.typed : a === 'block' ? labels[1] : a === 'third' ? labels[2] : labels[0];
      return { result: { questions: e.questions, answers: { [q?.question]: label } } };
    }
    reached.push(String(e.tool));
    calls.push(e);
    const answer = opts.results?.[String(e.tool)];
    return answer ? answer(e) : { result: 'ran' };
  });
  on('tool.list', () => ({ value: [{ name: 'Bash' }, { name: 'Read' }, { name: 'Write' }, { name: 'Edit' }] }));
  const registered: any[] = [];
  // The slash commands the plugin declares, as Claude Code takes them.
  const commands: any[] = [];
  on('command.register', (_$: any, e: any) => {
    commands.push(e);
    return { value: { command: e.name } };
  });
  on('tool.register', (_$: any, e: any) => {
    registered.push(e);
    return { value: { tool: `mcp__terminal-code__${e.name}` } };
  });
  // The safety-net hook's record of each prompt (UserPromptSubmit runs beneath every plugin's prompt hook).
  const hook = { mode: opts.promptMode ?? null, prompts: 0 };
  on('prompt.submit', (_$: any, e: any) => {
    submitted.push(e.text);
    if (hook.mode !== null) {
      const path = `${at.DATA}/state/sessions/${SESSION}.hook.json`;
      const prev = files.get(norm(path));
      const state = prev ? JSON.parse(prev.text) : { v: 1, sessionId: SESSION, lastRunAt: 0, blocks: {}, permissionMode: null, permissionModeAt: 0 };
      const changed = state.permissionMode !== hook.mode;
      write(path, JSON.stringify({ ...state, ...(changed ? { permissionMode: hook.mode, permissionModeAt: clock.now() } : {}), promptAt: clock.now() }));
      hook.prompts++;
    }
    return { text: e.text, context: e.context ?? [] };
  });
  on('session.measure', (_$: any, e: any) => ({ changed: e.changed }));
  on('fs.exists', (_$: any, e: any) => {
    const path = norm(e.path).replace(/\/+$/, '');
    return { value: files.has(path) || [...files.keys()].some((p) => p.startsWith(path + '/')) };
  });
  on('settings.read', () => ({ value: opts.settings ?? {} }));
  on('session.model', () => ({ value: 'claude-opus-5-5' }));
  on('session.messages', () => ({ value: opts.messages ?? [] }));
  const reviews: any[] = [];
  on('model.complete', (_$: any, e: any) => {
    reviews.push(e);
    return { value: opts.review ? opts.review(e) : { isAnswered: true, text: 'VERDICT: PASS', usage: { input_tokens: 1, output_tokens: 1 } } };
  });
  return {
    clock,
    hook,
    files,
    ran,
    reached,
    calls,
    registered,
    commands,
    reviews,
    toasts,
    notes,
    asked,
    submitted,
    read: (path: string) => files.get(norm(path))?.text ?? null,
    json: (path: string) => {
      const t = files.get(norm(path))?.text;
      return t ? JSON.parse(t) : null;
    },
    write,
    modState: () => {
      const t = files.get(norm(`${at.DATA}/state/sessions/${SESSION}.mod.json`))?.text;
      return t ? JSON.parse(t) : null;
    },
    events: () =>
      [...files.entries()]
        .filter(([p]) => p.startsWith(norm(`${at.DATA}/events/`)))
        .flatMap(([, f]) =>
          f.text
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l)),
        ),
  };
}
