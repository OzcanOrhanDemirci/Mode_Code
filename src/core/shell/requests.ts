// SPDX-License-Identifier: Apache-2.0
/**
 * What a command line says about the request it sends: its method, and whether it carries a body. Each program is read by
 * its own spelling: curl, wget, PowerShell's web cmdlets (and `curl` and `wget` through its aliases), httpie and xh, and
 * `gh api`. One reader for the safety belt (src/core/taint.ts: what sends data off the computer) and for the restricted
 * modes (src/core/shell/effects.ts: what changes something outside); each keeps its own rule about what a read may be.
 * Pure.
 */
import { psNamed } from './analyze.js';
import type { Word } from './types.js';

/**
 * curl's one-letter options that take a value, from its manual: in a word of letters (`-sSd x`, `-sSX POST`) the first of
 * them takes the rest of the word, or the next word. `X` names the method; `d`, `F` and `T` carry a body.
 */
const CURL_VALUED = new Set([...'AbcCdDeEFHKmoPQrtTuUwxXyYzh']);
const CURL_BODY_SHORT = new Set(['d', 'F', 'T']);
/** The same for `gh api`: `-X` the method, `-f` and `-F` fields (a body); `-H`, `-q`, `-t`, `-p` take a value too. */
const GH_VALUED = new Set([...'HfFqtpX']);
const GH_BODY_SHORT = new Set(['f', 'F']);
/**
 * The options that carry a request body, apart from the one-letter ones (whole, or with `=value`): curl's `--data…`,
 * `--form…`, `--json` and `--upload-file`; wget's `--post-…` and `--body-…` (it has no one-letter body option: its `-d`,
 * `-F`, `-T` and `-t` are debug, force-html, timeout and tries); `gh api`'s `--field`, `--raw-field` and `--input`; and
 * the `--raw` of httpie and xh.
 */
const CURL_BODY = /^--(?:data(?:-\w+)?|form(?:-string)?|json|upload-file)(?:=|$)/;
const WGET_BODY = /^--(?:post-data|post-file|body-data|body-file)(?:=|$)/;
const GH_BODY = /^--(?:field|raw-field|input)(?:=|$)/;
const HTTPIE_BODY = /^--raw(?:=|$)/;
/** The parameters of PowerShell's web cmdlets that name the method or carry a body (powerShellNamed). */
const POWERSHELL_PARAMS: Record<string, string> = { method: 'method', custommethod: 'custommethod', body: 'body', infile: 'infile', form: 'form' };
/** httpie and xh: the method is a word of its own (`http POST url`), and `name=value`, `name:=json`, `name@file` are a body. */
const HTTPIE = new Set(['http', 'https', 'xh']);
const HTTPIE_ITEM = /^\w[\w.-]*(?::=|=(?!=)|@)/;
/** The options of httpie and xh that take the next word as their value: the method is the first word that is none of those. */
const HTTPIE_VALUED =
  /^(?:-[aAopPs]|--(?:auth|auth-type|bearer|output|print|history-print|pretty|style|session|session-read-only|proxy|max-redirects|max-headers|timeout|verify|cert|cert-key|cert-key-pass|ssl|ciphers|default-scheme|response-charset|response-mime|format-options|boundary|raw|http-version|resolve|interface|unix-socket))$/;

/**
 * A word of letters the way curl and `gh` read it (`-sSd x`, `-sSdx`, `-X M`, `-XM`): the letters before the first one that
 * takes a value are flags; that one is an option and takes the rest of the word, or the next word when nothing is left,
 * and ends the word (`-oX` writes to a file named X, `-uTom:pw` is a user); a value is no word of its own.
 */
interface ShortWord {
  flags: string[];
  option?: { letter: string; value: string; attached: boolean };
}
function shortWords(args: readonly string[], valued: ReadonlySet<string>): ShortWord[] {
  const out: ShortWord[] = [];
  let skip = false;
  args.forEach((a, i) => {
    if (skip) {
      skip = false;
      return;
    }
    if (!/^-[A-Za-z0-9]/.test(a)) return;
    const letters = a.slice(1).split('');
    const at = letters.findIndex((ch) => valued.has(ch));
    if (at === -1) {
      out.push({ flags: letters });
      return;
    }
    const after = a.slice(at + 2);
    out.push({ flags: letters.slice(0, at), option: { letter: letters[at]!, value: after === '' ? (args[i + 1] ?? '') : after, attached: after !== '' } });
    skip = after === '';
  });
  return out;
}

/** The one-letter options that take a value, with the value. */
function shortOptions(args: readonly string[], valued: ReadonlySet<string>): { letter: string; value: string; attached: boolean }[] {
  return shortWords(args, valued).flatMap((w) => (w.option ? [w.option] : []));
}

/** The flag letters of curl's words of letters (`-sSLO`): what it does besides its options, as `-O` saves into a file. */
export function curlFlags(args: readonly string[]): ReadonlySet<string> {
  return new Set(shortWords(args, CURL_VALUED).flatMap((w) => w.flags));
}

/** What follows a long option: `--request M`, `--request=M`. */
function longOptionValues(args: readonly string[], name: string): string[] {
  const out: string[] = [];
  args.forEach((a, i) => {
    if (a === name) out.push(args[i + 1] ?? '');
    else if (a.startsWith(`${name}=`)) out.push(a.slice(name.length + 1));
  });
  return out;
}

/**
 * The parameters of PowerShell's web cmdlets that name the method or carry a body, with their values (`undefined` when
 * dangling): `-Method M`, `-Method:M`, `-CustomMethod` (for a method the cmdlets' list leaves out, WebDAV's), `-Body`,
 * `-InFile`, `-Form`. Case does not matter. The cmdlets take a name shortened to what no other parameter starts with
 * (`-Meth`, `-Bo`); `curl` and `wget` through PowerShell's aliases take the whole name only (`-m` and `-t` are theirs).
 */
function powerShellNamed(program: string, args: readonly string[]): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  if (program.startsWith('invoke-')) {
    // psNamed reads the text of a word, no more.
    const words = args.map((text) => ({ text }) as Word);
    for (const [name, word] of Object.entries(psNamed(words, POWERSHELL_PARAMS, []))) out.set(name, word?.text);
  } else {
    args.forEach((a, i) => {
      const m = /^-(method|custommethod|body|infile|form)(?::(.*))?$/i.exec(a);
      if (m) out.set(m[1]!.toLowerCase(), m[2] ?? args[i + 1]);
    });
  }
  return out;
}

/** httpie and xh name the method as their first word that is no option and no option's value, if it is only letters (`http MKCOL url`). */
function httpieMethods(args: readonly string[]): string[] {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('-')) return /^[A-Za-z]+$/.test(a) ? [a] : [];
    if (HTTPIE_VALUED.test(a)) i++;
  }
  return [];
}

/** The methods a request names, in the spelling of the program that sends it. */
export function methodsNamed(program: string, args: readonly string[]): string[] {
  const letterX = (valued: ReadonlySet<string>) => shortOptions(args, valued).filter((o) => o.letter === 'X');
  if (HTTPIE.has(program)) return httpieMethods(args);
  // gh's shorthand takes `-X=M` as well: an = after the letter only separates.
  if (program === 'gh') return [...letterX(GH_VALUED).map((o) => (o.attached ? o.value.replace(/^=/, '') : o.value)), ...longOptionValues(args, '--method')];
  const named = [...powerShellNamed(program, args)].filter(([name]) => name === 'method' || name === 'custommethod').map(([, value]) => value ?? '');
  if (program === 'curl') named.push(...letterX(CURL_VALUED).map((o) => o.value), ...longOptionValues(args, '--request'));
  if (program === 'wget') named.push(...longOptionValues(args, '--method'));
  return named;
}

/**
 * Whether a request carries a body by an option or an item, in the spelling of the program that sends it: curl's `-d`,
 * `-F` and `-T` (also in a word of letters, `-sSd`) and its long ones, wget's `--post-…` and `--body-…`, PowerShell's
 * `-Body`, `-InFile` and `-Form`, `gh api`'s fields and input, httpie's and xh's items and `--raw`.
 */
export function bodyNamed(program: string, args: readonly string[]): boolean {
  if (HTTPIE.has(program)) return args.some((a) => HTTPIE_ITEM.test(a) || HTTPIE_BODY.test(a));
  if (program === 'gh') return args.some((a) => GH_BODY.test(a)) || shortOptions(args, GH_VALUED).some((o) => GH_BODY_SHORT.has(o.letter));
  const named = powerShellNamed(program, args);
  if (named.has('body') || named.has('infile') || named.has('form')) return true;
  if (program === 'curl') return args.some((a) => CURL_BODY.test(a)) || shortOptions(args, CURL_VALUED).some((o) => CURL_BODY_SHORT.has(o.letter));
  return program === 'wget' && args.some((a) => WGET_BODY.test(a));
}
