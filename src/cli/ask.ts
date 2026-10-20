// SPDX-License-Identifier: Apache-2.0
/**
 * How the command line asks (docs/design.md, Command line and setup): one way for every question, in every command
 * and every setup. A yes or no names what Enter answers ("[y/n, Enter = no]", in the person's language) and asks
 * again on any other word; whatever installs or runs a program of another maker, or opens a browser, answers no to
 * Enter. A pick marks the option Enter takes. A setup says where it is ("Step 2 of 7 · The tools it needs"), a step
 * a choice made unneeded included. Prose is wrapped to the terminal's width at word boundaries.
 */
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import type { SetupIO } from '../app/memory-setup.js';
import { tIn, type Lang, type MessageKey } from '../core/i18n/index.js';
import { wrapText } from '../core/ux/text.js';
import { textWidth } from '../node/width.js';
import { bold, cyan, dim } from './style.js';

/** The columns the terminal shows, or a wide default when output is no terminal (a log keeps whole lines). */
export function columns(): number {
  return process.stdout.isTTY && process.stdout.columns ? process.stdout.columns : 200;
}

/**
 * A line said to the person: wrapped at word boundaries to the terminal's width, each further line indented as far as
 * the first one is (its leading spaces), so a list item's text runs on under itself.
 */
export function say(s = ''): void {
  const width = columns();
  const out = s.split('\n').flatMap((line) => {
    const indent = /^ */.exec(line)![0];
    // Colour codes take no columns (textWidth); a colour that spans a break goes on, as the terminal keeps it.
    if (textWidth(line) <= width) return [line];
    return wrapText(line.slice(indent.length), Math.max(20, width - indent.length - 1), textWidth).map((l) => indent + l);
  });
  process.stdout.write(out.join('\n') + '\n');
}

/** Reads one line from the person, or null when there is no terminal to ask. */
async function line(question: string): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Yes or no: Enter answers `def`, the hint says which; another word asks again. Without a terminal, `def` is never yes. */
export async function confirm(lang: Lang, question: string, def: boolean): Promise<boolean> {
  const T = (k: MessageKey) => tIn(lang, k);
  for (;;) {
    const a = await line(`${question} ${dim(T(def ? 'mcli.yes' : 'mcli.no'))} `);
    if (a === null) return false;
    if (a === '') return def;
    if (/^(?:y|yes|e|evet)$/i.test(a)) return true;
    if (/^(?:n|no|h|hayir|hayır)$/i.test(a)) return false;
  }
}

/** The exact word, typed (what cannot be undone: removing everything); anything else is no. */
export async function typed(question: string, word: string): Promise<boolean> {
  return (await line(`${question} `)) === word;
}

/** The setup's questions, asked in this terminal (src/app/memory-setup.ts, src/app/sync-setup.ts). */
export function terminalIO(lang: Lang): SetupIO {
  const T = (k: MessageKey, p?: Record<string, string | number>) => tIn(lang, k, p);
  return {
    say,
    async choose(question, options, def) {
      say(bold(question));
      options.forEach((o, i) => say(`  ${cyan(String(i + 1))}  ${o}${i === def ? dim(` (${T('mcli.default')})`) : ''}`));
      for (;;) {
        // The prompt names the option Enter takes: the one marked above, not always the first.
        const a = await line(`${T('mcli.pick', { n: options.length, def: def + 1 })} `);
        if (a === null || a === '') return def;
        const n = parseInt(a, 10);
        if (n >= 1 && n <= options.length) return n - 1;
      }
    },
    async ask(question, def) {
      const a = await line(`${bold(question)}${def ? dim(` [${def}]`) : ''}: `);
      return a === null || a === '' ? def : a;
    },
    confirm: (question, def) => confirm(lang, question, def),
    async interactive(argv) {
      say(dim(`$ ${argv.join(' ')}`));
      const r = spawnSync(argv[0]!, argv.slice(1), { stdio: 'inherit', windowsHide: false });
      return r.status ?? 1;
    },
    step(n, of, title, skipped) {
      say();
      say(bold(`${T('mcli.step', { n, of })} · ${title}`) + (skipped ? dim(` · ${skipped}`) : ''));
    },
  };
}
