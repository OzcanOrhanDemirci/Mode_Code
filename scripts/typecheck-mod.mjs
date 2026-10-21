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
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { declarationsFor, installedClaude } from './declarations.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = installedClaude();
if (!version) {
  console.log('typecheck-mod: skipped: Claude Code is not installed');
  process.exit(0);
}

const dts = declarationsFor(version);
if (!dts) {
  console.log(
    `typecheck-mod: skipped: Claude Code ${version} has not laid its declarations on this machine yet (they appear the first time a session loads its plugin-authoring guide; node scripts/test-live.mjs --yes --only-types runs one)`,
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
        files: [
          fwd(dts),
          fwd(join(root, 'src', 'mod', 'contract.d.ts')),
          fwd(join(root, 'src', 'mod', 'register.ts')),
          fwd(join(root, 'src', 'mod', 'mo-strip.ts')),
          fwd(join(root, 'src', 'mod', 'strip-pulse.ts')),
          fwd(join(root, 'src', 'mod', 'cockpit-clock.ts')),
          ...tests,
        ],
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

  // ── every built-in tool that runs a command or takes a file path is checked by the belt or reviewed ──
  const { tsImport } = await import('tsx/esm/api');
  const { BELT_TOOLS } = await tsImport(pathToFileURL(join(root, 'src', 'core', 'belt', 'tools.ts')).href, import.meta.url);
  const reviewed = JSON.parse(readFileSync(join(root, 'test', 'claude-code-tools.json'), 'utf8')).reviewed;
  const declared = readFileSync(dts, 'utf8');
  const takes = new Set();
  const block = /^ {4}([A-Z][A-Za-z]+): \{\r?\n([\s\S]*?)^ {4}\}/gm;
  for (let m = block.exec(declared); m; m = block.exec(declared)) if (/^ {6}(?:command|file_path|notebook_path)\??: string/m.test(m[2])) takes.add(m[1]);
  if (!takes.has('Bash') || !takes.has('Write')) {
    console.error(`typecheck-mod: could not read the tool inputs from Claude Code ${version}'s declarations (the layout changed); fix the reader`);
    process.exit(1);
  }
  const unknown = [...takes].filter((t) => !BELT_TOOLS.includes(t) && !Object.hasOwn(reviewed, t));
  if (unknown.length) {
    console.error(
      `typecheck-mod: Claude Code ${version} has tools that take a command or a file path the belt neither checks nor lists as reviewed: ${unknown.join(', ')}.\n` +
        'Add each to src/core/belt/tools.ts, or with the reason to test/claude-code-tools.json.',
    );
    process.exit(1);
  }
  console.log(
    `typecheck-mod: ${takes.size} built-in tools take a command or a file path: ${[...takes].filter((t) => BELT_TOOLS.includes(t)).length} checked by the belt, ${[...takes].filter((t) => Object.hasOwn(reviewed, t)).length} reviewed`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
