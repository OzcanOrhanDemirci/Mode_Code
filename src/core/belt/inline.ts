// SPDX-License-Identifier: Apache-2.0
/**
 * What code handed to an interpreter (`node -e`, `python -c`, a here-document on its standard input) does, best
 * effort: the string literals a delete call is given, directly or through a name the code assigns, and the calls
 * that write or run commands. Everything else is left to the checks of the literals themselves
 * (src/core/belt/check.ts). Measured on other agents' everyday work: a path in a test of an in-memory filesystem or
 * an XPath beside `os.unlink(tmp)` was taken for a delete when any literal of the code was. Measured on the
 * author's own sessions, where a script of some length is as common as a one-liner: a call written inside a string
 * (a script that edits another script), a comment, a regular expression or a function of the script's own was taken
 * for a call of the system's; so the code is read as code, not as the text it is made of.
 */

// ── what is code and what is text ─────────────────────────────────────────────────────────────────────

/** How an interpreter's code spells its comments and strings. */
interface Syntax {
  /**
   * Where `#` starts a comment: anywhere outside a string (Python); at the start of a line only (Ruby, Perl, PHP, where
   * `$#a`, `s#a#b#`, `/ #/` and `%w[ # ]` are code, and a trailing comment is not told from them); never.
   */
  hash: 'anywhere' | 'line start' | 'never';
  /** `//` and a slash-star block start comments. */
  slash: boolean;
  /** A `/` after an operator starts a regular expression (JavaScript). */
  regex: boolean;
  /** `'''…'''` and `"""…"""` are strings. */
  triple: boolean;
  /** A quoted string ends at its line's end (Python, JavaScript); in the others it may run on. */
  oneLine: boolean;
  /**
   * Whether the lexer reads this language's strings surely (checked against a real parser for JavaScript): then what
   * they hold is blanked where calls are looked for. Where it does not, a quote it pairs wrongly (a quoting operator it
   * does not know) could hide code from the search, so only the comments, which end with their line, are blanked there.
   */
  sure: boolean;
}

const PYTHON: Syntax = { hash: 'anywhere', slash: false, regex: false, triple: true, oneLine: true, sure: true };
const SCRIPT: Syntax = { hash: 'never', slash: true, regex: true, triple: false, oneLine: true, sure: true };
const PHP: Syntax = { hash: 'line start', slash: true, regex: false, triple: false, oneLine: false, sure: false };
const HASHED: Syntax = { hash: 'line start', slash: false, regex: false, triple: false, oneLine: false, sure: false };
const PLAIN: Syntax = { hash: 'never', slash: false, regex: false, triple: false, oneLine: false, sure: false };

function syntaxOf(program: string): Syntax {
  const name = program.replace(/[0-9.]+t?$/, '');
  if (name === 'python' || name === 'py' || name === 'pypy') return PYTHON;
  if (name === 'node' || name === 'nodejs' || name === 'bun' || name === 'deno') return SCRIPT;
  if (name === 'php') return PHP;
  return name === 'ruby' || name === 'perl' ? HASHED : PLAIN;
}

const COMMENT_HASH = String.raw`#[^\n]*`;
const COMMENT_HASH_LINE = String.raw`(?<=^|\n)[ \t]*#[^\n]*`;
const COMMENT_SLASH = String.raw`//[^\n]*|/\*[\s\S]*?(?:\*/|$)`;
const TRIPLE = String.raw`"""(?:[^\\]|\\[\s\S])*?(?:"""|$)|'''(?:[^\\]|\\[\s\S])*?(?:'''|$)`;
const QUOTED = String.raw`'(?:[^'\\]|\\[\s\S])*'|"(?:[^"\\]|\\[\s\S])*"`;
const QUOTED_LINE = String.raw`'(?:[^'\\\n]|\\[\s\S])*'|"(?:[^"\\\n]|\\[\s\S])*"`;
const TEMPLATE = '`(?:[^`\\\\]|\\\\[\\s\\S])*`';
/**
 * A regular expression literal: after `(`, `,`, `=`, `=>`, an operator, a keyword a value follows (`return`, `else`) or
 * the closing bracket of an `if (…)`, `while (…)`, `for (…)`; never after a name or another closing bracket, where it
 * is a division. A character class is bounded, so that a `[` that closes nowhere costs its line once and not once per slash.
 */
const REGEX_AFTER = String.raw`(?:^|[(,=:\[!&|?{;>+*%<^~]|\b(?:return|typeof|else|do|in|of|case|throw|delete|void|yield|await|new)|\b(?:if|while|for|with)\s*\((?:[^()\n]|\([^()\n]*\)){0,200}\))`;
const REGEX = String.raw`(?<=${REGEX_AFTER}\s*)/(?![/*])(?:\\.|\[(?:\\.|[^\]\\\n]){0,300}\]|[^/\\\n\[])+/[a-z]*`;

const lexers = new Map<Syntax, RegExp>();

/** The pattern that finds, left to right, the comments, strings and regular expressions of a syntax. */
function lexer(s: Syntax): RegExp {
  let re = lexers.get(s);
  if (!re) {
    const hash = s.hash === 'anywhere' ? COMMENT_HASH : s.hash === 'line start' ? COMMENT_HASH_LINE : '';
    const comments = [hash, s.slash ? COMMENT_SLASH : ''].filter(Boolean).join('|');
    const strings = [s.triple ? TRIPLE : '', s.oneLine ? QUOTED_LINE : QUOTED, TEMPLATE].filter(Boolean).join('|');
    re = new RegExp([comments && `(?<comment>${comments})`, `(?<string>${strings})`, s.regex ? `(?<regex>${REGEX})` : ''].filter(Boolean).join('|'), 'g');
    lexers.set(s, re);
  }
  return re;
}

interface Piece {
  kind: 'comment' | 'string' | 'regex';
  at: number;
  end: number;
}

/** The comments, strings and regular expressions of the code, in order. */
function pieces(code: string, program: string): Piece[] {
  return [...code.matchAll(lexer(syntaxOf(program)))].map((m) => ({
    kind: m.groups!.comment !== undefined ? 'comment' : m.groups!.string !== undefined ? 'string' : 'regex',
    at: m.index,
    end: m.index + m[0].length,
  }));
}

const blank = (s: string) => s.replace(/[^\n]/g, ' ');

/**
 * The parts of a string that are code, as ranges of its text: a JavaScript template's `${…}`, a Python f-string's `{…}`
 * (`{{` is a brace; a conversion and a format spec after the expression are no code).
 */
function interpolations(piece: string, python: boolean): [number, number][] {
  const found: [number, number][] = [];
  for (let i = 1; i < piece.length - 1; i++) {
    if (piece[i] === '\\') i++;
    else if (python && piece[i] === '{' && piece[i + 1] === '{') i++;
    else if (python ? piece[i] === '{' : piece[i] === '$' && piece[i + 1] === '{') {
      const from = i + (python ? 1 : 2);
      let depth = 1;
      let to = from;
      for (; to < piece.length - 1 && depth; to++) depth += piece[to] === '{' ? 1 : piece[to] === '}' ? -1 : 0;
      const close = depth ? to : to - 1;
      let end = close;
      if (python)
        for (let k = from, nest = 0; k < close; k++) {
          const c = piece[k]!;
          if ('([{'.includes(c)) nest++;
          else if (')]}'.includes(c)) nest--;
          else if (nest === 0 && ((c === '!' && piece[k + 1] !== '=') || c === ':')) {
            end = k;
            break;
          }
        }
      found.push([from, end]);
      i = close;
    }
  }
  return found;
}

/** What precedes an f-string's quote: its prefix letters (`f`, `rf`, `Fr`). */
const F_PREFIX = /(?<![\w$])(?:[fF][rRbB]?|[rRbB][fF])$/;

/** A string with its inside blanked but for the code in it, which is read as code; `before` is what stands before the string. */
function inside(piece: string, before: string, program: string): string {
  const python = syntaxOf(program) === PYTHON;
  const code = piece[0] === '`' ? interpolations(piece, false) : python && F_PREFIX.test(before) ? interpolations(piece, true) : [];
  let out = piece[0]!;
  let at = 1;
  for (const [from, to] of code) {
    out += blank(piece.slice(at, from)) + mask(piece.slice(from, to), program, true);
    at = to;
  }
  return out + blank(piece.slice(at, -1)) + piece.slice(-1);
}

/**
 * The code with its comments blanked, and the insides of strings and regular expressions too when `strings` (the code in
 * a template or an f-string stays); every position kept.
 */
function mask(code: string, program: string, strings: boolean): string {
  let out = '';
  let at = 0;
  for (const p of pieces(code, program)) {
    const piece = code.slice(p.at, p.end);
    let text = piece;
    if (p.kind === 'comment') text = blank(piece);
    else if (strings) text = p.kind === 'string' ? inside(piece, code.slice(Math.max(0, p.at - 3), p.at), program) : piece[0] + blank(piece.slice(1, -1)) + piece.slice(-1);
    out += code.slice(at, p.at) + text;
    at = p.end;
  }
  return out + code.slice(at);
}

/** The code as code, where a call is looked for: not in a comment, nor, where strings are read surely, in a string that holds code. */
const codeOf = (code: string, program: string) => mask(code, program, syntaxOf(program).sure);

/** The code with every comment, string and regular expression emptied: where names are read and parentheses counted. */
const skeletonOf = (code: string, program: string) => mask(code, program, true);

/** The string literals of the code, unescaped, in order; a template with an expression in it is no literal. */
export function codeLiterals(code: string, program = ''): string[] {
  const out: string[] = [];
  for (const p of pieces(code, program)) {
    if (p.kind !== 'string') continue;
    const text = code.slice(p.at, p.end);
    if (text.startsWith('`') && /(?:^|[^\\])\$/.test(text)) continue;
    const quote = text.startsWith('"""') || text.startsWith("'''") ? 3 : 1;
    const closed = text.length >= 2 * quote && text.endsWith(text.slice(0, quote));
    out.push(text.slice(quote, closed ? -quote : undefined).replace(/\\(.)/g, '$1'));
  }
  return out;
}

// ── calls ─────────────────────────────────────────────────────────────────────────────────────────────

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

/** Where a call's arguments end: the `)` that closes a `(` just before `from` in the code as code, or the code's end when unclosed. */
function argsEnd(text: string, from: number): number {
  let depth = 1;
  for (let i = from; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return text.length;
}

/** The statement a call stands in, up to the call: from the line's start or the last `;` before it. */
function statementBefore(code: string, at: number): string {
  return code.slice(Math.max(code.lastIndexOf('\n', at - 1), code.lastIndexOf(';', at - 1)) + 1, at);
}

/** The names a piece of code reads as values: not attributes, callees, keyword arguments, keywords or built-ins. */
function namesIn(text: string, program: string): string[] {
  // Strings and their prefixes (`f'…'`, `r"…"`) are no names.
  const bare = skeletonOf(text, program).replace(/\b[rRbBfFuU]{1,2}(?=['"])/g, ' ');
  const out: string[] = [];
  for (const m of bare.matchAll(/[A-Za-z_$][\w$]*/g)) {
    // What stands just before the name and just after it, blanks aside: found by a scan, not by copying the rest of a long line.
    let before = m.index - 1;
    while (before >= 0 && /\s/.test(bare[before]!)) before--;
    let after = m.index + m[0].length;
    while (after < bare.length && /\s/.test(bare[after]!)) after++;
    if (bare[before] === '.' || bare[after] === '(' || ((bare[after] === ':' || bare[after] === '=') && bare[after + 1] !== '=')) continue;
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
  // What stands before an `as` in its statement is what it names: found from the `as` backwards, since a pattern that
  // reads the statement first takes the square of a long line's length.
  for (const m of code.matchAll(new RegExp(`\\bas\\s+${n}(?![\\w$])`, 'g'))) {
    bound = true;
    found.push(statementBefore(code, m.index));
  }
  if (new RegExp(`^\\s*(?:from\\s+\\S+\\s+)?import\\b[^\\n;]*\\b${n}(?![\\w$])`, 'm').test(code)) bound = true;
  return bound ? found : null;
}

/**
 * Whether the code defines a function by this name itself, and only once (`def rm(`, `function rm(`, `const rm = (f) =>`):
 * a call of it by its bare name is the script's own, whatever the system's function of that name would do. A method
 * (`def rm(self`) is called through an object; a name assigned again or imported may as well be the system's. `text` is
 * the code as code.
 */
function defines(text: string, name: string): boolean {
  const n = escape(name);
  const count = (source: string) => text.match(new RegExp(source, 'gm'))?.length ?? 0;
  const named = count(String.raw`\b(?:def|function)\s+${n}\s*\((?!\s*(?:self|cls)\b)`);
  const assigned = count(String.raw`(?:^|[^\w$.])${n}\s*(?::[^=\n;]*)?=(?![=>])`);
  const arrow = count(String.raw`(?:^|[^\w$.])${n}\s*=\s*(?:async\s+)?(?:function\b|lambda\b|\([^)]*\)\s*=>|[\w$]+\s*=>)`);
  const imported = new RegExp(String.raw`^\s*(?:from\s+\S+\s+)?import\b[^\n;]*\b${n}(?![\w$])|\b(?:const|let|var)\s*\{[^}]*\b${n}\b[^}]*\}`, 'm').test(text);
  return named + arrow === 1 && named + assigned === 1 && !imported;
}

/** Where the dot that makes a name a method's stands before `at`, blanks aside, or -1: found by a scan, not by copying the text before. */
function dotBefore(text: string, at: number): number {
  let i = at - 1;
  while (i >= 0 && /\s/.test(text[i]!)) i--;
  return text[i] === '.' ? i : -1;
}

/**
 * The literals the code's delete calls are given, directly or through the names they use (followed a few
 * assignments deep). A name the code never assigns leaves a delete's target unknown: then every literal of the
 * code counts, as before this was measured. Empty when the code deletes nothing.
 */
export function deletedLiterals(code: string, program: string): string[] {
  const python = /^(?:python|py|pypy)[0-9.]*t?$/.test(program);
  // A call is looked for in the code as code: not in a string that holds code, a comment, or a function of the script's own.
  const text = codeOf(code, program);
  const bare = skeletonOf(code, program);
  const literals = codeLiterals(code, program);
  const defined = new Map<string, boolean>();
  const calls: { scope: string | null; own: boolean }[] = [];
  for (const m of text.matchAll(python ? PYTHON_DELETE : OTHER_DELETE)) {
    // The header of a definition (`def remove(`, `function rm(`) is no call.
    if (/\b(?:def|function)\s+$/.test(text.slice(Math.max(0, m.index - 16), m.index))) continue;
    const from = m.index + m[0].length;
    const args = code.slice(from, argsEnd(bare, from));
    // A function the code defines itself, called by its bare name, is no delete of the system's (`os.remove(` and `.unlink(` are named in full).
    const name = python ? m[2]! : m[0].replace(/\s*\($/, '');
    let own = !(python ? m[0].includes('.') : dotBefore(text, m.index) >= 0);
    if (own) {
      if (!defined.has(name)) defined.set(name, defines(text, name));
      own = defined.get(name)!;
    }
    // A module's function or a bare one (`os.remove(p)`, `rmtree(p)`): its arguments. A method: a path's own
    // (`Path('/x').unlink()`, `p.rmdir()`) takes no path; one that does is some other object's (`fs.rm('/x')` of an
    // in-memory filesystem, `list.remove(x)`).
    let scope: string | null = null;
    if (!python || !m[1]) scope = args;
    else if ((m[2] === 'unlink' || m[2] === 'rmdir') && /^\s*(?:missing_ok\s*=[^,]*)?$/.test(args)) scope = statementBefore(code, m.index);
    calls.push({ scope, own });
  }
  // The script's own function of a delete's name deletes nothing of the system's, unless the script also runs commands or
  // deletes by another call: then it may well wrap them (`rm = (p) => execSync('rm -rf ' + p)`), and its calls count.
  const wraps = calls.some((c) => c.own) && (runsCommands(code, program) || calls.some((c) => !c.own && c.scope !== null));
  const scopes = calls.flatMap((c) => (c.scope !== null && (!c.own || wraps) ? [c.scope] : []));
  if (!scopes.length) return [];
  const out = new Set<string>();
  const seen = new Set<string>();
  let pending = scopes;
  // Each name is read once, so this ends; a name still to read four assignments deep is as unknown as a parameter.
  for (let depth = 0; pending.length; depth++) {
    const next: string[] = [];
    for (const piece of pending) {
      for (const l of codeLiterals(piece, program)) out.add(l);
      for (const name of namesIn(piece, program)) {
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

/** Calls that put something into a file: Node's writes, Python's `write_text`, a copy or a move. (`open` is judged by its mode.) */
const WRITE_CALLS =
  /\b(?:writeFileSync|appendFileSync|writeFile|appendFile|write_text|write_bytes|copyFileSync|copyFile|renameSync|rename|move|copy|copyfile|copy2|copytree)\s*\(/;
/** A mode that creates, empties, appends to or updates a file: `w`, `a`, `x`, `+` (Python, Ruby), `>`, `>>`, `+<` (Perl). */
const WRITE_MODE = /^(?:[rbtU]*[wax+][rwxabtU+]*|\s*(?:\+?>|\+<)[\s\S]*)$/;
/** The flags a low-level open gives instead of a mode, when they make it write. */
const OPEN_FLAGS = /WRONLY|RDWR|APPEND|CREAT|TRUNC/;
/** Flags of a low-level open that only read (`os.O_RDONLY`, `File::RDONLY`, `fs.constants.O_RDONLY | os.O_NONBLOCK`), a variable aside. */
const READ_FLAGS = /^(?:(?:[\w$]+\.)*O_[A-Z_]+|(?:\w+::)+[A-Z_]+)(?:\s*\|\s*(?:(?:[\w$]+\.)*O_[A-Z_]+|(?:\w+::)+[A-Z_]+))*$/;

/**
 * The arguments of the call whose `(` just precedes `from`, as written in `code`, split at the commas that are not inside
 * brackets; `bare` is the code with its strings, comments and regular expressions emptied (`skeletonOf`).
 */
function argumentsOf(code: string, bare: string, from: number): string[] {
  const end = argsEnd(bare, from);
  const args: string[] = [];
  let depth = 0;
  let start = from;
  for (let i = from; i < end; i++) {
    const c = bare[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      args.push(code.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(code.slice(start, end).trim());
  return args;
}

/** The value of an argument that is one string literal and nothing else; null for any other expression. */
function single(arg: string): string | null {
  const [p] = pieces(arg, '');
  return p?.kind === 'string' && p.at === 0 && p.end === arg.length ? (codeLiterals(arg)[0] ?? null) : null;
}

/**
 * Whether an `open(` call may write: the mode it is given (the second argument, or `mode=`; either argument of a
 * method such as `Path.open('w')`) is one that writes, or one the code does not show, a name it assigns apart. Opened
 * with no mode, it reads.
 */
function opensToWrite(code: string, bare: string, at: number, from: number): boolean {
  // Flags in place of a mode (`os.O_WRONLY | os.O_CREAT`, `File::WRONLY`, `fs.constants.O_APPEND`).
  if (OPEN_FLAGS.test(bare.slice(from, argsEnd(bare, from)))) return true;
  const dot = dotBefore(bare, at);
  let receiver = '';
  for (let r = dot - 1; dot >= 0 && r >= 0; r--)
    if (!/\s/.test(bare[r]!)) {
      receiver = bare[r]!;
      break;
    }
  const args = argumentsOf(code, bare, from).filter((a) => a !== '');
  // `open(*args)`: nothing shows what it is given.
  if (args.some((a) => a.startsWith('*'))) return true;
  const keyword = /^[A-Za-z_]\w*\s*(?:=(?!=)|:(?!:))/;
  for (const [i, a] of args.filter((x) => !keyword.test(x)).entries()) {
    const literal = single(a);
    // A literal mode writes by what it says (either argument of a method such as `Path.open('w')`); anything else in the
    // place of a mode (the second argument, or the first of a method on a call's result, `Path(p).open(m)`) is shown by
    // what the code binds it to.
    if (literal !== null) {
      if ((dot >= 0 || i === 1) && WRITE_MODE.test(literal)) return true;
    } else if ((i === 1 || (i === 0 && receiver === ')')) && mayWrite(a, code)) return true;
  }
  for (const a of args) {
    const given = /^mode\s*[=:]\s*([\s\S]*)$/.exec(a)?.[1];
    if (given !== undefined && mayWrite(given.trim(), code)) return true;
  }
  return false;
}

/**
 * Whether what an open is given as its mode may write: a literal that does, flags that do, or a name the code binds to
 * one of these or to anything it does not show (a parameter, an expression): what is not shown is taken for a write.
 */
function mayWrite(arg: string, code: string, depth = 0): boolean {
  const value = single(arg);
  if (value !== null) return WRITE_MODE.test(value);
  if (OPEN_FLAGS.test(arg)) return true;
  if (READ_FLAGS.test(arg)) return false;
  if (!/^[A-Za-z_$][\w$]*$/.test(arg)) return true;
  const given = depth < 3 ? bindings(code, arg) : null;
  return given === null || given.some((b) => mayWrite(b.trim(), code, depth + 1));
}

/** Whether the code calls something that writes a file, an `open` in a mode that writes included. */
export function writesFiles(code: string, program: string): boolean {
  const text = codeOf(code, program);
  if (WRITE_CALLS.test(text)) return true;
  const bare = skeletonOf(code, program);
  // What a mode argument says is read in the code with its comments blanked, as written otherwise.
  const plain = mask(code, program, false);
  return [...text.matchAll(/\bopen\s*\(/g)].some((m) => opensToWrite(plain, bare, m.index, m.index + m[0].length));
}

/**
 * Calls and words that run a command line, in any of the languages: the code holds a command only if it runs one. A
 * stem such as `exec` or `shell` counts after an underscore or a dot (`create_subprocess_shell`, `execSync`) but not
 * inside a longer name (`filesystem`); a backtick is a command in Ruby and Perl, and a template in JavaScript. A call
 * the code does not name (`getattr(os, name)(…)`, `x['exec'](…)`, `$f(…)`, `obj.send(:system, …)`) is as good as any:
 * wherever the code reaches a function by a string or a name, it may be a command's, and the gate stays open.
 */
const RUNS =
  /(?<![A-Za-z0-9])(?:system|popen|exec|spawn|subprocess|shell|check_|passthru|proc_open|getoutput|getstatusoutput|Popen|Open3|Shell|System|Exec|Spawn|NSTask|send_keys)|(?<=[a-z0-9])(?:Shell|System|Exec|Spawn|Popen)|\b(?:run|call|[Cc]ommand|cmd|eval|fork|qx|sh|getattr|__import__|importlib|__builtins__|globals|locals|vars|send|method|keystroke)\b|\bdo script\b|\bwrite text\b|\.\s*(?:local|sudo)\s*\(|`|%x|\]\s*\(|\$\w+\s*\(/;
/** Perl's and Ruby's `open` runs a command when its name ends or begins with a pipe. */
const OPEN_RUNS = /\bopen\b/;

/** Whether the code runs commands: a string that looks like one is a command only then, not when it is searched for or printed. */
export function runsCommands(code: string, program: string): boolean {
  // AppleScript tells applications what to do, a shell among them (`do shell script`, `do script`, `keystroke`): its
  // strings are not read apart from its code, and any of them may be a command.
  if (program === 'osascript') return true;
  const text = codeOf(code, program);
  return RUNS.test(text) || (/^(?:perl|ruby)[0-9.]*$/.test(program) && OPEN_RUNS.test(text));
}
