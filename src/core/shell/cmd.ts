// SPDX-License-Identifier: Apache-2.0
/**
 * A cmd.exe parser for strings run through `cmd /c "…"`. cmd has few quoting rules: double quotes group,
 * `^` escapes outside quotes, `%VAR%` and `!VAR!` expand, and `&`, `&&`, `||`, `|` separate commands.
 */
import type { ParsedScript, Redirect, SimpleCommand, Word } from './types.js';

const REDIRECT_RE = /^([0-9])?(>>|>|<)(&[0-9])?/;

export function parseCmd(src: string): ParsedScript {
  const script: ParsedScript = { dialect: 'cmd', commands: [], nested: [], issues: [] };
  let pos = 0;
  let argv: Word[] = [];
  let redirects: Redirect[] = [];
  let start = 0;
  const finish = () => {
    if (argv.length || redirects.length) {
      const cmd: SimpleCommand = { dialect: 'cmd', assigns: [], argv, redirects, heredocs: [], raw: src.slice(start, pos).trim() };
      script.commands.push(cmd);
    }
    argv = [];
    redirects = [];
    start = pos;
  };
  const readWord = (): Word => {
    let text = '';
    let dynamic = false;
    let glob = false;
    while (pos < src.length) {
      const c = src[pos]!;
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '&' || c === '|' || c === '<' || c === '>' || c === '(' || c === ')') break;
      if (c === '^') {
        if (pos + 1 < src.length) text += src[pos + 1];
        pos += 2;
        continue;
      }
      if (c === '"') {
        const end = src.indexOf('"', pos + 1);
        const stop = end === -1 ? src.length : end;
        if (end === -1) script.issues.push('unterminated-quote');
        const inner = src.slice(pos + 1, stop);
        if (/%[^%\s]+%|![^!\s]+!/.test(inner)) dynamic = true;
        text += inner;
        pos = stop + 1;
        continue;
      }
      if ((c === '%' && /^%[^%\s]+%/.test(src.slice(pos))) || (c === '!' && /^![^!\s]+!/.test(src.slice(pos)))) dynamic = true;
      if (c === '*' || c === '?') glob = true;
      text += c;
      pos++;
    }
    return { text, dynamic, glob };
  };
  let lastPos = -1;
  while (pos < src.length) {
    if (pos === lastPos) {
      script.issues.push('parser-stuck');
      pos++;
      continue;
    }
    lastPos = pos;
    const c = src[pos]!;
    if (c === ' ' || c === '\t' || c === '\r') {
      pos++;
      continue;
    }
    if (c === '\n' || c === '(' || c === ')') {
      finish();
      pos++;
      start = pos;
      continue;
    }
    if (c === '&' || c === '|') {
      finish();
      pos += src[pos + 1] === c ? 2 : 1;
      start = pos;
      continue;
    }
    const redir = REDIRECT_RE.exec(src.slice(pos, pos + 4));
    if (redir) {
      pos += redir[0].length;
      if (redir[3]) {
        redirects.push({ op: redir[0], writes: false });
        continue;
      }
      while (src[pos] === ' ' || src[pos] === '\t') pos++;
      const t = readWord();
      redirects.push({ op: (redir[1] ?? '') + redir[2], target: t, writes: redir[2] !== '<' });
      continue;
    }
    if (argv.length === 0 && c === '@') {
      pos++; // @command: suppress echo
      continue;
    }
    argv.push(readWord());
  }
  finish();
  return script;
}
