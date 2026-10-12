// SPDX-License-Identifier: Apache-2.0
/**
 * A PowerShell parser built for safety analysis.
 *
 * Finds the commands a PowerShell string would run: pipelines, statements, the call operator (`& 'x.exe'`),
 * dot-sourcing, assignments whose right side is a pipeline, subexpressions `$(…)`, array subexpressions
 * `@(…)`, script blocks `{…}` and parenthesised pipelines. .NET static calls such as
 * `[IO.File]::Delete('x')` are reported as pseudo-commands named `[IO.File]::Delete`, so rules can see
 * them. PowerShell spellings that could hide a name are decoded: backtick escapes, doubled quotes,
 * typographic quotes and dashes (PowerShell accepts ‘ ’ “ ” and – — ―).
 */
import { LEADING_OPERATOR, MAX_DEPTH, type ParsedScript, type Redirect, type SimpleCommand, type Word } from './types.js';

const SINGLE_QUOTES = new Set(["'", '‘', '’', '‚', '‛']);
const DOUBLE_QUOTES = new Set(['"', '“', '”', '„']);
const DASHES = new Set(['-', '–', '—', '―']);
const REDIRECT_RE = /^([1-6*])?(>>|>)(&[1-6])?/;
const BACKTICK: Record<string, string> = { '0': '\0', a: '\x07', b: '\b', e: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };

export function parsePowerShell(src: string, depth = 0): ParsedScript {
  return new PsParser(src, depth).parse(0, null).script;
}

interface Draft {
  start: number;
  assigns: string[];
  argv: Word[];
  redirects: Redirect[];
  /** An expression statement (starts with a literal, a variable or a type): words are not a command. */
  expression: boolean;
}

class PsParser {
  private pos = 0;
  private readonly nested: ParsedScript[] = [];
  private readonly issues: string[] = [];

  constructor(
    private readonly src: string,
    private readonly depth: number,
  ) {}

  private addNested(script: ParsedScript): void {
    this.nested.push(script);
    for (const issue of script.issues) if (!this.issues.includes(issue)) this.issues.push(issue);
  }

  /** Parses from `start` until end of input or the closing character `stop` (')' or '}'). */
  parse(start: number, stop: ')' | '}' | null): { script: ParsedScript; end: number } {
    const script: ParsedScript = { dialect: 'powershell', commands: [], nested: this.nested, issues: this.issues };
    if (this.depth > MAX_DEPTH) {
      this.issues.push('too-deep');
      return { script, end: this.src.length };
    }
    this.pos = start;
    const src = this.src;
    let draft = this.fresh();
    let lastPos = -1;

    const finish = () => {
      if (draft.expression) {
        // Expression statements run no command themselves; .NET calls inside were already recorded.
      } else if (draft.argv.length || draft.redirects.length) {
        const cmd: SimpleCommand = {
          dialect: 'powershell',
          assigns: draft.assigns,
          argv: draft.argv,
          redirects: draft.redirects,
          heredocs: [],
          raw: src.slice(draft.start, this.pos).trim().replace(LEADING_OPERATOR, ''),
        };
        script.commands.push(cmd);
      }
      draft = this.fresh();
    };

    while (this.pos < src.length) {
      if (this.pos === lastPos) {
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
      if (c === '`' && (src[this.pos + 1] === '\n' || (src[this.pos + 1] === '\r' && src[this.pos + 2] === '\n'))) {
        this.pos += src[this.pos + 1] === '\r' ? 3 : 2;
        continue;
      }
      if (c === '<' && src[this.pos + 1] === '#') {
        const end = src.indexOf('#>', this.pos + 2);
        this.pos = end === -1 ? src.length : end + 2;
        continue;
      }
      if (c === '#') {
        while (this.pos < src.length && src[this.pos] !== '\n') this.pos++;
        continue;
      }
      if (c === '\n' || c === ';') {
        finish();
        this.pos++;
        continue;
      }
      if (c === '|') {
        finish();
        this.pos += src[this.pos + 1] === '|' ? 2 : 1;
        continue;
      }
      if (c === '&') {
        if (src[this.pos + 1] === '&') {
          finish();
          this.pos += 2;
          continue;
        }
        if (draft.argv.length === 0 && !draft.expression) {
          // Call operator: the next word (a string, a variable, a script block) is what runs.
          this.pos++;
          continue;
        }
        finish(); // background job operator at the end of a pipeline (PowerShell 7)
        this.pos++;
        continue;
      }
      if (stop && c === stop) {
        finish();
        return { script, end: this.pos + 1 };
      }
      if (c === ')' || c === '}') {
        // A closer without its opener: keep going, but say the parse was not clean.
        this.issues.push('unbalanced-bracket');
        finish();
        this.pos++;
        continue;
      }
      const redir = REDIRECT_RE.exec(src.slice(this.pos, this.pos + 6));
      if (redir && (draft.argv.length || draft.expression || redir[1])) {
        this.pos += redir[0].length;
        if (redir[3]) {
          draft.redirects.push({ op: redir[0], writes: false });
          continue;
        }
        this.skipBlanks();
        const t = this.readWord();
        draft.redirects.push({ op: (redir[1] ?? '') + redir[2], target: t, writes: true });
        continue;
      }

      // Statement starts that make an expression rather than a command.
      if (draft.argv.length === 0 && !draft.expression) {
        const assign = /^\$(?:\{[^}]*\}|[\w:]+)(?:\[[^\]]*\])?\s*(?:[-+*/%]|\?\?)?=(?!=)/.exec(src.slice(this.pos));
        if (assign) {
          draft.assigns.push(assign[0].replace(/\s*[-+*/%?]*=$/, ''));
          this.pos += assign[0].length;
          continue; // the right side is parsed as the statement's command
        }
        if (
          !this.prevIsCallOperator() &&
          (c === '[' || c === '$' || c === '@' || c === '(' || /[0-9]/.test(c) || SINGLE_QUOTES.has(c) || DOUBLE_QUOTES.has(c))
        ) {
          // A string, number, variable or type at statement start makes an expression in PowerShell; only
          // the call operator (`& 'x.exe'`, `& $cmd`) turns such a word into something that runs.
          draft.expression = c !== '(' && c !== '@';
          if (c === '[') this.readDotNetCall(script);
          else this.readWord();
          continue;
        }
        if (c === '.' && /^\.\s+\S/.test(src.slice(this.pos))) {
          this.pos++; // dot-sourcing: the next word is a script that runs in this scope
          continue;
        }
      }
      const w = this.readWord();
      if (!draft.expression) draft.argv.push(w);
      if (w.text === '--%') {
        // Stop-parsing token: the rest of the line goes to the program verbatim.
        let end = src.indexOf('\n', this.pos);
        if (end === -1) end = src.length;
        for (const part of src.slice(this.pos, end).trim().split(/\s+/).filter(Boolean))
          draft.argv.push({ text: part, dynamic: /%\w+%/.test(part), glob: false });
        this.pos = end;
      }
    }
    finish();
    if (stop) this.issues.push(stop === ')' ? 'unterminated-subexpression' : 'unterminated-scriptblock');
    return { script, end: this.pos };
  }

  private prevIsCallOperator(): boolean {
    let i = this.pos - 1;
    while (i >= 0 && (this.src[i] === ' ' || this.src[i] === '\t')) i--;
    return this.src[i] === '&' && this.src[i - 1] !== '&';
  }

  private fresh(): Draft {
    return { start: this.pos, assigns: [], argv: [], redirects: [], expression: false };
  }

  private skipBlanks(): void {
    while (this.pos < this.src.length && (this.src[this.pos] === ' ' || this.src[this.pos] === '\t')) this.pos++;
  }

  /** `[Type]::Member(...)` — recorded as a pseudo-command so rules can inspect .NET calls. */
  private readDotNetCall(script: ParsedScript): void {
    const src = this.src;
    const m = /^\[([\w.`]+)\]::(\w+)/.exec(src.slice(this.pos));
    if (!m) {
      this.readWord();
      return;
    }
    const start = this.pos;
    this.pos += m[0].length;
    const argv: Word[] = [{ text: `[${m[1]!.replace(/`/g, '')}]::${m[2]}`, dynamic: false, glob: false }];
    if (src[this.pos] === '(') {
      // Arguments: collect string literals and variables; nested pipelines in the arguments are parsed.
      this.pos++;
      let depth = 1;
      while (this.pos < src.length && depth > 0) {
        const c = src[this.pos]!;
        if (SINGLE_QUOTES.has(c)) {
          argv.push({ text: this.readSingleQuoted(), dynamic: false, glob: false });
          continue;
        }
        if (DOUBLE_QUOTES.has(c)) {
          const r = this.readExpandable(this.pos + 1, (i) => DOUBLE_QUOTES.has(src[i] ?? '') && !DOUBLE_QUOTES.has(src[i + 1] ?? ''));
          argv.push({ text: r.text, dynamic: r.dynamic, glob: false });
          continue;
        }
        if (c === '$') {
          const v = this.readVariableOrSub();
          argv.push({ text: v.text, dynamic: v.dynamic, glob: false });
          continue;
        }
        if (c === '(') depth++;
        else if (c === ')') depth--;
        this.pos++;
      }
      if (depth > 0) this.issues.push('unterminated-subexpression');
    }
    script.commands.push({
      dialect: 'powershell',
      assigns: [],
      argv,
      redirects: [],
      heredocs: [],
      raw: src.slice(start, this.pos).trim().replace(LEADING_OPERATOR, ''),
    });
  }

  private readWord(): Word {
    const src = this.src;
    let text = '';
    let dynamic = false;
    let glob = false;
    let first = true;
    while (this.pos < src.length) {
      const c = src[this.pos]!;
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ';' || c === '|' || c === ')' || c === '}' || (c === '&' && !first)) break;
      if (c === '>' || (c === '<' && src[this.pos + 1] !== '#')) {
        if (!first) break;
      }
      if (first && DASHES.has(c)) {
        text += '-';
        this.pos++;
        first = false;
        continue;
      }
      first = false;
      if (c === '`') {
        const n = src[this.pos + 1];
        if (n === undefined) {
          this.pos++;
          continue;
        }
        if (n === '\n') {
          this.pos += 2;
          continue;
        }
        text += BACKTICK[n] ?? n;
        this.pos += 2;
        continue;
      }
      if (
        c === '@' &&
        (SINGLE_QUOTES.has(src[this.pos + 1] ?? '') || DOUBLE_QUOTES.has(src[this.pos + 1] ?? '')) &&
        /^@.\r?\n/.test(src.slice(this.pos, this.pos + 4))
      ) {
        const r = this.readHereString();
        text += r.text;
        dynamic ||= r.dynamic;
        continue;
      }
      if (SINGLE_QUOTES.has(c)) {
        text += this.readSingleQuoted();
        continue;
      }
      if (DOUBLE_QUOTES.has(c)) {
        const r = this.readExpandable(this.pos + 1, (i) => DOUBLE_QUOTES.has(src[i] ?? '') && !DOUBLE_QUOTES.has(src[i + 1] ?? ''));
        text += r.text;
        dynamic ||= r.dynamic;
        continue;
      }
      if (c === '$') {
        const e = this.readVariableOrSub();
        text += e.text;
        dynamic ||= e.dynamic;
        continue;
      }
      if ((c === '@' || c === '(') && (c === '(' || src[this.pos + 1] === '(' || src[this.pos + 1] === '{')) {
        const open = c === '(' ? '(' : src[this.pos + 1]!;
        const close = open === '(' ? ')' : '}';
        const from = this.pos + (c === '@' ? 2 : 1);
        const r = new PsParser(src, this.depth + 1).parse(from, close);
        this.addNested(r.script);
        this.pos = r.end;
        text += c === '@' ? `@${open}…${close}` : '(…)';
        dynamic = true;
        continue;
      }
      if (c === '{') {
        const r = new PsParser(src, this.depth + 1).parse(this.pos + 1, '}');
        this.addNested(r.script);
        this.pos = r.end;
        text += '{…}';
        dynamic = true;
        continue;
      }
      if (c === '*' || c === '?' || c === '[') glob = true;
      text += c;
      this.pos++;
    }
    return { text, dynamic, glob };
  }

  /** Reads one single-quoted string at this.pos ('' is an escaped quote); returns its value. */
  private readSingleQuoted(): string {
    const src = this.src;
    let i = this.pos + 1;
    let s = '';
    for (;;) {
      if (i >= src.length) {
        this.issues.push('unterminated-quote');
        break;
      }
      const ch = src[i]!;
      if (SINGLE_QUOTES.has(ch)) {
        if (SINGLE_QUOTES.has(src[i + 1] ?? '')) {
          s += "'";
          i += 2;
          continue;
        }
        break;
      }
      s += ch;
      i++;
    }
    this.pos = Math.min(i + 1, src.length);
    return s;
  }

  /** Reads an expandable string body starting at `from` until `isEnd(i)`; returns its text. */
  private readExpandable(from: number, isEnd: (i: number) => boolean): { text: string; dynamic: boolean } {
    const src = this.src;
    let text = '';
    let dynamic = false;
    let i = from;
    while (i < src.length && !isEnd(i)) {
      const c = src[i]!;
      if (DOUBLE_QUOTES.has(c) && DOUBLE_QUOTES.has(src[i + 1] ?? '')) {
        text += '"';
        i += 2;
        continue;
      }
      if (c === '`') {
        const n = src[i + 1];
        if (n !== undefined) text += BACKTICK[n] ?? n;
        i += 2;
        continue;
      }
      if (c === '$') {
        this.pos = i;
        const e = this.readVariableOrSub();
        if (e.text === '$') {
          text += '$';
          i++;
          continue;
        }
        text += e.text;
        dynamic ||= e.dynamic;
        i = this.pos;
        continue;
      }
      text += c;
      i++;
    }
    if (i >= src.length) this.issues.push('unterminated-quote');
    this.pos = Math.min(i + 1, src.length);
    return { text, dynamic };
  }

  private readHereString(): { text: string; dynamic: boolean } {
    const src = this.src;
    const expandable = DOUBLE_QUOTES.has(src[this.pos + 1]!);
    const bodyStart = src.indexOf('\n', this.pos) + 1;
    const closer = new RegExp(`\\r?\\n[${expandable ? '"“”„' : "'‘’‚‛"}]@`, 'g');
    closer.lastIndex = bodyStart - 1;
    const m = closer.exec(src);
    const bodyEnd = m ? m.index : src.length;
    if (!m) this.issues.push('unterminated-herestring');
    let text = src.slice(bodyStart, bodyEnd);
    let dynamic = false;
    if (expandable) {
      const r = this.readExpandable(bodyStart, (i) => i >= bodyEnd);
      text = r.text;
      dynamic = r.dynamic;
    }
    this.pos = m ? m.index + m[0].length : src.length;
    return { text, dynamic };
  }

  /** $name, $env:NAME, ${…}, $(…) at this.pos. */
  private readVariableOrSub(): { text: string; dynamic: boolean } {
    const src = this.src;
    const n = src[this.pos + 1];
    if (n === '(') {
      const r = new PsParser(src, this.depth + 1).parse(this.pos + 2, ')');
      this.addNested(r.script);
      this.pos = r.end;
      return { text: '$(…)', dynamic: true };
    }
    if (n === '{') {
      const end = src.indexOf('}', this.pos + 2);
      const stop = end === -1 ? src.length : end + 1;
      const text = src.slice(this.pos, stop);
      this.pos = stop;
      return { text, dynamic: true };
    }
    const m = /^\$(?:[A-Za-z_]\w*:)?[A-Za-z_?^$]\w*/.exec(src.slice(this.pos));
    if (m) {
      this.pos += m[0].length;
      return { text: m[0], dynamic: true };
    }
    this.pos++;
    return { text: '$', dynamic: false };
  }
}
