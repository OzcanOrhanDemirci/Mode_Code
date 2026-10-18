// SPDX-License-Identifier: Apache-2.0
/**
 * Updates (docs/cli.md, `mode-code update`): which release is the newest, whether it is newer than this one, and
 * where its files are. The newest is read from the release's SHA256SUMS, whose versioned package name carries it
 * (mode-code-1.2.0.tgz): one small download from the release itself, the same for GitHub, a mirror or a folder, and
 * no API with its rate limit. A check runs at most once a day, and only when the person said yes (`update.check`).
 * Pure: the fetching is node/update.ts.
 */
import { APP_ID, REPO_URL } from './app.js';
import { compareVersions, parseVersion } from './version.js';

/** What the last check found (state/update.json): when it ran, the newest version then, or why it could not tell. */
export interface UpdateState {
  checkedAt: number;
  latest: string | null;
  error: string | null;
}

export const CHECK_EVERY_MS = 86_400_000;

export function parseUpdateState(text: string | null): UpdateState | null {
  try {
    const o = JSON.parse(text ?? '') as Record<string, unknown>;
    if (typeof o.checkedAt !== 'number' || !Number.isFinite(o.checkedAt)) return null;
    return {
      checkedAt: o.checkedAt,
      latest: typeof o.latest === 'string' && parseVersion(o.latest) ? o.latest.slice(0, 40) : null,
      error: typeof o.error === 'string' ? o.error.slice(0, 300) : null,
    };
  } catch {
    return null;
  }
}

/** Whether a check is due: none yet, the last one a day old, or one dated in the future (a clock set back). */
export function checkDue(state: UpdateState | null, now: number, everyMs = CHECK_EVERY_MS): boolean {
  return !state || now - state.checkedAt >= everyMs || state.checkedAt > now;
}

/** The SHA-256 a SHA256SUMS text lists for a file (`<hash>  <name>`, or `*<name>`), or null. */
export function sumOf(sums: string, file: string): string | null {
  for (const line of sums.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length === 2 && (parts[1] === file || parts[1] === `*${file}`) && /^[0-9a-f]{64}$/i.test(parts[0]!)) return parts[0]!.toLowerCase();
  }
  return null;
}

/** The newest version a SHA256SUMS names in its versioned package (`mode-code-1.2.0.tgz`), or null. */
export function versionInSums(sums: string): string | null {
  let best: string | null = null;
  for (const line of sums.split('\n')) {
    const name = line.trim().split(/\s+/)[1]?.replace(/^\*/, '') ?? '';
    if (!name.startsWith(`${APP_ID}-`) || !name.endsWith('.tgz')) continue;
    const v = name.slice(APP_ID.length + 1, -'.tgz'.length);
    if (parseVersion(v) && (best === null || compareVersions(v, best) > 0)) best = v;
  }
  return best;
}

/** The newer version, or null when `current` is the newest (or newer, a build ahead of its release). */
export function newerThan(current: string, latest: string | null): string | null {
  if (!latest || !parseVersion(latest) || !parseVersion(current)) return null;
  return compareVersions(latest, current) > 0 ? latest : null;
}

/** Where a release's files are: `override` (a mirror, a fork, a folder) when given, else GitHub's newest or one version. */
export function releaseBase(version: string | null, override?: string | null): string {
  if (override) {
    let end = override.length;
    while (end > 0 && (override[end - 1] === '/' || override[end - 1] === '\\')) end--;
    return override.slice(0, end);
  }
  return version ? `${REPO_URL}/releases/download/v${version}` : `${REPO_URL}/releases/latest/download`;
}

/** The release's page, for its notes. */
export function releasePage(version: string): string {
  return `${REPO_URL}/releases/tag/v${version}`;
}
