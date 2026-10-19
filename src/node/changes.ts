// SPDX-License-Identifier: Apache-2.0
/**
 * Writing the settings file with its record (src/core/ux/changes.ts): every writer of config.json goes through
 * `saveConfig`, so each change to a setting leaves a row of who, when, from and to. The record never stops a save:
 * a row that cannot be written is lost, the setting is not.
 */
import { serializeConfig, type Config } from '../core/config.js';
import type { Layout } from '../core/layout.js';
import { appendChanges, changeRows, parseChanges, type ChangeRow, type ChangeWho } from '../core/ux/changes.js';
import { readText, writeAtomic } from './fsx.js';

/** Writes `after` as the settings file and records what changed from `before`. */
export function saveConfig(l: Layout, before: Readonly<Config>, after: Readonly<Config>, who: ChangeWho, now = Date.now()): void {
  writeAtomic(l.config, serializeConfig(after as Config));
  const rows = changeRows(before, after, who, now);
  if (!rows.length) return;
  try {
    writeAtomic(l.changes, appendChanges(readText(l.changes), rows));
  } catch {
    /* the setting is saved; only its row is lost */
  }
}

/** The record, oldest first. */
export function readChanges(l: Layout): ChangeRow[] {
  return parseChanges(readText(l.changes));
}
