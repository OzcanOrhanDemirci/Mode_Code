// SPDX-License-Identifier: Apache-2.0
/**
 * Where what a call acts on came from (the 1.2.0 core's evidence, docs/safety-belt.md "Evidence"). A few risky
 * calls are let through in Autonomous, some in full autonomy too, when what they act on (a host, a repository, a
 * recipient, a path, an object's name, a command) is the person's own: written by them in this session, not pasted,
 * or in what the session found at its start (the project's remotes). Found only in what the session read from
 * outside (a page, an issue, a service's data), it is stopped in every way of working: a call is never steered by
 * what someone else wrote. Pure: the plugin keeps the session's record (`state/sessions/<id>.prov.json`), and the
 * plugin and the hook decide from it alike.
 */

import { analyzeCommand } from './shell/analyze.js';
import { shellOf } from './belt/tools.js';
import { resolvePath, type PathEnv } from './paths.js';
import { maskSecrets } from './secrets/scan.js';

/** What a call acts on, by kind; every value must be the person's for the call to stand on evidence. */
export interface Unit {
  kind: 'host' | 'repo' | 'recipient' | 'path' | 'object' | 'text';
  values: string[];
  /** The tool's own, never written in the call (gh's GitHub): evidence when the person named it, never taken from outside. */
  implicit?: true;
}

/**
 * A clear request (full autonomy's "net istek"): the person's sentence, quoted word for word by Claude with the
 * target it names, and found by code in what the person typed. It holds until the person's next prompt.
 */
export interface Grant {
  target: string;
  quote: string;
  at: number;
}

/** A session's record of where things came from. */
export interface Provenance {
  v: 1;
  /** The clear requests Claude quoted since the person's last prompt, each checked against their words. */
  granted: Grant[];
  /** What the person wrote, prompt by prompt, pastes left out; the newest last. */
  said: string[];
  /** What the session found at its start: the project's remotes (hosts and owner/repo). */
  start: string[];
  /** What the session read from outside: the units found in it, and a key per line, for text. */
  seen: string[];
  seenLines: string[];
  /** The files and folders this session made (a Write of a new file, a mkdir): its own to remove. */
  made: string[];
}

/** Where a unit came from: the person, the start record, what was read from outside, or nowhere known. */
export type Origin = 'person' | 'record' | 'content' | 'none';

export const PROV_SAID_MAX = 40;
export const PROV_SAID_CHARS = 8000;
export const PROV_SEEN_MAX = 4000;

export function emptyProvenance(): Provenance {
  return { v: 1, granted: [], said: [], start: [], seen: [], seenLines: [], made: [] };
}

/** Whitespace as one space: a quote is the person's words, however Claude broke its lines. */
const words = (s: string) => s.replace(/\s+/g, ' ').trim();

/** At most this many clear requests a turn: one per step the person asked for. */
export const GRANTS_MAX = 20;

/**
 * Whether Claude's quote is a clear request of the person's: long enough to be a sentence, found word for word
 * (case kept, spacing aside) in what they typed in this session, and naming the target as a whole.
 */
export function requestCheck(quote: string, target: string, p: Provenance): 'ok' | 'short' | 'not-said' | 'not-in-quote' {
  const q = words(quote);
  if (q.length < 8) return 'short';
  if (!p.said.some((s) => words(s).includes(q))) return 'not-said';
  return target.trim() && namedIn(q, target) ? 'ok' : 'not-in-quote';
}

/** The record with a clear request the code checked, the newest kept. */
export function withGrant(p: Provenance, g: Grant): Provenance {
  return { ...p, granted: [...p.granted, { target: g.target.trim(), quote: words(g.quote), at: g.at }].slice(-GRANTS_MAX) };
}

/** Whether every value of a unit is named in a clear request the person made. */
export function grantedUnit(u: Unit, p: Provenance): boolean {
  return u.values.length > 0 && u.values.every((v) => p.granted.some((g) => namedIn(g.quote, v)));
}

const norm = (s: string) => s.trim().replace(/\\/g, '/').toLowerCase();

/** A line's key: FNV-1a over its words, so a line read from outside is known again however it is spaced. */
export function lineKey(line: string): string {
  const s = line.trim().replace(/\s+/g, ' ').toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The lines of a text worth a key: long enough to be a command or a sentence, not a word. */
export function lineKeys(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 12)
    .map(lineKey);
}

const HOST = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi;
/** A file's name looks like a host (`README.md`): these endings are files, not places on the network. */
const FILE_END =
  /\.(?:md|js|mjs|cjs|ts|tsx|jsx|json|txt|py|sh|ps1|bat|cmd|yml|yaml|toml|lock|log|csv|html?|css|png|jpe?g|gif|svg|pdf|zip|gz|tgz|exe|dll|so|dylib|rs|go|java|kt|swift|dart|rb|php|c|h|cpp|hpp|cs|xml|ini|cfg|conf|env|sql|db|bak|tmp|map|wasm|git)$/i;
/**
 * The endings a bare name must have to be taken for a host (`example.com`, not `tool.check` or `prov.seen`): any two
 * letters (the countries'), the common generic ones, and those kept for examples, tests and local networks. Measured on
 * the author's sessions: a rule's or a field's name in a note was taken for a host read from outside. A URL's host
 * needs none.
 */
const TLDS = new Set(
  (
    'com net org edu gov mil int info biz name pro mobi asia app dev io cloud tech site online store shop blog page link ' +
    'live xyz top club icu buzz fun work space website world today life news media digital email network systems services ' +
    'agency studio design zip mov click download stream social chat team company finance money bank wiki one ' +
    'example test invalid localhost local internal lan home arpa onion'
  ).split(' '),
);
const URL_HOST = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s]*@)?([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)/gi;
/**
 * An address is a host too, and the likeliest one for a request somebody else steered: four numbers up to 255 that stand
 * alone (not inside a longer run of numbers, so a version such as `10.0.26200.1` is none), and an IPv6 address in the
 * brackets of a URL, the only place it is told from other text with colons.
 */
const IPV4 = /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\w]|\.\w)/g;
const URL_IPV6 = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s]*@)?\[([0-9a-f:.]+)\]/gi;
const EMAIL = /\b[\w.+-]{1,64}@(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}\b/gi;
const REPO = /\b(?:github\.com|gitlab\.com|bitbucket\.org)[/:]([\w.-]{1,100}\/[\w.-]{1,100}?)(?:\.git)?(?=[\s/#?"')\]]|$)/gi;
const PATH = /(?:(?<![\w/])[A-Za-z]:[\\/]|(?<![\w/])~\/|(?<![\w/.:])\/(?:home|Users|tmp|var|etc|opt|srv|mnt)\/)[^\s"'`<>|]{1,240}/g;

/** The units a text names: hosts, e-mail addresses, owner/repo of a code host, absolute paths. */
export function unitsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(EMAIL)) out.add(norm(m[0]));
  for (const m of text.matchAll(HOST)) {
    const tld = m[0].slice(m[0].lastIndexOf('.') + 1).toLowerCase();
    if (!/^\d/.test(m[0]) && !FILE_END.test(m[0]) && (tld.length === 2 || TLDS.has(tld))) out.add(norm(m[0]));
  }
  for (const m of text.matchAll(URL_HOST)) out.add(norm(m[1]!));
  for (const m of text.matchAll(IPV4)) out.add(m[0]);
  for (const m of text.matchAll(URL_IPV6)) out.add(norm(m[1]!));
  for (const m of text.matchAll(REPO)) out.add(norm(m[1]!));
  for (const m of text.matchAll(PATH)) out.add(norm(m[0]).replace(/[.,;:)\]]+$/, ''));
  return [...out];
}

/** Whether `value` stands in `text` as a whole: not inside a longer word, path or address. */
export function namedIn(text: string, value: string): boolean {
  const v = norm(value);
  if (!v) return false;
  const t = norm(text);
  for (let i = t.indexOf(v); i !== -1; i = t.indexOf(v, i + 1)) {
    const before = i === 0 ? '' : t[i - 1]!;
    const after = t[i + v.length] ?? '';
    if (!/[\w.@-]/.test(before) && !/[\w@-]/.test(after) && !(after === '.' && /\w/.test(t[i + v.length + 1] ?? ''))) return true;
  }
  return false;
}

/** Where one value came from. A value the person named stands, whatever else also named it. */
export function originOf(value: string, kind: Unit['kind'], p: Provenance): Origin {
  if (p.said.some((s) => namedIn(s, value))) return 'person';
  if (kind !== 'text' && p.start.some((s) => namedIn(s, value))) return 'record';
  if (kind === 'text') return value.split(/\r?\n/).some((l) => l.trim().length >= 12 && p.seenLines.includes(lineKey(l))) ? 'content' : 'none';
  // An object's name or id read in a listing (a release, a label) is how a session finds what it was asked about: not
  // a reason to stop, only no evidence. Where a call goes or what it runs is (a host, an address, a path, a command).
  if (kind === 'object') return 'none';
  const v = norm(value);
  return p.seen.some((s) => s === v || namedIn(s, v)) ? 'content' : 'none';
}

/**
 * Where a unit came from, taken whole: every value the person's (or the start record's), or one read from outside
 * and not theirs, which steers the call from someone else's text; otherwise unknown.
 */
export function unitOrigin(u: Unit, p: Provenance): Origin {
  if (!u.values.length) return 'none';
  const origins = u.values.map((v) => originOf(v, u.kind, p));
  if (origins.includes('content') && !u.implicit) return 'content';
  if (origins.every((o) => o === 'person' || o === 'record')) return origins.includes('person') ? 'person' : 'record';
  return 'none';
}

/** Whether a text carries what was read from outside: one of its lines, or a unit it names that the person did not. */
export function carriesOutside(text: string, p: Provenance): boolean {
  if (lineKeys(text).some((k) => p.seenLines.includes(k))) return true;
  return unitsIn(text).some((u) => originOf(u, 'host', p) === 'content');
}

/** What the person typed: the prompt without what they pasted into it, each paste where it stands. */
export function typedText(prompt: string, pastes: readonly string[]): string {
  let out = prompt;
  for (const p of pastes.slice().sort((a, b) => b.length - a.length)) if (p) out = out.split(p).join('\n');
  return out;
}

/** The record with a prompt the person wrote: the newest kept, each cut to its limit. */
export function withSaid(p: Provenance, text: string): Provenance {
  // Kept on disk like everything else Mode_Code stores: a key typed into a prompt is masked first.
  const t = maskSecrets(text).trim();
  // A new prompt of the person's: the clear requests quoted for the last one are done with.
  if (!t) return p.granted.length ? { ...p, granted: [] } : p;
  return { ...p, granted: [], said: [...p.said, t.slice(0, PROV_SAID_CHARS)].slice(-PROV_SAID_MAX) };
}

/** The record with what was read from outside: its units and its lines' keys, the newest kept. */
export function withSeen(p: Provenance, text: string): Provenance {
  const units = unitsIn(text);
  const keys = lineKeys(text);
  if (!units.length && !keys.length) return p;
  const seen = [...new Set([...p.seen, ...units])].slice(-PROV_SEEN_MAX);
  const seenLines = [...new Set([...p.seenLines, ...keys])].slice(-PROV_SEEN_MAX);
  return { ...p, seen, seenLines };
}

/** At most this many paths the session made are kept: the newest. */
export const PROV_MADE_MAX = 2000;

/** The record with paths the session made. */
export function withMade(p: Provenance, paths: readonly string[]): Provenance {
  const add = [...new Set(paths.map((x) => norm(x).replace(/\/+$/, '')))].filter((x) => x && !p.made.includes(x));
  return add.length ? { ...p, made: [...p.made, ...add].slice(-PROV_MADE_MAX) } : p;
}

/**
 * The files and folders a call that ran made: a Write of a file that was not there (`newFile`), the folders a
 * `mkdir` (`md`, `New-Item -ItemType Directory`) names. Resolved against where the call ran.
 */
export function madePaths(tool: string, input: Readonly<Record<string, unknown>>, env: PathEnv, newFile: boolean): string[] {
  if (tool === 'Write') return newFile && typeof input.file_path === 'string' ? [resolvePath(input.file_path, env)] : [];
  const dialect = shellOf(tool);
  if (!dialect) return [];
  const out: string[] = [];
  for (const inv of analyzeCommand(String(input.command ?? ''), dialect).invocations) {
    const dirItem = inv.program === 'new-item' && inv.args.some((a, i) => /^-itemtype$/i.test(inv.args[i - 1] ?? '') && /^directory$/i.test(a));
    if (inv.program !== 'mkdir' && inv.program !== 'md' && !dirItem) continue;
    inv.args.forEach((a, i) => {
      if (a.startsWith('-') || inv.dynamic[i]) return;
      if (dirItem && !/^-(?:path|name)$/i.test(inv.args[i - 1] ?? '')) return;
      out.push(resolvePath(a, env));
    });
  }
  return out;
}

/** Whether a path is one the session made, or inside one. */
export function madeHere(path: string, p: Provenance): boolean {
  const v = norm(path).replace(/\/+$/, '');
  return p.made.some((m) => v === m || v.startsWith(`${m}/`));
}

/** The record with the session's start: the project's remotes as `git remote -v` lists them. */
export function withStart(p: Provenance, remotes: string): Provenance {
  return { ...p, start: [...new Set([...p.start, ...unitsIn(remotes)])] };
}

/** A record read back; an empty one for anything else. */
export function parseProvenance(text: string | null): Provenance {
  if (!text) return emptyProvenance();
  try {
    const o = JSON.parse(text) as Partial<Provenance>;
    if (!o || o.v !== 1) return emptyProvenance();
    const strings = (x: unknown, max: number) => (Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string').slice(-max) : []);
    const granted = Array.isArray(o.granted)
      ? o.granted
          .filter((g): g is Grant => !!g && typeof g === 'object' && typeof g.target === 'string' && typeof g.quote === 'string' && typeof g.at === 'number')
          .slice(-GRANTS_MAX)
      : [];
    return {
      v: 1,
      granted,
      said: strings(o.said, PROV_SAID_MAX),
      start: strings(o.start, PROV_SEEN_MAX),
      seen: strings(o.seen, PROV_SEEN_MAX),
      seenLines: strings(o.seenLines, PROV_SEEN_MAX),
      made: strings(o.made, PROV_MADE_MAX),
    };
  } catch {
    return emptyProvenance();
  }
}
