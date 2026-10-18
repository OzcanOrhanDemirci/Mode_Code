// SPDX-License-Identifier: Apache-2.0
/**
 * Permission fatigue (A3-5 of 1.2.0): Claude Code asks about a compound command (`cd app && npm test`, `npm run
 * build && npm test`) even when the person allowed each of its parts. A command whose every part an allow rule
 * covers is what the person said yes to already. Pure: the plugin reads the rules and answers (src/mod/register.ts).
 */
import { analyzeCommand } from './shell/analyze.js';
import { isUnder, pathKey, resolvePath, type PathEnv } from './paths.js';

/** The person's allow rules for one shell tool, from Claude Code's `permissions.allow` (`Bash(npm test:*)`). */
export interface ShellRules {
  /** A bare `Bash`: every command. */
  all: boolean;
  exact: Set<string>;
  /** `Bash(npm run test:*)` and `Bash(npm run test *)`: commands that start with it, at a word's end. */
  prefixes: string[];
}

export function shellRules(allow: readonly unknown[], tool: 'Bash' | 'PowerShell'): ShellRules {
  const rules: ShellRules = { all: false, exact: new Set(), prefixes: [] };
  for (const r of allow) {
    if (typeof r !== 'string') continue;
    if (r === tool) rules.all = true;
    if (!r.startsWith(`${tool}(`) || !r.endsWith(')')) continue;
    const body = r.slice(tool.length + 1, -1).trim();
    if (body === '*' || body === '') rules.all = true;
    else if (body.endsWith(':*')) rules.prefixes.push(body.slice(0, -2).trim());
    else if (body.endsWith(' *')) rules.prefixes.push(body.slice(0, -2).trim());
    else if (!body.includes('*')) rules.exact.add(body);
  }
  return rules;
}

function covered(part: string, rules: ShellRules): boolean {
  const p = part.trim().replace(/\s+/g, ' ');
  return rules.all || rules.exact.has(p) || rules.prefixes.some((x) => p === x || p.startsWith(`${x} `));
}

/**
 * Whether every part of a compound command is one an allow rule covers. A `cd` into the project (or a folder in it)
 * is no part of its own: it only says where the rest runs. Anything the reading cannot follow, a nested command or a
 * redirect into a file, is not covered: those are asked as before.
 */
export function partsAllowed(command: string, dialect: 'bash' | 'powershell', rules: ShellRules, project: string, env: PathEnv): boolean {
  if (rules.all) return true;
  const a = analyzeCommand(command, dialect);
  if (a.issues.length || a.invocations.length < 2) return false;
  let parts = 0;
  for (const inv of a.invocations) {
    if (inv.via.length || inv.writes.length || inv.programDynamic) return false;
    if (inv.program === 'cd' || inv.program === 'set-location' || inv.program === 'pushd') {
      const dir = inv.args.find((x) => !x.startsWith('-'));
      if (!dir || inv.dynamic.some(Boolean)) return false;
      const to = resolvePath(dir, env);
      if (pathKey(to, env.platform) !== pathKey(project, env.platform) && !isUnder(to, project, env.platform)) return false;
      continue;
    }
    if (!covered(inv.raw, rules)) return false;
    parts++;
  }
  return parts > 0;
}
