// SPDX-License-Identifier: Apache-2.0
// The release's own checks and notes (scripts/release.mjs), and that this repository passes them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error: a plain JavaScript script, run by the release workflow
import { changelogSection, installerRepo, releaseNotes, releaseProblems } from '../../scripts/release.mjs';
import { ROOT } from '../helpers/proc.js';

const CHANGELOG = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '- Not yet.',
  '',
  '## [1.2.0] - 2026-11-02',
  '',
  'A summary.',
  '',
  '### Added',
  '',
  '- A thing.',
  '',
  '## [1.1.0] - 2026-10-20',
  '',
  '- Older.',
  '',
  '[1.2.0]: https://example.invalid/compare/v1.1.0...v1.2.0',
].join('\n');

const repo = 'Someone/Tool';
const pkg = { name: 'tool', version: '1.2.0', repository: { url: `git+https://github.com/${repo}.git` } };
const installSh = `#!/bin/sh\nREPO="${repo}"\n`;
const installPs1 = `param()\n& {\n  $Repo = '${repo}'\n}\n`;

test("a version's section is its text up to the next version, without link definitions", () => {
  assert.deepEqual(changelogSection(CHANGELOG, '1.2.0'), { date: '2026-11-02', body: 'A summary.\n\n### Added\n\n- A thing.' });
  assert.deepEqual(changelogSection(CHANGELOG, '1.1.0'), { date: '2026-10-20', body: '- Older.' });
  assert.equal(changelogSection(CHANGELOG, '1.0.0'), null);
  // A dot is a dot: 1.2.0 is not 1x2y0.
  assert.equal(changelogSection(CHANGELOG.replace('[1.2.0] -', '[1x2y0] -'), '1.2.0'), null);
});

test('the installers name the repository they download from', () => {
  assert.equal(installerRepo(installSh), repo);
  assert.equal(installerRepo(installPs1), repo);
  assert.equal(installerRepo('nothing'), null);
});

test('a release needs the tag, package.json, the changelog and the installers to agree', () => {
  const ok = { tag: 'v1.2.0', pkg, changelog: CHANGELOG, installSh, installPs1, today: '2026-11-02' };
  assert.deepEqual(releaseProblems(ok), []);
  assert.match(releaseProblems({ ...ok, tag: 'v1.2.1' }).join('\n'), /the tag v1\.2\.1 is not v1\.2\.0/);
  assert.match(releaseProblems({ ...ok, pkg: { ...pkg, version: '1.3.0' } }).join('\n'), /no "## \[1\.3\.0\] - <date>" section/);
  assert.match(releaseProblems({ ...ok, changelog: CHANGELOG.replace(' - 2026-11-02', '') }).join('\n'), /has no date/);
  assert.match(releaseProblems({ ...ok, today: '2026-11-01' }).join('\n'), /after today/);
  assert.match(releaseProblems({ ...ok, installSh: 'REPO="Other/Fork"' }).join('\n'), /install\.sh downloads from Other\/Fork/);
  assert.match(releaseProblems({ ...ok, installPs1: '' }).join('\n'), /install\.ps1 downloads from nowhere/);
  // Without a tag (a rehearsal), the rest is still checked.
  assert.deepEqual(releaseProblems({ ...ok, tag: undefined }), []);
});

test('the notes say how to install before what changed, and how to check the download', () => {
  const notes: string = releaseNotes({ pkg, changelog: CHANGELOG });
  const install = notes.indexOf(`curl -fsSL https://raw.githubusercontent.com/${repo}/main/install.sh | sh`);
  const windows = notes.indexOf(`irm https://raw.githubusercontent.com/${repo}/main/install.ps1 | iex`);
  const changes = notes.indexOf('### Added');
  assert.ok(install > 0 && windows > install && changes > windows, notes);
  assert.match(notes, /gh attestation verify tool-1\.2\.0\.tgz --repo Someone\/Tool/);
});

test('this repository is ready to release its version, but for the tag', () => {
  const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
  const problems = releaseProblems({
    pkg: JSON.parse(read('package.json')),
    changelog: read('CHANGELOG.md'),
    installSh: read('install.sh'),
    installPs1: read('install.ps1'),
  });
  assert.deepEqual(problems, []);
});
