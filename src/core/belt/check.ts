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
import { isProtectedBranch, looksLikeUrl, parseGit, planPush, remoteMatches } from './git.js';
import type { BeltContext, Finding, RuleId } from './types.js';

/** Issues that hide what runs: always worth asking about. */
const STRONG_UNCERTAIN = new Set(['eval-dynamic', 'encoded-command-undecodable', 'dynamic-shell-code', 'too-deep']);
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
}

function say(s: Scope, key: MessageKey, params?: Record<string, string | number>): string {
  const text = tIn(s.ctx.lang, key, params);
  return s.inline ? tIn(s.ctx.lang, 'belt.reason.inline', { reason: text }) : text;
}

function add(s: Scope, rule: RuleId, key: MessageKey, params?: Record<string, string | number>): void {
  s.findings.push({ rule, verdict: 'deny', reason: say(s, key, params) }); // verdict is set from the catalog later
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
  const crit = hitsCritical(t.path, paths, ctx.platform);
  if (crit) {
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
    add(s, 'fs.delete-git-dir', 'belt.reason.deleteGitDir', { target: show(t.path) });
    return;
  }
  if (isUnder(t.path, paths.canonical(claudeDir(ctx)), ctx.platform)) {
    add(s, 'fs.delete-outside-project', 'belt.reason.deleteInClaudeDir', { target: show(t.path) });
    return;
  }
  if (!recursive || insideAProject(t.path, project, ctx, paths)) return;
  if (homeIsProject(project, ctx, paths)) add(s, 'fs.delete-outside-project', 'belt.reason.deleteOutsideProjects', { target: show(t.path) });
  else add(s, 'fs.delete-outside-project', 'belt.reason.deleteOutside', { target: show(t.path), project: show(project) });
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
  if (crit) add(s, 'fs.move-critical', 'belt.reason.moveCritical', { target: show(t.path), critical: show(crit) });
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
  if (under(p, paths.memoryDirs, ctx.platform) && (kind === 'truncate' || kind === 'replace'))
    add(s, 'self.memory-shrink', 'belt.reason.memoryOverwrite', { target: show(p) });
}

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

async function checkInvocation(inv: Invocation, cwd: string | null, s: Scope, dialect: Dialect): Promise<void> {
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
  for (const kv of call.config) if (/^core\.hookspath=/i.test(kv)) add(s, 'git.hooks-path', 'belt.reason.hooksPath', { command: show(inv.raw) });
  const a = call.args;
  const has = (...flags: string[]) => a.some((x) => flags.includes(x));
  const protectedBranches = cfg.protectedBranches?.length ? cfg.protectedBranches : ['main', 'master'];

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
      for (const t of plan.targets) {
        const branchLabel = t.dst ?? tIn(ctx.lang, 'belt.word.currentBranchUnknown');
        const prot = t.dst === null ? false : isProtectedBranch(t.dst, protectedBranches);
        if (t.delete) {
          if (prot || t.dst === null) add(s, 'git.delete-remote-branch-protected', 'belt.reason.deleteRemoteProtected', { branch: branchLabel });
          else add(s, 'git.delete-remote-branch', 'belt.reason.deleteRemote', { branch: branchLabel });
          continue;
        }
        if (t.force) {
          if (prot || t.dst === null) add(s, 'git.force-push-protected', 'belt.reason.forcePushProtected', { branch: branchLabel });
          else add(s, 'git.force-push', 'belt.reason.forcePush', { branch: branchLabel });
        }
        if (prOnly && (prot || t.dst === null)) add(s, 'git.push-pr-only', 'belt.reason.prOnly', { branch: branchLabel, remote: remoteUrl ?? '?' });
      }
      break;
    }
    case 'branch': {
      const forceDelete = has('-D') || (has('-d', '--delete') && has('-f', '--force')) || a.some((x) => /^-[a-zA-Z]*D/.test(x));
      if (forceDelete) {
        add(s, inMemory ? 'self.memory-history' : 'git.branch-force-delete', inMemory ? 'belt.reason.memoryHistory' : 'belt.reason.branchForceDelete', {
          command: show(inv.raw),
        });
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
        add(s, 'git.discard-work', 'belt.reason.discardWork', { command: show(inv.raw) });
      break;
    }
    case 'worktree':
      if (a[0] === 'add' && a.includes('-b') && dir && ctx.git && remoteMatches(await ctx.git.remoteUrl(dir), cfg.singleBranchRepos))
        add(s, 'git.single-branch', 'belt.reason.singleBranch', { branch: a[a.indexOf('-b') + 1] ?? '?' });
      break;
    case 'reset':
      if (has('--hard', '--merge', '--keep'))
        add(s, inMemory ? 'self.memory-history' : 'git.discard-work', inMemory ? 'belt.reason.memoryHistory' : 'belt.reason.discardWork', {
          command: show(inv.raw),
        });
      break;
    case 'restore':
      if (!has('--staged', '-S') || has('--worktree', '-W')) add(s, 'git.discard-work', 'belt.reason.discardWork', { command: show(inv.raw) });
      break;
    case 'stash':
      if (a[0] === 'drop' || a[0] === 'clear') add(s, 'git.discard-work', 'belt.reason.discardWork', { command: show(inv.raw) });
      break;
    case 'clean': {
      const dry = a.some((x) => x === '-n' || x === '--dry-run' || /^-[a-zA-Z]*n/.test(x));
      const forced = a.some((x) => x === '--force' || /^-[a-zA-Z]*f/.test(x));
      if (forced && !dry)
        add(s, inMemory ? 'self.memory-history' : 'git.clean', inMemory ? 'belt.reason.memoryHistory' : 'belt.reason.clean', { command: show(inv.raw) });
      break;
    }
    case 'filter-branch':
    case 'filter-repo':
    case 'replace':
      add(s, inMemory ? 'self.memory-history' : 'git.history-rewrite', inMemory ? 'belt.reason.memoryHistory' : 'belt.reason.historyRewrite', {
        command: show(inv.raw),
      });
      break;
    case 'update-ref':
      if (has('-d', '--delete'))
        add(s, inMemory ? 'self.memory-history' : 'git.history-rewrite', inMemory ? 'belt.reason.memoryHistory' : 'belt.reason.historyRewrite', {
          command: show(inv.raw),
        });
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
      if (i !== -1 && !has('--get', '--get-all', '-l', '--list', '--show-origin'))
        add(s, 'git.hooks-path', 'belt.reason.hooksPath', { command: show(inv.raw) });
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
  /^(?:\.env(?:\..+)?|.*\.(?:pem|key|p12|pfx|jks|keystore|ppk|asc)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|credentials(?:\.json)?|service-account.*\.json|\.npmrc|\.pypirc|\.netrc|\.git-credentials|secrets?\.(?:json|ya?ml|toml))$/i;

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
  if (p === 'eas' && (first === 'submit' || a.includes('--auto-submit'))) return dep();
  if (p === 'fastlane' || (p === 'xcrun' && first === 'altool' && a.some((x) => x.includes('upload')))) return dep();
  if (p === 'gcloud' && a.includes('deploy')) return dep();
}

/** Best effort for code passed to interpreters (node -e, python -c): string literals that are commands or protected paths. */
async function checkInlineCode(inv: Invocation, cwd: string | null, s: Scope): Promise<void> {
  const code = inv.inlineCode ?? '';
  const literals = [...code.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.)*)`/g)].map((m) =>
    (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1'),
  );
  const inner: Scope = { ...s, inline: true };
  for (const lit of literals) {
    if (/^\s*(?:git|rm|del|rd|rmdir|remove-item|docker|claude|schtasks|crontab|sudo|bash|sh|pwsh|powershell|cmd|npm|gh)\s/i.test(lit))
      await evaluateScript(lit, 'bash', inner, cwd);
  }
  const deletes = /\b(?:rmSync|rmdirSync|unlinkSync|rm|rmdir|unlink|rimraf|rmtree|remove|removedirs|rm_rf|rm_r|deleteSync|delete)\s*\(/.test(code);
  const writes =
    /\b(?:writeFileSync|appendFileSync|writeFile|appendFile|write_text|write_bytes|copyFileSync|copyFile|renameSync|rename|move|copy|copyfile|copy2|copytree|open)\s*\(/.test(
      code,
    );
  if (!deletes && !writes) return;
  for (const lit of literals) {
    if (!/^(?:[A-Za-z]:[\\/]|[\\/]|~|\.{1,2}[\\/])/.test(lit) || lit.length < 2) continue;
    const t = target({ text: lit, dynamic: false, glob: /[*?]/.test(lit) }, cwd, inner);
    if (deletes) checkDelete(t, true, inner);
    if (writes) checkWrite(t, 'replace', inner);
  }
}

/** Mentions of disableAllHooks in a command that changes something. */
function checkDisableHooks(raw: string, invs: readonly Invocation[], s: Scope): void {
  if (!/disableAllHooks|allowManagedHooksOnly/i.test(raw)) return;
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
  const strong = analysis.issues.filter((i) => STRONG_UNCERTAIN.has(i));
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
  // A secret belongs in a secret store (.env, a key file), not in source, notes or memory.
  if (t.path && !SECRET_FILE.test(t.path.split('/').pop() ?? '')) {
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
  return s.findings;
}
