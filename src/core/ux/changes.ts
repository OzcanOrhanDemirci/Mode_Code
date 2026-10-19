// SPDX-License-Identifier: Apache-2.0
/**
 * The record of changes (docs/design.md, Say, do, undo): every change to a setting, by whom and when, from what to
 * what, kept in `state/changes.jsonl` (src/node/changes.ts writes it). From it a change is taken back, a page goes
 * back to its defaults with the list shown first, and the history is a page. Pure: rows in, rows out.
 */
import type { Config } from '../config.js';
import { tIn, type Lang, type MessageKey } from '../i18n/index.js';
import { dateTime } from '../format.js';
import { PACKS } from '../packs.js';
import { EXTERNAL_SKILLS } from '../skills-external.js';
import { defaultOf, nameOf, SETTING_IDS, SETTINGS, valueIn, valueText, type SettingPath } from './catalog.js';

/**
 * Who made a change: the control center, the command line, a setup, a template, the doctor, another computer's change
 * approved here, an undo, a page put back to its defaults, the cockpit inside Claude Code (src/core/ux/cockpit.ts).
 */
export type ChangeWho = 'center' | 'command' | 'setup' | 'template' | 'doctor' | 'sync' | 'undo' | 'default' | 'cockpit';

export const CHANGE_WHO: readonly ChangeWho[] = ['center', 'command', 'setup', 'template', 'doctor', 'sync', 'undo', 'default', 'cockpit'];

export interface ChangeRow {
  v: 1;
  at: number;
  who: ChangeWho;
  path: SettingPath;
  from: unknown;
  to: unknown;
}

/** At most this many rows are kept; the oldest go first. */
export const CHANGES_KEPT = 2000;

/** Every setting path a config holds: the catalog's own, and each pack and skill item. */
export function settingPaths(): SettingPath[] {
  const own = SETTING_IDS.filter((id) => !id.endsWith('.*')) as SettingPath[];
  return [...own, ...PACKS.map((p) => `packs.items.${p.id}` as SettingPath), ...Object.keys(EXTERNAL_SKILLS).map((id) => `skills.items.${id}` as SettingPath)];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What changed between two configs, setting by setting (settings outside the catalog, as lists, are not rows). */
export function settingChanges(before: Readonly<Config>, after: Readonly<Config>): { path: SettingPath; from: unknown; to: unknown }[] {
  const out: { path: SettingPath; from: unknown; to: unknown }[] = [];
  for (const path of settingPaths()) {
    const from = valueIn(before, path);
    const to = valueIn(after, path);
    if (!same(from, to)) out.push({ path, from, to });
  }
  return out;
}

/** The rows a change from `before` to `after` adds, by `who`, at `at`. */
export function changeRows(before: Readonly<Config>, after: Readonly<Config>, who: ChangeWho, at: number): ChangeRow[] {
  return settingChanges(before, after).map((c) => ({ v: 1, at, who, ...c }));
}

/** The rows of the record, oldest first; a torn line, or a row of a setting the catalog no longer has, is skipped. */
export function parseChanges(text: string | null): ChangeRow[] {
  const known = new Set<string>(settingPaths());
  const out: ChangeRow[] = [];
  for (const line of (text ?? '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as Partial<ChangeRow>;
      if (typeof o.at === 'number' && typeof o.path === 'string' && known.has(o.path) && CHANGE_WHO.includes(o.who as ChangeWho) && 'to' in o)
        out.push({ v: 1, at: o.at, who: o.who as ChangeWho, path: o.path as SettingPath, from: o.from, to: o.to });
    } catch {
      /* a torn line is skipped */
    }
  }
  return out;
}

/** The record with new rows after the old, cut to the newest CHANGES_KEPT, as file text. */
export function appendChanges(text: string | null, rows: readonly ChangeRow[]): string {
  const lines = [...(text ?? '').split('\n').filter((l) => l.trim()), ...rows.map((r) => JSON.stringify(r))];
  return lines.slice(-CHANGES_KEPT).join('\n') + '\n';
}

/**
 * What taking a row back does: its setting goes back to the value it had before, when it still holds what the row
 * set. A setting changed again since cannot be taken back from this row (null): the later change is the one to undo.
 */
export function undoOf(config: Readonly<Config>, row: ChangeRow): { path: SettingPath; to: unknown } | null {
  return same(valueIn(config, row.path), row.to) && !same(row.from, row.to) ? { path: row.path, to: row.from } : null;
}

/** The newest row that can still be taken back (u in the control center, `mode-code config undo`). */
export function lastUndoable(config: Readonly<Config>, rows: readonly ChangeRow[]): ChangeRow | null {
  for (let i = rows.length - 1; i >= 0; i--) if (undoOf(config, rows[i]!)) return rows[i]!;
  return null;
}

/** What going back to the defaults does, setting by setting: on one page, or everywhere. Shown before it is done. */
export function toDefaults(config: Readonly<Config>, page: string | null = null): { path: SettingPath; from: unknown; to: unknown }[] {
  return settingPaths()
    .filter(
      (p) =>
        page === null ||
        SETTINGS[(p.startsWith('packs.items.') ? 'packs.items.*' : p.startsWith('skills.items.') ? 'skills.items.*' : p) as keyof typeof SETTINGS].page ===
          page,
    )
    .map((path) => ({ path, from: valueIn(config, path), to: defaultOf(path) }))
    .filter((c) => !same(c.from, c.to));
}

/** One row as the history reads it: "19.10.2026 10:42 · Allow bypass: off → on · the control center". */
export function changeText(row: Pick<ChangeRow, 'path' | 'from' | 'to'> & { at?: number; who?: ChangeWho }, lang: Lang): string {
  const what = `${nameOf(row.path, lang)}: ${valueText(row.path, row.from, lang)} → ${valueText(row.path, row.to, lang)}`;
  const parts = [...(row.at !== undefined ? [dateTime(row.at, lang)] : []), what, ...(row.who ? [tIn(lang, `changes.who.${row.who}` as MessageKey)] : [])];
  return parts.join(' · ');
}
