// SPDX-License-Identifier: Apache-2.0
/**
 * What an antivirus makes of the repository (L15). A clone, a source ZIP or the package puts these files on
 * someone's disk; if their antivirus takes one for a threat, it quarantines it and shows a warning about a
 * command-line tool they just downloaded. This writes every tracked file and every built file into a new
 * folder in the system's temporary folder (scanned the hardest, and where downloads and unpacked archives
 * land), waits, and reads each one back: a file the antivirus took away, locked or changed is reported.
 *
 * A file it reports also lands in the antivirus's quarantine and shows its warning: that is the measurement.
 * Measured with Bitdefender: a test file full of sample commands was locked within 2.5 seconds of being
 * written (CMD:Heur.BZC.PZQ.Boxter), while the same file under C:\dev was left alone.
 *
 * Usage: node scripts/av-check.mjs [--wait <seconds>] [file...]
 *   Files named are checked as well (each under its own name). Needs a build for the built files.
 * Exit: 0 nothing taken (or skipped: not Windows, no active antivirus) · 1 something taken.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const waitAt = args.indexOf('--wait');
const waitSeconds = waitAt >= 0 ? Number(args[waitAt + 1]) : 10;
const named = args.filter((a, i) => a !== '--wait' && args[i - 1] !== '--wait');

if (process.platform !== 'win32') {
  console.log('av-check: skipped: measured on Windows, where an antivirus takes files away as they are written');
  process.exit(0);
}

/** The antivirus programs Windows Security Center knows, and whether each is on (null: Windows did not say). */
function antivirus() {
  const r = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | ForEach-Object { $_.displayName + '|' + $_.productState }",
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (r.status !== 0) return null;
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, state] = line.split('|');
      // productState 0xAABBCC: BB holds the real-time scanner, 0x10 set when it is on.
      return { name: name.trim(), on: (Number(state) & 0x1000) !== 0 };
    });
}

const products = antivirus();
const active = products?.filter((p) => p.on) ?? [];
if (products && active.length === 0) {
  console.log(`av-check: skipped: no antivirus reports itself on (${products.map((p) => `${p.name} off`).join(', ') || 'none installed'})`);
  process.exit(0);
}

const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .stdout.split('\0')
  .filter((f) => f && existsSync(join(root, f)));
const built = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else built.push(relative(root, p).replace(/\\/g, '/'));
  }
};
if (existsSync(join(root, 'dist'))) walk(join(root, 'dist'));

/** [path under the folder, the file's content] */
const files = [
  ...tracked.map((f) => [f, readFileSync(join(root, f))]),
  ...built.map((f) => [f, readFileSync(join(root, f))]),
  ...named.filter((f) => statSync(f).isFile()).map((f) => [`named/${basename(f)}`, readFileSync(resolve(f))]),
];

const dir = mkdtempSync(join(tmpdir(), 'mc-av-'));
for (const [f, content] of files) {
  mkdirSync(dirname(join(dir, f)), { recursive: true });
  writeFileSync(join(dir, f), content);
}
await new Promise((r) => setTimeout(r, waitSeconds * 1000));

const taken = [];
for (const [f, content] of files) {
  try {
    if (!readFileSync(join(dir, f)).equals(content)) taken.push(`${f}: changed`);
  } catch (err) {
    taken.push(`${f}: ${err.code === 'ENOENT' ? 'removed' : err.code === 'EPERM' || err.code === 'EBUSY' ? 'locked' : err.code}`);
  }
}
try {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
} catch {
  console.log(`av-check: could not remove ${dir}; a file the antivirus holds is in it`);
}

const watcher = active.length ? active.map((p) => p.name).join(', ') : 'the antivirus (Windows did not say which)';
const what = `${files.length} files (${tracked.length} tracked, ${built.length} built${named.length ? `, ${named.length} named` : ''})`;
if (taken.length) {
  console.log(taken.map((t) => `  ✗ ${t}`).join('\n'));
  console.log(`av-check: ${watcher} took ${taken.length} of ${what} written to the temporary folder`);
  process.exit(1);
}
if (!built.length) console.log('av-check: no build in dist/, so the built files were not checked (npm run build)');
console.log(`av-check: ${watcher} left all ${what} alone for ${waitSeconds} s in the temporary folder`);
