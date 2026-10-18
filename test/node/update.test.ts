// SPDX-License-Identifier: Apache-2.0
/**
 * Updates on the real disk (node/update.ts): a release in a folder, as a mirror or a rehearsal gives one. The check
 * reads its SHA256SUMS and keeps the answer; the update runs the release's own installer only when it matches the
 * checksum, with --yes and the version, the release's place handed on. The installer here is a stand-in that writes
 * down what it was given.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layout } from '../../src/core/layout.js';
import { checkUpdate, readUpdateState, runInstaller } from '../../src/node/update.js';

const root = mkdtempSync(join(tmpdir(), 'tc-update-'));
after(() => rmSync(root, { recursive: true, force: true }));
const fwd = (p: string) => p.replace(/\\/g, '/');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** A release folder: the installers given, and a SHA256SUMS that lists them (or `sums` instead). */
function release(name: string, files: Record<string, string>, sums?: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
  writeFileSync(
    join(dir, 'SHA256SUMS'),
    sums ??
      Object.entries(files)
        .map(([f, text]) => `${sha(text)}  ${f}\n`)
        .join(''),
  );
  return fwd(dir);
}

test('the check: the newest version the release names, kept; a failure keeps the version found before', async () => {
  const l = layout(fwd(join(root, 'data-check')));
  const rel = release('rel-check', { 'install.sh': 'x', 'mode-code-9.9.9.tgz': 'p', 'mode-code.tgz': 'p' });
  const first = await checkUpdate(l, { now: 1000, base: rel });
  assert.deepEqual(first, { checkedAt: 1000, latest: '9.9.9', error: null });
  assert.deepEqual(readUpdateState(l), first);
  const gone = await checkUpdate(l, { now: 2000, base: fwd(join(root, 'nowhere')) });
  assert.equal(gone.latest, '9.9.9');
  assert.match(gone.error ?? '', /ENOENT|no such file/i);
  const odd = await checkUpdate(l, { now: 3000, base: release('rel-odd', { 'mode-code.tgz': 'p' }) });
  assert.deepEqual(odd, { checkedAt: 3000, latest: '9.9.9', error: 'SHA256SUMS names no versioned package' });
});

const STAND_IN = {
  'install.sh': '#!/bin/sh\nprintf "%s %s %s %s|%s" "$1" "$2" "$3" "$4" "$MODE_CODE_RELEASE_URL" > "$TC_MARKER"\nexit "${TC_EXIT:-0}"\n',
  'install.ps1':
    'param([switch]$Yes, [string]$Version)\nSet-Content -LiteralPath $env:TC_MARKER -Value "Yes=$Yes $Version|$env:MODE_CODE_RELEASE_URL" -NoNewline\n$global:LASTEXITCODE = [int]$env:TC_EXIT\n',
};

test("the update runs the release's own installer, checked first, with --yes and the version", async () => {
  const rel = release('rel-run', STAND_IN);
  const marker = join(root, 'marker-run.txt');
  process.env.TC_MARKER = marker;
  try {
    const r = await runInstaller('9.9.9', { base: rel });
    assert.deepEqual(r, { ok: true });
    const said = readFileSync(marker, 'utf8');
    if (process.platform === 'win32') assert.equal(said, `Yes=True 9.9.9|${rel}`);
    else assert.equal(said, `--yes --version 9.9.9 |${rel}`);
    process.env.TC_EXIT = '3';
    const failed = await runInstaller('9.9.9', { base: rel });
    assert.equal(failed.ok, false);
    assert.equal(failed.error, 'failed');
  } finally {
    delete process.env.TC_MARKER;
    delete process.env.TC_EXIT;
  }
});

test('an installer that does not match its checksum, or a release that is not there, is never run', async () => {
  const marker = join(root, 'marker-never.txt');
  process.env.TC_MARKER = marker;
  try {
    const wrong = release('rel-wrong', STAND_IN, `${'0'.repeat(64)}  install.sh\n${'0'.repeat(64)}  install.ps1\n`);
    assert.deepEqual(await runInstaller('9.9.9', { base: wrong }), {
      ok: false,
      error: 'checksum',
      detail: process.platform === 'win32' ? 'install.ps1' : 'install.sh',
    });
    const unlisted = release('rel-unlisted', STAND_IN, '');
    assert.equal((await runInstaller('9.9.9', { base: unlisted })).error, 'checksum');
    const missing = await runInstaller('9.9.9', { base: fwd(join(root, 'nowhere')) });
    assert.equal(missing.error, 'download');
    assert.equal(existsSync(marker), false);
  } finally {
    delete process.env.TC_MARKER;
  }
});
