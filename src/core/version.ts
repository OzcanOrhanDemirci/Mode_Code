// SPDX-License-Identifier: Apache-2.0
/** Comparing dotted version numbers ("2.1.296"); pre-release suffixes sort before the release. */

export function parseVersion(v: string): { parts: number[]; pre: string | null } | null {
  const m = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?/.exec(v.trim());
  if (!m) return null;
  return { parts: m[1]!.split('.').map((x) => parseInt(x, 10)), pre: m[2] ?? null };
}

/** -1, 0 or 1. An unparsable version sorts first, so a check against a minimum fails safe. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 0; i < Math.max(pa.parts.length, pb.parts.length); i++) {
    const x = pa.parts[i] ?? 0;
    const y = pb.parts[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}
