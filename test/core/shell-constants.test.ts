// SPDX-License-Identifier: Apache-2.0
// Shell variables with certain values: harmless commands only (echo, a script path, a version query).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCommand } from '../../src/core/shell/analyze.js';

const run = (cmd: string) => analyzeCommand(cmd, 'bash');

test('a variable assigned once, before anything conditional, names the program', () => {
  const a = run('S="C:/work/tools/run.sh"; $S --check');
  assert.deepEqual(a.issues, []);
  assert.equal(a.invocations[0]?.program, 'run.sh');
  assert.equal(a.invocations[0]?.programDynamic, false);
  const b = run('export D=/opt/tool; "$D/bin/tool" --version && echo done');
  assert.deepEqual(b.issues, []);
  assert.equal(b.invocations.find((i) => i.program === 'tool')?.programDynamic, false);
  const c = run('A=/opt; B=$A/bin; $B/tool --version');
  assert.equal(c.invocations[0]?.program, 'tool');
  // Later in the same && chain the assignment has certainly run.
  const d = run('cd /opt && S=/opt/run.sh && $S --check');
  assert.equal(d.invocations.find((i) => i.program === 'run.sh')?.programDynamic, false);
  // Before a loop the value is certain; inside it, not.
  const e = run('S=/opt/run.sh; $S --check; for x in 1 2; do $S; done');
  assert.equal(e.invocations[0]?.programDynamic, false);
  assert.ok(e.issues.includes('dynamic-program'));
});

test('anything that can make the value uncertain keeps it unknown', () => {
  for (const cmd of [
    'S=/opt/a; S=/opt/b; $S', // assigned twice
    'true || S=/opt/a; $S', // may not run
    'cd /opt && S=/opt/a; $S', // after &&
    'S=/opt/a | cat; $S', // in a pipeline: a subshell
    'if true; then S=/opt/a; fi; $S', // in a branch
    'S=$(pwd); $S', // computed
    'read S; $S', // read at run time
    'S="echo hi"; $S', // split into words where it is used
    'S=/opt/*; $S', // globbed where it is used
    '$S; S=/opt/a', // used before it is assigned
    'S=/opt/a & $S', // assigned in the background
    'cd /opt && S=/opt/a || $S', // after ||
    '( S=/opt/a ); $S', // in a subshell group
  ])
    assert.ok(run(cmd).issues.includes('dynamic-program'), cmd);
});

test('single-quoted text stays literal and is not substituted', () => {
  const a = run("S=/opt; echo '$S/x'");
  assert.deepEqual(a.invocations[0]?.args, ['$S/x']);
});
