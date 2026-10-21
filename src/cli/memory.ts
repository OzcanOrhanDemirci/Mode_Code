// SPDX-License-Identifier: Apache-2.0
/**
 * `mode-code memory` and `mode-code morning` (docs/memory.md): where the memory lives and how it
 * stands, the setup, a sync now, the handoff notes, the morning report.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { APP_ID, APP_VERSION, CLI_NAME } from '../core/app.js';
import { serializeConfig } from '../core/config.js';
import { saveConfig } from '../node/changes.js';
import { dateTime, shortPath } from '../core/format.js';
import { nextOf } from '../core/handoff.js';
import { tIn, type MessageKey } from '../core/i18n/index.js';
import { heldText, syncProblem, type SyncResult } from '../core/memory-sync.js';
import { morningLines } from '../core/morning.js';
import { appContext, type AppContext } from '../app/context.js';
import { memorySetup } from '../app/memory-setup.js';
import { handoffsOf, memoryView, morningFacts, morningWindow, newestHandoff, projectKeyFor } from '../app/memory.js';
import { claudeDir, home, platform } from '../node/env.js';
import { underAgent } from '../node/install.js';
import { nodeRunner, recordSync, seenSince, syncStore } from '../node/memory.js';
import { flag, intValue, value, type Args } from './args.js';
import { bold, cyan, dim, green, red, yellow } from './style.js';
import { say, terminalIO } from './ask.js';

function json(schema: string, data: object): void {
  process.stdout.write(JSON.stringify({ schema: `${APP_ID}.${schema}/1`, version: APP_VERSION, ...data }, null, 2) + '\n');
}

export { terminalIO };

/** Whether a program answers on this PATH. */
export async function has(program: string): Promise<boolean> {
  const r = spawnSync(program, ['--version'], { stdio: 'ignore', windowsHide: true, timeout: 10_000 });
  return !r.error && r.status !== null;
}

function T(ctx: AppContext, key: MessageKey, params?: Record<string, string | number>): string {
  return tIn(ctx.lang, key, params);
}

function syncLine(ctx: AppContext, r: SyncResult): string {
  const problem = syncProblem(r);
  const parts: string[] = [];
  if (r.commit === 'ok') parts.push(T(ctx, 'mcli.sync.committed', { n: r.committed }));
  if (r.pulled.length) parts.push(T(ctx, 'mcli.sync.pulled', { n: r.pulled.length }));
  if (r.push === 'ok') parts.push(T(ctx, 'mcli.sync.pushed'));
  if (!parts.length && !problem) parts.push(T(ctx, 'mcli.sync.nothing'));
  if (problem)
    parts.push(
      T(ctx, `mcli.problem.${problem}` as MessageKey, { files: (problem === 'held' ? r.held.map(heldText) : r.conflicts).join(', '), detail: r.detail }),
    );
  // A push held for a secret the person looked at and found harmless: the way to let it go, by its fingerprint.
  const prints = r.held.flatMap((h) => (h.fingerprint ? [h.fingerprint] : []));
  if (prints.length) parts.push(T(ctx, 'mcli.heldAllow', { cmd: `${CLI_NAME} secrets allow ${prints.join(' ')}` }));
  return parts.join(' · ');
}

/** The setup in this terminal: refused under an agent or without a terminal; saves the choices when it went through. */
export async function runMemorySetup(ctx: AppContext): Promise<number> {
  // The setup changes Claude Code's settings and may create a repository: the person's own terminal only.
  if (underAgent()) {
    say(red(T(ctx, 'cli.agentRefused')));
    return 1;
  }
  if (!process.stdin.isTTY) {
    say(red(T(ctx, 'mcli.needsTerminal')));
    return 2;
  }
  const out = await memorySetup(terminalIO(ctx.lang), {
    lang: ctx.lang,
    platform,
    home: home(),
    cwd: ctx.cwd,
    layout: ctx.layout,
    claudeDir: claudeDir(),
    config: ctx.config,
    runner: nodeRunner,
    has,
    exists: existsSync,
    now: Date.now,
  });
  if (out.ok && out.config) {
    saveConfig(ctx.layout, ctx.config, out.config, 'setup');
    if (out.sync) recordSync(ctx.layout, 'cli', 'setup', null, out.sync);
  }
  return out.ok ? 0 : 1;
}

export async function cmdMemory(a: Args): Promise<number> {
  const ctx = appContext();
  const sub = a.positionals[0] ?? 'status';

  if (sub === 'setup') return runMemorySetup(ctx);
  if (sub === 'sync') {
    const r = await syncStore(ctx.config, { trigger: 'manual', session: null, lang: ctx.lang, since: seenSince(ctx.layout) });
    if (!r) {
      if (flag(a, 'json')) json('memory.sync', { ok: false, reason: ctx.config.memory.store ? 'no-history' : 'not-set-up' });
      else say(yellow(T(ctx, ctx.config.memory.store ? 'mcli.noHistory' : 'mcli.notSetUp')));
      return 1;
    }
    recordSync(ctx.layout, 'cli', 'manual', null, r);
    const problem = syncProblem(r);
    if (flag(a, 'json')) json('memory.sync', { ok: problem === null || problem === 'offline', problem, result: r });
    else say(`${problem && problem !== 'offline' ? red('✗') : green('✓')} ${syncLine(ctx, r)}`);
    return problem === null || problem === 'offline' ? 0 : 1;
  }

  if (sub === 'handoff' || sub === 'handoffs') {
    const project = value(a, 'project') ?? projectKeyFor(ctx, ctx.cwd);
    if (flag(a, 'all')) {
      const list = handoffsOf(ctx, project);
      if (flag(a, 'json')) {
        json('memory.handoffs', { project, notes: list });
        return 0;
      }
      if (!list.length) say(T(ctx, 'mcli.handoff.none', { project }));
      for (const h of list.slice().reverse()) say(`  ${h.name}  ${dim(h.path)}`);
      return 0;
    }
    const h = newestHandoff(ctx, project);
    if (flag(a, 'json')) {
      json('memory.handoff', { project, path: h?.path ?? null, note: h?.note ?? null });
      return h ? 0 : 1;
    }
    if (!h) {
      say(T(ctx, 'mcli.handoff.none', { project }));
      return 1;
    }
    say(dim(h.path));
    say();
    say(h.text.trimEnd());
    return 0;
  }

  if (sub !== 'status') {
    say(red(T(ctx, 'cli.unknownCommand', { cmd: `memory ${sub}`, near: '', help: `${CLI_NAME} help memory` })));
    return 2;
  }

  const v = memoryView(ctx);
  if (flag(a, 'json')) {
    json('memory', {
      ...v,
      handoff: v.handoff ? { path: v.handoff.path, at: v.handoff.note.at, trigger: v.handoff.note.trigger, next: nextOf(v.handoff.note) } : null,
    });
    return 0;
  }
  const h = home();
  const row = (label: string, text: string) => say(`  ${label.padEnd(16)}${text}`);
  if (!v.store) {
    say(bold(T(ctx, 'mcli.title.none')));
    row(T(ctx, 'mcli.claude'), v.setting ? shortPath(v.setting, h, 70) : T(ctx, 'mcli.perProject'));
    say();
    say(T(ctx, 'mcli.setupHint', { cmd: `${CLI_NAME} memory setup` }));
  } else {
    say(bold(T(ctx, 'mcli.title', { place: T(ctx, `msetup.place.${v.store.place}` as MessageKey) })));
    row(T(ctx, 'mcli.folder'), shortPath(v.store.dir, h, 70));
    if (v.store.repo || v.store.remote) row('GitHub', v.store.repo ?? v.store.remote ?? '');
    row(
      T(ctx, 'mcli.claude'),
      v.inUse
        ? green(`✓ ${T(ctx, 'mcli.inUse')}`)
        : red(`✗ ${T(ctx, 'mcli.notInUse', { dir: v.setting ? shortPath(v.setting, h, 50) : T(ctx, 'mcli.perProject') })}`),
    );
    if (v.local) {
      const bits = [
        v.local.isRepo ? T(ctx, 'mcli.local.repo') : T(ctx, 'mcli.local.noRepo'),
        v.local.dirty ? T(ctx, 'mcli.local.dirty', { n: v.local.dirty }) : '',
        v.local.ahead ? T(ctx, 'mcli.local.ahead', { n: v.local.ahead }) : '',
      ].filter(Boolean);
      row(T(ctx, 'mcli.local'), bits.join(' · '));
    } else row(T(ctx, 'mcli.local'), red(T(ctx, 'mcli.local.missing')));
    row(
      T(ctx, 'mcli.sync'),
      `${T(ctx, `mcli.sync.${v.store.sync}` as MessageKey)}${v.last ? ` · ${dateTime(v.last.at, ctx.lang)}: ${syncLine(ctx, v.last.result)}` : ''}`,
    );
  }
  row(
    T(ctx, 'mcli.handoff'),
    v.handoff ? `${dateTime(v.handoff.note.at, ctx.lang)} · ${nextOf(v.handoff.note, 80, ctx.lang)}` : dim(T(ctx, 'mcli.handoff.none', { project: v.project })),
  );
  return 0;
}

export async function cmdMorning(a: Args): Promise<number> {
  const ctx = appContext();
  const now = Date.now();
  const w = value(a, 'hours') ? { since: now - intValue(a, 'hours', 24, 1, 24 * 30) * 3_600_000, until: now } : morningWindow(ctx, now);
  const facts = morningFacts(ctx, w.since, w.until);
  const lines = morningLines(facts, ctx.lang);
  if (flag(a, 'json')) {
    json('morning', { since: w.since, until: w.until, facts, lines });
    return 0;
  }
  say(bold(T(ctx, 'morning.title', { since: dateTime(w.since, ctx.lang) })));
  say();
  if (!lines.length) say(T(ctx, 'morning.nothing'));
  let last = '';
  for (const l of lines) {
    say(`  ${(l.label === last ? '' : l.label).padEnd(16)}${l.text}`);
    last = l.label;
  }
  return 0;
}
