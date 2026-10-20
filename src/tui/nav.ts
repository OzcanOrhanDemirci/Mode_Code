// SPDX-License-Identifier: Apache-2.0
/**
 * The control center's map: eight categories, at most three levels (category › page › detail). Every
 * screen has an address made of its ids ("security/rules/git.clean"); the command line, the palette and
 * the "fix" links use the same addresses. Pure, so it can be tested without a terminal.
 */
import type { ReactNode } from 'react';
import type { MessageKey } from '../core/i18n/index.js';
import type { ViewLevel } from '../core/config.js';
import type { HealthState } from '../app/health.js';

export interface ScreenProps {
  width: number;
  height: number;
  /** True when the screen is open (has the keyboard); false when it is a preview beside a list. */
  open: boolean;
}

export interface NavNode {
  id: string;
  /** Label shown in lists and the location bar (already translated). */
  label: string;
  /** One sentence at the top of the screen: what it is for. */
  description?: string;
  /** Short status at the right of the list row ("🔴 1", "3 sessions"). */
  badge?: { text: string; state?: HealthState | 'info' };
  /** Shown only from this view level up. */
  minView?: ViewLevel;
  /** Child pages or details. A node has children or a screen, or both (a screen with its own list). */
  children?: () => NavNode[];
  screen?: (p: ScreenProps) => ReactNode;
  /** Words the palette also matches (the other language's label, synonyms). */
  keywords?: string[];
}

export const VIEW_ORDER: Record<ViewLevel, number> = { simple: 0, recommended: 1, detailed: 2 };

export function visible(n: NavNode, view: ViewLevel): boolean {
  return !n.minView || VIEW_ORDER[view] >= VIEW_ORDER[n.minView];
}

/** Resolves an address to the chain of nodes along it; stops at the first segment that does not exist. */
export function resolve(roots: NavNode[], address: string, view: ViewLevel): NavNode[] {
  const chain: NavNode[] = [];
  let level = roots.filter((n) => visible(n, view));
  for (const seg of address.split('/').filter(Boolean)) {
    const n = level.find((x) => x.id === seg) ?? level.find((x) => x.id.toLowerCase() === seg.toLowerCase());
    if (!n) break;
    chain.push(n);
    level = n.children ? n.children().filter((x) => visible(x, view)) : [];
  }
  return chain;
}

export function addressOf(chain: readonly NavNode[]): string {
  return chain.map((n) => n.id).join('/');
}

export interface PaletteEntry {
  address: string;
  path: string[];
  keywords: string[];
}

/** Every address down to `depth` levels, for the command palette; a page's old addresses are among its words. */
export function allEntries(roots: NavNode[], view: ViewLevel, depth = 3, maxChildren = 400): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  const walk = (nodes: NavNode[], prefix: string[], labels: string[], d: number) => {
    for (const n of nodes.filter((x) => visible(x, view)).slice(0, maxChildren)) {
      const path = [...labels, n.label];
      const address = [...prefix, n.id].join('/');
      out.push({ address, path, keywords: [...(n.keywords ?? []), ...(d < 3 ? formerAddresses(address) : [])] });
      if (d < depth && n.children) walk(n.children(), [...prefix, n.id], path, d + 1);
    }
  };
  walk(roots, [], [], 1);
  return out;
}

/**
 * Ranks palette entries for a query: every word must appear (folded). A page whose name (in either language, or a
 * word it is known by) starts with the query comes first, then one where a word of its name does, then the rest;
 * among equals the shallower page, then the shorter name.
 */
export function searchEntries(entries: readonly PaletteEntry[], query: string, fold: (s: string) => string, limit = 12): PaletteEntry[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return entries.slice(0, limit);
  const scored: { e: PaletteEntry; score: number }[] = [];
  for (const e of entries) {
    const hay = fold([...e.path, e.address, ...e.keywords].join(' '));
    if (!words.every((w) => hay.includes(w))) continue;
    const last = fold(e.path[e.path.length - 1] ?? '');
    const names = [last, ...e.keywords.map(fold)];
    const first = words[0]!;
    const fit = names.some((n) => n.startsWith(first)) ? 0 : names.some((n) => n.split(/[\s/._-]+/).some((w) => w.startsWith(first))) ? 4 : 10;
    scored.push({ e, score: fit + e.path.length * 2 + last.length / 100 });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.e);
}

/**
 * The eight categories, by what the person comes for (docs/design.md, The control center): what is going on now, what
 * happened, how Claude works, what protects the work, the memory and the projects, the quota, Claude Code's own
 * setup, and this tool's settings. Digits 1-8 jump to them.
 */
export const CATEGORY_IDS = ['now', 'activity', 'work', 'protection', 'memory', 'quota', 'claude-code', 'settings'] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export function categoryKey(id: CategoryId): MessageKey {
  return `cat.${id}` as MessageKey;
}

/**
 * Where each page of the old map (1.1, by the parts of the system) went: an old address still opens its page, from
 * the command line, a link of an older plugin, or the palette, which also finds a page by its old place. The longest
 * old address that starts a given one decides; what follows it is kept ("security/rules/git.clean").
 */
export const MOVED: readonly (readonly [from: string, to: string])[] = [
  ['home/overview', 'now'],
  ['home/inbox', 'activity/away'],
  ['home/activity', 'activity/feed'],
  ['home', 'now'],
  ['projects/flows', 'work/flows'],
  ['projects/handoffs', 'memory/handoffs'],
  ['projects', 'memory/projects'],
  ['sessions', 'memory/sessions'],
  ['measure/quota', 'quota/usage'],
  ['measure/report', 'activity/report'],
  ['measure', 'quota'],
  ['security/protection', 'protection/status'],
  ['security', 'protection'],
  ['automation', 'work'],
  ['settings/history', 'activity/changes'],
  ['settings/footer-quota', 'quota/limits'],
  ['settings/memory/store', 'memory/store'],
  ['settings/memory/handoffs', 'memory/notes'],
  ['settings/memory/protected', 'memory/protected'],
  ['settings/memory', 'memory'],
  ['settings/sync', 'memory/sync'],
  ['settings/projects', 'memory/names'],
  ['settings/keywords', 'work/keywords'],
  // 1.2.0: bypass is gone; the way of working (on the Modes page) says how much is asked, the activity what passed.
  ['automation/bypass', 'work/modes'],
  ['automation/bypassed', 'activity/feed'],
  ['work/bypass', 'work/modes'],
  ['work/bypassed', 'activity/feed'],
];

const startsAt = (address: string, prefix: string) => address === prefix || address.startsWith(`${prefix}/`);

/** An old address as the map has it now; null when it is not an old one. */
export function movedTo(address: string): string | null {
  const a = address.split('/').filter(Boolean).join('/');
  let best: readonly [string, string] | null = null;
  for (const m of MOVED) if (startsAt(a, m[0]) && (!best || m[0].length > best[0].length)) best = m;
  return best ? best[1] + a.slice(best[0].length) : null;
}

/** The old addresses a page had, for the palette: typing one finds where it went. */
export function formerAddresses(address: string): string[] {
  const out = new Set<string>();
  for (const [from, to] of MOVED) if (startsAt(address, to) && movedTo(from + address.slice(to.length)) === address) out.add(from + address.slice(to.length));
  return [...out];
}

/**
 * The chain of nodes an address leads to, an old address too: the page it names, or, when it names none, the page it
 * moved to. The list being browsed may hide pages (the view level); an address always reaches them.
 */
export function resolveAddress(roots: NavNode[], address: string): { chain: NavNode[]; address: string } {
  const segments = address.split('/').filter(Boolean);
  const here = resolve(roots, address, 'detailed');
  if (here.length === segments.length) return { chain: here, address: addressOf(here) };
  const moved = movedTo(address);
  if (moved) {
    const there = resolve(roots, moved, 'detailed');
    // Where it went, when that is a page whole, or leads further than the old words do here.
    if (there.length === moved.split('/').length || there.length > here.length) return { chain: there, address: addressOf(there) };
  }
  return { chain: here, address: addressOf(here) };
}

/**
 * The location bar's crumbs fitted to `room` columns, never squeezed into one another: the first and the last stay,
 * the ones between give way to one `…` from the outermost in, and a last crumb still too long is cut. `level` is the
 * crumb's place in the chain (what a click on it leads back to); null for the `…`.
 */
export function fitCrumbs(labels: readonly string[], room: number, sepW: number, measure: (s: string) => number): { label: string; level: number | null }[] {
  const all = labels.map((label, level) => ({ label, level: level as number | null }));
  const width = (ps: { label: string }[]) => ps.reduce((n, p, i) => n + measure(p.label) + (i ? sepW : 0), 0);
  if (width(all) <= room || all.length < 3) return fitLast(all, room, sepW, measure);
  for (let drop = 1; drop < all.length - 1; drop++) {
    const ps = [all[0]!, { label: '…', level: null }, ...all.slice(1 + drop)];
    if (width(ps) <= room) return ps;
  }
  return fitLast([all[0]!, { label: '…', level: null }, all.at(-1)!], room, sepW, measure);
}

function fitLast(ps: { label: string; level: number | null }[], room: number, sepW: number, measure: (s: string) => number) {
  const before = ps.slice(0, -1).reduce((n, p, i) => n + measure(p.label) + (i ? sepW : 0), 0) + (ps.length > 1 ? sepW : 0);
  const last = ps.at(-1)!;
  const max = Math.max(1, room - before);
  if (measure(last.label) <= max) return ps;
  let out = '';
  for (const ch of last.label) {
    if (measure(out + ch) > max - 1) break;
    out += ch;
  }
  return [...ps.slice(0, -1), { ...last, label: `${out.trimEnd()}…` }];
}
