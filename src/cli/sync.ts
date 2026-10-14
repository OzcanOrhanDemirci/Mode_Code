// SPDX-License-Identifier: Apache-2.0
/**
 * `mode-code sync` (docs/sync.md): where the shared copy lives and how it stands, the setup, a sync now,
 * settings from other computers that wait for the person (approve or ignore), and a project's folder on this
 * computer. Each with --json; setup, approve, ignore and project only in the person's own terminal.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { APP_ID, APP_VERSION, CLI_NAME } from '../core/app.js';
import { serializeConfig, type Config } from '../core/config.js';
import { ago, dateTime, shortPath } from '../core/format.js';
import { tIn, type MessageKey } from '../core/i18n/index.js';
import { syncProblem } from '../core/memory-sync.js';
import { resolvePath } from '../core/paths.js';
import { applyShared, sharedValues, type Pending } from '../core/sync.js';
import type { SharedRecord } from '../core/sync-export.js';
import { appContext, type AppContext } from '../app/context.js';
import { syncSetup } from '../app/sync-setup.js';
import { syncView } from '../app/sync.js';
import { home, platform } from '../node/env.js';
import { readText, writeAtomic, writeJsonAtomic } from '../node/fsx.js';
import { underAgent } from '../node/install.js';
import { nodeRunner } from '../node/memory.js';
import { mergedConfig, syncShared } from '../node/sync.js';
import { flag, type Args } from './args.js';
import { has, terminalIO } from './memory.js';
import { bold, dim, green, red, yellow } from './style.js';

const say = (s = '') => process.stdout.write(s + '\n');

function json(schema: string, data: object): void {
  process.stdout.write(JSON.stringify({ schema: `${APP_ID}.${schema}/1`, version: APP_VERSION, ...data }, null, 2) + '\n');
}

function T(ctx: AppContext, key: MessageKey, params?: Record<string, string | number>): string {
  return tIn(ctx.lang, key, params);
}

/** A sync's outcome in one line: what was written, recorded, brought in and sent, or what went wrong. */
export function sharedLine(ctx: AppContext, r: SharedRecord): string {
  if (r.error) return T(ctx, 'scli.problem.failed', { detail: r.error });
  const parts: string[] = [];
  if (r.written) parts.push(T(ctx, 'scli.written', { n: r.written }));
  const g = r.result;
  if (g) {
    if (g.commit === 'ok') parts.push(T(ctx, 'mcli.sync.committed', { n: g.committed }));
    if (g.pulled.length) parts.push(T(ctx, 'mcli.sync.pulled', { n: g.pulled.length }));
    if (g.push === 'ok') parts.push(T(ctx, 'mcli.sync.pushed'));
    const problem = syncProblem(g);
    if (problem)
      parts.push(
        T(ctx, `scli.problem.${problem}` as MessageKey, {
          files: (problem === 'held' ? g.held.map((h) => h.path) : g.conflicts).join(', '),
          detail: g.detail,
          dir: ctx.config.sync?.dir ?? '',
        }),
      );
  }
  return parts.length ? parts.join(' · ') : T(ctx, 'scli.nothing');
}

function failed(r: SharedRecord | null): boolean {
  if (!r) return true;
  if (r.error) return true;
  const p = r.result ? syncProblem(r.result) : null;
  return p !== null && p !== 'offline';
}

/** The setup in this terminal: refused under an agent or without a terminal; saves the choices when it went through. */
export async function runSyncSetup(ctx: AppContext): Promise<number> {
  if (underAgent()) {
    say(red(T(ctx, 'cli.agentRefused')));
    return 1;
  }
  if (!process.stdin.isTTY) {
    say(red(T(ctx, 'scli.needsTerminal')));
    return 2;
  }
  const out = await syncSetup(terminalIO(ctx), {
    lang: ctx.lang,
    platform,
    home: home(),
    cwd: ctx.cwd,
    layout: ctx.layout,
    config: ctx.local ?? ctx.config,
    runner: nodeRunner,
    has,
    exists: existsSync,
    now: Date.now,
    hostname: hostname().replace(/\.local$/i, ''),
    random: () => randomBytes(2).toString('hex'),
  });
  if (out.ok && out.config) writeAtomic(ctx.layout.config, serializeConfig(out.config));
  return out.ok ? 0 : 1;
}

function pendingJson(p: Pending) {
  return { key: p.key, machine: p.machine, at: p.at, current: p.current ?? null, incoming: p.incoming ?? null, removed: p.incoming === undefined };
}

export async function cmdSync(a: Args): Promise<number> {
  const ctx = appContext();
  const sub = a.positionals[0] ?? 'status';
  const local: Config = ctx.local ?? ctx.config;

  if (sub === 'setup') return runSyncSetup(ctx);

  if (sub === 'now') {
    if (!local.sync) {
      if (flag(a, 'json')) json('sync.now', { ok: false, reason: 'not-set-up' });
      else say(yellow(T(ctx, 'scli.notSetUp')));
      return 1;
    }
    const r = await syncShared(local, ctx.layout, { trigger: 'manual', session: null, writer: 'cli' });
    const bad = failed(r);
    if (flag(a, 'json')) json('sync.now', { ok: !bad, record: r });
    else say(`${bad ? red('✗') : green('✓')} ${r ? sharedLine(ctx, r) : ''}`);
    return bad ? 1 : 0;
  }

  if (sub === 'approve' || sub === 'ignore') {
    // Taking a setting that lowers a protection, or deciding against it, is the person's: never an agent's.
    if (underAgent()) {
      if (flag(a, 'json')) json(`sync.${sub}`, { ok: false, reason: 'agent' });
      else say(red(T(ctx, 'cli.agentRefused')));
      return 1;
    }
    const pending = mergedConfig(local, ctx.layout).pending;
    const keys = a.positionals.slice(1);
    const all = flag(a, 'all');
    if (!keys.length && !all) {
      // Naming what is taken (or --all) is the person's yes: nothing is taken by default.
      say(red(T(ctx, sub === 'ignore' ? 'scli.ignore.usage' : 'scli.approve.usage')));
      for (const p of pending) say(`  ${p.key}`);
      return 2;
    }
    if (!pending.length) {
      if (flag(a, 'json')) json(`sync.${sub}`, { ok: true, done: [] });
      else say(T(ctx, 'scli.approve.none'));
      return 0;
    }
    const chosen = all ? pending : pending.filter((p) => keys.includes(p.key));
    const unknown = keys.filter((k) => !pending.some((p) => p.key === k));
    if (unknown.length) {
      if (flag(a, 'json')) json(`sync.${sub}`, { ok: false, unknown });
      else for (const k of unknown) say(red(T(ctx, 'scli.approve.unknown', { key: k })));
      return 1;
    }
    if (sub === 'approve') {
      // Written into this computer's own settings: from now on it is this computer's change too.
      const next = applyShared(local, Object.fromEntries(chosen.map((p) => [p.key, p.incoming])));
      writeAtomic(ctx.layout.config, serializeConfig(next));
    } else {
      const ignored: Record<string, number> = {};
      try {
        Object.assign(ignored, JSON.parse(readText(ctx.layout.syncIgnored) ?? '{}'));
      } catch {
        /* a damaged file is replaced */
      }
      for (const p of chosen) ignored[p.key] = p.at;
      writeJsonAtomic(ctx.layout.syncIgnored, ignored);
    }
    const done = chosen.map((p) => p.key);
    if (flag(a, 'json')) json(`sync.${sub}`, { ok: true, done });
    else say(green(T(ctx, sub === 'approve' ? 'scli.approve.done' : 'scli.ignore.done', { keys: done.join(', ') })));
    return 0;
  }

  if (sub === 'project') {
    if (underAgent()) {
      say(red(T(ctx, 'cli.agentRefused')));
      return 1;
    }
    const id = a.positionals[1] ?? '';
    const dir = resolvePath(a.positionals[2] ?? ctx.cwd, { platform, home: home(), cwd: ctx.cwd });
    const known = ctx.config.projects.find((p) => p.id === id);
    if (!known) {
      say(red(T(ctx, 'scli.project.unknown', { id })));
      return 1;
    }
    let isDir = false;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) {
      say(red(T(ctx, 'scli.project.notDir', { dir })));
      return 1;
    }
    // The project as all computers share it, with its folder here: one entry of this computer's own settings.
    const shared = sharedValues(ctx.config)[`projects.${id}`] as { names: string[]; verify?: string[] };
    const others = local.projects.filter((p) => p.id !== id);
    const entry = { id, names: shared.names, ...(shared.verify?.length ? { verify: shared.verify } : {}), path: dir };
    const at = local.projects.findIndex((p) => p.id === id);
    const projects = at >= 0 ? local.projects.map((p) => (p.id === id ? entry : p)) : [...others, entry];
    writeAtomic(ctx.layout.config, serializeConfig({ ...local, projects }));
    say(green(T(ctx, 'scli.project.done', { id, dir })));
    return 0;
  }

  if (sub !== 'status') {
    say(red(T(ctx, 'cli.unknownSub', { sub, cmd: 'sync' })));
    return 2;
  }

  const v = syncView(ctx);
  if (flag(a, 'json')) {
    json('sync', {
      setting: v.setting,
      exists: v.exists,
      machines: v.machines,
      last: v.last,
      pending: v.pending.map(pendingJson),
      applied: v.applied,
      homeless: v.homeless,
      handoffs: v.handoffs,
    });
    return 0;
  }
  const h = home();
  const row = (label: string, text: string) => say(`  ${label.padEnd(16)}${text}`);
  const now = Date.now();
  if (!v.setting) {
    say(bold(T(ctx, 'scli.title.none')));
    say();
    say(T(ctx, 'scli.setupHint', { cmd: `${CLI_NAME} sync setup` }));
    return 0;
  }
  const s = v.setting;
  say(bold(T(ctx, 'scli.title', { place: T(ctx, `scli.place.${s.place}` as MessageKey) })));
  row(T(ctx, 'scli.where'), [s.repo ?? '', shortPath(s.dir, h, 70)].filter(Boolean).join(' · ') + (v.exists ? '' : red(` · ${T(ctx, 'mcli.local.missing')}`)));
  row(T(ctx, 'scli.this'), `${s.machine.name} ${dim(`(${s.machine.id})`)}`);
  const others = v.machines.filter((m) => !m.self);
  if (!others.length) row(T(ctx, 'scli.others'), dim(T(ctx, 'scli.others.none', { cmd: `${CLI_NAME} sync setup` })));
  others.forEach((m, i) =>
    row(
      i === 0 ? T(ctx, 'scli.others') : '',
      `${m.name}${m.platform ? dim(` · ${m.platform}`) : ''} · ${m.lastSeen ? T(ctx, 'scli.seen', { when: ago(m.lastSeen, now, ctx.lang) }) : dim(T(ctx, 'scli.seen.never'))}`,
    ),
  );
  row(T(ctx, 'scli.last'), v.last ? `${dateTime(v.last.at, ctx.lang)}: ${sharedLine(ctx, v.last)}` : dim(T(ctx, 'scli.last.none')));
  const names = new Map(v.machines.map((m) => [m.id, m.name]));
  v.pending.forEach((p, i) =>
    row(
      i === 0 ? T(ctx, 'scli.pending') : '',
      yellow(T(ctx, 'scli.pending.line', { key: p.key, machine: names.get(p.machine) ?? p.machine, when: ago(p.at, now, ctx.lang) })),
    ),
  );
  if (v.pending.length)
    row('', dim(T(ctx, 'scli.pending.hint', { approve: `${CLI_NAME} sync approve <setting>`, ignore: `${CLI_NAME} sync ignore <setting>` })));
  if (v.applied.length) row(T(ctx, 'scli.applied'), T(ctx, 'scli.applied.text', { n: v.applied.length }));
  if (v.homeless.length) row(T(ctx, 'scli.projects'), T(ctx, 'scli.projects.text', { ids: v.homeless.join(', '), cmd: `${CLI_NAME} sync project` }));
  row(T(ctx, 'scli.handoffs'), T(ctx, `scli.handoffs.${v.handoffs === 'shared' ? 'shared' : v.handoffs}` as MessageKey));
  return 0;
}
