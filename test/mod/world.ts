// SPDX-License-Identifier: Apache-2.0
/**
 * The world beneath the mod in Claude Code's test kit: a file system, the environment, the clock, the
 * session, `uname` and `git`, and the person's answers, all in memory. The hooks registered here sit
 * beneath the plugin, where the engine would be; the test reads back what the plugin did.
 */
import { mock } from 'claude-code/testing';

export interface WorldOptions {
  /** Answer to the belt's question: the label to pick, or 'nobody' when no one can be asked. */
  answer?: 'allow' | 'block' | 'nobody';
  config?: Record<string, unknown>;
  now?: number;
  lang?: 'en' | 'tr';
  windows?: boolean;
  /** The session cannot say where it is: every $.session.cwd call fails. */
  cwdFails?: boolean;
}

export const HOME = '/home/ada';
export const DATA = '/home/ada/.terminal-code';
export const PROJECT = '/home/ada/dev/app';
export const SESSION = 'kit-session-1';
/** The same machine on Windows. */
export const WIN = { HOME: 'C:/Users/ada', DATA: 'C:/Users/ada/.terminal-code', PROJECT: 'C:/dev/app' };

/** The engine hands file paths over in the host's own form (C:\home\ada\x on Windows): back to /home/ada/x. */
export function norm(path: string): string {
  return path.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '');
}

export function world(on: any, opts: WorldOptions = {}) {
  const files = new Map<string, { text: string; mtimeMs: number }>();
  const toasts: string[] = [];
  const notes: string[] = [];
  const asked: string[] = [];
  const submitted: string[] = [];
  const clock = mock.clock(on, { now: opts.now ?? Date.parse('2026-10-12T10:00:00Z') });
  const at = opts.windows ? WIN : { HOME, DATA, PROJECT };
  mock.env(on, {
    ...(opts.windows ? { USERPROFILE: at.HOME, OS: 'Windows_NT', TEMP: `${at.HOME}/AppData/Local/Temp` } : { HOME: at.HOME }),
    TERMINAL_CODE_HOME: at.DATA,
    TERMINAL_CODE_LANG: opts.lang ?? 'en',
  });
  const write = (path: string, text: string) => files.set(norm(path), { text, mtimeMs: clock.now() });
  if (opts.config) write(`${at.DATA}/config.json`, JSON.stringify(opts.config));
  on('session.cwd', () => {
    if (opts.cwdFails) throw new Error('the session is gone');
    return { value: at.PROJECT };
  });
  on('session.root', () => ({ value: at.PROJECT }));
  on('session.id', () => ({ value: SESSION }));
  on('fs.read', (_$: any, e: any) => (files.has(norm(e.path)) ? { value: files.get(norm(e.path))!.text } : { deny: `ENOENT: ${e.path}` }));
  on('fs.write', (_$: any, e: any) => {
    write(norm(e.path), e.text);
    return { value: undefined };
  });
  on('fs.list', (_$: any, e: any) => {
    const dir = norm(e.path).replace(/\/+$/, '');
    const entries = [...files.entries()]
      .filter(([p]) => p.startsWith(dir + '/') && !p.slice(dir.length + 1).includes('/'))
      .map(([p, f]) => ({ name: p.slice(dir.length + 1), kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs }));
    return { value: entries };
  });
  on('fs.stat', (_$: any, e: any) => {
    const path = norm(e.path);
    const f = files.get(path);
    if (f) return { value: { kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false } };
    if ([...files.keys()].some((p) => p.startsWith(path.replace(/\/+$/, '') + '/'))) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } };
    return { deny: 'ENOENT' };
  });
  on('process.run', (_$: any, e: any) => {
    const [cmd, ...rest] = e.argv as string[];
    if (cmd === 'uname') return { value: { exitCode: 0, stdout: 'Linux\n', stderr: '' } };
    if (cmd === 'git') {
      const a = rest.join(' ');
      if (a.includes('symbolic-ref')) return { value: { exitCode: 0, stdout: 'feature\n', stderr: '' } };
      if (a.includes('remote get-url')) return { value: { exitCode: 0, stdout: 'https://example.com/ada/app.git\n', stderr: '' } };
      return { value: { exitCode: 1, stdout: '', stderr: 'not a git repository' } };
    }
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
  on('tool.call', (_$: any, e: any) => {
    if (e.tool === 'AskUserQuestion') {
      const q = e.questions?.[0];
      asked.push(String(q?.question ?? ''));
      if (opts.answer === 'nobody' || !opts.answer) return { deny: 'no one to ask' };
      const labels: string[] = (q?.options ?? []).map((o: any) => o.label);
      const label = opts.answer === 'block' ? labels[1] : labels[0];
      return { result: { questions: e.questions, answers: { [q?.question]: label } } };
    }
    reached.push(String(e.tool));
    return { result: 'ran' };
  });
  on('prompt.submit', (_$: any, e: any) => {
    submitted.push(e.text);
    return { text: e.text, context: e.context ?? [] };
  });
  on('session.measure', (_$: any, e: any) => ({ changed: e.changed }));
  return {
    clock,
    files,
    reached,
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
