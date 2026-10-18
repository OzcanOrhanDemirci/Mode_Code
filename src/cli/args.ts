// SPDX-License-Identifier: Apache-2.0
/** A small argument reader: positionals, --flag, --key value, --key=value, repeated keys collect into lists. */

export interface Args {
  positionals: string[];
  flags: Record<string, string | boolean | string[]>;
}

/** Flags that never take a value, so `--json foo` keeps foo as a positional. */
const BOOLEAN = new Set([
  'json',
  'yes',
  'y',
  'dry-run',
  'purge',
  'keep-program',
  'help',
  'h',
  'version',
  'v',
  'no-color',
  'plain',
  'update',
  'no-update',
  'all',
  'print',
  'week',
  'fix',
  'self-check',
  'report',
  'quick',
  'check',
]);

export function parseArgs(argv: readonly string[]): Args {
  const positionals: string[] = [];
  const flags: Args['flags'] = {};
  const put = (k: string, v: string | boolean) => {
    const cur = flags[k];
    if (cur === undefined || typeof v === 'boolean') flags[k] = v;
    else flags[k] = Array.isArray(cur) ? [...cur, String(v)] : [String(cur), String(v)];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) put(a.slice(2, eq), a.slice(eq + 1));
      else {
        const k = a.slice(2);
        const next = argv[i + 1];
        if (!BOOLEAN.has(k) && next !== undefined && !next.startsWith('-')) {
          put(k, next);
          i++;
        } else put(k, true);
      }
    } else if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      for (const ch of a.slice(1)) put(ch, true);
    } else positionals.push(a);
  }
  return { positionals, flags };
}

export function flag(a: Args, ...names: string[]): boolean {
  return names.some((n) => a.flags[n] === true || a.flags[n] === 'true');
}

export function value(a: Args, name: string): string | undefined {
  const v = a.flags[name];
  if (Array.isArray(v)) return v[v.length - 1];
  return typeof v === 'string' ? v : undefined;
}

export function values(a: Args, name: string): string[] {
  const v = a.flags[name];
  if (Array.isArray(v)) return v;
  return typeof v === 'string' ? [v] : [];
}

export function intValue(a: Args, name: string, fallback: number, min = 1, max = 100000): number {
  const v = value(a, name);
  if (v === undefined) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
