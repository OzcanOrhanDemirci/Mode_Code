// SPDX-License-Identifier: Apache-2.0
/**
 * Tool hygiene (A3-6 of 1.2.0): reading files through the shell (`cat`, `sed -n`, `grep`) where Claude Code's own
 * tools do it without one. Measured on the author's machine (2026-10-16): shell reads were 9.3% of the quota, their
 * output larger and less targeted than the tools'. A hint, never a rule. Pure.
 */
import { analyzeCommand } from './shell/analyze.js';
import { shellOf } from './belt/tools.js';

const READERS: Readonly<Record<string, 'Read' | 'Grep'>> = {
  cat: 'Read',
  head: 'Read',
  tail: 'Read',
  less: 'Read',
  more: 'Read',
  'get-content': 'Read',
  grep: 'Grep',
  egrep: 'Grep',
  rg: 'Grep',
  'select-string': 'Grep',
};

/**
 * The Claude Code tool a shell command does the work of, when it only reads files: Read for `cat f`, `head -n 50 f`,
 * `sed -n '1,80p' f`, Grep for `grep -rn x src`. Null for anything else: a pipeline into a program that is no reader,
 * a reader of a stream (`… | grep x`), or a command that changes something.
 */
export function shellReadTool(tool: string, input: Readonly<Record<string, unknown>>): 'Read' | 'Grep' | null {
  const dialect = shellOf(tool);
  if (!dialect) return null;
  const a = analyzeCommand(String(input.command ?? ''), dialect);
  if (!a.invocations.length || a.issues.length) return null;
  let found: 'Read' | 'Grep' | null = null;
  for (const inv of a.invocations) {
    if (inv.writes.length) return null;
    const files = inv.args.filter((x) => !x.startsWith('-'));
    const sed = inv.program === 'sed' && inv.args.includes('-n') && !inv.args.some((x) => x.startsWith('-i'));
    const kind = sed ? 'Read' : Object.hasOwn(READERS, inv.program) ? READERS[inv.program]! : null;
    // A reader with no file reads its input: the end of someone else's pipeline, not a file read.
    if (!kind || files.length < (kind === 'Grep' || sed ? 2 : 1)) return null;
    found ??= kind;
  }
  return found;
}
