// SPDX-License-Identifier: Apache-2.0
/**
 * From parsed commands to invocations: what actually runs.
 *
 * Wrappers are unwrapped (`sudo`, `env`, `nohup`, `timeout`, `xargs`, …), interpreters are re-entered
 * (`bash -c`, `sh` fed a here-document, `eval`, `pwsh -Command`, `pwsh -EncodedCommand`, `cmd /c`,
 * `Invoke-Expression`, `Start-Process`, `wsl`), and PowerShell aliases are resolved (`rm` → Remove-Item).
 * Whatever cannot be followed is reported in `issues`, never silently dropped.
 */
import { parseBash } from './bash.js';
import { parseCmd } from './cmd.js';
import { parsePowerShell } from './powershell.js';
import { MAX_DEPTH, type Dialect, type ParsedScript, type SimpleCommand, type Word } from './types.js';

export interface Invocation {
  dialect: Dialect;
  /** Lower-case program name without directory or extension; PowerShell aliases resolved to the cmdlet name. */
  program: string;
  /** The argument words after the program name (and after any wrapper), as values. */
  args: string[];
  /** Per argument: only known at run time. */
  dynamic: boolean[];
  /** Per argument: holds an unquoted glob. */
  glob: boolean[];
  /** True when the program name itself is only known at run time. */
  programDynamic: boolean;
  /** Files this command writes through redirection. */
  writes: string[];
  /** Per write: appends (>>) rather than truncates. */
  writeAppend: boolean[];
  /** Per write: the target is only known at run time. */
  writeDynamic: boolean[];
  /** Wrappers and interpreters this invocation was reached through, outermost first. */
  via: string[];
  /** Code handed to an interpreter as a string (python -c, node -e, …); not parsed as shell. */
  inlineCode?: string;
  /** The source text of the simple command. */
  raw: string;
}

export interface Analysis {
  invocations: Invocation[];
  /** Why the result may be incomplete. Empty means every part was followed. */
  issues: string[];
}

const PS_ALIASES: Record<string, string> = {
  rm: 'remove-item',
  del: 'remove-item',
  erase: 'remove-item',
  rd: 'remove-item',
  rmdir: 'remove-item',
  ri: 'remove-item',
  cp: 'copy-item',
  copy: 'copy-item',
  cpi: 'copy-item',
  mv: 'move-item',
  move: 'move-item',
  mi: 'move-item',
  sc: 'set-content',
  ac: 'add-content',
  ni: 'new-item',
  md: 'new-item',
  mkdir: 'new-item',
  iex: 'invoke-expression',
  saps: 'start-process',
  start: 'start-process',
  icm: 'invoke-command',
  gc: 'get-content',
  cat: 'get-content',
  type: 'get-content',
  iwr: 'invoke-webrequest',
  irm: 'invoke-restmethod',
  kill: 'stop-process',
  spps: 'stop-process',
  ren: 'rename-item',
  rni: 'rename-item',
  clc: 'clear-content',
  cli: 'clear-item',
  sl: 'set-location',
  cd: 'set-location',
  chdir: 'set-location',
  ii: 'invoke-item',
  sajb: 'start-job',
  ls: 'get-childitem',
  dir: 'get-childitem',
  gci: 'get-childitem',
  echo: 'write-output',
  write: 'write-output',
  tee: 'tee-object',
  set: 'set-variable',
  sv: 'set-variable',
};

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'ash', 'mksh', 'busybox', 'git-bash']);
const POWERSHELLS = new Set(['pwsh', 'powershell', 'pwsh-preview']);
const CODE_FLAGS: Record<string, string[]> = {
  python: ['-c'],
  python3: ['-c'],
  py: ['-c'],
  node: ['-e', '--eval', '-p', '--print'],
  bun: ['-e', '--eval'],
  deno: ['eval'],
  ruby: ['-e'],
  perl: ['-e', '-E'],
  php: ['-r'],
  osascript: ['-e'],
};

/** `C:\Tools\Git.EXE` → `git`; `./build.sh` → `build.sh`. */
export function programName(word: string): string {
  const base = word.split(/[\\/]/).pop() ?? word;
  return base.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, '');
}

export function analyzeCommand(command: string, dialect: Dialect): Analysis {
  const out: Analysis = { invocations: [], issues: [] };
  const script = dialect === 'powershell' ? parsePowerShell(command) : dialect === 'cmd' ? parseCmd(command) : parseBash(command);
  walk(script, [], 0, out, dialect === 'bash' ? straightLineConstants(command, script) : null);
  out.issues = [...new Set(out.issues)];
  return out;
}

function walk(script: ParsedScript, via: string[], depth: number, out: Analysis, known: readonly ReadonlyMap<string, string>[] | null = null): void {
  for (const issue of script.issues) out.issues.push(issue);
  if (depth > MAX_DEPTH) {
    out.issues.push('too-deep');
    return;
  }
  script.commands.forEach((cmd, i) => {
    const k = known?.[i];
    expand(cmd, k?.size ? substituteKnown(cmd.argv, k) : cmd.argv, via, depth, out);
  });
  for (const n of script.nested) walk(n, via, depth + 1, out);
}

/** Anything that can make an assignment conditional, repeated, scoped or computed: then nothing is propagated. */
const NOT_STRAIGHT =
  /\b(?:if|case|while|until|for|select|function|read|mapfile|readarray|source|eval|trap|exec|unset)\b|\(\)\s*\{|(?:^|[;&|\n])\s*(?:\.\s|[({])/;
const DECLARERS = new Set(['export', 'declare', 'typeset', 'local', 'readonly']);

/** The words that assign in a command: `NAME=value` alone, or after export/declare/…; empty for anything else. */
function assignmentsOf(cmd: SimpleCommand): string[] {
  if (cmd.argv.length === 0) return cmd.assigns;
  if (DECLARERS.has(cmd.argv[0]!.text)) return cmd.argv.slice(1).flatMap((w) => (w.text.includes('=') && !w.text.startsWith('-') ? [w.text] : []));
  return [];
}

/**
 * Per command, the values shell variables certainly hold when it runs, in a script that runs straight
 * through: `S=C:/x; $S/run.sh` runs C:/x/run.sh. Agents write commands this way all the time, and an
 * unknown program name or delete target would otherwise be asked about on every call. Conservative: only
 * plain literal values of variables assigned exactly once, and only up to the first branch, loop, group,
 * function, read or sourcing. An assignment holds for what follows it in the same `&&` chain, and for the
 * rest of the script only when it is the first element of its list; nothing after a `||` and nothing in a
 * pipeline or in the background counts; a use before the assignment sees the unknown outside value.
 */
export function straightLineConstants(command: string, script: ParsedScript): Map<string, string>[] {
  const none = script.commands.map(() => new Map<string, string>());
  // Values only flow forward: the commands before the first branch, loop, group, … are still certain.
  const stop = command.search(NOT_STRAIGHT);
  const count = new Map<string, number>();
  for (const cmd of script.commands)
    for (const a of assignmentsOf(cmd)) {
      const name = /^([A-Za-z_]\w*)=/.exec(a)?.[1];
      if (name) count.set(name, (count.get(name) ?? 0) + 1);
    }
  // Where each command sits in the text, and the operators between neighbours.
  const spans: { at: number; end: number }[] = [];
  let cursor = 0;
  for (const cmd of script.commands) {
    const at = command.indexOf(cmd.raw, cursor);
    if (at === -1 || cmd.raw === '') return none;
    // The parser's raw text may begin with the operator that joins it to the previous command.
    const lead = /^[\s;&|]*/.exec(cmd.raw)![0].length;
    spans.push({ at: at + lead, end: at + cmd.raw.length });
    cursor = at + cmd.raw.length;
  }
  const joiner = (from: number, to: number): 'and' | 'or' | 'pipe' | 'seq' | 'lost' => {
    const between = command.slice(from, to).replace(/#[^\n]*/g, '');
    if (/[^\s;&|]/.test(between)) return 'lost';
    if (between.includes('||')) return 'or';
    if (between.includes('&&')) return 'and';
    if (between.includes('|')) return 'pipe';
    if (/&(?!&)/.test(between)) return 'lost';
    return 'seq';
  };
  const result: Map<string, string>[] = [];
  let settled = new Map<string, string>();
  let chain = new Map<string, string>();
  let afterOr = false;
  let first = true;
  for (let i = 0; i < script.commands.length; i++) {
    const before = i === 0 ? (command.slice(0, spans[0]!.at).trim() ? 'lost' : 'seq') : joiner(spans[i - 1]!.end, spans[i]!.at);
    const after = i + 1 < spans.length ? joiner(spans[i]!.end, spans[i + 1]!.at) : /&\s*$/.test(command.slice(spans[i]!.end)) ? 'lost' : 'seq';
    if (before === 'lost' || (stop !== -1 && spans[i]!.end > stop)) return [...result, ...none.slice(i)];
    if (before === 'seq') {
      chain = new Map();
      afterOr = false;
      first = true;
    } else if (before === 'or') afterOr = true;
    const known = afterOr ? new Map(settled) : new Map([...settled, ...chain]);
    result.push(known);
    // In a pipeline or in the background the command runs in a subshell: its assignments do not stay.
    const subshell = before === 'pipe' || after === 'pipe' || after === 'lost';
    if (!subshell && !afterOr)
      for (const a of assignmentsOf(script.commands[i]!)) {
        const m = /^([A-Za-z_]\w*)=(.*)$/s.exec(a);
        if (!m || count.get(m[1]!) !== 1) continue;
        const value = m[2]!.replace(/\$\{(\w+)\}|\$(\w+)/g, (whole, x: string | undefined, y: string | undefined) => known.get((x ?? y)!) ?? whole);
        // A value with spaces or wildcards is split and globbed where it is used unquoted: not one known word.
        if (/[$`\s*?[\]]/.test(value)) continue;
        (first ? settled : chain).set(m[1]!, value);
      }
    first = false;
  }
  return result;
}

/** The words with known variables filled in; a word is no longer dynamic once nothing unknown is left in it. */
export function substituteKnown(words: readonly Word[], known: ReadonlyMap<string, string>): Word[] {
  return words.map((w) => {
    if (!w.dynamic) return w;
    const text = w.text.replace(/\$\{(\w+)\}|\$(\w+)/g, (whole, a: string | undefined, b: string | undefined) => known.get((a ?? b)!) ?? whole);
    return text === w.text ? w : { ...w, text, dynamic: /[$`]/.test(text) };
  });
}

function texts(words: readonly Word[]): string[] {
  return words.map((w) => w.text);
}

function reenter(code: string, dialect: Dialect, via: string[], depth: number, out: Analysis): void {
  const script = dialect === 'powershell' ? parsePowerShell(code, depth + 1) : dialect === 'cmd' ? parseCmd(code) : parseBash(code, depth + 1);
  walk(script, via, depth + 1, out);
}

/** Skips leading options of a wrapper. `withValue` lists options that take the next word as their value. */
function skipOptions(argv: readonly Word[], from: number, withValue: Set<string>): number {
  let i = from;
  while (i < argv.length) {
    const a = argv[i]!.text;
    if (a === '--') return i + 1;
    if (!a.startsWith('-') || a === '-') return i;
    if (withValue.has(a)) i += 2;
    else i += 1;
  }
  return i;
}

function expand(cmd: SimpleCommand, argv: readonly Word[], via: string[], depth: number, out: Analysis): void {
  if (depth > MAX_DEPTH) {
    out.issues.push('too-deep');
    return;
  }
  if (argv.length === 0) {
    // Redirect-only command (`> file`): still a write.
    const w = writeTargets(cmd);
    if (w.writes.length)
      out.invocations.push({ dialect: cmd.dialect, program: '', args: [], dynamic: [], glob: [], programDynamic: false, ...w, via, raw: cmd.raw });
    return;
  }
  const first = argv[0]!;
  let program = programName(first.text);
  // Own keys only: a program named "constructor" or "__proto__" must not find Object's members.
  if (cmd.dialect === 'powershell' && Object.hasOwn(PS_ALIASES, program)) program = PS_ALIASES[program]!;
  const rest = argv.slice(1);
  const at = (i: number) => rest[i]?.text;

  // ── wrappers: the real command follows ─────────────────────────────────────────────────────────────
  if (cmd.dialect !== 'powershell') {
    const wrapper = unwrap(program, rest);
    if (wrapper) {
      if (wrapper.issue) out.issues.push(wrapper.issue);
      if (wrapper.inner.length) expand(cmd, wrapper.inner, [...via, program], depth + 1, out);
      else if (!wrapper.lookupOnly) record(cmd, argv, program, via, out);
      return;
    }
  }

  record(cmd, argv, program, via, out);

  // ── interpreters: a string becomes commands ───────────────────────────────────────────────────────
  if (cmd.dialect !== 'powershell' && SHELLS.has(program)) {
    const args = program === 'busybox' && (at(0) === 'sh' || at(0) === 'ash') ? rest.slice(1) : rest;
    const ci = args.findIndex((w) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(w.text) && !w.text.startsWith('--'));
    if (ci !== -1) {
      const code = args[ci + 1];
      if (code) {
        if (code.dynamic) out.issues.push('dynamic-shell-code');
        reenter(code.text, 'bash', [...via, `${program} -c`], depth, out);
      }
    } else {
      for (const h of cmd.heredocs) reenter(h.body, 'bash', [...via, `${program} <<`], depth, out);
      for (const r of cmd.redirects) if (r.op === '<<<' && r.target) reenter(r.target.text, 'bash', [...via, `${program} <<<`], depth, out);
    }
    return;
  }
  if (POWERSHELLS.has(program)) {
    const r = psCli(rest);
    if (r.code !== undefined) {
      if (r.dynamic) out.issues.push('dynamic-shell-code');
      reenter(r.code, 'powershell', [...via, `${program} ${r.flag}`], depth, out);
    } else if (r.encoded !== undefined) {
      const decoded = decodeUtf16Base64(r.encoded);
      if (decoded === null) out.issues.push('encoded-command-undecodable');
      else reenter(decoded, 'powershell', [...via, `${program} -EncodedCommand`], depth, out);
    }
    for (const h of cmd.heredocs) reenter(h.body, 'powershell', [...via, `${program} <<`], depth, out);
    return;
  }
  if (program === 'cmd') {
    const ci = rest.findIndex((w) => /^\/[cCkK]/.test(w.text));
    if (ci !== -1) {
      const attached = rest[ci]!.text.slice(2);
      const parts = [attached, ...texts(rest.slice(ci + 1))].filter((x) => x !== '');
      if (rest.slice(ci).some((w) => w.dynamic)) out.issues.push('dynamic-shell-code');
      reenter(parts.join(' '), 'cmd', [...via, 'cmd /c'], depth, out);
    }
    return;
  }
  if (program === 'eval' && cmd.dialect === 'bash') {
    if (rest.some((w) => w.dynamic)) out.issues.push('eval-dynamic');
    reenter(texts(rest).join(' '), 'bash', [...via, 'eval'], depth, out);
    return;
  }
  if (program === 'wsl') {
    const i = rest.findIndex((w) => w.text === '-e' || w.text === '--exec' || w.text === '--');
    const inner =
      i !== -1
        ? rest.slice(i + 1)
        : rest.filter((w, k) => !(w.text.startsWith('-') || ['-d', '--distribution', '-u', '--user', '--cd'].includes(rest[k - 1]?.text ?? '')));
    if (inner.length) expand({ ...cmd, dialect: 'bash', heredocs: [] }, inner, [...via, 'wsl'], depth + 1, out);
    return;
  }
  if (cmd.dialect === 'powershell') {
    if (program === 'invoke-expression') {
      const arg = rest.find((w) => !w.text.startsWith('-')) ?? rest[1];
      if (!arg || arg.dynamic) out.issues.push('eval-dynamic');
      if (arg) reenter(arg.text, 'powershell', [...via, 'Invoke-Expression'], depth, out);
      return;
    }
    if (program === 'start-process') {
      const named = psNamed(rest, { filepath: 'FilePath', argumentlist: 'ArgumentList' }, ['filepath', 'argumentlist']);
      const file = named.filepath;
      if (file) {
        const list = named.argumentlist;
        const extra = list ? splitArgumentList(list.text) : [];
        const words: Word[] = [file, ...extra.map((t) => ({ text: t, dynamic: list!.dynamic, glob: false }))];
        expand({ ...cmd, dialect: 'bash', heredocs: [] }, words, [...via, 'Start-Process'], depth + 1, out);
      }
      return;
    }
    if (program === '[scriptblock]::create') {
      const s = rest[0];
      if (s) reenter(s.text, 'powershell', [...via, '[scriptblock]::Create'], depth, out);
      return;
    }
  }
}

function writeTargets(cmd: SimpleCommand): Pick<Invocation, 'writes' | 'writeAppend' | 'writeDynamic'> {
  const rs = cmd.redirects.filter((r) => r.writes && r.target);
  return { writes: rs.map((r) => r.target!.text), writeAppend: rs.map((r) => r.op.includes('>>')), writeDynamic: rs.map((r) => r.target!.dynamic) };
}

function record(cmd: SimpleCommand, argv: readonly Word[], program: string, via: string[], out: Analysis): void {
  const first = argv[0]!;
  const rest = argv.slice(1);
  const inv: Invocation = {
    dialect: cmd.dialect,
    program,
    args: texts(rest),
    dynamic: rest.map((w) => w.dynamic),
    glob: rest.map((w) => w.glob),
    programDynamic: first.dynamic,
    ...writeTargets(cmd),
    via,
    raw: cmd.raw,
  };
  const versionless = program.replace(/[0-9.]+$/, '');
  const flags = Object.hasOwn(CODE_FLAGS, versionless) ? CODE_FLAGS[versionless] : Object.hasOwn(CODE_FLAGS, program) ? CODE_FLAGS[program] : undefined;
  if (flags) {
    const i = rest.findIndex((w) => flags.includes(w.text));
    if (i !== -1 && rest[i + 1]) inv.inlineCode = rest[i + 1]!.text;
  }
  // `"$JAVA_HOME/bin/java"` is still java; only a name that is itself a runtime value is unknown.
  const base = first.text.split(/[\\/]/).pop() ?? first.text;
  if (first.dynamic && /[$`%…]/.test(base)) out.issues.push('dynamic-program');
  out.invocations.push(inv);
}

interface Unwrapped {
  inner: Word[];
  issue?: string;
  /** `command -v x` only looks a name up; nothing runs. */
  lookupOnly?: boolean;
}

const SUDO_VALUE = new Set([
  '-u',
  '-g',
  '-C',
  '-p',
  '-h',
  '-r',
  '-t',
  '-U',
  '-D',
  '-T',
  '--user',
  '--group',
  '--prompt',
  '--host',
  '--role',
  '--type',
  '--chdir',
  '--close-from',
  '--other-user',
  '--command-timeout',
]);

/** Returns the wrapped command of a wrapper program, or null when `program` is not a wrapper. */
function unwrap(program: string, rest: readonly Word[]): Unwrapped | null {
  switch (program) {
    case 'sudo':
    case 'doas':
    case 'run0':
    case 'pkexec':
      return { inner: rest.slice(skipOptions(rest, 0, SUDO_VALUE)) };
    case 'nohup':
    case 'setsid':
    case 'chronic':
    case 'unbuffer':
    case 'caffeinate':
    case 'winpty':
    case 'builtin':
      return { inner: rest.slice(skipOptions(rest, 0, new Set())) };
    case 'time':
      return { inner: rest.slice(skipOptions(rest, 0, new Set(['-f', '-o', '--format', '--output']))) };
    case 'command': {
      if (rest.some((w) => w.text === '-v' || w.text === '-V')) return { inner: [], lookupOnly: true };
      return { inner: rest.slice(skipOptions(rest, 0, new Set())) };
    }
    case 'exec':
      return { inner: rest.slice(skipOptions(rest, 0, new Set(['-a']))) };
    case 'nice':
      return { inner: rest.slice(skipOptions(rest, 0, new Set(['-n', '--adjustment']))) };
    case 'ionice':
      return { inner: rest.slice(skipOptions(rest, 0, new Set(['-c', '-n', '-p', '-P', '-u', '--class', '--classdata']))) };
    case 'stdbuf':
      return { inner: rest.slice(skipOptions(rest, 0, new Set(['-i', '-o', '-e', '--input', '--output', '--error']))) };
    case 'timeout': {
      const i = skipOptions(rest, 0, new Set(['-s', '-k', '--signal', '--kill-after']));
      return { inner: rest.slice(i + 1) }; // the first non-option is the duration
    }
    case 'watch': {
      const i = skipOptions(rest, 0, new Set(['-n', '--interval', '-d', '--differences', '-q', '--equexit', '--errexit']));
      const inner = rest.slice(i);
      // watch joins its arguments into one shell command
      if (inner.length === 1) return nestedString(inner[0]!);
      return { inner };
    }
    case 'flock': {
      const i = skipOptions(rest, 0, new Set(['-w', '--timeout', '-E', '--conflict-exit-code']));
      return { inner: rest.slice(i + 1) }; // first non-option is the lock file
    }
    case 'chroot': {
      const i = skipOptions(rest, 0, new Set(['--userspec', '--groups']));
      return { inner: rest.slice(i + 1) };
    }
    case 'xargs': {
      const i = skipOptions(
        rest,
        0,
        new Set(['-I', '-i', '-n', '-P', '-d', '-L', '-l', '-s', '-a', '-E', '-e', '--max-args', '--max-procs', '--delimiter', '--arg-file', '--max-lines']),
      );
      const inner = rest.slice(i);
      // xargs appends words read from stdin: the command is known, its final arguments are not.
      return {
        inner: inner.length ? [...inner, { text: '…stdin', dynamic: true, glob: false }] : [{ text: 'echo', dynamic: false, glob: false }],
        issue: 'xargs-stdin-arguments',
      };
    }
    case 'env': {
      let i = 0;
      const inner: Word[] = [];
      while (i < rest.length) {
        const a = rest[i]!.text;
        if (a === '--') {
          i++;
          break;
        }
        if (a === '-S' || a === '--split-string') {
          const s = rest[i + 1];
          if (s)
            inner.push(
              ...s.text
                .split(/\s+/)
                .filter(Boolean)
                .map((t) => ({ text: t, dynamic: s.dynamic, glob: false })),
            );
          i += 2;
          continue;
        }
        if (a.startsWith('--split-string=')) {
          inner.push(
            ...a
              .slice(15)
              .split(/\s+/)
              .filter(Boolean)
              .map((t) => ({ text: t, dynamic: false, glob: false })),
          );
          i++;
          continue;
        }
        if (a === '-u' || a === '--unset' || a === '-C' || a === '--chdir') {
          i += 2;
          continue;
        }
        if (a.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) {
          i++;
          continue;
        }
        break;
      }
      return { inner: [...inner, ...rest.slice(i)] };
    }
    case 'su':
    case 'runuser': {
      const ci = rest.findIndex((w) => w.text === '-c' || w.text === '--command');
      if (ci !== -1 && rest[ci + 1]) return nestedString(rest[ci + 1]!);
      return null;
    }
    case 'script': {
      const ci = rest.findIndex((w) => w.text === '-c' || w.text === '--command');
      if (ci !== -1 && rest[ci + 1]) return nestedString(rest[ci + 1]!);
      return null;
    }
    case 'start': {
      // cmd's start: an optional quoted title comes first.
      let i = 0;
      while (i < rest.length && (rest[i]!.text.startsWith('/') || (i === 0 && rest[i]!.text === ''))) i++;
      return { inner: rest.slice(i) };
    }
    case 'npx':
    case 'pnpx':
    case 'bunx':
      return packageRunner(rest);
    case 'pnpm':
    case 'yarn':
      return rest[0]?.text === 'dlx' ? packageRunner(rest.slice(1)) : null;
    case 'bun':
      return rest[0]?.text === 'x' ? packageRunner(rest.slice(1)) : null;
    default:
      return null;
  }
}

const RUNNER_VALUE = new Set(['-p', '--package', '--cache', '--registry', '--userconfig', '-w', '--workspace']);

/**
 * A package runner (`npx`, `pnpm dlx`, `bunx`) runs the program of the package it names: `npx rimraf@5 x`
 * runs `rimraf x`. `-c '<command>'` runs a shell string instead.
 */
function packageRunner(rest: readonly Word[]): Unwrapped {
  const ci = rest.findIndex((w) => w.text === '-c' || w.text === '--call');
  if (ci !== -1 && rest[ci + 1]) return nestedString(rest[ci + 1]!);
  const inner = rest.slice(skipOptions(rest, 0, RUNNER_VALUE));
  const [first, ...more] = inner;
  if (!first) return { inner: [] };
  // "rimraf@5" and "@scope/tool@1.2" name the package's program without the version.
  return { inner: [{ ...first, text: first.text.replace(/^(@[^/@]+\/[^@]+|[^@]+)@.*$/, '$1') }, ...more] };
}

/** A wrapper whose argument is itself a shell string (watch 'cmd', su -c 'cmd'): parse it as bash words. */
function nestedString(word: Word): Unwrapped {
  const parsed = parseBash(word.text, 1);
  const inner = parsed.commands[0]?.argv ?? [];
  const issue = parsed.commands.length > 1 || parsed.nested.length || parsed.issues.length ? 'wrapper-string-complex' : undefined;
  return issue ? { inner: inner.map((w) => ({ ...w, dynamic: w.dynamic || word.dynamic })), issue } : { inner };
}

/** Reads `pwsh` command-line arguments: -Command/-c (rest joined), -EncodedCommand/-e/-ec, -File/-f. */
function psCli(rest: readonly Word[]): { code?: string; encoded?: string; flag: string; dynamic: boolean } {
  for (let i = 0; i < rest.length; i++) {
    const raw = rest[i]!.text;
    const a = raw.toLowerCase();
    if (!a.startsWith('-') && !a.startsWith('/')) {
      // First positional: pwsh treats it as -File in 7+, -Command in 5.1. Either way we cannot read a file.
      return { flag: 'file', dynamic: false };
    }
    const name = a.replace(/^[-/]+/, '').split(':')[0]!;
    if (
      name === 'encodedcommand' ||
      name === 'e' ||
      name === 'ec' ||
      name === 'enc' ||
      ('encodedcommand'.startsWith(name) && name.length >= 3 && name.startsWith('en'))
    ) {
      const v = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : rest[i + 1]?.text;
      return { encoded: v ?? '', flag: '-EncodedCommand', dynamic: !!rest[i + 1]?.dynamic };
    }
    if (name === 'c' || (name.length >= 2 && 'command'.startsWith(name))) {
      const words = rest.slice(i + 1);
      return { code: texts(words).join(' '), flag: '-Command', dynamic: words.some((w) => w.dynamic) };
    }
    if (name === 'f' || (name.length >= 2 && 'file'.startsWith(name))) return { flag: '-File', dynamic: false };
    if (['noprofile', 'nop', 'noninteractive', 'noni', 'nologo', 'mta', 'sta', 'interactive', 'i', 'login', 'l', 'nol'].includes(name)) continue;
    if (
      [
        'executionpolicy',
        'ex',
        'ep',
        'exec',
        'windowstyle',
        'w',
        'win',
        'workingdirectory',
        'wd',
        'wo',
        'configurationname',
        'config',
        'inputformat',
        'if',
        'in',
        'outputformat',
        'of',
        'o',
        'settingsfile',
        'settings',
      ].includes(name)
    ) {
      if (!raw.includes(':')) i++;
      continue;
    }
  }
  return { flag: '', dynamic: false };
}

/** Decodes PowerShell's -EncodedCommand payload (base64 of UTF-16LE). Returns null when it is not valid. */
export function decodeUtf16Base64(b64: string): string | null {
  const clean = b64.trim();
  if (!/^[A-Za-z0-9+/]+=*$/.test(clean) || clean.length % 4 === 1) return null;
  let bin: string;
  try {
    bin = atob(clean);
  } catch {
    return null;
  }
  let out = '';
  for (let i = 0; i + 1 < bin.length; i += 2) out += String.fromCharCode(bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8));
  return out;
}

/** Reads named parameters of a PowerShell command, allowing unambiguous prefixes and positional order. */
export function psNamed(rest: readonly Word[], names: Record<string, string>, positional: string[]): Record<string, Word | undefined> {
  const keys = Object.keys(names);
  const out: Record<string, Word | undefined> = {};
  const pos: Word[] = [];
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]!;
    if (w.text.startsWith('-') && w.text.length > 1 && !/^-\d/.test(w.text)) {
      const [n, inline] = splitParam(w.text);
      const matches = keys.filter((k) => k.startsWith(n));
      const key = matches.length === 1 ? matches[0] : keys.find((k) => k === n);
      if (key) {
        if (inline !== undefined) out[key] = { ...w, text: inline };
        else {
          out[key] = rest[i + 1];
          i++;
        }
      }
      continue;
    }
    pos.push(w);
  }
  for (const k of positional) if (out[k] === undefined && pos.length) out[k] = pos.shift();
  return out;
}

/** `-Path:C:\x` → ['path', 'C:\x']; `-Recurse` → ['recurse', undefined]. */
export function splitParam(text: string): [string, string | undefined] {
  const body = text.replace(/^-+/, '');
  const c = body.indexOf(':');
  return c === -1 ? [body.toLowerCase(), undefined] : [body.slice(0, c).toLowerCase(), body.slice(c + 1)];
}

/** Start-Process -ArgumentList accepts a string or a comma list; split conservatively on commas and spaces. */
function splitArgumentList(text: string): string[] {
  return text
    .split(/[,\s]+/)
    .map((s) => s.replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}
