// SPDX-License-Identifier: Apache-2.0
/** Quota history: readings recorded by the plugin, turned into evenly spaced points for a chart. Pure. */

export interface ReadingPoint {
  at: number;
  five: number | null;
  week: number | null;
  /** When each window was due to reset at the time of the reading (epoch ms), if known. */
  fiveResetsAt?: number | null;
  weekResetsAt?: number | null;
}

/**
 * One value per bucket (the highest reading in it), oldest first. A bucket with no reading repeats the last
 * known value, so a quiet night draws flat instead of dropping to zero, until that window's reset time has
 * passed: then it is 0. Before the first reading the buckets are null.
 */
export function bucketize(points: readonly ReadingPoint[], key: 'five' | 'week', from: number, to: number, buckets: number): (number | null)[] {
  const size = (to - from) / buckets;
  const resetKey = key === 'five' ? 'fiveResetsAt' : 'weekResetsAt';
  const out: (number | null)[] = new Array(buckets).fill(null);
  const lastIn: (ReadingPoint | null)[] = new Array(buckets).fill(null);
  const valid = points.filter((p) => p[key] !== null && p[key] !== undefined).sort((a, b) => a.at - b.at);
  for (const p of valid) {
    if (p.at < from || p.at > to) continue;
    const i = Math.min(buckets - 1, Math.floor((p.at - from) / size));
    const v = p[key]!;
    out[i] = out[i] === null ? v : Math.max(out[i]!, v);
    lastIn[i] = p;
  }
  let last: ReadingPoint | null = valid.filter((p) => p.at < from).pop() ?? null;
  for (let i = 0; i < buckets; i++) {
    if (out[i] !== null) {
      last = lastIn[i] ?? last;
      continue;
    }
    if (!last) continue;
    const reset = last[resetKey];
    out[i] = typeof reset === 'number' && from + i * size >= reset ? 0 : last[key]!;
  }
  return out;
}
