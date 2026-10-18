// SPDX-License-Identifier: Apache-2.0
/**
 * The package as npm installs it (L12). `npm pack` makes the tarball a release would publish; its file
 * list must be exactly the expected one. The tarball is installed into an empty prefix outside the
 * repository, offline and without install scripts, so nothing from this checkout can be resolved by the
 * installed program. Then npm's own launcher (a .cmd shim on Windows, a link on macOS and Linux) runs it,
 * and the bundle suites (test/dist) run again against the installed copy instead of dist/.
 *
 * Usage: node scripts/test-package.mjs      (needs a build: npm run build)
 * Exit: 0 passed · 1 failed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Every file the tarball holds, and nothing else. A new file in a release is a decision, made here. */
export const EXPECTED_FILES = [
  'CHANGELOG.md',
  'LICENSE',
  'NOTICE',
  'README.md',
  'README.tr.md',
  'THIRD_PARTY_NOTICES.md',
  'TRADEMARK.md',
  'dist/THIRD_PARTY_NOTICES.md',
  'dist/cli.mjs',
  'dist/hook.mjs',
  // The tool packs (docs/packs.md): every guide, and each hosted pack as a plugin of its own.
  'dist/packs/guides/browser.md',
  'dist/packs/guides/ffmpeg.md',
  'dist/packs/guides/firebase.md',
  'dist/packs/guides/flutter.md',
  'dist/packs/guides/openscad.md',
  'dist/packs/guides/python.md',
  'dist/packs/guides/store.md',
  'dist/packs/guides/typescript.md',
  'dist/packs/guides/typst.md',
  'dist/packs/plugins/mode-code-browser/.claude-plugin/plugin.json',
  'dist/packs/plugins/mode-code-browser/LICENSE',
  'dist/packs/plugins/mode-code-browser/skills/browser/SKILL.md',
  'dist/packs/plugins/mode-code-ffmpeg/.claude-plugin/plugin.json',
  'dist/packs/plugins/mode-code-ffmpeg/LICENSE',
  'dist/packs/plugins/mode-code-ffmpeg/skills/ffmpeg/SKILL.md',
  'dist/packs/plugins/mode-code-firebase/.claude-plugin/plugin.json',
  'dist/packs/plugins/mode-code-firebase/LICENSE',
  'dist/packs/plugins/mode-code-firebase/skills/firebase/SKILL.md',
  'dist/packs/plugins/mode-code-flutter/.claude-plugin/plugin.json',
  'dist/packs/plugins/mode-code-flutter/LICENSE',
  'dist/packs/plugins/mode-code-flutter/skills/flutter/SKILL.md',
  'dist/packs/plugins/mode-code-openscad/.claude-plugin/plugin.json',
  'dist/packs/plugins/mode-code-openscad/LICENSE',
  'dist/packs/plugins/mode-code-openscad/skills/openscad/SKILL.md',
  'dist/packs/plugins/mode-code-store/.claude-plugin/plugin.json',
  'dist/packs/plugins/mode-code-store/LICENSE',
  'dist/packs/plugins/mode-code-store/skills/store/SKILL.md',
  'dist/packs/plugins/mode-code-typst/.claude-plugin/plugin.json',
  'dist/packs/plugins/mode-code-typst/LICENSE',
  'dist/packs/plugins/mode-code-typst/skills/typst/SKILL.md',
  'dist/plugin/.claude-plugin/plugin.json',
  'dist/plugin/LICENSE',
  'dist/plugin/NOTICE',
  'dist/plugin/hooks/hooks.json',
  'dist/plugin/hooks/register.js',
  'dist/plugin/hooks/mo-strip.js',
  'dist/plugin/hooks/strip-pulse.js',
  'dist/plugin/types/index.d.ts',
  'package.json',
  // The skills (docs/skills.md): Mode_Code's own as the reviewed folders hold them, and each skill of others with
  // exactly the files its sources.json lists, its licence, and its notice where its repository has one.
  ...readdirSync(join(root, 'skills')).map((id) => `dist/plugin/skills/${id}/SKILL.md`),
  // The two that carry a script of their own (the project checks of A9).
  'dist/plugin/skills/store-check/check.mjs',
  'dist/plugin/skills/turkish-text/check.mjs',
  ...readdirSync(join(root, 'skills-managed')).map((id) => `dist/skills-source/own/${id}/SKILL.md`),
  ...Object.entries(JSON.parse(readFileSync(join(root, 'skills-external', 'sources.json'), 'utf8'))).flatMap(([id, s]) => [
    ...s.files.map((f) => `dist/skills-source/external/${id}/${f}`),
    `dist/skills-source/external/${id}/LICENSE.source`,
    ...(existsSync(join(root, 'skills-external', id, 'NOTICE.source')) ? [`dist/skills-source/external/${id}/NOTICE.source`] : []),
  ]),
];

class Failure extends Error {}
const fail = (msg) => {
  throw new Failure(msg);
};
if (!existsSync(join(root, 'dist', 'cli.mjs')) || !existsSync(join(root, 'dist', 'plugin', '.claude-plugin', 'plugin.json'))) {
  console.error('test-package: no build (run npm run build first)');
  process.exit(1);
}

// A clean environment: no variable of a Claude Code session this may run in, no color.
const env = { ...process.env, NO_COLOR: '1' };
for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE' || k === 'NODE_OPTIONS' || k === 'FORCE_COLOR') delete env[k];

/** Runs a command through the shell on Windows (npm and its shims are .cmd files there), quoting each argument. */
function sh(cmd, args, opts = {}) {
  const quote = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);
  return spawnSync(isWin ? [cmd, ...args].map(quote).join(' ') : cmd, isWin ? [] : args, {
    encoding: 'utf8',
    windowsHide: true,
    shell: isWin,
    timeout: 300_000,
    env,
    ...opts,
  });
}

const tmp = mkdtempSync(join(tmpdir(), 'tc-package-'));
let code = 0;
try {
  // ── the tarball ──
  const packed = sh('npm', ['pack', '--json', '--pack-destination', tmp], { cwd: root });
  if (packed.status !== 0) fail(`npm pack failed: ${packed.stderr.slice(0, 2000)}`);
  const [info] = JSON.parse(packed.stdout.slice(packed.stdout.indexOf('[')));
  const files = info.files.map((f) => f.path.replace(/\\/g, '/')).sort();
  const expected = [...EXPECTED_FILES].sort();
  const extra = files.filter((f) => !expected.includes(f));
  const missing = expected.filter((f) => !files.includes(f));
  if (extra.length || missing.length)
    fail(`the tarball's files differ from the expected list:${extra.map((f) => `\n  + ${f}`).join('')}${missing.map((f) => `\n  - ${f}`).join('')}`);
  console.log(
    `test-package: ${info.filename}: ${files.length} files, ${(info.size / 1024).toFixed(0)} KiB packed, ${(info.unpackedSize / 1024).toFixed(0)} KiB unpacked`,
  );

  // ── installed by npm into an empty prefix, offline, without scripts ──
  const prefix = join(tmp, 'prefix');
  mkdirSync(prefix);
  const installed = sh(
    'npm',
    ['install', '--global', '--prefix', prefix, join(tmp, info.filename), '--offline', '--ignore-scripts', '--no-audit', '--no-fund'],
    {
      cwd: tmp,
    },
  );
  if (installed.status !== 0) fail(`npm install from the tarball failed: ${installed.stderr.slice(0, 2000)}`);
  const pkgDir = isWin ? join(prefix, 'node_modules', pkg.name) : join(prefix, 'lib', 'node_modules', pkg.name);
  const shim = isWin ? join(prefix, `${pkg.name}.cmd`) : join(prefix, 'bin', pkg.name);
  const cliFile = join(pkgDir, 'dist', 'cli.mjs');
  if (!existsSync(cliFile)) fail(`the installed package has no ${cliFile}`);
  if (!existsSync(shim)) fail(`npm made no launcher at ${shim}`);
  if (existsSync(join(pkgDir, 'node_modules'))) fail(`the installed package brought dependencies: ${readdirSync(join(pkgDir, 'node_modules')).join(', ')}`);

  // ── run through npm's own launcher, in an isolated home ──
  const home = join(tmp, 'home');
  const runEnv = { ...env, MODE_CODE_HOME: join(home, 'data'), CLAUDE_CONFIG_DIR: join(home, 'claude'), MODE_CODE_LANG: 'en' };
  mkdirSync(join(home, 'claude'), { recursive: true });
  const v = sh(shim, ['--version'], { cwd: home, env: runEnv });
  if (v.status !== 0 || v.stdout.trim() !== pkg.version)
    fail(`the launcher's --version said ${JSON.stringify(v.stdout.trim())} (exit ${v.status}), not ${pkg.version}: ${v.stderr.slice(0, 500)}`);
  const s = sh(shim, ['status', '--json'], { cwd: home, env: runEnv });
  let schema = '';
  try {
    schema = JSON.parse(s.stdout).schema;
  } catch {
    /* reported below */
  }
  if (!/\.status\/\d+$/.test(schema))
    fail(`the launcher's status --json printed no status (exit ${s.status}): ${s.stdout.slice(0, 300)}${s.stderr.slice(0, 300)}`);
  console.log(`test-package: npm's launcher runs it: --version ${v.stdout.trim()}, status --json ${schema}`);

  // ── the bundle suites, against the installed copy ──
  const suites = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', 'test/dist/cli.test.ts', 'test/dist/shipped.test.ts'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 900_000,
    env: { ...env, TC_PACKAGE_CLI: cliFile },
  });
  process.stdout.write(suites.stdout);
  process.stderr.write(suites.stderr);
  const pass = /ℹ pass (\d+)/.exec(suites.stdout)?.[1] ?? '0';
  const failed = /ℹ fail (\d+)/.exec(suites.stdout)?.[1] ?? '?';
  const skipped = /ℹ skipped (\d+)/.exec(suites.stdout)?.[1] ?? '0';
  if (suites.status !== 0 || failed !== '0' || skipped !== '0') code = 1;
  console.log(
    `test-package: ${files.length} files as expected, installed by npm ${sh('npm', ['--version']).stdout.trim()} and run through its launcher; bundle suites against the installed copy: ${pass} passed, ${failed} failed, ${skipped} skipped`,
  );
} catch (err) {
  if (!(err instanceof Failure)) throw err;
  console.error(`test-package: ${err.message}`);
  code = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
}
process.exit(code);
