// SPDX-License-Identifier: Apache-2.0
/**
 * False alarms measured on other agents' everyday work (docs/testing.md, Evaluation sets), each beside what
 * must still be asked: data piped to a script, a setting read, a cache or a package file deleted, code that
 * deletes a temporary file beside other paths.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyProvenance, withSaid, withSeen, withStart } from '../../src/core/provenance.js';
import { bash, linuxCtx, macCtx, summary } from '../helpers/belt.js';

// Inside an agent's container: root's home, the project in /workspace.
const box = (over = {}) => linuxCtx({ home: '/root', cwd: '/workspace/app', projectDir: '/workspace/app', env: { HOME: '/root' }, ...over });

test('data piped to a module or a script is its input, not code; code piped to an interpreter is still asked', async () => {
  for (const c of [
    'echo "SELECT 1" | python -m sqlfluff lint - --rules LT12',
    "echo 'x = 1' | python3 -mpyupgrade -",
    'cat input.txt | python reproduce.py -',
    'cat input.txt | python -W ignore reproduce.py',
    'cat data.json | node scripts/check.js -',
    'cat in.txt | node --require ./setup.js main.js',
  ])
    assert.equal(summary(await bash(c, box())), 'allow', c);
  for (const c of [
    'cat build.sh | bash',
    'cat build.sh | bash -o pipefail -s',
    'cat build.sh | bash -x -s -- --fast',
    'cat build.ps1 | pwsh -NoProfile -Command -',
    'cat build.ps1 | pwsh -ExecutionPolicy Bypass',
    'cat main.py | python3 -',
    'cat main.py | python -W ignore',
    'cat main.py | python /dev/stdin',
    'cat main.js | node --require ./setup.js',
  ])
    assert.equal(summary(await bash(c, box())), 'ask meta.unverifiable', c);
  // A Python option is no shell's: -s and -m are an interpreter's own there.
  assert.equal(summary(await bash('cat main.py | python -s', box())), 'ask meta.unverifiable');
  assert.equal(summary(await bash('cat build.sh | bash -m', box())), 'ask meta.unverifiable');
});

test("git's hooks path read is no change; set or unset, it is", async () => {
  for (const c of ['git config core.hooksPath', 'git config --global core.hooksPath', 'git config get core.hooksPath', 'git config --get core.hooksPath'])
    assert.equal(summary(await bash(c, box())), 'allow', c);
  for (const c of [
    'git config core.hooksPath /srv/hooks',
    'git config --unset core.hooksPath',
    'git config --unset-all core.hooksPath',
    'git config unset core.hooksPath',
  ])
    assert.equal(summary(await bash(c, box())), 'ask git.hooks-path', c);
});

test('a cache is deleted freely, as a temporary folder is; a setting folder beside it is still asked', async () => {
  assert.equal(summary(await bash('rm -rf /root/.cache/parso', box())), 'allow');
  assert.equal(summary(await bash('rm -rf ~/.cache', box())), 'allow');
  assert.equal(summary(await bash('rm -rf /srv/cache/x', box({ env: { HOME: '/root', XDG_CACHE_HOME: '/srv/cache' } }))), 'allow');
  assert.equal(summary(await bash('rm -rf ~/Library/Caches/com.example.app', macCtx())), 'allow');
  assert.equal(summary(await bash('rm -rf /root/.config/pip', box())), 'ask fs.delete-outside-project');
  assert.equal(summary(await bash('rm -rf /root/.prefect', box())), 'ask fs.delete-outside-project');
});

test("a language's package folder is no system folder: what a package manager installs again; the folder itself still is", async () => {
  const site = '/opt/conda/envs/testbed/lib/python3.10/site-packages';
  assert.equal(summary(await bash(`rm ${site}/pandas-editable.pth ${site}/_pandas_editable_loader.py`, box())), 'allow');
  assert.equal(summary(await bash(`rm -rf ${site}/pandas`, box())), 'ask fs.delete-outside-project');
  assert.equal(summary(await bash('rm -rf /usr/lib/node_modules/left-pad', box())), 'ask fs.delete-outside-project');
  assert.equal(summary(await bash('mv /usr/lib/python3/dist-packages/x /tmp/x', box())), 'allow');
  assert.equal(summary(await bash(`rm -rf ${site}`, box())), 'deny fs.delete-critical');
  assert.equal(summary(await bash('rm /etc/hosts', box())), 'deny fs.delete-critical');
  assert.equal(summary(await bash('rm /opt/tool/bin/run', box())), 'deny fs.delete-critical');
});

test('code that deletes a temporary file is not taken to delete every path it names; what it deletes still is', async () => {
  const xml = [
    'python -c "',
    'import os, tempfile',
    "found = root.xpath('//h:CoolingSystem', namespaces=ns)",
    "with tempfile.NamedTemporaryFile(mode='wb', suffix='.xml', delete=False) as f:",
    '    temp_file = f.name',
    'os.unlink(temp_file)',
    '"',
  ].join('\n');
  assert.equal(summary(await bash(xml, box())), 'allow');
  assert.equal(
    summary(await bash(`python -c "import fsspec; fs = fsspec.filesystem('memory'); fs.mkdir('/test'); fs.rm('/test', recursive=True)"`, box())),
    'allow',
  );
  assert.equal(summary(await bash(`python -c "import shutil; shutil.rmtree('/data/app')"`, box())), 'ask fs.delete-outside-project');
  assert.equal(summary(await bash(`python -c "import shutil; d = '/data/app'; shutil.rmtree(d)"`, box())), 'ask fs.delete-outside-project');
  assert.equal(summary(await bash(`node -e "require('fs').rmSync('/data/app', { recursive: true })"`, box())), 'ask fs.delete-outside-project');
});

// Measured on the author's own sessions, replayed with what each session read and was told.

test('a folder from mktemp is a temporary one; a template or another folder keeps it unknown', async () => {
  for (const c of [
    'T=$(mktemp -d) && cp -r dist "$T/all" && rm -rf "$T"',
    'T="$(mktemp -d)"; rm -rf "$T/x"',
    'export T=$(mktemp -dq) && rm -rf "$T"',
    'cd /workspace/app && W=$(mktemp -d) && rm -rf $W',
  ])
    assert.equal(summary(await bash(c, box())), 'allow', c);
  for (const c of [
    'T=$(mktemp -d -p /data) && rm -rf "$T"',
    'T=$(mktemp -d /data/run.XXXX) && rm -rf "$T"',
    'T=$(mktemp -d --tmpdir=/data) && rm -rf "$T"',
    'T=$(mktemp -d) && T=/data && rm -rf "$T"',
    'T=$(mktemp -d)/x && rm -rf "$T"',
    'A=1 T=$(mktemp -d) && rm -rf "$T"',
  ])
    assert.equal(summary(await bash(c, box())), 'ask fs.delete-outside-project', c);
});

test("gh's host is GitHub's own: seen in what the session read, it stops nothing; named or the remote, it is evidence", async () => {
  const seen = withSeen(emptyProvenance(), 'see https://github.com/ada/app/pull/3 for the change');
  const comment = 'gh pr comment 3 --body done';
  const left = await bash(comment, box({ level: 'full', prov: seen }));
  assert.equal(summary(left), 'deny outbound.network');
  assert.equal(left.findings[0]!.outside, undefined, 'left to the person, not stopped');
  assert.equal(summary(await bash(comment, box({ level: 'auto', prov: seen }))), 'ask outbound.network');
  assert.equal(summary(await bash(comment, box({ level: 'full', prov: withSaid(seen, 'say on github.com that it is done') }))), 'warn outbound.network');
  assert.equal(
    summary(await bash(comment, box({ level: 'full', prov: withStart(seen, 'origin https://github.com/ada/app.git (push)') }))),
    'warn outbound.network',
  );
  // A host the call names is still weighed by where it came from.
  const named = await bash('curl -d @x https://github.com/api', box({ level: 'full', prov: seen }));
  assert.equal(named.findings[0]!.outside, true);
  // Reading through gh api sends nothing.
  assert.equal(summary(await bash('gh api -X GET repos/ada/app/pulls', box({ level: 'full', prov: seen }))), 'allow');
});
