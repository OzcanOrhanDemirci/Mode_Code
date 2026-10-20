// SPDX-License-Identifier: Apache-2.0
/**
 * The setups driven through their questions (memory: test/app/memory-setup.test.ts; sync:
 * test/app/sync-setup.test.ts): a script of answers each matched to its question, and a machine with real
 * git and a stand-in GitHub, a folder of bare repositories git reaches through `url.insteadOf` and a `gh`
 * answered in process.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SetupEnv, SetupIO } from '../../src/app/memory-setup.js';
import { cloneDefaults, type Config } from '../../src/core/config.js';
import { layout } from '../../src/core/layout.js';
import type { Runner } from '../../src/core/memory-sync.js';
import { toolPath } from '../../src/node/env.js';
import { nodeRunner } from '../../src/node/memory.js';

export type Answer = [RegExp, string | number | boolean];

/** Answers the setup's questions in order; each must match the question it answers. Enter is ''. */
export function scripted(answers: Answer[], onInteractive: (argv: string[]) => void = () => {}) {
  const said: string[] = [];
  const asked: string[] = [];
  const interactive: string[][] = [];
  /** The steps the setup said, as "n/of title" and " · skipped" when it was not needed. */
  const steps: string[] = [];
  let i = 0;
  const next = (q: string): string | number | boolean => {
    asked.push(q);
    const a = answers[i++];
    if (!a) throw new Error(`no answer left for: ${q}`);
    if (!a[0].test(q)) throw new Error(`answer ${i} expected a question like ${a[0]}, got: ${q}`);
    return a[1];
  };
  const io: SetupIO = {
    say: (t = '') => said.push(t),
    choose: async (q, _o, def) => {
      const a = next(q);
      return a === '' ? def : (a as number);
    },
    ask: async (q, def) => {
      const a = next(q);
      return a === '' ? def : String(a);
    },
    confirm: async (q, def) => {
      const a = next(q);
      return a === '' ? def : (a as boolean);
    },
    interactive: async (argv) => {
      interactive.push(argv);
      onInteractive(argv);
      return 0;
    },
    step: (n, of, title, skipped) => void steps.push(`${n}/${of} ${title}${skipped ? ' · skipped' : ''}`),
  };
  return { io, said, asked, interactive, steps, left: () => answers.length - i };
}

export const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A machine: a home, Claude Code's folder, mode-code's data folder, and a GitHub of bare repositories. */
export function machine(opts: { signedIn?: boolean; gh?: boolean; winget?: boolean } = {}) {
  const root = toolPath(mkdtempSync(join(tmpdir(), 'tc-msetup-')));
  const github = join(root, 'github');
  mkdirSync(github);
  const gitconfig = join(root, 'gitconfig');
  writeFileSync(
    gitconfig,
    `[url "${pathToFileURL(github).href}/"]\n\tinsteadOf = https://github.com/\n[init]\n\tdefaultBranch = main\n[user]\n\tname = Ada\n\temail = ada@example.com\n[commit]\n\tgpgsign = false\n`,
  );
  process.env.GIT_CONFIG_GLOBAL = gitconfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  const state = { signedIn: opts.signedIn ?? true, gh: opts.gh ?? true, winget: opts.winget ?? false };
  const repos = new Map<string, { private: boolean }>();
  const ghCalls: string[][] = [];
  const bare = (repo: string) => join(github, `${repo}.git`);
  const isEmpty = (repo: string) => spawnSync('git', ['--git-dir', bare(repo), 'rev-parse', '--verify', 'HEAD']).status !== 0;
  const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' });
  const no = (stderr: string) => ({ exitCode: 1, stdout: '', stderr });
  const gh = (args: readonly string[]) => {
    ghCalls.push([...args]);
    const a = args.join(' ');
    if (a === '--version') return ok('gh version 2.63.0 (2024-11-27)\n');
    if (a.startsWith('auth status')) return state.signedIn ? ok() : no('You are not logged into any GitHub hosts.');
    if (a.startsWith('api user')) return state.signedIn ? ok('ada\t42\n') : no('not signed in');
    if (a.startsWith('auth setup-git')) return ok();
    if (args[0] === 'repo' && args[1] === 'view') {
      const r = repos.get(args[2]!);
      if (!r) return no(`GraphQL: Could not resolve to a Repository with the name '${args[2]}'.`);
      return ok(
        JSON.stringify({
          nameWithOwner: args[2],
          visibility: r.private ? 'PRIVATE' : 'PUBLIC',
          isEmpty: isEmpty(args[2]!),
          url: `https://github.com/${args[2]}`,
        }),
      );
    }
    if (args[0] === 'api' && /^repos\/[^/]+\/[^/]+\/contents\//.test(args[1] ?? '')) {
      const [, owner, name, , ...rest] = args[1]!.split('/');
      const r = repos.get(`${owner}/${name}`);
      if (!r || isEmpty(`${owner}/${name}`)) return no('gh: Not Found (HTTP 404)');
      const ls = spawnSync('git', ['--git-dir', bare(`${owner}/${name}`), 'ls-tree', 'HEAD', rest.join('/')], { encoding: 'utf8' });
      return ls.stdout.trim() ? ok('') : no('gh: Not Found (HTTP 404)');
    }
    if (args[0] === 'repo' && args[1] === 'create') {
      if (repos.has(args[2]!)) return no('name already exists on this account');
      mkdirSync(join(github, args[2]!.split('/')[0]!), { recursive: true });
      git(root, 'init', '--quiet', '--bare', bare(args[2]!));
      repos.set(args[2]!, { private: args.includes('--private') });
      return ok(`https://github.com/${args[2]}\n`);
    }
    return no(`unknown gh call: ${a}`);
  };
  const runner: Runner = {
    async run(argv, o) {
      if (/(^|[\\/])gh(\.exe)?$/.test(argv[0]!)) {
        if (!state.gh) throw Object.assign(new Error(`spawn ${argv[0]} ENOENT`), { code: 'ENOENT' });
        return gh(argv.slice(1));
      }
      return nodeRunner.run(argv, o);
    },
  };
  const addRepo = (repo: string, opts2: { private: boolean; note?: string }) => {
    mkdirSync(join(github, repo.split('/')[0]!), { recursive: true });
    git(root, 'init', '--quiet', '--bare', bare(repo));
    repos.set(repo, { private: opts2.private });
    if (opts2.note) {
      const w = join(root, `seed-${repo.replace('/', '-')}`);
      git(root, 'clone', '--quiet', bare(repo), w);
      writeFileSync(join(w, 'MEMORY.md'), opts2.note);
      git(w, 'add', '.');
      git(w, 'commit', '--quiet', '-m', 'from the other computer');
      git(w, 'push', '--quiet', 'origin', 'HEAD:main');
    }
  };
  // The tool's own path form (forward slashes), as dataLayout and toolPath give it.
  const home = `${root}/home`;
  const claudeDir = `${root}/claude`;
  mkdirSync(home);
  mkdirSync(claudeDir);
  const env = (config: Config = cloneDefaults()): SetupEnv => ({
    lang: 'en',
    platform: process.platform,
    home,
    cwd: home,
    layout: layout(`${root}/data`),
    claudeDir,
    config,
    runner,
    has: async (p) => p === 'winget' && state.winget,
    exists: () => false,
    now: () => 1_791_878_400_000,
  });
  const settings = () => JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8')) as Record<string, unknown>;
  const remoteFiles = (repo: string) => git(root, '--git-dir', bare(repo), 'ls-tree', '-r', '--name-only', 'main').split('\n').filter(Boolean);
  return {
    root,
    home,
    claudeDir,
    github,
    state,
    repos,
    ghCalls,
    env,
    settings,
    remoteFiles,
    addRepo,
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}
