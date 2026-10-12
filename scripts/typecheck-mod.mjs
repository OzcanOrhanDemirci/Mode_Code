// SPDX-License-Identifier: Apache-2.0
/**
 * Type-checks the mod (src/mod) and its engine tests (test/mod) against the declarations of the Claude
 * Code installed here. Claude Code writes those declarations itself (they are not published as a package):
 * they are found where it laid them for its plugin-authoring guide, under the system temporary folder, for
 * exactly the installed version. Where they are not there, the check says so and skips: it never passes
 * without having run.
 *
 * Usage: node scripts/typecheck-mod.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE') delete env[k];
let v = spawnSync('claude', ['--version'], { encoding: 'utf8', env, windowsHide: true });
if (v.error && process.platform === 'win32') v = spawnSync('claude --version', { encoding: 'utf8', env, shell: true, windowsHide: true });
const version = /(\d+\.\d+\.\d+)/.exec(v.stdout ?? '')?.[1];
if (!version) {
  console.log('typecheck-mod: skipped: Claude Code is not installed');
  process.exit(0);
}

/** The newest declaration file Claude Code laid for this version. */
function findDeclarations() {
  const base = join(tmpdir(), 'claude', 'bundled-skills', version);
  if (!existsSync(base)) return null;
  const found = readdirSync(base)
    .map((h) => join(base, h, 'plugin-authoring', 'types', 'claude-code.d.ts'))
    .filter((p) => existsSync(p))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return found[0] ?? null;
}

const dts = findDeclarations();
if (!dts) {
  console.log(
    `typecheck-mod: skipped: Claude Code ${version} has not laid its declarations on this machine yet (they appear the first time a session loads its plugin-authoring guide)`,
  );
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), 'tc-modtypes-'));
try {
  const fwd = (p) => p.replace(/\\/g, '/');
  const tests = readdirSync(join(root, 'test', 'mod'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => fwd(join(root, 'test', 'mod', f)));
  writeFileSync(
    join(work, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'es2023',
          lib: ['es2023'],
          types: [],
          module: 'esnext',
          moduleResolution: 'bundler',
          strict: true,
          noUncheckedIndexedAccess: true,
          noEmit: true,
          skipLibCheck: true,
          allowImportingTsExtensions: true,
          jsx: 'react',
          jsxFactory: 'h',
          jsxFragmentFactory: 'Fragment',
        },
        files: [fwd(dts), fwd(join(root, 'src', 'mod', 'contract.d.ts')), fwd(join(root, 'src', 'mod', 'register.ts')), ...tests],
      },
      null,
      2,
    ),
  );
  const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const r = spawnSync(process.execPath, [tsc, '-p', join(work, 'tsconfig.json')], { encoding: 'utf8', windowsHide: true });
  const out = `${r.stdout}${r.stderr}`.trim();
  if (r.status !== 0) {
    console.error(`typecheck-mod: errors against Claude Code ${version}'s declarations:\n${out}`);
    process.exit(1);
  }
  console.log(`typecheck-mod: src/mod and ${tests.length} engine test files type-check against Claude Code ${version}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
