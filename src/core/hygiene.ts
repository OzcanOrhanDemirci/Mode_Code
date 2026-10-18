// SPDX-License-Identifier: Apache-2.0
/**
 * Tool hygiene (A3-6 of 1.2.0): reading files through the shell (`cat`, `sed -n`, `grep`) where Claude Code's own
 * tools do it without one. Measured on the author's machine (2026-10-16): shell reads were 9.3% of the quota, their
 * output larger and less targeted than the tools'. A hint, never a rule. Pure.
 */
import { analyzeCommand, programName } from './shell/analyze.js';
import { parseBash } from './shell/bash.js';
import { shellOf } from './belt/tools.js';
import type { Platform } from './paths.js';

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

/** Programs that build or test: their exit code is the one that matters. */
const RUNNER = /^(?:npm|pnpm|yarn|bun|npx|pytest|cargo|go|flutter|dart|gradle|gradlew|mvn|make|tsc|jest|vitest|dotnet)$/;
const FILTER = new Set(['tail', 'head', 'grep', 'tee', 'less', 'more', 'sort', 'uniq', 'cut', 'awk', 'sed']);

/**
 * A shell trap a command falls into, as bash behaves (measured in test/core/hygiene.test.ts): on Windows, an unquoted
 * heredoc whose body holds backslashes (Git Bash expands them, and `$`), and anywhere a build or test piped into a
 * filter without pipefail (the pipe's exit code is the filter's: a failure reads as a success). Null otherwise.
 */
export function shellTrap(tool: string, input: Readonly<Record<string, unknown>>, platform: Platform): 'heredoc' | 'pipe' | null {
  if (shellOf(tool) !== 'bash') return null;
  const command = String(input.command ?? '');
  const script = parseBash(command);
  if (platform === 'win32' && script.commands.some((c) => c.heredocs.some((h) => h.expands && h.body.includes('\\')))) return 'heredoc';
  if (/\bpipefail\b/.test(command)) return null;
  for (let i = 1; i < script.commands.length; i++) {
    const cur = script.commands[i]!;
    const prev = script.commands[i - 1]!;
    const first = prev.argv[0]?.text ?? '';
    if (cur.piped && FILTER.has(programName(cur.argv[0]?.text ?? '')) && RUNNER.test(programName(first))) return 'pipe';
  }
  return null;
}

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
