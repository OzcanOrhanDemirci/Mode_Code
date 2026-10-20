// SPDX-License-Identifier: Apache-2.0
/**
 * The safety net on a real disk with real git (src/node/net.ts): what a hard reset, a forced branch delete and
 * `git clean` take away is kept, the call then runs, and putting the net back overwrites nothing; a folder kept
 * before a delete comes back; a net past its days goes, with its refs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layNet, listNets, netSteps, pruneNets, restoreNet } from '../../src/node/net.js';

const hasGit = spawnSync('git', ['--version']).status === 0;
const slash = (p: string) => p.replace(/\\/g, '/');

function world() {
  const root = slash(realpathSync.native(mkdtempSync(join(tmpdir(), 'tc-net-'))));
  const repo = `${root}/app`;
  mkdirSync(repo);
  const git = (...a: string[]) =>
    spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...a], {
      encoding: 'utf8',
    });
  git('init', '-q', '-b', 'main');
  writeFileSync(`${repo}/a.txt`, 'one\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'one');
  const layout = { netDir: `${root}/data/net` };
  return { root, repo, git, layout, done: () => rmSync(root, { recursive: true, force: true }) };
}

const head = (w: ReturnType<typeof world>, ref = 'HEAD') => w.git('rev-parse', ref).stdout.trim();

test('a hard reset: the branches and the uncommitted changes are kept, and come back into the stash', { skip: !hasGit && 'git is not installed' }, () => {
  const w = world();
  try {
    w.git('branch', 'feature');
    writeFileSync(`${w.repo}/a.txt`, 'changed, not committed\n');
    const r = layNet({
      layout: w.layout,
      plan: { kind: 'refs', repo: w.repo },
      rule: 'git.discard-work',
      tool: 'Bash',
      command: 'git reset --hard',
      session: 's1',
      now: Date.now(),
    })!;
    assert.ok(r, 'laid');
    assert.deepEqual(
      r.refs.map((x) => x.name),
      ['refs/heads/feature', 'refs/heads/main'],
    );
    assert.ok(r.work, 'the uncommitted change kept as a stash commit');
    // The commits are held by refs of their own, out of git's cleanup.
    assert.match(w.git('for-each-ref', '--format=%(refname)', `refs/modecode/net/${r.id}`).stdout, new RegExp(`refs/modecode/net/${r.id}/`));
    // The call runs: the change is gone, the branch deleted.
    w.git('reset', '--hard', '-q');
    w.git('branch', '-D', 'feature');
    assert.equal(readFileSync(`${w.repo}/a.txt`, 'utf8'), 'one\n');
    // Back: the branch under its name, the change in the stash; nothing overwritten.
    const back = restoreNet(w.layout, r);
    assert.deepEqual([back.failed.length, back.person.length], [0, 0]);
    assert.equal(head(w, 'feature'), head(w, 'main'));
    assert.match(w.git('stash', 'list').stdout, new RegExp(`mode-code net ${r.id}`));
    assert.equal(w.git('stash', 'show', '-p').stdout.includes('changed, not committed'), true);
    assert.deepEqual(netSteps(w.layout, r), [], 'put back once, nothing is left to do');
    assert.deepEqual(
      listNets(w.layout).map((x) => x.id),
      [r.id],
    );
  } finally {
    w.done();
  }
});

test(
  'git clean: the untracked files it would remove are kept, ignored ones only with -x; a folder comes back whole',
  { skip: !hasGit && 'git is not installed' },
  () => {
    const w = world();
    try {
      writeFileSync(`${w.repo}/.gitignore`, 'out/\n');
      w.git('add', '-A');
      w.git('commit', '-q', '-m', 'ignore');
      writeFileSync(`${w.repo}/build.tmp`, 'left over\n');
      mkdirSync(`${w.repo}/dist/deep`, { recursive: true });
      writeFileSync(`${w.repo}/dist/deep/x.js`, 'x\n');
      mkdirSync(`${w.repo}/out`);
      writeFileSync(`${w.repo}/out/y.bin`, 'y\n');
      const r = layNet({
        layout: w.layout,
        plan: { kind: 'untracked', repo: w.repo, args: ['-fd'] },
        rule: 'git.clean',
        tool: 'Bash',
        command: 'git clean -fd',
        session: null,
        now: Date.now(),
      })!;
      assert.deepEqual(r.files.map((f) => f.from).sort(), [`${w.repo}/build.tmp`, `${w.repo}/dist`]);
      w.git('clean', '-fdq');
      assert.ok(!existsSync(`${w.repo}/dist`) && existsSync(`${w.repo}/out/y.bin`));
      const back = restoreNet(w.layout, r);
      assert.equal(back.failed.length, 0);
      assert.equal(readFileSync(`${w.repo}/dist/deep/x.js`, 'utf8'), 'x\n');
      assert.equal(readFileSync(`${w.repo}/build.tmp`, 'utf8'), 'left over\n');
      // Nothing to remove: nothing kept, and no record.
      w.git('clean', '-fdq');
      const none = layNet({
        layout: w.layout,
        plan: { kind: 'untracked', repo: w.repo, args: ['-f'] },
        rule: 'git.clean',
        tool: 'Bash',
        command: 'git clean -f',
        session: null,
        now: Date.now(),
      })!;
      assert.deepEqual([none.files, listNets(w.layout).length], [[], 1]);
    } finally {
      w.done();
    }
  },
);

test('a folder before a delete; a remote tip as last seen; a net past its days goes with its refs', { skip: !hasGit && 'git is not installed' }, () => {
  const w = world();
  try {
    const target = `${w.root}/elsewhere`;
    mkdirSync(`${target}/sub`, { recursive: true });
    writeFileSync(`${target}/sub/n.txt`, 'kept\n');
    const del = layNet({
      layout: w.layout,
      plan: { kind: 'paths', paths: [target, `${w.root}/missing`] },
      rule: 'fs.delete-outside-project',
      tool: 'Bash',
      command: 'rm -rf ../elsewhere',
      session: null,
      now: Date.now(),
    })!;
    assert.deepEqual(del.files.length, 1, 'a path that is not there keeps nothing');
    rmSync(target, { recursive: true });
    restoreNet(w.layout, del);
    assert.equal(readFileSync(`${target}/sub/n.txt`, 'utf8'), 'kept\n');

    // A remote's tip as its remote-tracking branch has it; none there, no net.
    w.git('update-ref', 'refs/remotes/origin/feature', head(w));
    const push = layNet({
      layout: w.layout,
      plan: { kind: 'remote', repo: w.repo, remote: 'origin', branch: 'feature' },
      rule: 'git.force-push',
      tool: 'Bash',
      command: 'git push -f',
      session: null,
      now: Date.now(),
    })!;
    assert.deepEqual(push.remote, { remote: 'origin', branch: 'feature', sha: head(w) });
    assert.equal(
      layNet({
        layout: w.layout,
        plan: { kind: 'remote', repo: w.repo, remote: 'origin', branch: 'nope' },
        rule: 'git.force-push',
        tool: 'Bash',
        command: 'git push -f',
        session: null,
        now: Date.now(),
      }),
      null,
    );
    w.git('update-ref', '-d', 'refs/remotes/origin/feature');
    const steps = netSteps(w.layout, push);
    assert.equal(steps.length, 1);
    assert.equal(steps[0]!.kind, 'person');

    // Past its days: the folder and the refs go.
    assert.equal(pruneNets(w.layout, Date.now() + 15 * 86_400_000), 2);
    assert.deepEqual(listNets(w.layout), []);
    assert.equal(w.git('for-each-ref', 'refs/modecode/').stdout.trim(), '');
  } finally {
    w.done();
  }
});
