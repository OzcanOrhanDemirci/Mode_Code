// SPDX-License-Identifier: Apache-2.0
/**
 * The footer lines under each answer: whether memory was pushed, whether anything changed, and quota
 * when it matters. Computed by code from facts, never guessed by the model.
 *
 * Two ways to show them (a setting): the mod draws them under the answer (`turn.complete`), or the model
 * writes them and the Stop hook checks them against these values. The second exists because a line drawn
 * by the interface does not reach every surface (a phone following the session, a transcript export).
 */
import { analyzeCommand } from './shell/analyze.js';
import { parseGit } from './belt/git.js';
import { gitOnlyReads } from './shell/effects.js';
import { isFileTool, shellOf } from './belt/tools.js';
import { actsOutside } from './belt/tool-words.js';
import { resolvePath, isUnder, type PathEnv } from './paths.js';
import { tIn, type Lang } from './i18n/index.js';

export interface ToolUse {
  name: string;
  input: Readonly<Record<string, unknown>>;
}

export interface TurnActs {
  files: number;
  memoryFiles: number;
  settings: number;
  git: number;
  shell: number;
  external: number;
}

export interface ClassifyEnv extends PathEnv {
  memoryRoots: string[];
  /** Folders whose changes do not count as work (temporary and scratch folders). */
  ignore: string[];
}

const MUTATING_GIT =
  /^(?:add|rm|mv|checkout|switch|reset|rebase|merge|tag|stash|cherry-pick|apply|am|revert|clean|restore|pull|init|clone|worktree|branch|config|remote|submodule|filter-branch|filter-repo|update-ref|notes)$/;
const MUTATING_PROGRAMS = new Set([
  'rm',
  'mv',
  'cp',
  'mkdir',
  'rmdir',
  'touch',
  'tee',
  'ln',
  'chmod',
  'chown',
  'truncate',
  'dd',
  'install',
  'unlink',
  'shred',
  'rimraf',
  'remove-item',
  'move-item',
  'copy-item',
  'new-item',
  'rename-item',
  'set-content',
  'add-content',
  'out-file',
  'clear-content',
  'tee-object',
  'del',
  'erase',
  'rd',
  'copy',
  'move',
  'ren',
  'xcopy',
  'robocopy',
  'md',
]);
const VERBS = /^(?:i|install|add|rm|remove|uninstall|update|up|upgrade|link|unlink|publish|init|ci|dedupe|prune|reinstall|tap|untap|get)$/;
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'pip', 'pip3', 'winget', 'brew', 'choco', 'apt', 'apt-get', 'cargo', 'go', 'gem']);
const NULLS = new Set(['/dev/null', 'nul', '$null']);
const SETTINGS_FILE = /[/][.]claude[/]settings([.]local)?[.]json$/i;

function ignored(path: string, env: ClassifyEnv): boolean {
  if (NULLS.has(path.toLowerCase())) return true;
  const p = resolvePath(path, env);
  return env.ignore.some((d) => isUnder(p, resolvePath(d, env), env.platform));
}

/** What a shell command changes outside ignored folders: a commit or a push, staging for one (`git add`), anything else. */
export function shellChanges(command: string, dialect: 'bash' | 'powershell', env: ClassifyEnv): { git: boolean; staging: boolean; other: boolean } {
  const a = analyzeCommand(command, dialect);
  let git = false;
  let staging = false;
  let other = false;
  for (const inv of a.invocations) {
    if (inv.writes.some((w, i) => !inv.writeDynamic[i] && !ignored(w, env))) other = true;
    if (inv.program === 'git') {
      const call = parseGit(inv.args, inv.dynamic, env);
      if (call.sub === 'commit' || call.sub === 'push') git = true;
      else if (call.sub === 'add' || call.sub === 'stage') staging = true;
      else if (MUTATING_GIT.test(call.sub) && !gitOnlyReads(call.sub, call.args)) other = true;
      continue;
    }
    if (MUTATING_PROGRAMS.has(inv.program)) {
      const paths = inv.args.filter((x) => !x.startsWith('-'));
      if (!paths.length || !paths.every((x) => ignored(x, env))) other = true;
      continue;
    }
    if ((inv.program === 'sed' || inv.program === 'perl') && inv.args.some((x) => x.startsWith('-i'))) other = true;
    if (PACKAGE_MANAGERS.has(inv.program) && VERBS.test(inv.args[0] ?? '')) other = true;
    if ((inv.program === 'flutter' || inv.program === 'dart') && inv.args[0] === 'pub' && ['add', 'remove', 'upgrade'].includes(inv.args[1] ?? ''))
      other = true;
    if (
      (inv.program === 'docker' || inv.program === 'podman') &&
      ['run', 'rm', 'rmi', 'volume', 'system', 'compose', 'build', 'tag', 'push'].includes(inv.args[0] ?? '')
    )
      other = true;
  }
  return { git, staging, other };
}

/** Counts what a turn changed. Blind spot, stated: a script run as `node x.js` may write files unseen. */
export function classifyTurn(uses: readonly ToolUse[], env: ClassifyEnv): TurnActs {
  const acts: TurnActs = { files: 0, memoryFiles: 0, settings: 0, git: 0, shell: 0, external: 0 };
  const seen = new Set<string>();
  for (const u of uses) {
    const shell = shellOf(u.name);
    if (isFileTool(u.name)) {
      const raw = String(u.input.file_path ?? u.input.notebook_path ?? '');
      if (!raw || ignored(raw, env)) continue;
      const p = resolvePath(raw, env);
      const key = p.toLowerCase();
      if (seen.has(key)) continue; // 23 edits of 6 files are 6 files
      seen.add(key);
      if (SETTINGS_FILE.test(p)) acts.settings++;
      else if (env.memoryRoots.some((m) => isUnder(p, resolvePath(m, env), env.platform))) acts.memoryFiles++;
      else acts.files++;
    } else if (shell) {
      const r = shellChanges(String(u.input.command ?? ''), shell, env);
      if (r.git) acts.git++;
      if (r.other || r.staging) acts.shell++;
    } else if (u.name.startsWith('mcp__') && actsOutside(u.name)) {
      acts.external++;
    }
  }
  return acts;
}

export interface MemoryStatus {
  /** null when the person has no git-backed memory: the line is then hidden. */
  state: 'pushed' | 'dirty' | 'ahead' | 'unchanged' | 'noUpstream' | 'unknown' | null;
  count?: number;
}

export interface FooterFacts {
  memory: MemoryStatus;
  acts: TurnActs;
  five: number | null;
  week: number | null;
  weeklyTarget: number | null;
  showFiveFrom: number;
  showWeekFrom: number;
}

export interface FooterExpect {
  memory: 'yes' | 'no' | null;
  changed: boolean;
  five: number | null;
  week: { used: number; target: number | null } | null;
}

export interface Footer {
  lines: string[];
  expect: FooterExpect;
}

/**
 * What the lines look like after a turn that wrote two files with the five-hour quota at 83: shown where the person
 * chooses them. No memory line, as a first installation has no memory repository to push.
 */
export function sampleFooter(lang: Lang): string[] {
  const acts: TurnActs = { files: 2, memoryFiles: 0, settings: 0, git: 0, shell: 0, external: 0 };
  return buildFooter({ memory: { state: null }, acts, five: 83, week: null, weeklyTarget: null, showFiveFrom: 70, showWeekFrom: 85 }, lang).lines;
}

export function buildFooter(f: FooterFacts, lang: Lang): Footer {
  const lines: string[] = [];
  const yes = tIn(lang, 'footer.yes');
  const no = tIn(lang, 'footer.no');
  let memory: FooterExpect['memory'] = null;
  if (f.memory.state !== null) {
    const label = tIn(lang, 'footer.memory');
    if (f.memory.state === 'pushed') {
      lines.push(`${label}: ${yes}`);
      memory = 'yes';
    } else if (f.memory.state === 'unknown') {
      lines.push(`${label}: ${tIn(lang, 'footer.unknown')}`);
    } else {
      const why =
        f.memory.state === 'dirty'
          ? tIn(lang, 'footer.memory.dirty', { n: f.memory.count ?? 0 })
          : f.memory.state === 'ahead'
            ? tIn(lang, 'footer.memory.ahead', { n: f.memory.count ?? 0 })
            : f.memory.state === 'noUpstream'
              ? tIn(lang, 'footer.memory.noUpstream')
              : tIn(lang, 'footer.memory.unchanged');
      lines.push(`${label}: ${no} (${why})`);
      memory = 'no';
    }
  }
  const parts: string[] = [];
  const a = f.acts;
  const count = (key: 'footer.acts.files' | 'footer.acts.memory' | 'footer.acts.shell' | 'footer.acts.external', n: number) =>
    tIn(lang, n === 1 ? (`${key}.one` as const) : key, { n });
  if (a.files) parts.push(count('footer.acts.files', a.files));
  if (a.memoryFiles) parts.push(count('footer.acts.memory', a.memoryFiles));
  if (a.settings) parts.push(tIn(lang, 'footer.acts.settings'));
  if (a.git) parts.push(tIn(lang, 'footer.acts.git'));
  if (a.shell) parts.push(count('footer.acts.shell', a.shell));
  if (a.external) parts.push(count('footer.acts.external', a.external));
  const changedLabel = tIn(lang, 'footer.changed');
  lines.push(parts.length ? `${changedLabel}: ${yes} (${parts.join(', ')})` : `${changedLabel}: ${no}`);
  let five: number | null = null;
  if (f.five !== null && Math.round(f.five) >= f.showFiveFrom) {
    five = Math.round(f.five);
    lines.push(`${tIn(lang, 'footer.five')}: ${five}`);
  }
  let week: FooterExpect['week'] = null;
  if (f.week !== null) {
    const used = Math.round(f.week);
    if (f.weeklyTarget !== null) {
      week = { used, target: f.weeklyTarget };
      lines.push(`${tIn(lang, 'footer.week')}: ${used}/${f.weeklyTarget}`);
    } else if (used >= f.showWeekFrom) {
      week = { used, target: null };
      lines.push(`${tIn(lang, 'footer.week')}: ${used}`);
    }
  }
  return { lines, expect: { memory, changed: parts.length > 0, five, week } };
}

/**
 * Checks footer lines the model wrote against the computed ones. Returns the problems found ([] = right).
 * Memory must match exactly · "changed" must say yes when something changed (when nothing was seen, either
 * answer passes: scripts are a blind spot) · quota lines are required only when shown, within 2 points.
 * The lines must be among the last 8 non-empty lines; markdown emphasis around them is ignored.
 */
export function checkFooter(expect: FooterExpect, reply: string, lang: Lang): string[] {
  const tail = reply
    .split(/\r?\n/)
    .map((l) => l.replace(/[*_`]/g, '').trim())
    .filter(Boolean)
    .slice(-8);
  const find = (label: string): string | null => {
    for (const l of tail) if (l.toLowerCase().startsWith(label.toLowerCase() + ':')) return l.slice(label.length + 1).trim();
    return null;
  };
  const yes = tIn(lang, 'footer.yes').toLowerCase();
  const no = tIn(lang, 'footer.no').toLowerCase();
  const problems: string[] = [];
  const memLabel = tIn(lang, 'footer.memory');
  if (expect.memory !== null) {
    const v = find(memLabel);
    const said = v === null ? null : v.toLowerCase().startsWith(yes) ? 'yes' : v.toLowerCase().startsWith(no) ? 'no' : '?';
    if (said === null) problems.push(tIn(lang, 'footer.problem.missing', { label: memLabel }));
    else if (said !== expect.memory) problems.push(tIn(lang, 'footer.problem.memory', { label: memLabel, said: v!, want: expect.memory === 'yes' ? yes : no }));
  }
  const chLabel = tIn(lang, 'footer.changed');
  const ch = find(chLabel);
  if (ch === null) problems.push(tIn(lang, 'footer.problem.missing', { label: chLabel }));
  else if (expect.changed && !ch.toLowerCase().startsWith(yes)) problems.push(tIn(lang, 'footer.problem.changed', { label: chLabel }));
  const fiveLabel = tIn(lang, 'footer.five');
  if (expect.five !== null) {
    const v = find(fiveLabel);
    const n = v === null ? NaN : parseInt(v.replace('%', ''), 10);
    if (v === null) problems.push(tIn(lang, 'footer.problem.missingValue', { label: fiveLabel, value: expect.five }));
    else if (!(Math.abs(n - expect.five) <= 2)) problems.push(tIn(lang, 'footer.problem.value', { label: fiveLabel, said: v, value: expect.five }));
  }
  const weekLabel = tIn(lang, 'footer.week');
  if (expect.week !== null) {
    const v = find(weekLabel);
    const want = expect.week.target !== null ? `${expect.week.used}/${expect.week.target}` : String(expect.week.used);
    const m = v === null ? null : /^%?(\d+)(?:\s*[/]\s*(\d+))?/.exec(v);
    if (v === null) problems.push(tIn(lang, 'footer.problem.missingValue', { label: weekLabel, value: want }));
    else if (!m || Math.abs(parseInt(m[1]!, 10) - expect.week.used) > 2 || (expect.week.target !== null && parseInt(m[2] ?? '-1', 10) !== expect.week.target))
      problems.push(tIn(lang, 'footer.problem.value', { label: weekLabel, said: v, value: want }));
  }
  return problems;
}
