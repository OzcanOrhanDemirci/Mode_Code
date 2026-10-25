// SPDX-License-Identifier: Apache-2.0
/**
 * A bash parser built for safety analysis, not for running scripts.
 *
 * It finds every simple command a string would run, including those inside $(…), backticks, <(…),
 * subshells, groups, control flow, function bodies and expanding here-documents, and it decodes the
 * spellings an agent could use to hide a command name ($'\x67it', quotes split mid-word, line
 * continuations). When it meets something it cannot follow it says so in `issues` instead of guessing;
 * the rules treat a non-empty `issues` list as "unverified".
 */
import { LEADING_OPERATOR, MAX_DEPTH, type ParsedScript, type Redirect, type SimpleCommand, type Word } from './types.js';

// `time` is a reserved word in bash too, but it is left to the analyzer, which unwraps it with its options.
const RESERVED = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '!', '{', '}', 'coproc', 'esac']);
const REDIRECT_RE = /^(\d+|\{[A-Za-z_]\w*\})?(&>>|&>|>>|>\||>&|>|<<<|<<-|<<|<&|<>|<)/;
const WRITE_OPS = new Set(['>', '>>', '>|', '&>', '&>>', '<>']);
/** What a word reads like up to the parenthesis of an array: `NAME=`, `NAME+=`, `NAME[i]=`. */
const ARRAY_NAME = /^[A-Za-z_]\w*(?:\[[^\]]*\])?\+?=$/;

/** The word before was `=~` (inside `[[ … ]]`, where a regular expression comes next). */
function regexNext(d: Draft): boolean {
  const last = d.argv.length - 1;
  return last >= 0 && !d.quotedFirst[last] && d.argv[last]!.text === '=~';
}

/** The words after bash's `time` keyword are what may stand before the command it times: `-p`, `--`, `!`, unquoted, in that order. */
function timePrefix(words: readonly Word[], quoted: readonly boolean[]): boolean {
  let i = 1;
  if (words[i]?.text === '-p' && !quoted[i]) i++;
  if (words[i]?.text === '--' && !quoted[i]) i++;
  while (words[i]?.text === '!' && !quoted[i]) i++;
  return i === words.length;
}

interface Draft {
  start: number;
  assigns: string[];
  argv: Word[];
  quotedFirst: boolean[];
  redirects: Redirect[];
  heredocs: { body: string; expands: boolean }[];
  skip: boolean;
  piped?: boolean;
  /** Its first word is bash's `time` keyword: unquoted, where a command begins, no assignment before it. */
  timed?: boolean;
  /** It follows bash's `coproc` keyword. */
  coproc?: boolean;
}

interface PendingHeredoc {
  delim: string;
  strip: boolean;
  expands: boolean;
  owner: Draft;
}

/** How a `${…}` is closed: with the quotes in it honoured (as bash mostly does) or at its first `}`; and whether the two differed. */
interface ReadMode {
  readonly quotes: boolean;
  differ: boolean;
}

export function parseBash(src: string, depth = 0): ParsedScript {
  const mode: ReadMode = { quotes: true, differ: false };
  const script = new BashParser(src, depth, mode).parse(0, false).script;
  if (!mode.differ) return script;
  // A `${…}` whose end depends on quotes the parser cannot be sure of (a pattern's quotes inside double quotes): the
  // script is read the other way too, and the commands of both readings are judged. Where each stands and where the
  // comments are is then not one answer, so neither is said, and no value is carried from one command to the next.
  const other = new BashParser(src, depth, { quotes: false, differ: false }).parse(0, false).script;
  return {
    dialect: 'bash',
    commands: [...script.commands, ...other.commands].map(({ at: _at, ...cmd }) => cmd),
    nested: [...script.nested, ...other.nested],
    issues: [...new Set([...script.issues, ...other.issues, 'expansion-ambiguous'])],
  };
}

/** Decodes ANSI-C quoting ($'...') escapes. */
export function decodeAnsiC(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c !== '\\' || i === s.length - 1) {
      out += c;
      continue;
    }
    const n = s[++i]!;
    const simple: Record<string, string> = {
      n: '\n',
      t: '\t',
      r: '\r',
      a: '\x07',
      b: '\b',
      e: '\x1b',
      E: '\x1b',
      f: '\f',
      v: '\v',
      '\\': '\\',
      "'": "'",
      '"': '"',
      '?': '?',
    };
    if (n in simple) {
      out += simple[n];
    } else if (n === 'x') {
      const m = /^[0-9A-Fa-f]{1,2}/.exec(s.slice(i + 1));
      if (m) {
        out += String.fromCharCode(parseInt(m[0], 16));
        i += m[0].length;
      } else out += '\\x';
    } else if (n === 'u' || n === 'U') {
      const m = (n === 'u' ? /^[0-9A-Fa-f]{1,4}/ : /^[0-9A-Fa-f]{1,8}/).exec(s.slice(i + 1));
      if (m) {
        const cp = parseInt(m[0], 16);
        out += cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
        i += m[0].length;
      } else out += '\\' + n;
    } else if (/[0-7]/.test(n)) {
      const m = /^[0-7]{1,3}/.exec(s.slice(i));
      out += String.fromCharCode(parseInt(m![0], 8) & 0xff);
      i += m![0].length - 1;
    } else if (n === 'c' && i + 1 < s.length) {
      out += String.fromCharCode(s.charCodeAt(++i) & 0x1f);
    } else {
      out += '\\' + n;
    }
  }
  return out;
}

class BashParser {
  private pos = 0;
  private readonly nested: ParsedScript[] = [];
  private readonly issues: string[] = [];
  private readonly comments: (readonly [number, number])[] = [];
  private readonly bodies: (readonly [number, number])[] = [];

  constructor(
    private readonly src: string,
    private readonly depth: number,
    private readonly mode: ReadMode = { quotes: true, differ: false },
  ) {}

  parse(start: number, stopAtParen: boolean): { script: ParsedScript; end: number } {
    const script: ParsedScript = {
      dialect: 'bash',
      commands: [],
      nested: this.nested,
      issues: this.issues,
      comments: this.comments,
      bodies: this.bodies,
    };
    if (this.depth > MAX_DEPTH) {
      this.issues.push('too-deep');
      return { script, end: this.src.length };
    }
    this.pos = start;
    const src = this.src;
    let draft = this.fresh();
    const pending: PendingHeredoc[] = [];
    let parenDepth = 0;
    let caseDepth = 0;
    let expectPattern = false;
    let dropNextWord = false;
    // Whether a `[[ … ]]` conditional is open: inside one, the word after `=~` is a regular expression. They do not
    // nest: a `[[` inside one is a word (`[[ a && [[ ]]` is closed by that `]]`).
    let cond = false;

    const finish = () => {
      if (!draft.skip && (draft.argv.length || draft.assigns.length || draft.redirects.length)) {
        const text = src.slice(draft.start, this.pos);
        const trimmed = text.trim();
        const raw = trimmed.replace(LEADING_OPERATOR, '');
        const cmd: SimpleCommand = {
          dialect: 'bash',
          assigns: draft.assigns,
          argv: draft.argv,
          redirects: draft.redirects,
          heredocs: draft.heredocs,
          raw,
          // Where raw stands: after the blanks, and after the operator that joined it to the command before.
          at: draft.start + (text.length - text.trimStart().length) + (trimmed.length - raw.length),
          ...(draft.piped ? { piped: true } : {}),
        };
        // cmd.heredocs is the draft's own array, so bodies read at the next newline land on the stored command.
        script.commands.push(cmd);
      }
      draft = this.fresh();
    };

    let lastPos = -1;
    while (this.pos < src.length) {
      if (this.pos === lastPos) {
        // Defensive: never spin. Every character is consumed by some branch below; if not, say so.
        this.issues.push('parser-stuck');
        this.pos++;
        continue;
      }
      lastPos = this.pos;
      const c = src[this.pos]!;
      if (c === ' ' || c === '\t' || c === '\r') {
        this.pos++;
        continue;
      }
      if (c === '\\' && src[this.pos + 1] === '\n') {
        this.pos += 2;
        continue;
      }
      if (this.atComment()) {
        this.readComment();
        continue;
      }
      if (c === '\n') {
        // A pipe at the end of a line goes on to the next command, past blank and comment lines.
        const piped = draft.piped && !draft.argv.length && !draft.assigns.length && !draft.redirects.length;
        finish();
        if (piped) draft.piped = true;
        this.pos++;
        if (pending.length) {
          this.readHeredocs(pending.splice(0));
          // The next command begins after the bodies, which are text of this one's.
          draft.start = this.pos;
        }
        continue;
      }
      // After `=~` in `[[ … ]]` comes a regular expression: its parentheses and bars are its own, and a `#` is no comment.
      if (cond && !/[;&<>)#]/.test(c) && regexNext(draft)) {
        const r = this.readWord(true);
        draft.argv.push(r.word);
        draft.quotedFirst.push(r.quoted);
        continue;
      }
      if (c === ';') {
        const two = src.slice(this.pos, this.pos + 3);
        const len = two.startsWith(';;&') ? 3 : two.startsWith(';;') || two.startsWith(';&') ? 2 : 1;
        if (len > 1 && caseDepth > 0) expectPattern = true;
        // `;`, a lone `&` and a lone `|` end a command; inside `[[ … ]]` bash refuses them, so none is left open.
        cond = false;
        finish();
        this.pos += len;
        continue;
      }
      if (c === '&' && src[this.pos + 1] !== '>') {
        if (src[this.pos + 1] !== '&') cond = false;
        finish();
        this.pos += src[this.pos + 1] === '&' ? 2 : 1;
        continue;
      }
      if (c === '|') {
        if (src[this.pos + 1] !== '|') cond = false;
        finish();
        // `|` and `|&` hand the output on; `||` runs the next command only when this one failed.
        draft.piped = src[this.pos + 1] !== '|';
        this.pos += src[this.pos + 1] === '|' || src[this.pos + 1] === '&' ? 2 : 1;
        continue;
      }
      if (c === '(' && src[this.pos + 1] !== '(') {
        if (expectPattern && caseDepth > 0) {
          this.pos++;
          continue;
        }
        if (draft.argv.length === 1 && /^\s*\)/.test(src.slice(this.pos + 1))) {
          // name() { ... } — a function definition; its body is parsed as commands.
          draft.skip = true;
          finish();
          this.pos = src.indexOf(')', this.pos) + 1;
          continue;
        }
        finish();
        parenDepth++;
        this.pos++;
        continue;
      }
      if (c === '(' && src[this.pos + 1] === '(') {
        // (( arithmetic )) — no command runs inside except substitutions, which readArithmetic collects.
        finish();
        this.readArithmetic(this.pos + 2);
        continue;
      }
      if (c === ')') {
        if (expectPattern && caseDepth > 0) {
          expectPattern = false;
          draft = this.fresh();
          this.pos++;
          continue;
        }
        finish();
        if (parenDepth > 0) {
          parenDepth--;
          this.pos++;
          continue;
        }
        if (stopAtParen) {
          if (pending.length) this.issues.push('heredoc-unterminated');
          if (cond) this.issues.push('unbalanced-bracket');
          return { script, end: this.pos + 1 };
        }
        this.issues.push('unbalanced-paren');
        this.pos++;
        continue;
      }
      if (c === '<' || c === '>') {
        if (src[this.pos + 1] === '(') {
          // A process substitution standing as its own word.
          const w = this.readWord();
          if (expectPattern && caseDepth > 0) continue;
          draft.argv.push(w.word);
          draft.quotedFirst.push(w.quoted);
          continue;
        }
      }
      const redir = REDIRECT_RE.exec(src.slice(this.pos, this.pos + 16));
      if (redir && (redir[1] === undefined || /[\s;&|()]/.test(src[this.pos - 1] ?? ' ') || this.pos === start)) {
        this.pos += redir[0].length;
        const op = redir[2]!;
        this.skipBlanks();
        if (op === '<<' || op === '<<-') {
          const delim = this.readWord();
          const r: Redirect = { op, target: delim.word, writes: false };
          draft.redirects.push(r);
          pending.push({ delim: delim.word.text, strip: op === '<<-', expands: !delim.quoted, owner: draft });
          continue;
        }
        if ((op === '>&' || op === '<&') && /^(\d+|-)(?=$|[\s;&|()<>])/.test(src.slice(this.pos))) {
          const m = /^(\d+|-)/.exec(src.slice(this.pos))!;
          this.pos += m[0].length;
          draft.redirects.push({ op: op + m[0], writes: false });
          continue;
        }
        const t = this.readWord();
        draft.redirects.push({ op, target: t.word, writes: WRITE_OPS.has(op) || op === '>&' });
        continue;
      }

      const { word, quoted, quoteAt } = this.readWord();
      if (dropNextWord) {
        dropNextWord = false;
        continue;
      }
      if (!quoted && word.text === 'esac' && caseDepth > 0 && (expectPattern || draft.argv.length === 0)) {
        caseDepth--;
        expectPattern = false;
        draft = this.fresh();
        continue;
      }
      if (expectPattern && caseDepth > 0) continue;
      const atCommandStart = draft.argv.length === 0 && draft.assigns.length === 0 && draft.redirects.length === 0;
      const assign = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/.exec(word.text);
      // NAME=value is an assignment when the NAME= part is unquoted (the value itself may be quoted) and no
      // command word came before it; assignments and redirects may precede the command in any order.
      if (draft.argv.length === 0 && assign && (!quoted || quoteAt >= assign[0].length)) {
        draft.assigns.push(word.text);
        continue;
      }
      if (atCommandStart && !quoted) {
        if (RESERVED.has(word.text)) {
          if (word.text === 'esac') caseDepth = Math.max(0, caseDepth - 1);
          if (word.text === 'coproc') draft.coproc = true;
          continue;
        }
        if (word.text === 'function') {
          dropNextWord = true;
          continue;
        }
        if (word.text === 'case') {
          // case SUBJECT in PATTERN) commands ;; ... esac — the subject's substitutions are still collected.
          caseDepth++;
          this.readWordsUntilIn();
          expectPattern = true;
          draft = this.fresh();
          continue;
        }
        if (word.text === 'for' || word.text === 'select') draft.skip = true;
      }
      if (!quoted) {
        // `[[` opens a conditional where a command may begin, also after the `time` keyword and what may follow it
        // (not after a quoted `time`, one with an assignment before it, a quoted or another option: that is the
        // program, and `[[` its argument); `]]` closes it.
        const timed = draft.timed === true && timePrefix(draft.argv, draft.quotedFirst);
        if (word.text === '[[' && !cond && (atCommandStart || timed)) cond = true;
        else if (word.text === ']]' && cond) cond = false;
        // `time` is the keyword only where a pipeline begins: after a `|` or `coproc` it is the program of that name.
        if (atCommandStart && word.text === 'time' && !draft.piped && !draft.coproc) draft.timed = true;
      }
      draft.argv.push(word);
      draft.quotedFirst.push(quoted);
    }
    finish();
    if (pending.length) {
      this.issues.push('heredoc-unterminated');
    }
    // A conditional still open at the end is one bash refused, or one the parser took for a conditional wrongly: what
    // it read as a regular expression may have held commands, so the result is not trusted.
    if (cond) this.issues.push('unbalanced-bracket');
    // So is a group still open: a `(` the parser took for one may have been bash's regular expression, and the `#`
    // after it a comment that hid the line.
    if (parenDepth > 0) this.issues.push('unbalanced-paren');
    if (stopAtParen) this.issues.push('unterminated-substitution');
    return { script, end: this.pos };
  }

  private fresh(): Draft {
    return { start: this.pos, assigns: [], argv: [], quotedFirst: [], redirects: [], heredocs: [], skip: false };
  }

  /** Keeps a nested script and lifts its problems, so the top-level issue list is complete. */
  private addNested(script: ParsedScript): void {
    this.nested.push(script);
    for (const issue of script.issues) if (!this.issues.includes(issue)) this.issues.push(issue);
  }

  /**
   * Reads the commands inside `$(…)`, `<(…)` or `>(…)` at this.pos, in this same text, and moves past them. They are
   * a nested script of their own, and the comments and here-document bodies they hold stand in this text too.
   */
  private readGroup(): void {
    const r = new BashParser(this.src, this.depth + 1, this.mode).parse(this.pos + 2, true);
    this.addNested(r.script);
    // A loop, not push(...): a script of a hundred thousand comments must not overflow the call.
    for (const c of r.script.comments ?? []) this.comments.push(c);
    for (const b of r.script.bodies ?? []) this.bodies.push(b);
    this.pos = r.end;
  }

  private skipBlanks(): void {
    while (this.pos < this.src.length && (this.src[this.pos] === ' ' || this.src[this.pos] === '\t')) this.pos++;
  }

  /**
   * A `#` where a word would begin starts a comment. A lone carriage return is no blank to bash on Linux and macOS but a
   * letter of the word it ends (`a\r#x` is one word), so a `#` right after one starts none; the parser skips such a
   * return as a blank. Git Bash drops the return first, so there the `#` does start one: read as a word, it hides nothing.
   * Nor does one right after `!(`: with `extglob` on that is a pattern and the `#` is its own, with it off a group of
   * commands, and the parser cannot tell which. It reads the hash as a word, so no command after it is hidden.
   */
  private atComment(): boolean {
    const before = this.src[this.pos - 1];
    return this.src[this.pos] === '#' && before !== '\r' && !(before === '(' && this.src[this.pos - 2] === '!');
  }

  /** Moves past the comment at this.pos, up to its line end, and tells where it stood. */
  private readComment(): void {
    const at = this.pos;
    while (this.pos < this.src.length && this.src[this.pos] !== '\n') this.pos++;
    this.comments.push([at, this.pos]);
  }

  /**
   * Reads the elements of an array's `(…)` at this.pos, in `NAME=(a b "c" $(d))`, and moves past it. They are words, not
   * commands (a command substitution among them is read as one); line ends and comments may stand between them. The
   * word the assignment is goes on after the parenthesis: `a=(1)#x` is one word, and no comment.
   */
  private readArray(): string {
    const src = this.src;
    this.pos++;
    while (this.pos < src.length) {
      const c = src[this.pos]!;
      if (c === ')') {
        this.pos++;
        return '(…)';
      }
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') this.pos++;
      else if (c === '\\' && src[this.pos + 1] === '\n') this.pos += 2;
      else if (this.atComment()) this.readComment();
      else {
        const before = this.pos;
        this.readWord();
        // A character no word takes here (`;`, `&`, `|`, `<`, `>`, `(`) is a syntax error to bash, which drops that
        // line and runs the next ones: the array ends here, and what follows is read as commands.
        if (this.pos === before) {
          this.issues.push('unbalanced-paren');
          return '(…)';
        }
      }
    }
    this.issues.push('unbalanced-paren');
    return '(…)';
  }

  /** After `case`, consume the subject and the `in` keyword (collecting substitutions in the subject). */
  private readWordsUntilIn(): void {
    for (let guard = 0; guard < 4 && this.pos < this.src.length; guard++) {
      this.skipBlanks();
      const { word } = this.readWord();
      if (word.text === 'in') return;
    }
  }

  private readHeredocs(list: PendingHeredoc[]): void {
    const src = this.src;
    for (const h of list) {
      const from = this.pos;
      const lines: string[] = [];
      let closed = false;
      while (this.pos < src.length) {
        let nl = src.indexOf('\n', this.pos);
        if (nl === -1) nl = src.length;
        let line = src.slice(this.pos, nl);
        this.pos = Math.min(nl + 1, src.length);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        const cmp = h.strip ? line.replace(/^\t+/, '') : line;
        if (cmp === h.delim) {
          closed = true;
          break;
        }
        lines.push(line);
      }
      if (!closed) this.issues.push('heredoc-unterminated');
      // The body and its closing line, where they stand in the text.
      this.bodies.push([from, this.pos]);
      const body = lines.join('\n');
      h.owner.heredocs.push({ body, expands: h.expands });
      if (h.expands) this.collectSubstitutions(body);
    }
  }

  /** Finds $(…) and `…` inside expanding text (here-document bodies, ${…} operands) and parses them. */
  private collectSubstitutions(text: string): void {
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === '$' && text[i + 1] === '(') {
        const sub = new BashParser(text, this.depth + 1, this.mode);
        const r = sub.parse(i + 2, true);
        this.addNested(r.script);
        i = r.end - 1;
      } else if (c === '`') {
        const end = findBacktickEnd(text, i + 1);
        const inner = unescapeBacktick(text.slice(i + 1, end));
        this.addNested(parseBash(inner, this.depth + 1));
        i = end;
      }
    }
  }

  private readArithmetic(from: number): void {
    const src = this.src;
    let depth = 2;
    let i = from;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    if (depth > 0) this.issues.push('unterminated-arithmetic');
    this.collectSubstitutions(src.slice(from, Math.max(from, i - 2)));
    this.pos = i;
  }

  /**
   * Reads one word at this.pos. `regex` is the operand of `=~`, where bash takes parentheses and bars as the
   * expression's own. Parentheses are part of a word also after an extended-pattern sign (`@(a|b)`, `+(x)`, `*(y)`,
   * `?(z)`; the `!(` of a negation is left alone, see atComment: it begins a group of commands when `extglob` is off) and as the
   * elements of an array (`NAME=(…)`). Inside such parentheses blanks, line ends and the shell's operators are the
   * word's too, and a `#` is no comment.
   */
  private readWord(regex = false): { word: Word; quoted: boolean; quoteAt: number } {
    const src = this.src;
    let text = '';
    let dynamic = false;
    let glob = false;
    let quoted = false;
    let quoteAt = -1;
    let group = 0;
    while (this.pos < src.length) {
      const c = src[this.pos]!;
      if ((c === '<' || c === '>') && src[this.pos + 1] === '(') {
        this.readGroup();
        text += `${c}(…)`;
        dynamic = true;
        continue;
      }
      if (c === '(' && !regex && group === 0 && !quoted && ARRAY_NAME.test(text)) {
        text += this.readArray();
        dynamic = true;
        continue;
      }
      if (c === '(' && (regex || group > 0 || (!quoted && /[?*+@]$/.test(text)))) {
        group++;
        glob ||= !regex;
        text += c;
        this.pos++;
        continue;
      }
      if (c === ')' && group > 0) {
        group--;
        text += c;
        this.pos++;
        continue;
      }
      if (
        group === 0 &&
        !(regex && c === '|') &&
        (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ';' || c === '&' || c === '|' || c === '<' || c === '>' || c === '(' || c === ')')
      )
        break;
      if (c === '\\') {
        const n = src[this.pos + 1];
        if (n === '\n') {
          this.pos += 2;
          continue;
        }
        if (!quoted) {
          quoted = true;
          quoteAt = text.length;
        }
        if (n !== undefined) text += n;
        this.pos += 2;
        continue;
      }
      if (c === "'") {
        if (!quoted) {
          quoted = true;
          quoteAt = text.length;
        }
        const end = src.indexOf("'", this.pos + 1);
        if (end === -1) {
          this.issues.push('unterminated-quote');
          text += src.slice(this.pos + 1);
          this.pos = src.length;
          break;
        }
        text += src.slice(this.pos + 1, end);
        this.pos = end + 1;
        continue;
      }
      if (c === '"') {
        if (!quoted) {
          quoted = true;
          quoteAt = text.length;
        }
        const r = this.readDoubleQuoted();
        text += r.text;
        dynamic ||= r.dynamic;
        continue;
      }
      if (c === '$') {
        const n = src[this.pos + 1];
        if (n === "'") {
          if (!quoted) {
            quoted = true;
            quoteAt = text.length;
          }
          let end = this.pos + 2;
          while (end < src.length && src[end] !== "'") end += src[end] === '\\' ? 2 : 1;
          if (end >= src.length) this.issues.push('unterminated-quote');
          text += decodeAnsiC(src.slice(this.pos + 2, Math.min(end, src.length)));
          this.pos = Math.min(end + 1, src.length);
          continue;
        }
        if (n === '"') {
          if (!quoted) {
            quoted = true;
            quoteAt = text.length;
          }
          this.pos++;
          const r = this.readDoubleQuoted();
          text += r.text;
          dynamic ||= r.dynamic;
          continue;
        }
        const e = this.readExpansion();
        text += e;
        dynamic = true;
        continue;
      }
      if (c === '`') {
        const end = findBacktickEnd(src, this.pos + 1);
        if (end >= src.length) this.issues.push('unterminated-backtick');
        this.addNested(parseBash(unescapeBacktick(src.slice(this.pos + 1, end)), this.depth + 1));
        this.pos = Math.min(end + 1, src.length);
        text += '`…`';
        dynamic = true;
        continue;
      }
      if (c === '*' || c === '?' || c === '[') glob = true;
      if (c === '{' && /^\{[^{}\s]*(,|\.\.)[^{}\s]*\}/.test(src.slice(this.pos))) glob = true;
      text += c;
      this.pos++;
    }
    if (group > 0) this.issues.push('unbalanced-paren');
    return { word: { text, dynamic, glob }, quoted, quoteAt };
  }

  private readDoubleQuoted(): { text: string; dynamic: boolean } {
    const src = this.src;
    let text = '';
    let dynamic = false;
    this.pos++; // opening "
    while (this.pos < src.length && src[this.pos] !== '"') {
      const c = src[this.pos]!;
      if (c === '\\') {
        const n = src[this.pos + 1];
        if (n === '$' || n === '`' || n === '"' || n === '\\') {
          text += n;
          this.pos += 2;
        } else if (n === '\n') {
          this.pos += 2;
        } else {
          text += '\\';
          this.pos++;
        }
        continue;
      }
      if (c === '$') {
        const n = src[this.pos + 1];
        if (n === '(' || n === '{' || (n !== undefined && /[A-Za-z_0-9@*#?$!-]/.test(n))) {
          text += this.readExpansion();
          dynamic = true;
          continue;
        }
        text += '$';
        this.pos++;
        continue;
      }
      if (c === '`') {
        const end = findBacktickEnd(src, this.pos + 1);
        this.addNested(parseBash(unescapeBacktick(src.slice(this.pos + 1, end)), this.depth + 1));
        this.pos = Math.min(end + 1, src.length);
        text += '`…`';
        dynamic = true;
        continue;
      }
      text += c;
      this.pos++;
    }
    if (this.pos >= src.length) this.issues.push('unterminated-quote');
    this.pos++; // closing "
    return { text, dynamic };
  }

  /**
   * Where the `${…}` whose text starts at `from` ends, just past its `}`; -1 where it does not. Only another `${` nests
   * (`${x:-{}` ends at its first `}`, as bash ends it). With `quotes`, a `}` in quotes closes nothing (`${x:-"}"}`,
   * `"${x:-'}'}"`: bash honours single quotes there inside double quotes too).
   */
  private braceEnd(from: number, quotes: boolean): number {
    const src = this.src;
    let depth = 1;
    let i = from;
    let dollar = false;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '\\') i++;
      else if (quotes && c === "'") {
        const end = src.indexOf("'", i + 1);
        i = end === -1 ? src.length : end;
      } else if (quotes && c === '"') {
        for (i++; i < src.length && src[i] !== '"'; i++) if (src[i] === '\\') i++;
      } else if (c === '{' && dollar) depth++;
      else if (c === '}') depth--;
      // An escaped `$` is stepped over with its backslash, so a `$` met here is the shell's; but `$$` is the process's
      // number, and the `{` after it nests nothing.
      dollar = c === '$' && !dollar;
      i++;
    }
    return depth > 0 ? -1 : i;
  }

  /** Reads $name, ${…}, $(…), $((…)) or a special parameter at this.pos; returns its text for the word. */
  private readExpansion(): string {
    const src = this.src;
    const n = src[this.pos + 1];
    if (n === '(') {
      if (src[this.pos + 2] === '(') {
        this.readArithmetic(this.pos + 3);
        return '$((…))';
      }
      this.readGroup();
      return '$(…)';
    }
    if (n === '{') {
      const quoted = this.braceEnd(this.pos + 2, true);
      const plain = this.braceEnd(this.pos + 2, false);
      // Which quotes bash honours in it depends on its mode and the operator: where the two readings end it in different
      // places, the script is read both ways (parseBash).
      if (quoted !== plain) this.mode.differ = true;
      const end = this.mode.quotes ? quoted : plain;
      if (end === -1) this.issues.push('unterminated-expansion');
      const i = end === -1 ? src.length : end;
      const whole = src.slice(this.pos, i);
      this.collectSubstitutions(whole.slice(2, -1));
      this.pos = i;
      return whole;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(this.pos + 1));
    if (name) {
      this.pos += 1 + name[0].length;
      return '$' + name[0];
    }
    if (n !== undefined && /[0-9@*#?$!-]/.test(n)) {
      this.pos += 2;
      return '$' + n;
    }
    this.pos++;
    return '$';
  }
}

function findBacktickEnd(s: string, from: number): number {
  let i = from;
  while (i < s.length && s[i] !== '`') i += s[i] === '\\' ? 2 : 1;
  return Math.min(i, s.length);
}

function unescapeBacktick(s: string): string {
  return s.replace(/\\([`$\\])/g, '$1');
}
