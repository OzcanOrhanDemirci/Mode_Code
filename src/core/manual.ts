// SPDX-License-Identifier: Apache-2.0
/**
 * What Manual promises the person (docs/modes.md, "Ways of working"): a commit and a push wait for them, whatever
 * else lets the command through, so that working step by step means the work leaves the step only on their word.
 * Pure: the in-process plugin uses it.
 */
import { parseGit } from './belt/git.js';
import type { PathEnv } from './paths.js';
import { analyzeCommand } from './shell/analyze.js';

export type Promised = 'commit' | 'push';

/** The commits and pushes a shell command makes, in the order it makes them, each once. */
export function promisedIn(command: string, dialect: 'bash' | 'powershell', env: PathEnv): Promised[] {
  const out: Promised[] = [];
  for (const inv of analyzeCommand(command, dialect).invocations) {
    if (inv.program !== 'git') continue;
    const sub = parseGit(inv.args, inv.dynamic, env).sub;
    if ((sub === 'commit' || sub === 'push') && !out.includes(sub)) out.push(sub);
  }
  return out;
}
