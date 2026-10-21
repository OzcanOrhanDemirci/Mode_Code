// SPDX-License-Identifier: Apache-2.0
/** A small argument reader: positionals, --flag, --key value, --key=value, repeated keys collect into lists. */

export interface Args {
  positionals: string[];
  flags: Record<string, string | boolean | string[]>;
  /** The words as given, for a command that takes another command's words whole (`belt test rm -rf x`). */
  raw?: readonly string[];
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
  'no-mouse',
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
  'auto',
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
  return { positionals, flags, raw: [...argv] };
}

/** `belt test`'s own options: they take a value (`--level full`, `--level=full`); `--json` alone. */
const TEST_OPTIONS = new Set(['--tool', '--path', '--level', '--content', '--command']);

/**
 * The command `belt test <words>` names, as typed: every word after `test` but belt test's own options, the command's
 * options kept (`rm -rf /` is not `rm /`). A single word is the whole command (`belt test "git clean -f"`); words with
 * spaces or shell characters are quoted back as the shell received them. After `--`, every word is the command's.
 */
export function testedCommand(raw: readonly string[]): string {
  const belt = raw.indexOf('belt');
  const at = belt === -1 ? -1 : raw.indexOf('test', belt + 1);
  if (at === -1) return '';
  const words: string[] = [];
  for (let i = at + 1; i < raw.length; i++) {
    const w = raw[i]!;
    if (w === '--') {
      words.push(...raw.slice(i + 1));
      break;
    }
    if (w === '--json') continue;
    if (TEST_OPTIONS.has(w.split('=')[0]!)) {
      if (!w.includes('=')) i++;
      continue;
    }
    words.push(w);
  }
  if (words.length === 1) return words[0]!;
  return words.map((w) => (/^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replace(/'/g, "'\\''")}'`)).join(' ');
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
