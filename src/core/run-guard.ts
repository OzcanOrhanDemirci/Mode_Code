// SPDX-License-Identifier: Apache-2.0
/**
 * The full-autonomy guard: what a tool call may do while a run goes on and nobody is there to ask
 * (docs/autonomy.md, "What waits for you" and "The fence"). It runs after the safety belt, on every call
 * (subagents' too), and answers allow, defer (the step waits for the person: refused, recorded, reported)
 * or refuse (never during a run: an unknown tool, a question for the person, a write outside the fence, a
 * credential read, a memory folder, the sandbox's escape hatch). Pure.
 *
 * Like the belt it is an accident preventer; the boundary is the operating system's (the WSL distribution,
 * Claude Code's sandbox). It judges what a call says, never runs it.
 */
import { analyzeCommand, type Invocation } from './shell/analyze.js';
import { commandEffects } from './shell/effects.js';
import { isProtectedBranch, parseGit, planPush } from './belt/git.js';
import { isFileTool, shellOf } from './belt/tools.js';
import { OUTWARD_MCP } from './footer.js';
import { inZones } from './modes.js';
import { joinPath, resolvePath, type PathEnv } from './paths.js';
import { truncate } from './text.js';
import type { DeferKind } from './run.js';

export interface AutoEnv extends PathEnv {
  env: Readonly<Record<string, string | undefined>>;
  /** Where file tools may write: the project, the temporary folders, the run's work folder (resolved). */
  writable: readonly string[];
  memoryDirs: readonly string[];
  /** Credential files and folders (resolved): never read during a run. */
  credentials: readonly string[];
  protectedBranches: readonly string[];
  /** The project's current branch (for a push that names no branch), when known. */
  branch: string | null;
}

export type RefuseWhy = 'unknown-tool' | 'person-only' | 'fence-write' | 'fence-read' | 'memory' | 'sandbox-escape';

export type AutoVerdict =
  { kind: 'allow' } | { kind: 'defer'; defer: DeferKind; what: string; reason: string } | { kind: 'refuse'; why: RefuseWhy; detail: string };

const ALLOW: AutoVerdict = { kind: 'allow' };

/** Tools that read, plan, or start work that the guard sees call by call (subagents, workflows). */
const READ_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'LS',
  'LSP',
  'ToolSearch',
  'TodoWrite',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskUpdate',
  'TaskStop',
  'GetTask',
  'ListAgents',
  'ListConnectors',
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
  'ReadMcpResourceDirTool',
  'ListPlugins',
  'ListSkills',
  'SearchSkills',
  'SearchPlugins',
  'SearchMcpRegistry',
  'WaitForMcpServers',
  'ReadNotifications',
  'FetchInboxMessage',
  'Skill',
  'Agent',
  'Task',
  'Workflow',
  'WebFetch',
  'WebSearch',
  'CronList',
  'ReportFindings',
]);

/** Tools that put something to the person: nobody is there to answer. */
const PERSON_TOOLS = new Set([
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'ProposeGoal',
  'ShowOnboardingRolePicker',
  'OfferChromeSetup',
  'SuggestConnectors',
  'SuggestPluginInstall',
  'SuggestSkills',
  'ShareOnboardingGuide',
  'EndConversation',
]);

/** Tools that act outside the machine or beyond the run: messages, publications, schedules, worktrees. */
const OUTWARD_TOOLS = new Set([
  'Artifact',
  'ArtifactData',
  'ArtifactComments',
  'ArtifactCheck',
  'AppifactRepl',
  'ClaudeDesign',
  'DesignSync',
  'PublishPlugin',
  'PushNotification',
  'SendFile',
  'SendMessage',
  'SendUserFile',
  'SendUserMessage',
  'SendFeedback',
  'RemoteTrigger',
  'ScheduleWakeup',
  'CronCreate',
  'CronDelete',
  'EnterWorktree',
  'ExitWorktree',
  'Projects',
]);

const READING_ACTION = /^(?:read|list|get|query|open|status|info)$/i;
/** An MCP tool whose own name says it only reads. */
const MCP_READS = /(?:^|_)(?:get|list|search|read|query|fetch|find|describe|view|show|lookup|retrieve|download|count|stat|guide)(?:_|$)/i;

/** Fragments of credential paths that no command of a run has a reason to name. */
const CREDENTIAL_TEXT = [
  '.ssh/',
  '/.ssh',
  '.aws/credentials',
  '.aws/config',
  '.git-credentials',
  '.netrc',
  '.config/gh/hosts.yml',
  '.credentials.json',
  '.docker/config.json',
  '.kube/config',
  '.gnupg',
  '.pypirc',
  '.cargo/credentials',
  '.config/gcloud',
  '.azure/',
];

/** The credential files and folders under a home folder, for AutoEnv.credentials. */
export function credentialPaths(home: string, claudeDir: string): string[] {
  const rel = [
    '.ssh',
    '.aws',
    '.gnupg',
    '.config/gh',
    '.config/gcloud',
    '.azure',
    '.netrc',
    '.git-credentials',
    '.npmrc',
    '.pypirc',
    '.docker/config.json',
    '.kube/config',
    '.cargo/credentials',
    '.cargo/credentials.toml',
  ];
  return [...rel.map((r) => joinPath(home, ...r.split('/'))), joinPath(claudeDir, '.credentials.json')];
}

function under(path: string, zones: readonly string[], e: AutoEnv): boolean {
  return inZones(path, zones, e.platform);
}

function named(text: string): boolean {
  const t = text.replace(/\\/g, '/').toLowerCase();
  return CREDENTIAL_TEXT.some((f) => t.includes(f));
}

function defer(d: DeferKind, what: string, reason: string): AutoVerdict {
  return { kind: 'defer', defer: d, what: truncate(what, 600), reason };
}

function refuse(why: RefuseWhy, detail: string): AutoVerdict {
  return { kind: 'refuse', why, detail: truncate(detail, 300) };
}

/** gh subcommands that only read; every other gh call acts on GitHub and waits for the person. */
const GH_READS: Record<string, RegExp> = {
  pr: /^(?:view|list|status|diff|checks)$/,
  issue: /^(?:view|list|status)$/,
  repo: /^(?:view|list|clone)$/,
  release: /^(?:view|list|download)$/,
  run: /^(?:view|list|watch|download)$/,
  workflow: /^(?:view|list)$/,
  gist: /^(?:view|list)$/,
  label: /^(?:list)$/,
  cache: /^(?:list)$/,
  auth: /^(?:status|token)$/,
  search: /./,
  status: /^$|./,
  browse: /./,
  help: /^$|./,
};

/** The words of a command line that are not options, with the values of the options that take one left out. */
function positional(args: readonly string[], valueFlags: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--') {
      out.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('-')) {
      if (valueFlags.has(a)) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

/** gh's global options that take a value (`gh -R owner/repo pr merge 1`). */
const GH_VALUE_FLAGS = new Set(['-R', '--repo', '--hostname']);
/** docker's and podman's global options that take a value (`docker -H host push image`). */
const DOCKER_VALUE_FLAGS = new Set([
  '-H',
  '--host',
  '--context',
  '-c',
  '--config',
  '-l',
  '--log-level',
  '--tlscacert',
  '--tlscert',
  '--tlskey',
  '--url',
  '--connection',
]);

function ghVerdict(inv: Invocation): AutoVerdict {
  const [group = '', sub = ''] = positional(inv.args, GH_VALUE_FLAGS);
  // Options alone (--version, --help) only print.
  if (!group) return ALLOW;
  if (group === 'api') {
    const method = inv.args.findIndex((a) => a === '-X' || a === '--method');
    const m =
      method !== -1
        ? (inv.args[method + 1] ?? '').toUpperCase()
        : (inv.args
            .find((a) => a.startsWith('--method='))
            ?.slice(9)
            .toUpperCase() ?? '');
    const sends = inv.args.some((a) => /^(?:-f|-F|--field|--raw-field|--input)(?:=|$)/.test(a));
    if ((m && m !== 'GET') || (!m && sends)) return defer('outward', inv.raw, 'calls the GitHub API to change something');
    return ALLOW;
  }
  if (GH_READS[group]?.test(sub)) return ALLOW;
  if (group === 'pr' && sub === 'merge') return defer('merge', inv.raw, 'merges a pull request');
  if (group === 'release') return defer('release', inv.raw, 'changes a release');
  if (group === 'repo' || group === 'secret' || group === 'variable') return defer('repo', inv.raw, 'changes a repository or its settings');
  return defer('outward', inv.raw, 'acts on GitHub');
}

function gitVerdict(inv: Invocation, e: AutoEnv): AutoVerdict {
  const g = parseGit(inv.args, inv.dynamic, e);
  if (g.sub !== 'push') return ALLOW;
  const plan = planPush(g.args, e.branch);
  if (plan.dryRun) return ALLOW;
  for (const t of plan.targets) {
    if (t.dst !== null && t.dst.startsWith('tag:')) return defer('release', inv.raw, 'pushes a tag');
    if (t.dst === null) return defer('push', inv.raw, 'pushes to a branch that is not known before it runs');
    if (isProtectedBranch(t.dst, e.protectedBranches)) return defer('push', inv.raw, `pushes to the protected branch ${t.dst}`);
  }
  if (g.args.includes('--tags') || g.args.includes('--follow-tags')) return defer('release', inv.raw, 'pushes tags');
  return ALLOW;
}

const PUBLISHERS = /^(?:docker|podman)$/;
const CD = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl', 'push-location']);

function shellVerdict(tool: string, input: Readonly<Record<string, unknown>>, dialect: 'bash' | 'powershell', e: AutoEnv): AutoVerdict {
  if (input.dangerouslyDisableSandbox === true) return refuse('sandbox-escape', tool);
  const command = String(input.command ?? input.script ?? '');
  if (named(command)) return refuse('fence-read', command);
  const a = analyzeCommand(command, dialect);
  // The folder each program runs in, followed through cd: `cd ~ && cat .npmrc` reads the home folder's.
  let cwd: string | null = e.cwd;
  for (const inv of a.invocations) {
    if (CD.has(inv.program)) {
      const k = inv.args.findIndex((x) => !x.startsWith('-'));
      cwd =
        k === -1
          ? e.home
          : inv.dynamic[k]
            ? null
            : cwd === null && !/^(?:[\\/~]|[A-Za-z]:)/.test(inv.args[k]!)
              ? null
              : resolvePath(inv.args[k]!, { ...e, cwd: cwd ?? e.cwd });
      // Nothing of a run works inside a credential folder.
      if (cwd !== null && under(cwd, e.credentials, e)) return refuse('fence-read', inv.raw);
      continue;
    }
    for (const [i, arg] of inv.args.entries()) {
      const text = arg.replace(/^--?[\w-]+=/, '');
      if (!text || text.startsWith('-')) continue;
      // A value known only at run time is placed by the part written out: `~/.aws/$PROFILE` is in ~/.aws.
      const fixed = inv.dynamic[i] ? text.split(/[$`]/)[0]! : text;
      if (inv.dynamic[i] && !/[\\/]/.test(fixed)) continue;
      // Where the folder is not known (cd to a value known only at run time), only absolute paths can be placed.
      if (cwd === null && !/^(?:[\\/~]|[A-Za-z]:)/.test(fixed)) continue;
      if (under(resolvePath(fixed, { ...e, cwd: cwd ?? e.cwd }), e.credentials, e)) return refuse('fence-read', arg);
    }
    if (inv.program === 'git') {
      const v = gitVerdict(inv, e);
      if (v.kind !== 'allow') return v;
    }
    if (inv.program === 'gh') {
      const v = ghVerdict(inv);
      if (v.kind !== 'allow') return v;
    }
    if (PUBLISHERS.test(inv.program) && positional(inv.args, DOCKER_VALUE_FLAGS)[0] === 'push')
      return defer('publish', inv.raw, 'pushes an image to a registry');
  }
  if (e.memoryDirs.length) {
    const fx = commandEffects(command, dialect, { ...e, env: e.env });
    for (const x of fx.effects) for (const t of x.targets) if (t !== null && under(t, e.memoryDirs, e)) return refuse('memory', t);
  }
  return ALLOW;
}

/** The guard's answer for one tool call during a run. */
export function checkAutonomy(tool: string, input: Readonly<Record<string, unknown>>, e: AutoEnv): AutoVerdict {
  if (tool.startsWith('mcp__terminal-code__')) return ALLOW;
  const dialect = shellOf(tool);
  if (dialect) return shellVerdict(tool, input, dialect, e);
  if (isFileTool(tool)) {
    const raw = String(input.file_path ?? input.notebook_path ?? '');
    if (!raw) return refuse('fence-write', '?');
    const path = resolvePath(raw, e);
    if (under(path, e.memoryDirs, e)) return refuse('memory', raw);
    if (!under(path, e.writable, e)) return refuse('fence-write', raw);
    return ALLOW;
  }
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') {
    const raw = String(input.file_path ?? input.path ?? '');
    if (raw && under(resolvePath(raw, e), e.credentials, e)) return refuse('fence-read', raw);
    if (named(`${raw} ${String(input.pattern ?? '')} ${String(input.glob ?? '')}`)) return refuse('fence-read', raw || String(input.pattern ?? ''));
    return ALLOW;
  }
  if (READ_TOOLS.has(tool)) return ALLOW;
  if (PERSON_TOOLS.has(tool)) return refuse('person-only', tool);
  if (OUTWARD_TOOLS.has(tool)) {
    if (READING_ACTION.test(String(input.action ?? ''))) return ALLOW;
    return defer('outward', `${tool} ${truncate(JSON.stringify(input), 300)}`, 'acts outside the machine or beyond the run');
  }
  if (tool.startsWith('mcp__')) {
    const name = tool.split('__').slice(2).join('__');
    if (!OUTWARD_MCP.test(name) && MCP_READS.test(name)) return ALLOW;
    return defer('mcp', `${tool} ${truncate(JSON.stringify(input), 300)}`, 'an MCP tool that does not only read');
  }
  return refuse('unknown-tool', tool);
}
