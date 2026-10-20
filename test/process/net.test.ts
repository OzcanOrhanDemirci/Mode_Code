// SPDX-License-Identifier: Apache-2.0
/**
 * `mode-code net` as a separate process (docs/safety-belt.md, "Safety net"): none yet; a net laid before a hard
 * reset listed, shown with its steps back, put back without overwriting anything, and then whole; an unknown id.
 * Each with its --json contract.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli, world } from '../helpers/proc.js';
import { layNet } from '../../src/node/net.js';

const hasGit = spawnSync('git', ['--version']).status === 0;
const slash = (p: string) => p.replace(/\\/g, '/');

test('net: none yet, then one listed, shown, put back and whole', { skip: !hasGit && 'git is not installed' }, () => {
  const w = world();
  try {
    const none = cli(w, ['net']);
    assert.equal(none.code, 0, none.err);
    assert.match(none.out, /No safety net yet/);
    assert.deepEqual(cli(w, ['net', '--json']).json?.nets, []);
    assert.equal(cli(w, ['net', 'show', 'nope']).code, 1);
    assert.equal(cli(w, ['net', 'frob']).code, 2);

    const repo = slash(join(w.root, 'app'));
    mkdirSync(repo);
    const git = (...a: string[]) =>
      spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...a], {
        encoding: 'utf8',
      });
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'one');
    git('branch', 'old');
    writeFileSync(join(repo, 'a.txt'), 'two, not committed\n');
    const r = layNet({
      layout: { netDir: slash(join(w.data, 'net')) },
      plan: { kind: 'refs', repo },
      rule: 'git.discard-work',
      tool: 'Bash',
      command: 'git reset --hard',
      session: null,
      now: Date.now(),
    })!;
    git('reset', '--hard', '-q');
    git('branch', '-D', 'old');

    const list = cli(w, ['net']);
    assert.match(list.out, new RegExp(`${r.id} .*git reset --hard .*2 branch tip\\(s\\) · the changes not committed`));
    const shown = cli(w, ['net', 'show', r.id.slice(0, 15), '--json']);
    assert.equal(shown.json?.schema, 'mode-code.net.show/1');
    assert.deepEqual(
      (shown.json?.steps as { what: string }[]).map((s) => s.what),
      ['old', 'stash'],
    );
    assert.match(cli(w, ['net', 'show']).out, /branch old at its tip from before/);
    const back = cli(w, ['net', 'restore', r.id]);
    assert.equal(back.code, 0, back.err + back.out);
    assert.match(back.out, /✓ branch old/);
    assert.match(git('stash', 'show', '-p').stdout, /two, not committed/);
    assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'one\n', 'nothing in the work tree was overwritten');
    const again = cli(w, ['net', 'restore', r.id, '--json']);
    assert.deepEqual([again.code, again.json?.done, again.json?.failed], [0, [], []]);
    assert.match(cli(w, ['net', 'show', r.id]).out, /Nothing to put back/);
  } finally {
    w.done();
  }
});
