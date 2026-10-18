// SPDX-License-Identifier: Apache-2.0
/**
 * Tool packs on this computer (docs/packs.md): which are on in a project, turning one on or off there, and what this
 * tool turned on, kept in state/packs.json so that uninstalling takes it all away again. A pack is turned on for one
 * project as Claude Code does it (`claude plugin install <id> --scope local`, measured in scripts/test-packs.mjs: the
 * project's `.claude/settings.local.json` names it, and `claude plugin list --json` run there lists it enabled).
 */
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { hostedName, packById, packPluginId, packsFor, PACKS, type Pack, type PackPolicy, type PackRow, modeOf } from '../core/packs.js';
import type { Layout } from '../core/layout.js';
import { cleanClaudeEnv, runClaude, type ClaudeRunner } from './claude-env.js';
import { readJson, readText, writeAtomic, writeJsonAtomic } from './fsx.js';

/** `claude` run in a project's folder: what is on is said for that folder. */
export function claudeIn(cwd: string): ClaudeRunner {
  return {
    version: () => null,
    run: (args, timeoutMs = 120_000) => runClaude(args, { timeoutMs, env: cleanClaudeEnv(), cwd }),
  };
}

/** The names at a folder's top (folders without a mark), at most 2,000; none for the home folder or a drive's root. */
export function topNames(dir: string): string[] {
  const full = resolve(dir);
  if (full === resolve(homedir()) || dirname(full) === full) return [];
  try {
    return readdirSync(full).slice(0, 2000);
  } catch {
    return [];
  }
}

/** Where a program is on the PATH (with Windows' extensions), or null. */
export function findProgram(name: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const exts = platform === 'win32' ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())] : [''];
  for (const dir of (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean)) {
    for (const ext of exts) {
      const p = join(dir, name + ext);
      try {
        if (statSync(p).isFile()) return p;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

/** The plugins Claude Code lists from a folder: id, scope, and whether each is on there. Null when it cannot be read. */
export function listedPlugins(runner: ClaudeRunner): { id: string; scope: string; enabled: boolean }[] | null {
  try {
    const r = runner.run(['plugin', 'list', '--json'], 30_000);
    if (r.status !== 0) return null;
    const list = JSON.parse(r.stdout.slice(r.stdout.indexOf('['))) as unknown;
    if (!Array.isArray(list)) return null;
    return list.flatMap((p) =>
      p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string'
        ? [{ id: (p as { id: string }).id, scope: String((p as { scope?: unknown }).scope ?? ''), enabled: (p as { enabled?: unknown }).enabled === true }]
        : [],
    );
  } catch {
    return null;
  }
}

/** Each pack as it stands in a folder: the person's mode, whether it is on there, its programs found. */
export function packRows(
  listed: readonly { id: string; enabled: boolean }[],
  items: PackPolicy['items'],
  found: (program: string) => boolean = (p) => findProgram(p) !== null,
): PackRow[] {
  return PACKS.map((pack) => ({
    pack,
    mode: modeOf(items, pack.id),
    on: listed.some((l) => l.id === packPluginId(pack) && l.enabled),
    found: [...new Set([...pack.tools.map((t) => t.program), ...pack.needs])].filter(found),
  }));
}

/** What this tool turned on, where (state/packs.json): what uninstalling takes away. */
export interface PackRecord {
  v: 1;
  on: { pack: string; project: string | null; at: number }[];
}

export function readPackRecord(l: Layout): PackRecord {
  const r = readJson<Partial<PackRecord>>(join(l.stateDir, 'packs.json'));
  const on = Array.isArray(r?.on)
    ? r.on.filter((x) => x && typeof x.pack === 'string' && (x.project === null || typeof x.project === 'string') && typeof x.at === 'number')
    : [];
  return { v: 1, on };
}

function keepRecord(l: Layout, r: PackRecord): void {
  writeJsonAtomic(join(l.stateDir, 'packs.json'), r);
}

/** The arguments that turn a pack on: in one project (`local`), or everywhere (`user`). */
export function packInstallArgs(p: Pack, l: Layout, scope: 'local' | 'user'): string[] {
  return p.plugin.hosted
    ? ['plugin', 'install', hostedName(p.id), '--marketplace', l.marketplace, '--scope', scope]
    : ['plugin', 'install', p.plugin.id, '--scope', scope];
}

export interface PackChange {
  pack: string;
  ok: boolean;
  detail: string;
}

/** Turns packs on in a project (or everywhere), and records it. */
export function turnOn(l: Layout, packs: readonly Pack[], where: { project: string | null; runner: ClaudeRunner }, now = Date.now()): PackChange[] {
  const record = readPackRecord(l);
  const out: PackChange[] = [];
  for (const p of packs) {
    const r = where.runner.run(packInstallArgs(p, l, where.project ? 'local' : 'user'), 120_000);
    const detail = `${r.stdout}${r.stderr}`.trim().split('\n').pop() ?? '';
    out.push({ pack: p.id, ok: r.status === 0, detail });
    if (r.status === 0) {
      record.on = [...record.on.filter((x) => !(x.pack === p.id && x.project === where.project)), { pack: p.id, project: where.project, at: now }];
    }
  }
  if (out.some((c) => c.ok)) keepRecord(l, record);
  return out;
}

/**
 * Turns a pack off in a project (or everywhere) and forgets it. Claude Code leaves an empty `enabledPlugins` in the
 * project's local settings: taken out, and the file too when nothing else is left in it.
 */
export function turnOff(l: Layout, p: Pack, where: { project: string | null; runner: ClaudeRunner }): PackChange {
  const r = where.runner.run(['plugin', 'uninstall', packPluginId(p), '--scope', where.project ? 'local' : 'user'], 120_000);
  const gone = r.status === 0 || /not (?:installed|found)/i.test(`${r.stdout}${r.stderr}`);
  if (gone) {
    const record = readPackRecord(l);
    keepRecord(l, { v: 1, on: record.on.filter((x) => !(x.pack === p.id && x.project === where.project)) });
    if (where.project) tidyLocalSettings(join(where.project, '.claude', 'settings.local.json'));
  }
  return { pack: p.id, ok: gone, detail: `${r.stdout}${r.stderr}`.trim().split('\n').pop() ?? '' };
}

/** Removes an empty `enabledPlugins` from a local settings file, and the file when it is then empty. */
export function tidyLocalSettings(file: string): void {
  try {
    const text = readText(file);
    if (text === null) return;
    const s = JSON.parse(text) as Record<string, unknown>;
    const e = s.enabledPlugins;
    if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).length) return;
    delete s.enabledPlugins;
    if (Object.keys(s).length) writeAtomic(file, JSON.stringify(s, null, 2) + '\n');
    else unlinkSync(file);
  } catch {
    /* a file that does not read as settings is left as it is */
  }
}

/** Everything this tool turned on, turned off (uninstalling): each where it was turned on. */
export function turnAllOff(l: Layout, runnerFor: (project: string | null) => ClaudeRunner): PackChange[] {
  return readPackRecord(l).on.flatMap((x) => {
    const p = packById(x.pack);
    if (!p || (x.project !== null && !existsSync(x.project))) return [];
    return [turnOff(l, p, { project: x.project, runner: runnerFor(x.project) })];
  });
}

/**
 * Automatic use in a project: the packs its markers call for that are not on yet, those whose server's program is
 * here (a language server or an MCP server that cannot start would only fail), turned on.
 */
export function autoPacks(
  l: Layout,
  project: string,
  policy: PackPolicy,
  runner: ClaudeRunner,
  found: (program: string) => boolean = (p) => findProgram(p) !== null,
  listedNow?: readonly { id: string; enabled: boolean }[],
): { on: PackChange[]; already: string[] } {
  const want = packsFor(topNames(project), policy).filter((p) => p.needs.every(found));
  if (!want.length) return { on: [], already: [] };
  const listed = listedNow ?? listedPlugins(runner) ?? [];
  const isOn = (p: Pack) => listed.some((x) => x.id === packPluginId(p) && x.enabled);
  return {
    on: turnOn(
      l,
      want.filter((p) => !isOn(p)),
      { project, runner },
    ),
    already: want.filter(isOn).map((p) => p.id),
  };
}

/** A pack's guide as shipped beside the marketplace (packs/guides/<id>.md), else in a build's folder, or null. */
export function packGuide(l: Layout, id: string, dist?: string): string | null {
  for (const base of [join(l.marketplace, 'packs'), ...(dist ? [join(dist, 'packs')] : [])]) {
    try {
      return readFileSync(join(base, 'guides', `${id}.md`), 'utf8');
    } catch {
      /* the next place */
    }
  }
  return null;
}
