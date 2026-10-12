// SPDX-License-Identifier: Apache-2.0
/**
 * The control center's map: seven categories, at most three levels (category › page › detail). Every
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

/** Every address down to `depth` levels, for the command palette. */
export function allEntries(roots: NavNode[], view: ViewLevel, depth = 3, maxChildren = 400): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  const walk = (nodes: NavNode[], prefix: string[], labels: string[], d: number) => {
    for (const n of nodes.filter((x) => visible(x, view)).slice(0, maxChildren)) {
      const path = [...labels, n.label];
      out.push({ address: [...prefix, n.id].join('/'), path, keywords: n.keywords ?? [] });
      if (d < depth && n.children) walk(n.children(), [...prefix, n.id], path, d + 1);
    }
  };
  walk(roots, [], [], 1);
  return out;
}

/** Ranks palette entries for a query: every word must appear (folded); shorter paths and prefix hits first. */
export function searchEntries(entries: readonly PaletteEntry[], query: string, fold: (s: string) => string, limit = 12): PaletteEntry[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return entries.slice(0, limit);
  const scored: { e: PaletteEntry; score: number }[] = [];
  for (const e of entries) {
    const hay = fold([...e.path, e.address, ...e.keywords].join(' '));
    if (!words.every((w) => hay.includes(w))) continue;
    const last = fold(e.path[e.path.length - 1] ?? '');
    const score = (last.startsWith(words[0]!) ? 0 : 10) + e.path.length * 2 + hay.length / 200;
    scored.push({ e, score });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.e);
}

/** Message keys of the seven categories, in order; digits 1-7 jump to them. */
export const CATEGORY_IDS = ['home', 'projects', 'sessions', 'measure', 'security', 'claude-code', 'settings'] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export function categoryKey(id: CategoryId): MessageKey {
  return `cat.${id}` as MessageKey;
}
