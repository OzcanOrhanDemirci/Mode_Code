// SPDX-License-Identifier: Apache-2.0
/**
 * What changed, for someone who updated: the note a release carries for those coming from a version before it, said
 * once where they meet the change first (at the end of the update, and as their next Claude Code session starts). A
 * new installation has nothing to compare with and hears nothing.
 */
import type { MessageKey } from './i18n/index.js';
import { compareVersions, parseVersion } from './version.js';

export interface News {
  /** The release that brought the change. */
  since: string;
  /** The note in full, where there is room (the end of an update). */
  key: MessageKey;
  /** In a line, for a toast. */
  short: MessageKey;
}

/** The releases with a note, oldest first. */
export const NEWS: readonly News[] = [{ since: '1.2.0', key: 'news.1_2', short: 'news.1_2.short' }];

/**
 * The notes for an update from `from` to `to`: each release after `from`, up to `to`, that carries one. None when either
 * is not a version (a build from source is `dev`), or nothing was updated.
 */
export function newsFor(from: string | null | undefined, to: string, notes: readonly News[] = NEWS): News[] {
  if (!from || !parseVersion(from) || !parseVersion(to)) return [];
  return notes.filter((n) => compareVersions(from, n.since) < 0 && compareVersions(to, n.since) >= 0);
}

/**
 * What to say as a session starts: the notes since the version the installation record says was replaced (`updatedFrom`)
 * that were not said yet (`said`: the release of the newest note said before), and the release to keep as said.
 */
export function newsToSay(updatedFrom: unknown, said: unknown, version: string, notes: readonly News[] = NEWS): News[] {
  const news = newsFor(typeof updatedFrom === 'string' ? updatedFrom : null, version, notes);
  return typeof said === 'string' ? news.filter((n) => compareVersions(n.since, said) > 0) : news;
}

/**
 * The version an installation replaced, for its record: the earlier record's version when it was another, or what that
 * record said it had replaced (a reinstall of the same version keeps it until the note is said).
 */
export function replacedVersion(old: { version?: unknown; updatedFrom?: unknown } | null, version: string): string | undefined {
  if (!old || typeof old.version !== 'string') return undefined;
  if (old.version !== version) return old.version;
  return typeof old.updatedFrom === 'string' ? old.updatedFrom : undefined;
}
