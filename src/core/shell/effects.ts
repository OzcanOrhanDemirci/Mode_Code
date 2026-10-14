// SPDX-License-Identifier: Apache-2.0
/**
 * What a shell command does to the machine, program by program, in five classes: it only reads; it writes
 * files it names; it changes things around the folder it runs in (or runs code that may); it changes
 * something outside the machine or outside any folder (a push, a global install, a container); or the tool
 * does not know. The restricted modes (chat, research, plan) run only what they can place.
 *
 * Built on the same analysis as the safety belt (shell/analyze.ts): wrappers, interpreters, script blocks
 * and substitutions are followed, and the folder each program runs in is tracked through `cd`. Knowledge is
 * a list: a program not in it is "unknown", never assumed to read. Pure.
 */
import { analyzeCommand, psNamed, type Invocation } from './analyze.js';
import { expandVars } from './vars.js';
import type { Dialect, Word } from './types.js';
import { resolvePath, type PathEnv } from '../paths.js';
import { parseGit } from '../belt/git.js';

export type EffectKind = 'read' | 'write' | 'local' | 'outside' | 'unknown';

/** Why a program is in its class. */
export const WHY_CODES = [
  'reads',
  'readsNetwork',
  'keyword',
  'expression',
  'function',
  'givenCode',
  'emptyTemp',
  'writes',
  'editsInPlace',
  'download',
  'local',
  'downloadHere',
  'runsCode',
  'script',
  'scriptFile',
  'folderProgram',
  'repo',
  'clone',
  'archive',
  'findDeletes',
  'outside',
  'push',
  'gitGlobal',
  'server',
  'publish',
  'global',
  'system',
  'elevated',
  'unknown',
  'dynamicProgram',
  'dotnet',
  'scriptMay',
  'findRuns',
] as const;
export type WhyCode = (typeof WHY_CODES)[number];

/** Severity order: a command is as strong as its strongest program. */
export const EFFECT_ORDER: readonly EffectKind[] = ['read', 'write', 'local', 'outside', 'unknown'];

export interface Effect {
  /** The program as the analysis names it (lower case, PowerShell aliases resolved). */
  program: string;
  /** The source text of the simple command. */
  raw: string;
  kind: EffectKind;
  /** Files written, resolved; null for a target only known at run time. */
  targets: (string | null)[];
  /** The folder the program runs in (or the repository git works on), resolved; null when unknown. */
  cwd: string | null;
  /** Why it is in its class, as a code the interface words in each language (`mode.why.<code>`). */
  why: WhyCode;
}

export interface CommandEffects {
  effects: Effect[];
  /** Why the analysis may be incomplete (unterminated quote, dynamic code, …); empty when every part was followed. */
  issues: string[];
}

export interface EffectEnv extends PathEnv {
  /** Environment variables, for paths written with $TMPDIR, %TEMP%, $env:TEMP. */
  env: Readonly<Record<string, string | undefined>>;
}

const NULL_TARGETS = /^(?:\/dev\/(?:null|stdout|stderr|tty|fd\/\d+)|nul|\$null|con)$/i;

/** A table's own entry: a program named "__proto__" or "constructor" finds nothing, not Object's members. */
function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** A set from words separated by spaces or line breaks: the lists below stay readable. */
function wordSet(list: string): Set<string> {
  return new Set(list.split(/\s+/).filter(Boolean));
}

// ── what is known ─────────────────────────────────────────────────────────────────────────────────────

/** Programs that only read, whatever their arguments (redirections are judged separately). */
const READS = new Set([
  // files and text
  'ls',
  'dir',
  'vdir',
  'tree',
  'cat',
  'tac',
  'head',
  'tail',
  'less',
  'more',
  'most',
  'bat',
  'batcat',
  'wc',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'ag',
  'ack',
  'cut',
  'tr',
  'join',
  'paste',
  'column',
  'fold',
  'fmt',
  'nl',
  'expand',
  'unexpand',
  'rev',
  'comm',
  'diff',
  'cmp',
  'sdiff',
  'colordiff',
  'od',
  'hexdump',
  'strings',
  'file',
  'stat',
  'md5sum',
  'sha1sum',
  'sha224sum',
  'sha256sum',
  'sha384sum',
  'sha512sum',
  'shasum',
  'cksum',
  'b2sum',
  'base64',
  'base32',
  'jq',
  'gojq',
  'xmllint',
  'envsubst',
  'look',
  'numfmt',
  'tsort',
  'factor',
  'bc',
  'expr',
  'seq',
  'basename',
  'dirname',
  'realpath',
  'readlink',
  'pwd',
  'du',
  'df',
  'locate',
  'findstr',
  'zcat',
  'zgrep',
  'bzcat',
  'xzcat',
  'lsof',
  'tput',
  'cloc',
  'tokei',
  'scc',
  // shell, lookups and the system as it stands
  'echo',
  'printf',
  'true',
  'false',
  ':',
  'test',
  '[',
  '[[',
  'sleep',
  'wait',
  'exit',
  'return',
  'type',
  'which',
  'whereis',
  'where',
  'hash',
  'alias',
  'history',
  'declare',
  'typeset',
  'local',
  'readonly',
  'export',
  'unset',
  'let',
  'shopt',
  'read',
  'set',
  'ulimit',
  'umask',
  'trap',
  'whoami',
  'id',
  'groups',
  'users',
  'who',
  'w',
  'last',
  'cal',
  'uname',
  'arch',
  'nproc',
  'env',
  'printenv',
  'tty',
  'uptime',
  'free',
  'ps',
  'pgrep',
  'lscpu',
  'lsblk',
  'lsusb',
  'lspci',
  'vmstat',
  'iostat',
  'sw_vers',
  'system_profiler',
  'systeminfo',
  'ver',
  'vol',
  'tasklist',
  'netstat',
  'ss',
  'ipconfig',
  'getconf',
  'locale',
  'cls',
  'clear',
  'title',
  'cygpath',
  'wslpath',
  'nslookup',
  'dig',
  'host',
  'ping',
  'traceroute',
  'tracert',
  'whois',
  'man',
  'info',
  'apropos',
  'help',
  'time',
  'jobs',
  'disown',
  'dirs',
  'ffprobe',
  'identify',
  'nvidia-smi',
  'pdfinfo',
  'pdffonts',
  'javap',
  'mediainfo',
  // PowerShell
  'select-string',
  'measure-object',
  'select-object',
  'where-object',
  'foreach-object',
  'sort-object',
  'group-object',
  'compare-object',
  'out-string',
  'out-host',
  'out-null',
  'out-default',
  'write-output',
  'write-host',
  'write-verbose',
  'write-information',
  'write-warning',
  'write-error',
  'write-debug',
  'write-progress',
  'join-path',
  'split-path',
  'test-path',
  'resolve-path',
  'convert-path',
  'measure-command',
  'test-connection',
  'test-json',
  'select-xml',
  'start-sleep',
  'new-object',
  'add-type',
  'import-module',
  'set-variable',
  'new-variable',
  'clear-variable',
  'remove-variable',
  'set-strictmode',
  'out-gridview',
]);

/** Programs that are only known by their version or help when asked for nothing else. */
const VERSION_ONLY = wordSet(`--version -version version --help -h help -V /? -?`);

/** Subcommands that only read, per program (first argument after global options). */
const READ_SUBS: Record<string, ReadonlySet<string>> = {
  npm: wordSet(`
    view v info show ls list ll la outdated search s help help-search root prefix bin whoami ping explain why query fund docs repo bugs diff
    sbom
  `),
  pnpm: wordSet(`view info ls list ll outdated search help root bin why licenses store`),
  yarn: wordSet(`info list outdated why help licenses npm`),
  bun: wordSet(`pm`),
  pip: wordSet(`list show freeze check search help inspect index debug`),
  pip3: wordSet(`list show freeze check search help inspect index debug`),
  cargo: wordSet(`tree metadata search locate-project pkgid read-manifest help verify-project`),
  go: wordSet(`version list doc help`),
  flutter: wordSet(`doctor devices emulators channel help config`),
  dart: wordSet(`help info`),
  docker: wordSet(`ps images image inspect logs version info stats top port history events diff search`),
  podman: wordSet(`ps images inspect logs version info stats top port history events diff search`),
  kubectl: wordSet(`get describe logs version explain top api-resources api-versions cluster-info auth`),
  brew: wordSet(`list ls info search outdated deps uses leaves config doctor home desc commands shellenv --prefix --cellar --repository`),
  winget: wordSet(`list search show source features hash`),
  choco: wordSet(`list search info outdated`),
  scoop: wordSet(`list search info status which prefix home cat checkup`),
  apt: wordSet(`list show search policy depends rdepends`),
  'apt-cache': wordSet(`show search policy depends rdepends showpkg madison stats`),
  dpkg: wordSet(`-l -L -s -S --list --listfiles --status --search --print-architecture`),
  rustup: wordSet(`show which help`),
  nvm: wordSet(`ls list current ls-remote which version`),
  terraform: wordSet(`show validate version output providers graph`),
  claude: wordSet(`--version -v doctor`),
  code: wordSet(`--list-extensions --version --help --status`),
  gcloud: wordSet(`info version help`),
  az: wordSet(`version account`),
  uv: wordSet(`tree help version`),
  poetry: wordSet(`show check help about search env`),
  composer: wordSet(`show info outdated depends why why-not search licenses validate diagnose`),
  gem: wordSet(`list search info specification environment contents which help`),
  dotnet: wordSet(`--info --list-sdks --list-runtimes list --version help`),
  java: wordSet(`-version --version -help`),
  reg: wordSet(`query`),
  adb: wordSet(`devices version get-state get-serialno get-devpath help`),
  tailscale: wordSet(`status ip version netcheck ping whois dns`),
  aapt: wordSet(`dump list l d version v`),
  aapt2: wordSet(`dump version`),
  apksigner: wordSet(`verify version help`),
  defaults: wordSet(`read domains read-type find`),
  launchctl: wordSet(`list print`),
  systemctl: wordSet(`status list-units list-unit-files is-active is-enabled show cat`),
  powercfg: wordSet(`/list /query /l /q -list -query`),
  wsl: wordSet(`--list -l --status --version -v`),
  schtasks: wordSet(`/query`),
};

/** Second words that keep a first word reading: `npm config get`, `git stash list`, `docker compose ps`. */
const READ_PAIRS: Record<string, ReadonlySet<string>> = {
  'npm config': wordSet(`get list ls`),
  'pnpm config': wordSet(`get list`),
  'yarn config': wordSet(`get list`),
  'bun pm': wordSet(`ls hash cache bin`),
  'cargo help': new Set([]),
  'flutter pub': wordSet(`deps outdated`),
  'dart pub': wordSet(`deps outdated`),
  'docker compose': wordSet(`ps logs config ls images top version port`),
  'docker image': wordSet(`ls list inspect history`),
  'docker container': wordSet(`ls list inspect logs top port diff stats`),
  'docker volume': wordSet(`ls list inspect`),
  'docker network': wordSet(`ls list inspect`),
  'kubectl config': wordSet(`view current-context get-contexts get-clusters get-users`),
  'claude mcp': wordSet(`list get`),
  'claude plugin': wordSet(`list validate`),
  'claude config': wordSet(`get list`),
  'gh auth': wordSet(`status`),
  'gh pr': wordSet(`view list diff checks status`),
  'gh issue': wordSet(`view list status`),
  'gh repo': wordSet(`view list`),
  'gh run': wordSet(`view list watch`),
  'gh release': wordSet(`view list`),
  'gh workflow': wordSet(`view list`),
  'gh search': wordSet(`repos issues prs code commits`),
  'gh gist': wordSet(`view list`),
  'gh label': wordSet(`list`),
  'gh secret': wordSet(`list`),
  'gh variable': wordSet(`list get`),
  'gh cache': wordSet(`list`),
  'gh ruleset': wordSet(`list view check`),
  'gh status': new Set([]),
  'gh browse': new Set([]),
  'az account': wordSet(`show list`),
  'gcloud config': wordSet(`list get-value`),
  'poetry env': wordSet(`info list`),
  'rustup toolchain': wordSet(`list`),
  'uv pip': wordSet(`list show freeze tree check`),
  'uv python': wordSet(`list find dir`),
  'cargo metadata': new Set([]),
};

/** Programs that change something outside the machine or outside any project folder, whatever they are asked. */
const OUTSIDE = wordSet(`
  ssh scp sftp rsync ftp telnet nc ncat kill pkill killall taskkill stop-process shutdown reboot halt poweroff restart-computer stop-computer
  open xdg-open explorer invoke-item start-process crontab at sc service set-service start-service stop-service restart-service new-service
  register-scheduledtask unregister-scheduledtask set-executionpolicy setx set-itemproperty new-itemproperty remove-itemproperty osascript
  notify-send say mail sendmail heroku vercel netlify firebase wrangler fly flyctl railway eas fastlane twine aws gsutil start-job
  invoke-command enter-pssession new-pssession send-mailmessage mount umount diskpart format mkfs fdisk parted useradd userdel passwd chpasswd
  visudo iptables ufw netsh route nmcli systemctl brew winget choco scoop apt apt-get dpkg dnf yum pacman snap flatpak port nvm fnm volta rustup
  sdk asdf pyenv rbenv docker podman kubectl helm terraform pulumi gcloud az gh glab reg defaults launchctl powercfg schtasks wsl claude code
  cursor pm2 supervisorctl adb fastboot emulator tailscale avdmanager sdkmanager xcrun simctl idevicesyslog
`);

/** Programs that run code or change files around the folder they run in. */
const LOCAL = wordSet(`
  npm pnpm yarn bun npx node deno tsx ts-node python python3 py pip pip3 pipx uv poetry pipenv conda ruby gem bundle rake rails php composer
  perl java javac gradle gradlew mvn kotlin kotlinc scala sbt dotnet msbuild cargo rustc go gcc g++ clang clang++ cc c++ make cmake ninja
  meson bazel flutter dart swift swiftc xcodebuild pod tsc esbuild vite webpack rollup parcel turbo nx lerna jest vitest mocha ava pytest tox
  nox eslint prettier biome stylelint black ruff isort mypy pylint flake8 rubocop gofmt rustfmt clippy-driver playwright cypress storybook
  next nuxt astro remix expo react-native ng vue-cli-service source . bash sh zsh dash ksh fish pwsh powershell cmd invoke-pester tar zip
  unzip gzip gunzip bzip2 xz 7z patch git-lfs pre-commit husky hyperfine ffmpeg magick convert sqlite3 psql mysql redis-cli mongosh protoc
  openssl ssh-keygen gpg certutil expand-archive compress-archive invoke-expression mklink icacls attrib takeown wget curl invoke-webrequest
  invoke-restmethod yq awk gawk mawk nawk sed xxd iconv sort uniq find fd aapt aapt2 apksigner pdftoppm pdftocairo gitleaks
`);

/** Programs whose job is to change named files; the file arguments are the targets. */
const WRITERS = wordSet(`
  rm rmdir del erase rd unlink shred rimraf trash mkdir md touch truncate chmod chown chgrp mv move ren rename cp copy xcopy robocopy ln tee
  install dd
`);

/** PowerShell cmdlets that change files, with the parameters that name them. */
const PS_WRITERS: Record<string, { names: Record<string, string>; positional: string[]; targets: string[] }> = {
  'set-content': {
    names: P('path literalpath value encoding filter include exclude stream delimiter credential'),
    positional: ['path', 'value'],
    targets: ['path', 'literalpath'],
  },
  'add-content': {
    names: P('path literalpath value encoding filter include exclude stream credential'),
    positional: ['path', 'value'],
    targets: ['path', 'literalpath'],
  },
  'clear-content': { names: P('path literalpath filter include exclude stream credential'), positional: ['path'], targets: ['path', 'literalpath'] },
  'out-file': { names: P('filepath literalpath encoding width inputobject'), positional: ['filepath', 'encoding'], targets: ['filepath', 'literalpath'] },
  'tee-object': { names: P('filepath literalpath variable inputobject encoding'), positional: ['filepath'], targets: ['filepath', 'literalpath'] },
  'new-item': { names: P('path name itemtype value literalpath credential'), positional: ['path'], targets: ['path', 'literalpath'] },
  'remove-item': { names: P('path literalpath filter include exclude credential stream'), positional: ['path'], targets: ['path', 'literalpath'] },
  'move-item': {
    names: P('path literalpath destination filter include exclude credential'),
    positional: ['path', 'destination'],
    targets: ['path', 'literalpath', 'destination'],
  },
  'copy-item': {
    names: P('path literalpath destination filter include exclude credential fromsession tosession'),
    positional: ['path', 'destination'],
    targets: ['destination'],
  },
  'rename-item': { names: P('path literalpath newname credential'), positional: ['path', 'newname'], targets: ['path', 'literalpath'] },
  'set-item': { names: P('path literalpath value filter include exclude credential'), positional: ['path', 'value'], targets: ['path', 'literalpath'] },
  'clear-item': { names: P('path literalpath filter include exclude credential'), positional: ['path'], targets: ['path', 'literalpath'] },
  'export-csv': { names: P('path literalpath inputobject delimiter encoding'), positional: ['path'], targets: ['path', 'literalpath'] },
  'export-clixml': { names: P('path literalpath inputobject depth encoding'), positional: ['path'], targets: ['path', 'literalpath'] },
};

function P(list: string): Record<string, string> {
  return Object.fromEntries(list.split(' ').map((k) => [k, k]));
}

/** git subcommands that only read (listing forms of others are judged by gitReads). */
const GIT_READS = new Set([
  'status',
  'log',
  'diff',
  'show',
  'blame',
  'annotate',
  'shortlog',
  'describe',
  'rev-parse',
  'rev-list',
  'ls-files',
  'ls-tree',
  'ls-remote',
  'cat-file',
  'grep',
  'show-ref',
  'for-each-ref',
  'name-rev',
  'merge-base',
  'cherry',
  'range-diff',
  'whatchanged',
  'count-objects',
  'fsck',
  'check-ignore',
  'check-attr',
  'check-ref-format',
  'check-mailmap',
  'var',
  'help',
  'version',
  'diff-tree',
  'diff-index',
  'diff-files',
  'show-branch',
  'verify-commit',
  'verify-tag',
  'verify-pack',
  '',
  'show-index',
  'get-tar-commit-id',
]);
const GIT_OUTSIDE = wordSet(`push send-email svn p4 daemon instaweb credential credential-store`);

/**
 * `git config` reads unless it is given a value or an action that changes: one key reads it, whatever the scope
 * (`--global user.email`), and so do --get…, --list and the `get`/`list` subcommands; a key with a value, --add,
 * --unset…, --replace-all, --rename-section, --remove-section, --edit and the `set`/`unset`/… subcommands change.
 * Options that take a value (--file .gitmodules) are skipped with it, so the value is not taken for a key.
 */
function gitConfigReads(args: readonly string[]): boolean {
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (/^(?:-f|--file|--blob|--type|--default|--comment)$/.test(a)) {
      i++;
      continue;
    }
    if (/^(?:--get|--get-all|--get-regexp|--get-urlmatch|--get-color|--get-colorbool|--list|-l)$/.test(a)) return true;
    if (/^(?:--add|--unset|--unset-all|--replace-all|--rename-section|--remove-section|-e|--edit)$/.test(a)) return false;
    if (!a.startsWith('-')) rest.push(a);
  }
  if (['get', 'list'].includes(rest[0] ?? '')) return true;
  if (['set', 'unset', 'rename-section', 'remove-section', 'edit'].includes(rest[0] ?? '')) return false;
  return rest.length <= 1;
}

/** Listing and showing forms of otherwise changing git subcommands: `git branch -a`, `git remote -v`, … */
export function gitOnlyReads(sub: string, args: readonly string[]): boolean {
  const words = args.filter((a) => !a.startsWith('-'));
  const flags = args.filter((a) => a.startsWith('-'));
  switch (sub) {
    // Without a name, or with a listing flag, these only list.
    case 'branch':
      return (
        words.length === 0 || flags.some((f) => /^(?:-l|--list|-a|--all|-r|--remotes|--contains|--merged|--no-merged|--points-at|--show-current)$/.test(f))
      );
    case 'tag':
      return words.length === 0 || flags.some((f) => /^(?:-l|--list|--contains|--merged|--no-merged|--points-at)$/.test(f));
    case 'remote':
      return words.length === 0 || ['show', 'get-url'].includes(words[0]!);
    case 'config':
      return gitConfigReads(args);
    case 'stash':
    case 'worktree':
    case 'notes':
      return ['list', 'show'].includes(words[0] ?? '');
    case 'submodule':
      return words.length === 0 || words[0] === 'status';
    case 'reflog':
      return words.length === 0 || ['show', 'list', 'exists'].includes(words[0]!);
    case 'symbolic-ref':
      return words.length <= 1 && !flags.some((f) => /^(?:-d|--delete)$/.test(f));
    case 'archive':
      return !flags.some((f) => /^(?:-o|--output)(?:=|$)/.test(f));
    default:
      return false;
  }
}

// ── judging one program ───────────────────────────────────────────────────────────────────────────────

interface Judged {
  kind: EffectKind;
  targets: (string | null)[];
  why: WhyCode;
  /** For git: the repository folder, which replaces the working folder. */
  dir?: string | null;
}

function words(inv: Invocation): Word[] {
  return inv.args.map((text, i) => ({ text, dynamic: inv.dynamic[i] ?? false, glob: inv.glob[i] ?? false }));
}

/** Resolves an argument naming a file; null when only known at run time or relative to an unknown folder. */
function pathOf(w: Word | undefined, cwd: string | null, env: EffectEnv): string | null {
  if (!w) return null;
  let text = w.text;
  if (w.dynamic) {
    const e = expandVars(text, env.home, env.env);
    if (e === null) return null;
    text = e;
  }
  if (cwd === null && !/^(?:[A-Za-z]:[\\/]|[\\/]|~)/.test(text)) return null;
  return resolvePath(text, { platform: env.platform, home: env.home, cwd: cwd ?? env.cwd });
}

function positional(ws: readonly Word[]): Word[] {
  return ws.filter((w) => !(w.text.startsWith('-') && w.text.length > 1));
}

const R = (why: WhyCode = 'reads'): Judged => ({ kind: 'read', targets: [], why });
const L = (why: WhyCode = 'local'): Judged => ({ kind: 'local', targets: [], why });
const O = (why: WhyCode = 'outside'): Judged => ({ kind: 'outside', targets: [], why });
const U = (why: WhyCode = 'unknown'): Judged => ({ kind: 'unknown', targets: [], why });
const W = (targets: (string | null)[], why: WhyCode = 'writes'): Judged => ({ kind: 'write', targets, why });

function first(ws: readonly Word[]): string {
  return positional(ws)[0]?.text.toLowerCase() ?? '';
}

function hasFlag(ws: readonly Word[], re: RegExp): boolean {
  return ws.some((w) => re.test(w.text));
}

function judgeGit(inv: Invocation, cwd: string | null, env: EffectEnv): Judged {
  const call = parseGit(inv.args, inv.dynamic, { platform: env.platform, home: env.home, cwd: cwd ?? env.cwd });
  const dir = cwd === null && call.dir === (cwd ?? env.cwd) ? null : call.dir;
  if (GIT_OUTSIDE.has(call.sub)) return { ...O('push'), dir };
  if (call.sub === 'diff' && call.args.some((a) => /^--output(?:=|$)/.test(a))) return { ...L('writes'), dir };
  if (GIT_READS.has(call.sub) || gitOnlyReads(call.sub, call.args)) return { ...R(), dir };
  if (call.sub === 'config' && call.args.some((a) => a === '--global' || a === '--system')) return { ...O('gitGlobal'), dir };
  if (call.sub === 'clone') return { ...L('clone'), dir };
  return { ...L('repo'), dir };
}

/** `find` and `fd` read, unless they run another program or delete what they find. */
function judgeFind(inv: Invocation, cwd: string | null, env: EffectEnv): Judged {
  const ws = words(inv);
  if (inv.program === 'fd' || inv.program === 'fdfind') {
    const i = ws.findIndex((w) => /^(?:-x|--exec|-X|--exec-batch)$/.test(w.text));
    if (i === -1) return R();
    return subcommand(
      ws.slice(i + 1).filter((w) => w.text !== ';'),
      cwd,
      env,
      'findRuns',
    );
  }
  if (hasFlag(ws, /^-(?:delete|fprint0?|fprintf|fls)$/)) return L('findDeletes');
  const i = ws.findIndex((w) => /^-(?:exec|execdir|ok|okdir)$/.test(w.text));
  if (i === -1) return R();
  const end = ws.findIndex((w, j) => j > i && (w.text === ';' || w.text === '+' || w.text === '\\;'));
  const rest = ws.findIndex((w, j) => j > end && /^-(?:exec|execdir|ok|okdir)$/.test(w.text));
  if (end !== -1 && rest !== -1) return U('findRuns');
  return subcommand(
    ws.slice(i + 1, end === -1 ? undefined : end).filter((w) => w.text !== '{}'),
    cwd,
    env,
    'findRuns',
  );
}

/** A program named inside another's arguments (find -exec, fd -x): judged on its own words. */
function subcommand(ws: Word[], cwd: string | null, env: EffectEnv, why: WhyCode): Judged {
  const [prog, ...args] = ws;
  if (!prog || prog.dynamic) return U(why);
  const name = prog.text
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\.(exe|cmd|bat)$/, '');
  const inner = judge(
    {
      dialect: 'bash',
      program: name,
      args: args.map((w) => w.text),
      dynamic: args.map((w) => w.dynamic),
      glob: args.map((w) => w.glob),
      programDynamic: false,
      writes: [],
      writeAppend: [],
      writeDynamic: [],
      via: [],
      raw: ws.map((w) => w.text).join(' '),
    },
    cwd,
    env,
  );
  return inner.kind === 'read' ? inner : { ...inner, why };
}

function judgeSed(inv: Invocation, cwd: string | null, env: EffectEnv): Judged {
  const ws = words(inv);
  const inPlace = hasFlag(ws, /^(?:-i|--in-place)(?:=|$|\S)|^-[a-hj-zA-Z]*i/);
  const scripts: string[] = [];
  const files: Word[] = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    if (w.text === '-e' || w.text === '--expression') {
      scripts.push(ws[i + 1]?.text ?? '');
      i++;
    } else if (w.text === '-f' || w.text === '--file') return L('scriptFile');
    else if (!w.text.startsWith('-')) files.push(w);
  }
  if (!scripts.length && files.length) scripts.push(files.shift()!.text);
  // The commands `w file`, `W file` and `e command` write or run: after an address (a line number, `$`, a
  // pattern), after a substitution's flags, or at the start of a command (`1w out`, `s/a/b/gw out`, `/x/w out`).
  if (scripts.some((s) => /(?:^|[;}\n]|\/[gpIiMm0-9]*|[0-9$])\s*[wWe](?:\s|$)/.test(s))) return U('scriptMay');
  if (!inPlace) return R();
  return W(files.length ? files.map((f) => pathOf(f, cwd, env)) : [null], 'editsInPlace');
}

function judgeAwk(inv: Invocation, cwd: string | null, env: EffectEnv): Judged {
  const ws = words(inv);
  if (hasFlag(ws, /^-f$|^--file/)) return L('scriptFile');
  // gawk -i LIBRARY loads code this tool does not read; -i inplace rewrites the files.
  if (ws.some((w, j) => w.text === '-i' && !/inplace/.test(ws[j + 1]?.text ?? ''))) return L('scriptFile');
  const i = ws.findIndex((w, j) => w.text === '-i' && /inplace/.test(ws[j + 1]?.text ?? ''));
  // awk -i inplace PROGRAM FILE…: the files after the program are rewritten.
  if (i !== -1) {
    const files = positional(ws.filter((_, j) => j !== i + 1)).slice(1);
    return W(files.length ? files.map((f) => pathOf(f, cwd, env)) : [null], 'editsInPlace');
  }
  const script = positional(ws)[0]?.text ?? '';
  // Output redirection belongs to print and printf (a comparison `$3 > 5` does not write); system() and `| getline` run commands.
  if (/system\s*\(|\b(?:print|printf)\b[^;}]*(?:>>?|\|)\s*\S|\|\s*getline/.test(script)) return U('scriptMay');
  return R();
}

function judgeCurl(inv: Invocation, cwd: string | null, env: EffectEnv): Judged {
  const ws = words(inv);
  for (let i = 0; i < ws.length; i++) {
    const t = ws[i]!.text;
    if (/^(?:-d|--data|--data-\w+|-F|--form|--form-string|-T|--upload-file|--json)(?:=|$)/.test(t) || /^-[a-zA-Z]*[dFT]$/.test(t)) return O('server');
    if (/^(?:-X|--request)(?:=|$)/.test(t) || /^-[a-zA-Z]*X$/.test(t)) {
      const m = t.includes('=') ? t.slice(t.indexOf('=') + 1) : /^-X./.test(t) ? t.slice(2) : (ws[i + 1]?.text ?? '');
      if (!/^(?:GET|HEAD|OPTIONS)$/i.test(m)) return O('server');
    }
  }
  const out = ws.findIndex((w) => /^(?:-o|--output)$/.test(w.text));
  if (out !== -1) return W([pathOf(ws[out + 1], cwd, env)], 'download');
  if (hasFlag(ws, /^(?:-O|--remote-name|--remote-name-all|-J|--remote-header-name)$|^-[a-zA-Z]*O[a-zA-Z]*$/)) return L('downloadHere');
  return R('readsNetwork');
}

function judgeWget(inv: Invocation, cwd: string | null, env: EffectEnv): Judged {
  const ws = words(inv);
  if (hasFlag(ws, /^--(?:post-data|post-file|method|body-data|body-file)(?:=|$)/)) return O('server');
  if (hasFlag(ws, /^--spider$/)) return R('readsNetwork');
  // -O FILE, -OFILE, bundled (-qO-, -qO FILE) or --output-document[=FILE]; "-" is standard output.
  let target: Word | undefined;
  for (let i = 0; i < ws.length; i++) {
    const t = ws[i]!.text;
    const short = /^-[a-zA-Z]*O(.*)$/.exec(t);
    if (t === '--output-document' || (short && short[1] === '')) target = ws[i + 1];
    else if (short) target = { ...ws[i]!, text: short[1]! };
    else if (t.startsWith('--output-document=')) target = { ...ws[i]!, text: t.slice(18) };
  }
  if (target?.text === '-') return R('readsNetwork');
  if (target !== undefined) return W([pathOf(target, cwd, env)], 'download');
  return L('downloadHere');
}

function judgeWebCmdlet(inv: Invocation, cwd: string | null, env: EffectEnv): Judged {
  const named = psNamed(words(inv), P('uri method body outfile infile headers contenttype form usebasicparsing websession'), ['uri']);
  const method = named.method?.text;
  if (named.body || named.form || named.infile || (method && !/^(?:get|head|options)$/i.test(method))) return O('server');
  if (named.outfile) return W([pathOf(named.outfile, cwd, env)], 'download');
  return R('readsNetwork');
}

/** A package manager or toolchain: version and reading subcommands read, global installs reach outside. */
function judgeTool(inv: Invocation): Judged | null {
  const p = inv.program;
  const reads = own(READ_SUBS, p);
  if (!reads && !LOCAL.has(p) && !OUTSIDE.has(p)) return null;
  const ws = words(inv);
  const args = inv.args;
  if (args.length === 0) return LOCAL.has(p) ? L() : OUTSIDE.has(p) ? O() : R();
  if (args.length === 1 && (VERSION_ONLY.has(args[0]!) || args[0] === '-v')) return R();
  // A shell given a script file runs it (a shell given its code as a string was judged before).
  if (/^(?:bash|sh|zsh|dash|ksh|fish|pwsh|powershell|cmd|source|\.)$/.test(p)) return L('script');
  // Some reading "subcommands" are flags: dpkg -l, wsl --list, dotnet --info (powercfg /list is a word).
  if (reads?.has(args[0]!) && args[0]!.startsWith('-')) return R();
  const sub = first(ws);
  if (/^(?:npm|pnpm|yarn|bun)$/.test(p) && args.some((a) => a === '-g' || a === '--global' || a === '--location=global')) return O('global');
  if (
    /^(?:npm|pnpm|yarn|bun|cargo|twine|gem|poetry|dotnet|flutter|dart)$/.test(p) &&
    /^(?:publish|unpublish|deprecate|dist-tag|owner|access|login|logout|adduser|token|yank|push|nuget)$/.test(sub)
  )
    return args.includes('--dry-run') ? R() : O('publish');
  if ((p === 'cargo' || p === 'go') && sub === 'install') return O('global');
  if (p === 'go' && sub === 'env') return args.includes('-w') || args.includes('-u') ? O('global') : R();
  if ((p === 'npm' || p === 'pnpm' || p === 'yarn') && sub === 'audit' && !args.includes('fix')) return R();
  if ((p === 'npm' || p === 'pnpm') && sub === 'pack' && args.includes('--dry-run')) return R();
  if (reads?.has(sub)) {
    const pair = own(READ_PAIRS, `${p} ${sub}`);
    if (!pair) return R();
    const next = positional(ws)[1]?.text.toLowerCase() ?? '';
    return pair.size === 0 || pair.has(next) ? R() : OUTSIDE.has(p) ? O() : L();
  }
  const pair = own(READ_PAIRS, `${p} ${sub}`);
  if (pair) {
    const next = positional(ws)[1]?.text.toLowerCase() ?? '';
    if (pair.size === 0 || pair.has(next)) return R();
  }
  if (p === 'gh' && sub === 'api') return gitHubApi(ws);
  if (p === 'python' || p === 'python3' || p === 'py') {
    const m = args.indexOf('-m');
    if (m !== -1 && /^(?:json\.tool|pydoc|site|platform|sysconfig|this|tokenize)$/.test(args[m + 1] ?? '')) return R();
  }
  if (inv.inlineCode !== undefined) return L('runsCode');
  if (OUTSIDE.has(p)) return O();
  return L();
}

/** `gh api` reads with GET; a method, fields or input send. */
function gitHubApi(ws: readonly Word[]): Judged {
  for (let i = 0; i < ws.length; i++) {
    const t = ws[i]!.text;
    if (/^(?:-f|-F|--field|--raw-field|--input)(?:=|$)/.test(t)) return O('server');
    if (/^(?:-X|--method)(?:=|$)/.test(t)) {
      const m = t.includes('=') ? t.slice(t.indexOf('=') + 1) : (ws[i + 1]?.text ?? '');
      if (!/^GET$/i.test(m)) return O('server');
    }
  }
  return R('readsNetwork');
}

function judgeWriter(inv: Invocation, cwd: string | null, env: EffectEnv): Judged {
  const ws = words(inv);
  const pos = positional(ws);
  const p = inv.program;
  const paths = (list: readonly Word[]) => list.map((w) => pathOf(w, cwd, env));
  if (!pos.length) return p === 'tee' ? R() : W([null]);
  switch (p) {
    case 'cp':
    case 'copy':
    case 'install':
    case 'ln': {
      const t = ws.findIndex((w) => w.text === '-t' || w.text === '--target-directory');
      if (t !== -1) return W([pathOf(ws[t + 1], cwd, env)]);
      const inline = ws.find((w) => w.text.startsWith('--target-directory='));
      if (inline) return W([pathOf({ ...inline, text: inline.text.slice(inline.text.indexOf('=') + 1) }, cwd, env)]);
      return W(paths(pos.length > 1 ? pos.slice(-1) : pos));
    }
    case 'xcopy':
    case 'robocopy': {
      // cmd-style switches (/E, /MIR, /XD:x) are not paths; the destination is the second path.
      const files = pos.filter((w) => !/^\/[A-Za-z?]+(?::\S*)?$/.test(w.text));
      return W(paths(files.length > 1 ? files.slice(1, 2) : [{ text: '.', dynamic: false, glob: false }]));
    }
    case 'chmod':
    case 'chown':
    case 'chgrp':
      return W(paths(pos.slice(1)));
    case 'dd': {
      const i = inv.args.findIndex((a) => a.startsWith('of='));
      return i !== -1 ? W([pathOf({ text: inv.args[i]!.slice(3), dynamic: inv.dynamic[i] ?? false, glob: false }, cwd, env)]) : R();
    }
    default:
      return W(paths(pos));
  }
}

function judgePsWriter(inv: Invocation, cwd: string | null, env: EffectEnv): Judged {
  const spec = PS_WRITERS[inv.program]!;
  const named = psNamed(words(inv), spec.names, spec.positional);
  const targets = spec.targets.map((k) => named[k]).filter((w): w is Word => w !== undefined);
  if (!targets.length) return inv.program === 'tee-object' ? R() : W([null]);
  if (inv.program === 'new-item' && named.name && targets.length) {
    const base = pathOf(targets[0], cwd, env);
    return W([base === null ? null : pathOf(named.name, base, env)]);
  }
  return W(targets.map((w) => pathOf(w, cwd, env)));
}

/** A shell handed its code as a string: the analysis follows the code, whose programs are judged on their own. */
function runsGivenCode(inv: Invocation): boolean {
  const p = inv.program;
  if (/^(?:bash|sh|zsh|dash|ksh|fish|ash|mksh|busybox|git-bash)$/.test(p)) return inv.args.some((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
  if (/^(?:pwsh|powershell|pwsh-preview)$/.test(p)) return inv.args.some((a) => /^-(?:c|com\w*|ec|e|enc\w*)$/i.test(a));
  // Git Bash turns /c into a path, so it is written //c there.
  if (p === 'cmd') return inv.args.some((a) => /^\/{1,2}[ckCK]$/.test(a));
  return false;
}

/** Words of the shell's own language that the analysis meets where a program could stand: nothing runs. */
const KEYWORDS = wordSet(`
  if elseif else foreach for while do until switch try catch finally break continue throw param function filter begin process end data shift
  then fi done esac in select case
`);

/** .NET calls from PowerShell (`[IO.File]::WriteAllText`) that change things, by their method's name. */
const DOTNET_CHANGES = /::(?:\w*(?:write|append|delete|remove|create|move|copy|replace|save|kill|start|exit|set|encrypt|decrypt|compress|extract)\w*)$/i;

/** Was the program spelled with a folder (`./build/app.exe`, `C:/tools/x`), not found on PATH? */
function spelledWithFolder(inv: Invocation): boolean {
  const esc = inv.program.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`[\\\\/]${esc}(?:\\.[A-Za-z0-9]+)?(?=["'\\s]|$)`, 'i').test(inv.raw);
}

function judge(inv: Invocation, cwd: string | null, env: EffectEnv): Judged {
  const p = inv.program;
  if (KEYWORDS.has(p) || /^(?:if|elseif|foreach|for|while|switch|catch|until)\s*\(/.test(p)) return R('keyword');
  // Expression pieces the PowerShell reader meets as words: -not, -join, a comma, a property hashtable, an assignment, a member call.
  if (/^[-,)(@{'"+]|=|^\.[a-z]/i.test(p)) return R('expression');
  if (inv.programDynamic) return U('dynamicProgram');
  if (/^\[[^\]]+\]::/.test(p)) return DOTNET_CHANGES.test(p) ? U('dotnet') : R();
  if (runsGivenCode(inv)) return R('givenCode');
  if (p === 'git') return judgeGit(inv, cwd, env);
  if (p === 'find' || p === 'fd' || p === 'fdfind') return judgeFind(inv, cwd, env);
  if (p === 'sed') return judgeSed(inv, cwd, env);
  if (p === 'awk' || p === 'gawk' || p === 'mawk' || p === 'nawk') return judgeAwk(inv, cwd, env);
  if (p === 'curl') return judgeCurl(inv, cwd, env);
  if (p === 'wget') return judgeWget(inv, cwd, env);
  if (p === 'invoke-webrequest' || p === 'invoke-restmethod') return judgeWebCmdlet(inv, cwd, env);
  if (p === 'sort') {
    const ws = words(inv);
    const o = ws.findIndex((w) => w.text === '-o');
    const inline = ws.find((w) => /^--output=/.test(w.text));
    if (o !== -1) return W([pathOf(ws[o + 1], cwd, env)]);
    if (inline) return W([pathOf({ ...inline, text: inline.text.slice(9) }, cwd, env)]);
    return R();
  }
  if (p === 'uniq') {
    const pos = positional(words(inv));
    return pos.length > 1 ? W([pathOf(pos[1], cwd, env)]) : R();
  }
  if (p === 'yq')
    return hasFlag(words(inv), /^(?:-i|--inplace)$/)
      ? W(
          positional(words(inv))
            .slice(1)
            .map((w) => pathOf(w, cwd, env)),
          'editsInPlace',
        )
      : R();
  if (p === 'xxd') {
    // xxd [-r] [infile [outfile]]: a second file is written.
    const pos = positional(words(inv));
    return pos.length > 1 ? W([pathOf(pos[1], cwd, env)]) : R();
  }
  if (p === 'iconv') {
    const ws = words(inv);
    const o = ws.findIndex((w) => w.text === '-o' || w.text === '--output');
    return o !== -1 ? W([pathOf(ws[o + 1], cwd, env)]) : R();
  }
  if (p === 'date') return hasFlag(words(inv), /^(?:-s|--set)(?:=|$)/) ? O('system') : R();
  if (p === 'hostname') return inv.args.filter((a) => !a.startsWith('-')).length ? O('system') : R();
  if (p === 'tar') return judgeTar(inv);
  if (p === 'unzip') return ['-l', '-v', '-t', '-Z', '-z'].some((f) => inv.args.includes(f)) ? R() : L('archive');
  if (Object.hasOwn(PS_WRITERS, p)) return judgePsWriter(inv, cwd, env);
  if (READS.has(p) || PS_READS.test(p)) return R();
  if (WRITERS.has(p)) return judgeWriter(inv, cwd, env);
  const tool = judgeTool(inv);
  if (tool) return tool;
  if (p === 'mktemp') {
    // An empty file or folder in the temporary folder, unless a folder is named.
    const ws = words(inv);
    const dir = ws.findIndex((w) => /^(?:-p|--tmpdir)$/.test(w.text));
    const template = positional(ws).find((w) => /[\\/]/.test(w.text));
    if (dir !== -1) return W([pathOf(ws[dir + 1], cwd, env)], 'writes');
    return template ? W([pathOf(template, cwd, env)], 'writes') : R('emptyTemp');
  }
  if (p === 'pdftotext') {
    const pos = positional(words(inv));
    return pos.length > 1 ? (pos[1]!.text === '-' ? R() : W([pathOf(pos[1], cwd, env)])) : W([null], 'writes');
  }
  if (inv.args.length === 1 && VERSION_ONLY.has(inv.args[0]!)) return R();
  if (/\.(?:sh|bash|zsh|ps1|cmd|bat|py|js|mjs|cjs|ts|rb|pl)$/i.test(p)) return L('script');
  if (spelledWithFolder(inv)) return L('folderProgram');
  return U();
}

/** Shell functions a command defines for itself (`run() { … }`, `function p { … }`): calling one runs its body, judged on its own. */
export function definedFunctions(command: string): Set<string> {
  const out = new Set<string>();
  for (const m of command.matchAll(/(?:^|[;&|\n{(]\s*)(?:function\s+)?([A-Za-z_][\w.:-]*)\s*\(\s*\)\s*\{/g)) out.add(m[1]!.toLowerCase());
  for (const m of command.matchAll(/(?:^|[;&|\n{(]\s*)function\s+([A-Za-z_][\w.:-]*)/gi)) out.add(m[1]!.toLowerCase());
  return out;
}

/** PowerShell verbs that only read (Get-Content, Test-Path, ConvertTo-Json, …). */
const PS_READS =
  /^(?:get|test|show|find|select|measure|format|convertto|convertfrom|compare|search|resolve|read|import-csv|import-clixml|import-powershelldatafile|wait)-/;

/** tar lists with t; x, c, r, u and A extract, create or add. Flags come bundled (`tar -tzf`, `tar xvf`) or long. */
function judgeTar(inv: Invocation): Judged {
  const clusters = inv.args.filter((a, i) => (a.startsWith('-') && !a.startsWith('--')) || (i === 0 && /^[a-zA-Z]+$/.test(a)));
  const long = inv.args.filter((a) => a.startsWith('--'));
  const changes =
    clusters.some((c) => /[xcruA]/.test(c.replace(/^-/, ''))) ||
    long.some((l) => /^--(?:extract|get|create|append|update|delete|catenate|concatenate)$/.test(l));
  const lists = clusters.some((c) => /t/.test(c.replace(/^-/, ''))) || long.includes('--list');
  return lists && !changes ? R() : L('archive');
}

const CD = wordSet(`cd pushd set-location chdir sl push-location`);

/** The effects of a command, program by program, in source order. */
export function commandEffects(command: string, dialect: Dialect, env: EffectEnv): CommandEffects {
  const analysis = analyzeCommand(command, dialect);
  const functions = definedFunctions(command);
  let cwd: string | null = env.cwd;
  const effects: Effect[] = [];
  for (const inv of analysis.invocations) {
    if (functions.has(inv.program) && !inv.writes.length) {
      effects.push({ program: inv.program, raw: inv.raw, kind: 'read', targets: [], cwd, why: 'function' });
      continue;
    }
    if (CD.has(inv.program)) {
      const arg = inv.args.find((x) => x === '-' || !x.startsWith('-'));
      const i = arg === undefined ? -1 : inv.args.indexOf(arg);
      if (arg === undefined) cwd = env.home;
      else if (arg === '-') cwd = null;
      else cwd = pathOf({ text: arg, dynamic: inv.dynamic[i] ?? false, glob: false }, cwd, env);
      continue;
    }
    if (inv.program === 'popd' || inv.program === 'pop-location') {
      cwd = null;
      continue;
    }
    const j = judge(inv, cwd, env);
    const redirects = inv.writes
      .map((w, i) => ({ w, dynamic: inv.writeDynamic[i] ?? false }))
      .filter((x) => !NULL_TARGETS.test(x.w.trim()))
      .map((x) => pathOf({ text: x.w, dynamic: x.dynamic, glob: false }, cwd, env));
    let kind = j.kind;
    let why = j.why;
    if (redirects.length && kind === 'read') {
      kind = 'write';
      why = 'writes';
    }
    // Elevation runs the program as another user: outside whatever folder it is in.
    if (inv.via.some((v) => /^(?:sudo|doas|run0|pkexec|su|runuser|gsudo|runas)$/.test(v)) && kind !== 'read') {
      kind = 'outside';
      why = 'elevated';
    }
    effects.push({ program: inv.program, raw: inv.raw, kind, targets: [...j.targets, ...redirects], cwd: j.dir !== undefined ? j.dir : cwd, why });
  }
  return { effects, issues: analysis.issues };
}

/** Issues about arguments only: the programs are all known, some of their arguments are not. */
const ARGUMENT_ISSUES = wordSet(`xargs-stdin-arguments`);

/** The issues that may hide a program (a parse that did not finish, code only known at run time). */
export function hidingIssues(issues: readonly string[]): string[] {
  return issues.filter((i) => !ARGUMENT_ISSUES.has(i));
}

/** The strongest kind among the effects ('read' for a command with none). */
export function strongest(effects: readonly Effect[]): EffectKind {
  let k = 0;
  for (const e of effects) k = Math.max(k, EFFECT_ORDER.indexOf(e.kind));
  return EFFECT_ORDER[k]!;
}
