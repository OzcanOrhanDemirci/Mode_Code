// SPDX-License-Identifier: Apache-2.0
/**
 * What code handed to an interpreter deletes (`node -e`, `python -c`), best effort: the string literals a delete
 * call is given, directly or through a name the code assigns. Everything else is left to the checks of the
 * literals themselves (src/core/belt/check.ts). Measured on other agents' everyday work: a path in a test of an
 * in-memory filesystem or an XPath beside `os.unlink(tmp)` was taken for a delete when any literal of the code was.
 */

const LITERAL = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.)*)`/g;

/** The string literals of the code, unescaped, in order. */
export function codeLiterals(code: string): string[] {
  return [...code.matchAll(LITERAL)].map((m) => (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1'));
}

/** Python deletes through its modules (`os.remove`, `shutil.rmtree`) or a path's own method (`p.unlink()`). */
const PYTHON_DELETE = /(?:\b(?:os|shutil|send2trash)\s*\.\s*)?(\.\s*)?\b(remove|unlink|rmdir|removedirs|rmtree|send2trash)\s*\(/g;
/** Other languages: Node's fs, rimraf, Ruby's FileUtils, Perl's and PHP's unlink, … */
const OTHER_DELETE = /\b(?:rmSync|rmdirSync|unlinkSync|rm|rmdir|unlink|rimraf|rmtree|remove|removedirs|rm_rf|rm_r|deleteSync|delete)\s*\(/g;

const KEYWORDS = new Set(
  (
    'if else elif for in of not and or is with as try except finally return del lambda None True False null undefined ' +
    'true false new await async const let var function this self typeof instanceof void yield from import def class ' +
    'while break continue pass raise global nonlocal assert do switch case default throw catch'
  ).split(' '),
);

/** Names Node gives every script that hold no path: the rest, `process.argv` too, are unknown unless assigned or imported. */
const GLOBALS = new Set(['console', 'JSON', 'Math']);

const TOKEN = `${LITERAL.source}|[()]`;

/** The text of a call's arguments, from just after its `(` to the matching `)`, strings passed over; to the end when unclosed. */
function argsFrom(code: string, from: number): string {
  let depth = 1;
  const tokens = new RegExp(TOKEN, 'g');
  tokens.lastIndex = from;
  for (const m of code.matchAll(tokens)) {
    if (m[0] === '(') depth++;
    else if (m[0] === ')' && --depth === 0) return code.slice(from, m.index);
  }
  return code.slice(from);
}

/** The statement a call stands in, up to the call: from the line's start or the last `;` before it. */
function statementBefore(code: string, at: number): string {
  return code.slice(0, at).split(/[\n;]/).pop()!;
}

/** The names a piece of code reads as values: not attributes, callees, keyword arguments, keywords or built-ins. */
function namesIn(text: string): string[] {
  // Strings and their prefixes (`f'…'`, `r"…"`) are no names.
  const bare = text.replace(/\b[rRbBfFuU]{1,2}(?=['"])/g, ' ').replace(LITERAL, ' ');
  const out: string[] = [];
  for (const m of bare.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const before = bare.slice(0, m.index).trimEnd();
    const after = bare.slice(m.index + m[0].length).trimStart();
    if (before.endsWith('.') || after.startsWith('(') || /^[:=](?!=)/.test(after)) continue;
    if (KEYWORDS.has(m[0]) || GLOBALS.has(m[0])) continue;
    out.push(m[0]);
  }
  return out;
}

/** A name as a pattern: every character a pattern reads specially escaped (a JavaScript name can hold `$`). */
const escape = (name: string) => name.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

/**
 * The texts that give a name its value in the code: an assignment's right side, what a `for` walks over, what
 * a `with … as` holds; an import gives it none. Null when the code never assigns it (a parameter): unknown.
 */
function bindings(code: string, name: string): string[] | null {
  const n = escape(name);
  const found: string[] = [];
  let bound = false;
  for (const m of code.matchAll(new RegExp(`(?:^|[^\\w$.])${n}\\s*(?::[^=\\n;]*)?=(?![=>])([^\\n;]*)`, 'gm'))) {
    bound = true;
    found.push(m[1]!);
  }
  for (const m of code.matchAll(new RegExp(`\\bfor\\s*\\(?\\s*(?:const|let|var)?\\s*(?:[\\w$]+\\s*,\\s*)*${n}\\s+(?:in|of)\\s+([^\\n]*)`, 'g'))) {
    bound = true;
    found.push(m[1]!);
  }
  for (const m of code.matchAll(new RegExp(`([^\\n;]*)\\bas\\s+${n}(?![\\w$])`, 'g'))) {
    bound = true;
    found.push(m[1]!);
  }
  if (new RegExp(`^\\s*(?:from\\s+\\S+\\s+)?import\\b[^\\n;]*\\b${n}(?![\\w$])`, 'm').test(code)) bound = true;
  return bound ? found : null;
}

/**
 * The literals the code's delete calls are given, directly or through the names they use (followed a few
 * assignments deep). A name the code never assigns leaves a delete's target unknown: then every literal of the
 * code counts, as before this was measured. Empty when the code deletes nothing.
 */
export function deletedLiterals(code: string, program: string): string[] {
  const python = /^(?:python|py|pypy)[0-9.]*$/.test(program);
  const literals = codeLiterals(code);
  const scopes: string[] = [];
  for (const m of code.matchAll(python ? PYTHON_DELETE : OTHER_DELETE)) {
    const args = argsFrom(code, m.index + m[0].length);
    // A module's function or a bare one (`os.remove(p)`, `rmtree(p)`): its arguments.
    if (!python || !m[1]) {
      scopes.push(args);
      continue;
    }
    // A method: a path's own (`Path('/x').unlink()`, `p.rmdir()`) takes no path; one that does is some other
    // object's (`fs.rm('/x')` of an in-memory filesystem, `list.remove(x)`).
    if ((m[2] === 'unlink' || m[2] === 'rmdir') && /^\s*(?:missing_ok\s*=[^,]*)?$/.test(args)) scopes.push(statementBefore(code, m.index));
  }
  if (!scopes.length) return [];
  const out = new Set<string>();
  const seen = new Set<string>();
  let pending = scopes;
  // Each name is read once, so this ends; a name still to read four assignments deep is as unknown as a parameter.
  for (let depth = 0; pending.length; depth++) {
    const next: string[] = [];
    for (const text of pending) {
      for (const l of codeLiterals(text)) out.add(l);
      for (const name of namesIn(text)) {
        if (seen.has(name)) continue;
        seen.add(name);
        const values = depth < 4 ? bindings(code, name) : null;
        if (values === null) return literals;
        next.push(...values);
      }
    }
    pending = next;
  }
  return [...out];
}
