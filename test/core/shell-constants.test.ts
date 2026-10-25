// SPDX-License-Identifier: Apache-2.0
// Shell variables with certain values: harmless commands only (echo, a script path, a version query).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCommand, straightLineConstants } from '../../src/core/shell/analyze.js';
import { parseBash } from '../../src/core/shell/bash.js';

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
    'S=/opt/@(a|b); $S', // an extended pattern, globbed with extglob on
    'S=/opt/a; declare +x -n S=T; $S', // a nameref after another option
    "S=/opt/a; pr''intf -v S /opt/b; $S", // printf -v, its name split by quotes
    'S=/opt/a; command printf -v S /opt/b; $S', // the same builtin behind `command`
    'S=/opt/a; builtin read S; $S', // and behind `builtin`
    'S=/opt/a; declare $N=/opt/b; $S', // a name computed when it runs
    'coproc S=/opt/a; $S', // in a coprocess: a subshell
    '_=/opt/a; echo /opt/b; $_', // set by bash after each command
    'PWD=/opt/a; cd /opt/b; $PWD', // set by bash at a cd
  ])
    assert.ok(run(cmd).issues.includes('dynamic-program'), cmd);
});

test('single-quoted text stays literal and is not substituted', () => {
  const a = run("S=/opt; echo '$S/x'");
  assert.deepEqual(a.invocations[0]?.args, ['$S/x']);
});

/** What the analysis finds of the `rm` in a command: its arguments, and which of them are only known when it runs. */
const found = (cmd: string) =>
  run(cmd)
    .invocations.filter((i) => i.program === 'rm')
    .map((i) => [i.args, i.dynamic, i.programDynamic]);

test('a comment, wherever it stands, changes nothing about the values a variable holds', () => {
  const body = 'S=/opt/zz\nrm -rf "$S/x"';
  const plain = found(body);
  assert.deepEqual(plain, [[['-rf', '/opt/zz/x'], [false, false], false]], 'the plain command fills the value in');
  for (const [where, cmd] of Object.entries({
    'a first line': `# note\n${body}`,
    'a shebang': `#!/bin/bash\n${body}`,
    'a shebang, blank lines and more': `#!/usr/bin/env bash\n\n# a\n  # b\n\n${body}`,
    'a carriage return': `# note\r\n${body}`,
    'between commands': 'S=/opt/zz\n# note\nrm -rf "$S/x"',
    'after a command': 'S=/opt/zz # note\nrm -rf "$S/x" # note',
    'after an operator': 'S=/opt/zz && # note\nrm -rf "$S/x"',
    'after a separator': 'S=/opt/zz; # note\nrm -rf "$S/x"',
    'beside a separator': 'S=/opt/zz;# note\nrm -rf "$S/x"',
    'between the words of a list': 'S=/opt/zz\n# a\n\n# b\nrm -rf "$S/x"',
    'ending in an ampersand': 'S=/opt/zz\nrm -rf "$S/x" # in the background &',
    'saying what the script is not': '# a loop, if you like, for each file: read it, then source it, eval it, exec it, trap it, unset it\n' + body,
    'saying so between commands': 'S=/opt/zz # while true; do until; done case esac function select\nrm -rf "$S/x"',
    'beginning like a group': '# (this is a subshell) { and a group }\n' + body,
    'repeating the assignment': '# S=/opt/zz\n' + body,
    'repeating the assignment, between': 'S=/opt/zz\n# S=/opt/zz\nrm -rf "$S/x"',
    'repeating the command': '# rm -rf "$S/x"\n' + body,
    'repeating every word': '# S=/opt/zz rm -rf "$S/x" S=/opt/zz\n' + body,
    'inside a substitution': 'S=/opt/zz\necho $(ls # for the list\n) >/dev/null\nrm -rf "$S/x"',
  }))
    assert.deepEqual(found(cmd), plain, where);
  // The same when the comment is the only thing that was in the way: `$T` is a new temporary folder.
  const temp = found('T=$(mktemp -d)\nrm -rf "$T/x"');
  assert.deepEqual(temp, [[['-rf', '/tmp/tmp.mktemp/x'], [false, false], false]]);
  for (const cmd of ['# note\nT=$(mktemp -d)\nrm -rf "$T/x"', 'T=$(mktemp -d) # scratch\nrm -rf "$T/x"', 'T=$(mktemp -d)\n# scratch\nrm -rf "$T/x"'])
    assert.deepEqual(found(cmd), temp, cmd);
});

test('the values are read where the parser says the commands stand; a script it does not place gets none', () => {
  const src = 'S=/opt/a; $S';
  const script = parseBash(src);
  assert.deepEqual(
    straightLineConstants(src, script).map((m) => [...m]),
    [[], [['S', '/opt/a']]],
  );
  const unplaced = { ...script, commands: script.commands.map((c) => ({ ...c, at: undefined })) };
  assert.deepEqual(
    straightLineConstants(src, unplaced).map((m) => m.size),
    [0, 0],
  );
  const empty = { ...script, commands: script.commands.map((c) => ({ ...c, raw: '' })) };
  assert.deepEqual(
    straightLineConstants(src, empty).map((m) => m.size),
    [0, 0],
  );
});

test('a comment hides nothing that is uncertain, and what is uncertain stays so beside one', () => {
  // A branch, a loop, a second assignment, a pipeline, a read: not straight, with a comment before or after.
  for (const cmd of [
    'if true; then S=/opt/a; fi; $S',
    'for i in 1; do S=/opt/a; done; $S',
    'S=/opt/a; S=/opt/b; $S',
    'S=/opt/a | cat; $S',
    'read S; $S',
    'true || S=/opt/a; $S',
    'S=$(pwd); $S',
    '( S=/opt/a ); $S',
    'echo "a # b"; for i in 1; do S=/opt/a; done; $S',
    'echo $# ; for i in 1; do S=/opt/a; done; $S',
    'echo ${#S} "$#" ; if true; then S=/opt/a; fi; $S',
  ]) {
    assert.ok(run(cmd).issues.includes('dynamic-program'), cmd);
    assert.ok(run(`# note\n${cmd}`).issues.includes('dynamic-program'), `# note\n${cmd}`);
    assert.ok(run(`${cmd.replace('; ', ' # note\n')}`).issues.includes('dynamic-program'), cmd.replace('; ', ' # note\n'));
  }
  // A group, a block or a sourced file that begins its line after a line with a comment on it ends what is known: the
  // comment's own line end is a line end still.
  for (const group of ['( true )', '{ true; }', '. ./x.sh', '(true)']) {
    assert.ok(run(`S=/opt/a\n${group}\n$S`).issues.includes('dynamic-program'), group);
    assert.ok(run(`S=/opt/a # note\n${group}\n$S`).issues.includes('dynamic-program'), `a comment, then ${group}`);
    assert.ok(run(`S=/opt/a;# note\n${group}\n$S`).issues.includes('dynamic-program'), `a glued comment, then ${group}`);
  }
  // A loop written in the script itself, not in a comment, still ends what is known, with a comment beside it or not.
  assert.deepEqual(found('S=/opt/zz\nfor i in 1; do :; done # note\nrm -rf "$S/x"')[0]?.[0], ['-rf', '$S/x']);
  assert.deepEqual(found('S=/opt/zz\nfor i in 1; do :; done\nrm -rf "$S/x"')[0]?.[0], ['-rf', '$S/x']);
});

test('an array is no value of its name, and every other way of assigning counts as an assignment', () => {
  // The elements of an array are words, and the name stands for the first of them: no known value to fill in.
  for (const cmd of ['S=(/opt/zz)', 'S=(/opt/zz /opt/yy)', 'declare -a S=(/opt/zz)', 'S=/opt/zz\nS+=(/opt/yy)', 'S=/opt/zz\nS[1]=/opt/yy', 'S=/opt/zz\nS+=/yy'])
    assert.deepEqual(found(`${cmd}\nrm -rf "$S/x"`)[0]?.[0], ['-rf', '$S/x'], JSON.stringify(cmd));
  // A comment in the array, or one that looks like it, changes nothing.
  assert.deepEqual(found('S=(/opt/zz # note\n/opt/yy)\nrm -rf "$S/x"')[0]?.[0], ['-rf', '$S/x']);
  assert.deepEqual(found('# S=(/opt/zz)\nS=/opt/zz\nrm -rf "$S/x"')[0]?.[0], ['-rf', '/opt/zz/x']);
});
