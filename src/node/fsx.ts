// SPDX-License-Identifier: Apache-2.0
/** File helpers with the failure behaviour the tool needs: reads never throw, writes are atomic. */
import { appendFileSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

/** The file's text, or null when it does not exist or cannot be read. */
export function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function readJson<T = unknown>(path: string): T | null {
  const text = readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/**
 * Writes through a temporary file in the same folder and a rename, so a reader never sees half a file.
 * On Windows a rename over a file another process holds open can fail for a moment; it is retried.
 */
export function writeAtomic(path: string, text: string): void {
  ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt < 5 && (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')) {
        const until = Date.now() + 20 * (attempt + 1);
        while (Date.now() < until) {
          /* short spin: a hook must not await timers */
        }
        continue;
      }
      try {
        rmSync(tmp, { force: true });
      } catch {
        /* ignore */
      }
      throw err;
    }
  }
}

export function writeJsonAtomic(path: string, value: unknown): void {
  writeAtomic(path, JSON.stringify(value, null, 2) + '\n');
}

/** Appends one line. Appends of a few hundred bytes are atomic on local disks, so concurrent writers interleave whole lines. */
export function appendLine(path: string, line: string): void {
  ensureDir(dirname(path));
  appendFileSync(path, line.endsWith('\n') ? line : line + '\n', 'utf8');
}

export function fileSize(path: string): number | null {
  try {
    const s = statSync(path);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

/**
 * Where a path really is: links followed and, on Windows, 8.3 short names written out (the native call
 * asks the file system). Null when the path does not exist or cannot be read.
 */
export function realPathOf(path: string): string | null {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
}

export function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
