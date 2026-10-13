// SPDX-License-Identifier: Apache-2.0
/**
 * Runs the command line as a person runs it: a separate process, with its own data folder
 * (TERMINAL_CODE_HOME), its own Claude Code folder (CLAUDE_CONFIG_DIR) and a stand-in `claude` first on
 * PATH. Nothing outside the temporary folder is touched, and no session variable of a Claude Code session
 * the tests may run in leaks into the child (it would make the tool refuse to install).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The installed package's dist/cli.mjs, when scripts/test-package.mjs runs the bundle suites (test/dist)
 * against what npm installed from the tarball; null otherwise, and they run against the build in dist/.
 */
export const PACKAGE_CLI: string | null = process.env.TC_PACKAGE_CLI || null;

/** The bundle the "dist" suites run: the installed package's, or the build's. */
export const bundleCli = (): string => PACKAGE_CLI ?? join(ROOT, 'dist', 'cli.mjs');
const FAKE = join(ROOT, 'test', 'helpers', 'fake-claude.mjs');

export interface World {
  root: string;
  data: string;
  claudeDir: string;
  /** Where the stand-in claude keeps its state and the calls it received. */
  stateFile: string;
  env: NodeJS.ProcessEnv;
  claudeState(): { version: string; plugins: { id: string; enabled: boolean }[]; calls: string[][] };
  done(): void;
}

function pathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
}

/** PATH without any folder that holds a real `claude`, so a missing Claude Code can be tested here too. */
function pathWithoutClaude(path: string): string {
  return path
    .split(delimiter)
    .filter((d) => {
      try {
        return !readdirSync(d).some((f) => /^claude(?:\.exe|\.cmd|\.bat)?$/i.test(f));
      } catch {
        return true;
      }
    })
    .join(delimiter);
}

export function world(opts: { claude?: { version?: string; pluginVersion?: string } | null; lang?: 'en' | 'tr' } = {}): World {
  const root = mkdtempSync(join(tmpdir(), 'tc-proc-'));
  const data = join(root, 'data');
  const claudeDir = join(root, 'claude');
  mkdirSync(claudeDir, { recursive: true });
  const stateFile = join(root, 'fake-claude.json');
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('CLAUDE_CODE_') && k !== 'CLAUDECODE' && k !== 'NODE_OPTIONS') env[k] = v;
  const pk = pathKey(env);
  let path = pathWithoutClaude(env[pk] ?? '');
  if (opts.claude !== null) {
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(
      stateFile,
      JSON.stringify({ version: opts.claude?.version ?? '2.1.296', pluginVersion: opts.claude?.pluginVersion ?? 'dev', plugins: [], calls: [] }),
    );
    if (process.platform === 'win32') writeFileSync(join(bin, 'claude.cmd'), `@"${process.execPath}" "${FAKE}" %*\r\n`);
    else {
      writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
      chmodSync(join(bin, 'claude'), 0o755);
    }
    path = bin + delimiter + path;
  }
  env[pk] = path;
  Object.assign(env, {
    TERMINAL_CODE_HOME: data,
    CLAUDE_CONFIG_DIR: claudeDir,
    TERMINAL_CODE_LANG: opts.lang ?? 'en',
    NO_COLOR: '1',
    FAKE_CLAUDE_STATE: stateFile,
  });
  delete env.FORCE_COLOR;
  return {
    root,
    data,
    claudeDir,
    stateFile,
    env,
    claudeState: () => JSON.parse(readFileSync(stateFile, 'utf8')),
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}

export interface Ran {
  code: number | null;
  out: string;
  err: string;
  /** The output parsed as JSON, when it is JSON. */
  json: Record<string, any> | null;
}

/** Runs `terminal-code <args>`: from source, or with `dist` the bundle the package ships (bundleCli). */
export function cli(w: World, args: string[], opts: { dist?: boolean; input?: string; cwd?: string; timeoutMs?: number } = {}): Ran {
  // tsx by its full address: the child runs in the temporary folder, where a bare "tsx" would not resolve.
  const entry = opts.dist ? [bundleCli()] : ['--import', import.meta.resolve('tsx'), join(ROOT, 'src', 'cli', 'main.tsx')];
  const r = spawnSync(process.execPath, [...entry, ...args], {
    cwd: opts.cwd ?? w.root,
    // And with the project's tsconfig.json, which tsx would not find from there: without it the sources
    // compile differently (JSX the classic way), and Node's coverage merges two versions of each file.
    env: opts.dist ? w.env : { ...w.env, TSX_TSCONFIG_PATH: join(ROOT, 'tsconfig.json') },
    input: opts.input ?? '',
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 120_000,
    windowsHide: true,
  });
  let json: Record<string, any> | null = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = null;
  }
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', json };
}

export const built = (): boolean => existsSync(join(ROOT, 'dist', 'hook.mjs')) && existsSync(join(ROOT, 'dist', 'plugin', '.claude-plugin', 'plugin.json'));
