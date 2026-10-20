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

/** What a call acts on, by kind; every value must be the person's for the call to stand on evidence. */
export interface Unit {
  kind: 'host' | 'repo' | 'recipient' | 'path' | 'object' | 'text';
  values: string[];
}

/** A session's record of where things came from. */
export interface Provenance {
  v: 1;
  /** What the person wrote, prompt by prompt, pastes left out; the newest last. */
  said: string[];
  /** What the session found at its start: the project's remotes (hosts and owner/repo). */
  start: string[];
  /** What the session read from outside: the units found in it, and a key per line, for text. */
  seen: string[];
  seenLines: string[];
}

/** Where a unit came from: the person, the start record, what was read from outside, or nowhere known. */
export type Origin = 'person' | 'record' | 'content' | 'none';

export const PROV_SAID_MAX = 40;
export const PROV_SAID_CHARS = 8000;
export const PROV_SEEN_MAX = 4000;

export function emptyProvenance(): Provenance {
  return { v: 1, said: [], start: [], seen: [], seenLines: [] };
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
const EMAIL = /\b[\w.+-]{1,64}@(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}\b/gi;
const REPO = /\b(?:github\.com|gitlab\.com|bitbucket\.org)[/:]([\w.-]{1,100}\/[\w.-]{1,100}?)(?:\.git)?(?=[\s/#?"')\]]|$)/gi;
const PATH = /(?:(?<![\w/])[A-Za-z]:[\\/]|(?<![\w/])~\/|(?<![\w/.:])\/(?:home|Users|tmp|var|etc|opt|srv|mnt)\/)[^\s"'`<>|]{1,240}/g;

/** The units a text names: hosts, e-mail addresses, owner/repo of a code host, absolute paths. */
export function unitsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(EMAIL)) out.add(norm(m[0]));
  for (const m of text.matchAll(HOST)) if (!/^\d/.test(m[0]) && !FILE_END.test(m[0])) out.add(norm(m[0]));
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
  if (origins.includes('content')) return 'content';
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
  const t = text.trim();
  if (!t) return p;
  return { ...p, said: [...p.said, t.slice(0, PROV_SAID_CHARS)].slice(-PROV_SAID_MAX) };
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
    return {
      v: 1,
      said: strings(o.said, PROV_SAID_MAX),
      start: strings(o.start, PROV_SEEN_MAX),
      seen: strings(o.seen, PROV_SEEN_MAX),
      seenLines: strings(o.seenLines, PROV_SEEN_MAX),
    };
  } catch {
    return emptyProvenance();
  }
}
