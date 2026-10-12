// SPDX-License-Identifier: Apache-2.0
/** Reading the end of a large text file (session transcripts reach tens of megabytes). */
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/**
 * The last `maxBytes` of a file as complete lines. The first, possibly cut, line is dropped unless the
 * read started at the beginning of the file. Returns [] when the file cannot be read.
 */
export function readTail(path: string, maxBytes: number): string[] {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    let read = 0;
    while (read < buf.length) {
      const n = readSync(fd, buf, read, buf.length - read, start + read);
      if (n <= 0) break;
      read += n;
    }
    const lines = buf.subarray(0, read).toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines.filter((l) => l.length > 0);
  } catch {
    return [];
  } finally {
    if (fd !== null)
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
  }
}
