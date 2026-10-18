// SPDX-License-Identifier: Apache-2.0
/**
 * `mode-code packs` (docs/packs.md): the tool packs, which are on in this folder, and turning them on or off. The
 * person's own choices (a pack on or off, a pack's mode, Automatic use) are refused inside a Claude Code session;
 * `packs here --auto` only does what Automatic use already allows, and is what the plugin runs as a session starts.
 */
import { APP_ID, APP_VERSION } from '../core/app.js';
import { serializeConfig, setConfigValue } from '../core/config.js';
import { tIn, type MessageKey } from '../core/i18n/index.js';
import { optionLabel } from '../core/ux/catalog.js';
import {
  claudeMayTurnOn,
  installLines,
  packById,
  packLastUse,
  packOfPlugin,
  PACK_MODES,
  PACKS,
  unusedPacks,
  type PackMode,
  type PackRow,
} from '../core/packs.js';
import { appContext, type AppContext } from '../app/context.js';
import { loadEvents } from '../app/data.js';
import { ago } from '../core/format.js';
import { writeAtomic } from '../node/fsx.js';
import { distDir, underAgent } from '../node/install.js';
import { autoPacks, claudeIn, listedPlugins, packGuide, packRows, readPackRecord, turnOff, turnOn } from '../node/packs.js';
import { flag, value, type Args } from './args.js';
import { bold, dim, green, red, yellow } from './style.js';

const say = (s = '') => process.stdout.write(s + '\n');

export async function cmdPacks(a: Args): Promise<number> {
  const ctx = appContext();
  const T = (k: MessageKey, p?: Record<string, string | number>) => tIn(ctx.lang, k, p);
  const sub = a.positionals[0] ?? 'list';
  const dir = value(a, 'dir') ?? ctx.cwd;
  const json = flag(a, 'json');
  const out = (o: Record<string, unknown>) => say(JSON.stringify({ schema: `${APP_ID}.packs/1`, version: APP_VERSION, ...o }, null, 2));
  const policy = ctx.config.packs;

  if (sub === 'here' && (flag(a, 'auto') || value(a, 'pack'))) {
    // Only what Automatic use (or a pack set to always) allows: run by the plugin as a session starts (the folder's
    // markers), or for the one pack Claude asked for through the catalog. Nothing the person keeps for themselves.
    const runner = claudeIn(dir);
    const listed = listedPlugins(runner) ?? [];
    const onHere = () => (listedPlugins(runner) ?? listed).filter((x) => x.enabled).flatMap((x) => packOfPlugin(x.id)?.id ?? []);
    const asked = value(a, 'pack');
    if (asked !== undefined) {
      const p = packById(asked);
      if (!p) return unknown(ctx, asked);
      const may = claudeMayTurnOn(p, policy);
      const changes = may === 'yes' ? turnOn(ctx.layout, [p], { project: dir, runner }) : [];
      if (json) out({ ok: may === 'yes' && changes.every((c) => c.ok), reason: may === 'yes' ? null : may, changes, onHere: onHere() });
      else report(ctx, changes);
      return may === 'yes' && changes.every((c) => c.ok) ? 0 : 1;
    }
    const r = autoPacks(ctx.layout, dir, policy, runner, undefined, listed);
    if (json)
      out({
        on: r.on,
        already: r.already,
        onHere: r.on.some((c) => c.ok) ? onHere() : listed.filter((x) => x.enabled).flatMap((x) => packOfPlugin(x.id)?.id ?? []),
      });
    else for (const c of r.on) say(c.ok ? green(T('packs.cli.on', { pack: c.pack })) : red(T('packs.cli.failed', { pack: c.pack, detail: c.detail })));
    return r.on.every((c) => c.ok) ? 0 : 1;
  }
  if (sub === 'list' || sub === 'here') {
    const rows = packRows(listedPlugins(claudeIn(dir)) ?? [], policy.items);
    const lastUse = packLastUse(loadEvents(ctx, 60));
    const unused = unusedPacks(readPackRecord(ctx.layout).on, dir, lastUse, Date.now());
    if (json) {
      out({
        autoUse: policy.autoUse,
        packs: rows.map((r) => ({
          id: r.pack.id,
          category: r.pack.category,
          mode: r.mode,
          on: r.on,
          found: r.found,
          tokens: r.pack.tokens,
          risk: r.pack.risk,
          lastUsed: lastUse[r.pack.id] ?? null,
        })),
        unused,
      });
      return 0;
    }
    printList(ctx, rows, lastUse, unused);
    return 0;
  }
  if (sub === 'guide') {
    const p = packById(a.positionals[1] ?? '');
    if (!p) return unknown(ctx, a.positionals[1]);
    say(packGuide(ctx.layout, p.id, distDir()) ?? p.summary);
    for (const l of installLines(p)) say(dim(l));
    return 0;
  }
  // The rest are the person's own choices.
  if (underAgent()) {
    if (json) out({ ok: false, reason: 'agent' });
    else say(red(T('cli.agentRefused')));
    return 1;
  }
  const save = (key: string, v: unknown): boolean => {
    const r = setConfigValue(ctx.config, key, v);
    const mine = r.problems.filter((p) => p.path.startsWith('packs'));
    if (mine.length) {
      for (const p of mine) say(red(T('cli.doctor.configProblem', { path: p.path, detail: p.detail })));
      return false;
    }
    writeAtomic(ctx.layout.config, serializeConfig(r.config));
    return true;
  };
  if (sub === 'auto') {
    const v = a.positionals[1];
    if (v !== 'on' && v !== 'off') return usage(ctx);
    if (!save('packs.autoUse', v === 'on')) return 1;
    say(green(T(v === 'on' ? 'packs.cli.autoOn' : 'packs.cli.autoOff')));
    return 0;
  }
  if (sub === 'set') {
    const p = packById(a.positionals[1] ?? '');
    const mode = a.positionals[2] as PackMode;
    if (!p) return unknown(ctx, a.positionals[1]);
    if (!PACK_MODES.includes(mode)) return usage(ctx);
    // `always` turns it on in each project as a session starts there (packsFor); the others change nothing on now.
    if (!save(`packs.items.${p.id}`, mode)) return 1;
    say(green(T('packs.cli.mode', { pack: p.id, mode: optionLabel('packs.items.*', mode, ctx.lang) })));
    return 0;
  }
  if (sub === 'on' || sub === 'off') {
    const p = packById(a.positionals[1] ?? '');
    if (!p) return unknown(ctx, a.positionals[1]);
    const runner = claudeIn(dir);
    const changes = sub === 'on' ? turnOn(ctx.layout, [p], { project: dir, runner }) : [turnOff(ctx.layout, p, { project: dir, runner })];
    if (json) out({ changes });
    else report(ctx, changes);
    if (sub === 'on' && changes[0]?.ok) say(dim(T('packs.cli.reload')));
    return changes.every((c) => c.ok) ? 0 : 1;
  }
  return usage(ctx);
}

function printList(ctx: AppContext, rows: readonly PackRow[], lastUse: Readonly<Record<string, number>>, unused: readonly string[]): void {
  const T = (k: MessageKey, p?: Record<string, string | number>) => tIn(ctx.lang, k, p);
  say(bold(T('packs.cli.title')));
  say(dim(T(ctx.config.packs.autoUse ? 'packs.cli.autoIsOn' : 'packs.cli.autoIsOff')));
  say();
  for (const r of rows) {
    const state = r.on ? green(T('packs.cli.stateOn')) : dim(T('packs.cli.stateOff'));
    const mode = r.mode === 'auto' ? '' : yellow(` · ${optionLabel('packs.items.*', r.mode, ctx.lang)}`);
    const missing = r.pack.tools.filter((t) => !r.found.includes(t.program)).map((t) => t.program);
    const used = lastUse[r.pack.id] ? dim(` · ${T('packs.cli.lastUsed', { when: ago(lastUse[r.pack.id], Date.now(), ctx.lang) })}`) : '';
    say(`  ${r.pack.id.padEnd(11)} ${state}${mode} ${dim(`· ~${r.pack.tokens} tok`)}${used}`);
    say(dim(`    ${r.pack.summary}`));
    if (missing.length) say(dim(`    ${T('packs.cli.missing', { programs: missing.join(', ') })}`));
  }
  say();
  // Turned on here by this tool and not used for a month: offered, never turned off by itself.
  if (unused.length) say(yellow(T('packs.cli.unused', { packs: unused.join(', '), first: unused[0]! })));
  say(dim(T('packs.cli.hint')));
}

function report(ctx: AppContext, changes: readonly { pack: string; ok: boolean; detail: string }[]): void {
  for (const c of changes) say(c.ok ? green(`✓ ${c.pack}`) : red(tIn(ctx.lang, 'packs.cli.failed', { pack: c.pack, detail: c.detail })));
}

function unknown(ctx: AppContext, id: string | undefined): number {
  say(red(tIn(ctx.lang, 'packs.cli.unknown', { pack: id ?? '', packs: PACKS.map((p) => p.id).join(', ') })));
  return 2;
}

function usage(ctx: AppContext): number {
  say(red(tIn(ctx.lang, 'packs.cli.usage')));
  return 2;
}
