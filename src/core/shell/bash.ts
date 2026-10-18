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

interface Draft {
  start: number;
  assigns: string[];
  argv: Word[];
  quotedFirst: boolean[];
  redirects: Redirect[];
  heredocs: { body: string; expands: boolean }[];
  skip: boolean;
  piped?: boolean;
}

interface PendingHeredoc {
  delim: string;
  strip: boolean;
  expands: boolean;
  owner: Draft;
}

export function parseBash(src: string, depth = 0): ParsedScript {
  return new BashParser(src, depth).parse(0, false).script;
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

  constructor(
    private readonly src: string,
    private readonly depth: number,
  ) {}

  parse(start: number, stopAtParen: boolean): { script: ParsedScript; end: number } {
    const script: ParsedScript = { dialect: 'bash', commands: [], nested: this.nested, issues: this.issues };
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

    const finish = () => {
      if (!draft.skip && (draft.argv.length || draft.assigns.length || draft.redirects.length)) {
        const cmd: SimpleCommand = {
          dialect: 'bash',
          assigns: draft.assigns,
          argv: draft.argv,
          redirects: draft.redirects,
          heredocs: draft.heredocs,
          raw: src.slice(draft.start, this.pos).trim().replace(LEADING_OPERATOR, ''),
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
      if (c === '#') {
        while (this.pos < src.length && src[this.pos] !== '\n') this.pos++;
        continue;
      }
      if (c === '\n') {
        finish();
        this.pos++;
        if (pending.length) this.readHeredocs(pending.splice(0));
        continue;
      }
      if (c === ';') {
        const two = src.slice(this.pos, this.pos + 3);
        const len = two.startsWith(';;&') ? 3 : two.startsWith(';;') || two.startsWith(';&') ? 2 : 1;
        if (len > 1 && caseDepth > 0) expectPattern = true;
        finish();
        this.pos += len;
        continue;
      }
      if (c === '&' && src[this.pos + 1] !== '>') {
        finish();
        this.pos += src[this.pos + 1] === '&' ? 2 : 1;
        continue;
      }
      if (c === '|') {
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
      draft.argv.push(word);
      draft.quotedFirst.push(quoted);
    }
    finish();
    if (pending.length) {
      this.issues.push('heredoc-unterminated');
    }
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

  private skipBlanks(): void {
    while (this.pos < this.src.length && (this.src[this.pos] === ' ' || this.src[this.pos] === '\t')) this.pos++;
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
        const sub = new BashParser(text, this.depth + 1);
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

  private readWord(): { word: Word; quoted: boolean; quoteAt: number } {
    const src = this.src;
    let text = '';
    let dynamic = false;
    let glob = false;
    let quoted = false;
    let quoteAt = -1;
    while (this.pos < src.length) {
      const c = src[this.pos]!;
      if ((c === '<' || c === '>') && src[this.pos + 1] === '(') {
        const r = new BashParser(src, this.depth + 1).parse(this.pos + 2, true);
        this.addNested(r.script);
        this.pos = r.end;
        text += `${c}(…)`;
        dynamic = true;
        continue;
      }
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ';' || c === '&' || c === '|' || c === '<' || c === '>' || c === '(' || c === ')') break;
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

  /** Reads $name, ${…}, $(…), $((…)) or a special parameter at this.pos; returns its text for the word. */
  private readExpansion(): string {
    const src = this.src;
    const n = src[this.pos + 1];
    if (n === '(') {
      if (src[this.pos + 2] === '(') {
        this.readArithmetic(this.pos + 3);
        return '$((…))';
      }
      const r = new BashParser(src, this.depth + 1).parse(this.pos + 2, true);
      this.addNested(r.script);
      this.pos = r.end;
      return '$(…)';
    }
    if (n === '{') {
      let depth = 1;
      let i = this.pos + 2;
      while (i < src.length && depth > 0) {
        const c = src[i];
        if (c === '\\') i++;
        else if (c === '{') depth++;
        else if (c === '}') depth--;
        i++;
      }
      if (depth > 0) this.issues.push('unterminated-expansion');
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
