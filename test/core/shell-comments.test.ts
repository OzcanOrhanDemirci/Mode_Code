// SPDX-License-Identifier: Apache-2.0
/**
 * What the parser tells of the text it read, and what the analysis makes of it: where the comments and the bodies of
 * here-documents stand, where each command's own text stands, and the command as its words are read, with its
 * comments blanked. The values a script's variables hold are filled in from the text between its commands, and a
 * comment or the body of a here-document is no command, so what stands between commands is read with both left out.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCommand } from '../../src/core/shell/analyze.js';
import { parseBash } from '../../src/core/shell/bash.js';
import { parseCmd } from '../../src/core/shell/cmd.js';
import { parsePowerShell } from '../../src/core/shell/powershell.js';
import { fc, shellish } from '../helpers/prop.js';

test('the comments of a script are told, each from its hash to its line end, and where each command stands', () => {
  const textOf = (src: string) => (parseBash(src).comments ?? []).map(([from, to]) => src.slice(from, to));
  assert.deepEqual(textOf('# one\na # two\nb\n  # three'), ['# one', '# two', '# three']);
  assert.deepEqual(textOf('a && # after an operator\nb ;# glued\nc'), ['# after an operator', '# glued']);
  assert.deepEqual(textOf('#!/bin/sh\r\na # crlf\r\n'), ['#!/bin/sh\r', '# crlf\r'], 'up to the line feed');
  // A hash that is no comment: inside a word or a quote, a parameter, arithmetic, a here-document's text.
  assert.deepEqual(textOf('echo a#b "# c" \'# d\' ${#x} $# $((16#ff)) \\# e'), []);
  assert.deepEqual(textOf("cat <<'EOF'\n# data\nEOF\n# real"), ['# real']);
  assert.deepEqual(textOf('case $x in\n  a) # in a case\n    b;;\nesac'), ['# in a case']);
  // Inside $( ), <( ) and >( ) the text is this text's: their comments stand in it. Inside `…`, a heredoc's text or ${…} it is not.
  assert.deepEqual(textOf('echo $(ls # inner\n) # outer'), ['# inner', '# outer']);
  assert.deepEqual(textOf('diff <(a # one\n) >(b # two\n) # three'), ['# one', '# two', '# three']);
  assert.deepEqual(textOf('echo `ls # inner` # outer'), ['# outer']);
  assert.deepEqual(textOf('cat <<EOF\n$(ls # inner\n)\nEOF'), []);
  // The parse of a script that is not bash has none to tell.
  assert.equal(parseCmd('dir').comments, undefined);
  // Each command says where its text stands: after the blanks and the operator that joined it to the one before.
  for (const src of [
    'a b',
    '  a b  ',
    'a && b || c; d | e & f\ng |& h',
    '# note\n\n  a x # trailing\n# more\n b y',
    'a &&\n# between\n b',
    'cat <<EOF > f\nbody\nEOF\nb',
    'x=1 y=2 cmd >out 2>&1',
    'f() { a; }\nf',
    'echo $(a; b) `c` && d',
  ])
    for (const c of parseBash(src).commands) assert.equal(src.slice(c.at, c.at! + c.raw.length), c.raw, `${src} → ${c.raw}`);
});

test('the bodies of here-documents are told, each with its closing line, in order', () => {
  const textOf = (src: string) => (parseBash(src).bodies ?? []).map(([from, to]) => src.slice(from, to));
  assert.deepEqual(textOf('cat <<EOF\nbody\nEOF\nnext'), ['body\nEOF\n']);
  assert.deepEqual(textOf("cat <<-'X'\n\t# not a comment\n\tX\nnext"), ['\t# not a comment\n\tX\n'], 'the dash form strips tabs from the closing line');
  assert.deepEqual(textOf('cat <<A <<B\none\nA\ntwo\nB\nnext'), ['one\nA\n', 'two\nB\n']);
  assert.deepEqual(textOf('cat <<EOF\r\nbody\r\nEOF\r\nnext'), ['body\r\nEOF\r\n']);
  assert.deepEqual(textOf('cat <<EOF\nEOF\nnext'), ['EOF\n'], 'an empty body');
  assert.deepEqual(textOf('cat <<EOF\nnever closed'), ['never closed'], 'to the end of the text');
  assert.deepEqual(textOf('cat <<< word\nnext'), [], 'a here-string has no body');
  assert.deepEqual(textOf('echo $(cat <<EOF\ninside\nEOF\n) after'), ['inside\nEOF\n'], 'inside $( ): read in this text');
  assert.deepEqual(
    textOf('cat <<EOF\n$(cat <<IN\nnested\nIN\n)\nEOF'),
    ['$(cat <<IN\nnested\nIN\n)\nEOF'],
    "a body's own substitutions are read from the body: only the body is told",
  );
  assert.equal(parseCmd('dir').bodies, undefined);
});

test('the command after a here-document stands after its body, and its text does not begin with the body', () => {
  for (const [src, next] of [
    ['cat <<EOF > f\nbody\nEOF\nrm -rf x', 'rm -rf x'],
    ['cat <<EOF > f\nbody\nEOF\n\nrm -rf x', 'rm -rf x'],
    ['cat <<EOF > f\nbody\nEOF\n# note\nrm -rf x', 'rm -rf x'],
    ["cat <<'A' <<B | grep x\none\nA\ntwo\nB\nrm -rf x", 'rm -rf x'],
    ['cat <<EOF\r\nbody\r\nEOF\r\nrm -rf x', 'rm -rf x'],
  ] as const) {
    const cmds = parseBash(src).commands;
    const last = cmds[cmds.length - 1]!;
    assert.equal(last.raw, next, JSON.stringify(src));
    assert.equal(src.slice(last.at), next, JSON.stringify(src));
  }
});

test('comments are merged out of a script of a hundred and fifty thousand of them without a stack overflow', () => {
  const src = `echo $(\n${'# c\n'.repeat(150000)})\n${'# d\n'.repeat(10)}rm x`;
  const script = parseBash(src);
  assert.equal(script.comments!.length, 150010);
  assert.equal(script.commands.length, 2);
  assert.equal(script.commands[1]!.raw, 'rm x');
  assert.equal(analyzeCommand(src, 'bash').invocations.length, 2);
});

test('the code of a bash command is the command with its comments blanked, every other character where it was', () => {
  const code = (c: string) => analyzeCommand(c, 'bash').code;
  const blanks = (n: number) => ' '.repeat(n);
  assert.equal(code('# note\nrm x # more\n  # last'), `${blanks(6)}\nrm x ${blanks(6)}\n  ${blanks(6)}`);
  assert.equal(code('#!/bin/bash\r\nls\r\n'), `${blanks(12)}\nls\r\n`, 'a comment takes its carriage return with it');
  assert.equal(code('echo a#b "# c" \'# d\' ${#x} $# $((16#ff))'), 'echo a#b "# c" \'# d\' ${#x} $# $((16#ff))', 'a hash that starts no comment');
  assert.equal(code('echo $(ls # inner\n) # outer'), `echo $(ls ${blanks(7)}\n) ${blanks(7)}`, 'a comment inside $( ) too');
  assert.equal(code('cat <<EOF\n# data\nEOF'), 'cat <<EOF\n# data\nEOF', 'the body of a here-document is data, kept as it is');
  assert.equal(code('a;# glued\nb&# after an ampersand\nc|# after a pipe\nd'), `a;${blanks(7)}\nb&${blanks(20)}\nc|${blanks(14)}\nd`);
  // The code of a script that is not bash is the command: its comments are not read as these are.
  for (const c of ['# note\nrm x', 'dir # note', 'REM note\r\ndir']) {
    assert.equal(analyzeCommand(c, 'powershell').code, c);
    assert.equal(analyzeCommand(c, 'cmd').code, c);
  }
});

/** The words of each command the parser finds, one string per command (an assignment alone has none). */
const wordsOf = (src: string) =>
  parseBash(src)
    .commands.map((c) => c.argv.map((w) => w.text).join(' '))
    .filter((w) => w !== '');

test('where bash reads no comment the parser tells none: what follows the hash is read as the commands it holds', () => {
  const code = (c: string) => analyzeCommand(c, 'bash').code;
  // A carriage return alone is no line end (`a\r#x` is one word); the parentheses of a regular expression after `=~`, of an
  // array's elements and of an extended pattern are their word's own. A hash in them starts no comment, and the delete
  // after it is a command, as bash runs it (the delete is the one this text stands for in a test of the belt).
  for (const src of [
    'echo a\r#x; rm -rf y',
    'echo a\r\r#x; rm -rf y',
    'echo a \r#x; rm -rf y',
    'echo a\r# note\nrm -rf y',
    '[[ $c =~ ^(#x)$ ]]; rm -rf y',
    '[[ $c =~ ^(#x)$ ]] && rm -rf y',
    '[[ -n $c && $c =~ (a|#x) ]] && rm -rf y',
    '[[ $c =~ a|#x ]]; rm -rf y',
    'if [[ $c =~ ^(a #x) ]]; then rm -rf y; fi',
    'time [[ $c =~ ^(#x)$ ]]; rm -rf y',
    'time -p [[ $c =~ ^(#x)$ ]]; rm -rf y',
    'time -- [[ $c =~ ^(#x)$ ]]; rm -rf y',
    'time ! [[ $c =~ ^(#x)$ ]]; rm -rf y',
    'time -p ! [[ $c =~ ^(#x)$ ]]; rm -rf y',
    'a=(1)#x; rm -rf y',
    'a+=(1 2)#x; rm -rf y',
    'a[2]=(1)#x; rm -rf y',
    'declare -a a=(1)#x; rm -rf y',
    'a=([0]=x [1]="y z")#x; rm -rf y',
    'a=($(true))#x; rm -rf y',
    'echo @(#x); rm -rf y',
    'case $c in @(#x|y)) rm -rf y;; esac',
    'echo +(#x) *(#y) ?(#z); rm -rf y',
    'echo !(#x); rm -rf y',
    'shopt -s extglob\necho !(#x|y); rm -rf y',
  ]) {
    assert.deepEqual(parseBash(src).comments, [], JSON.stringify(src));
    assert.ok(wordsOf(src).includes('rm -rf y'), JSON.stringify(src));
    assert.equal(code(src), src, JSON.stringify(src));
  }
  // Where bash does read one, it is one: after a blank, a line end or a separator, a group's opening, inside an array.
  for (const [src, comment] of [
    ['echo a #x; rm -rf y', '#x; rm -rf y'],
    ['echo a\t#x', '#x'],
    ['echo a\r\n#x', '#x'],
    ['echo a;#x; rm -rf y', '#x; rm -rf y'],
    ['(#x\ntrue)', '#x'],
    ['echo $(#x\ntrue)', '#x'],
    ['a=(1 #x\n2)\nrm -rf y', '#x'],
    ['a=(#x\n1)', '#x'],
    ['[[ a =~ b ]] #x', '#x'],
    ['[[ a =~ b ]]\n#x', '#x'],
    ['[[ a =~ b ]]; true #x', '#x'],
    ['echo =~ #x', '#x'],
  ] as const) {
    const told = (parseBash(src).comments ?? []).map(([from, to]) => src.slice(from, to));
    assert.deepEqual(told, [comment], JSON.stringify(src));
    assert.ok(!code(src).includes('#'), JSON.stringify(src));
  }
  // `=~` outside `[[ … ]]` takes no regular expression: a bar after it is a pipe.
  assert.deepEqual(wordsOf('echo =~ a|rm -rf y'), ['echo =~ a', 'rm -rf y']);
  assert.deepEqual(wordsOf('[[ a == b ]]; echo =~ a|rm -rf y'), ['[[ a == b ]]', 'echo =~ a', 'rm -rf y'], 'after the conditional ended');
  assert.deepEqual(wordsOf('echo [[ a =~ b|rm -rf y'), ['echo [[ a =~ b', 'rm -rf y'], 'a `[[` that is no command opens none');
});

test('the parentheses that belong to a word keep it whole, and an array holds words, not commands', () => {
  // The element of an array is a word, even when it reads like a command: nothing runs there (a substitution does).
  assert.deepEqual(wordsOf('a=(rm -rf y)'), []);
  const ran = (src: string) => analyzeCommand(src, 'bash').invocations.map((i) => [i.program, ...i.args].join(' '));
  assert.deepEqual(ran('a=(rm -rf y)'), []);
  assert.deepEqual(ran('a=($(rm -rf y))'), ['rm -rf y']);
  assert.deepEqual(ran('a=(x `rm -rf y`)'), ['rm -rf y']);
  assert.deepEqual(parseBash('a=(1 2) b=3 cmd').commands[0]?.assigns, ['a=(…)', 'b=3']);
  assert.deepEqual(wordsOf('a=(1 2)\nrm -rf y'), ['rm -rf y']);
  assert.deepEqual(wordsOf('declare -a a=(1 2) && rm -rf y'), ['declare -a a=(…)', 'rm -rf y']);
  // A regular expression and an extended pattern are one word with their parentheses, bars and inner blanks.
  assert.deepEqual(wordsOf('[[ $c =~ ^(a|b c)+$ ]] && rm -rf y'), ['[[ $c =~ ^(a|b c)+$ ]]', 'rm -rf y']);
  assert.deepEqual(wordsOf('[[ $c =~ ^[[:space:]]+$ ]]'), ['[[ $c =~ ^[[:space:]]+$ ]]']);
  assert.deepEqual(wordsOf('[[ $c =~ "a b" ]]'), ['[[ $c =~ a b ]]']);
  assert.deepEqual(wordsOf('ls @(a|b) +(c) | wc'), ['ls @(a|b) +(c)', 'wc']);
  // A negation is not a pattern: `!(` begins a group of commands when `extglob` is off, and the commands in it are read.
  assert.deepEqual(wordsOf('if !(rm -rf y); then true; fi'), ['rm -rf y', 'true']);
  // What does not close is said, so a result is not trusted: the belt asks about a risky command that holds one.
  for (const src of ['a=(1 2', '[[ $c =~ ^(a ]]', 'echo @(a', 'a=(1 2; rm -rf y']) assert.ok(parseBash(src).issues.includes('unbalanced-paren'), src);
  // A character bash refuses in an array (`;`, `|`, `&`, `<`, `>`, `(`) ends it there, and the lines after it are commands.
  for (const src of ['a=(x|\nrm -rf y\n)', 'a=(x;\nrm -rf y\n)', 'a=(x &\nrm -rf y\n)', 'a=(x <\nrm -rf y\n)', 'a=(x (\nrm -rf y\n)']) {
    assert.ok(ran(src).includes('rm -rf y'), JSON.stringify(src));
    assert.ok(parseBash(src).issues.includes('unbalanced-paren'), JSON.stringify(src));
  }
  // A quoted `time`, one after an assignment, with another option, a quoted one or its options out of order is a program:
  // its `[[` opens no regular expression. Nor does a `[[` inside an open conditional, which is a word there.
  for (const src of [
    '"time" [[ a\necho =~ b|rm -rf y',
    'X=1 time [[ a\necho =~ b|rm -rf y',
    'time -x [[ a\necho =~ b|rm -rf y',
    'time "-p" [[ a || echo =~ b|rm -rf y',
    'time -- -p [[ a || echo =~ b|rm -rf y',
    '[[ a && [[ ]] && echo =~ b|rm -rf y',
    // After a `|` or `coproc`, `time` is the program of that name.
    'echo x | time [[ a =~ b|rm -rf y ]]',
    'coproc time -p [[ a =~ b|rm -rf y ]]',
  ])
    assert.ok(
      ran(src).some((c) => c.startsWith('rm -rf y')),
      JSON.stringify(src),
    );
  // A conditional the parser does not open where bash does (`time time [[`) leaves a group open: the parse is not trusted.
  assert.ok(parseBash('time time [[ $c =~ ^(#x)$ ]]; rm -rf y').issues.includes('unbalanced-paren'));
  // Inside `${…}` a quote is the shell's: the brace in it closes nothing, and the command after the expansion is read.
  assert.ok(ran('echo ${x:-"} #"}; rm -rf y').includes('rm -rf y'));
  assert.ok(ran("echo ${x:-'} #'}; rm -rf y").includes('rm -rf y'));
  // Inside double quotes too (bash 5.3: `"${x:-'}'}"` is `'}'`), and a quote in a quote is a letter.
  assert.ok(ran(`echo "\${x#'"'}"; rm -rf y`).includes('rm -rf y'));
  // Where the quotes and the first brace end it in different places, both readings count, and the parse is not trusted.
  const both = `echo "\${x:-'}"; rm -rf y; echo "'}"`;
  assert.ok(ran(both).includes('rm -rf y'));
  assert.ok(parseBash(both).issues.includes('expansion-ambiguous'));
  assert.equal(parseBash('echo ${x:-a}; rm -rf y').issues.includes('expansion-ambiguous'), false);
  // Only another `${` nests: a bare brace in it is a letter (`${x:-{}` ends at its first `}`), escaped `\${` too.
  assert.ok(ran('echo ${x:-{}; rm -rf y; echo }').includes('rm -rf y'));
  assert.ok(ran('echo ${x:-\\${}; rm -rf y; echo }').includes('rm -rf y'));
  // Nor `$${`: `$$` is the process's number, and its `{` a letter.
  assert.ok(ran('echo ${x:-$${}; rm -rf y; echo }').includes('rm -rf y'));
  assert.deepEqual(wordsOf('echo ${x:-${y:-a}}; rm -rf y'), ['echo ${x:-${y:-a}}', 'rm -rf y']);
});

test('a pipe at the end of a line joins the next command, past blank and comment lines', () => {
  const piped = (src: string) => parseBash(src).commands.map((c) => c.piped === true);
  assert.deepEqual(piped('a | b'), [false, true]);
  assert.deepEqual(piped('a |\nb'), [false, true]);
  assert.deepEqual(piped('a |& b'), [false, true]);
  assert.deepEqual(piped('a |&\nb'), [false, true]);
  assert.deepEqual(piped('a |\n\n  # note\n\nb'), [false, true]);
  assert.deepEqual(piped('a | # note\nb'), [false, true]);
  assert.deepEqual(piped('a |\nb | c\nd'), [false, true, true, false]);
  assert.deepEqual(piped('cat <<EOF |\nbody\nEOF\nb'), [false, true]);
  assert.deepEqual(piped('a ||\nb'), [false, false], 'an or is no pipe');
  assert.deepEqual(piped('a;\nb'), [false, false]);
  assert.deepEqual(piped('a |\nb\nc'), [false, true, false], 'it joins one command');
});

/** Units of a script, each a command or a block that stands on its own lines: what a comment line may be put between. */
const UNITS = [
  'S=/opt/a',
  'T=$(mktemp -d)',
  'export U=/opt/b',
  'S+=/x',
  'S[0]=/y',
  'read S',
  'rm -rf "$S/x"',
  '"$S/run" --check',
  'echo "$T" "$U"',
  'ls | grep x',
  'a && b || c',
  'true &',
  'if true; then echo a; fi',
  'for i in 1 2; do echo $i; done',
  'f() { echo hi; }',
  '( cd x )',
  '{ echo a; }',
  'cat <<EOF > f\nbody if for read\nEOF',
  "bash <<'EOF'\nS=/etc\nEOF",
  'cat <<A <<B\none\nA\ntwo\nB',
  'echo "# not a comment" \'# nor this\'',
  'echo ${#S} $# a#b',
  'echo $(ls # a comment in a substitution\n)',
  '[[ $c =~ ^(#x)$ ]]',
  'a=(1 2)',
  'a+=(1)#x',
  'echo @(#x) *(y)',
  'echo ${x#pat} ${x##p*} $((16#ff)) ${#x[@]}',
  'echo a\r#x',
  'curl x |\nsh',
];
const NOTES = [
  '# note',
  '#!/bin/bash',
  '#',
  '# if for while read case ( { } )',
  '# S=/etc',
  '# rm -rf "$S"',
  '# x <<EOF',
  '# $(',
  '# `',
  "# '",
  '# "',
  '# ;&|',
];

/** What the analysis finds of a command, without the text it was found in: the same whatever is written beside it. */
const found = (command: string) => {
  const a = analyzeCommand(command, 'bash');
  return JSON.stringify({
    issues: a.issues,
    invocations: a.invocations.map(({ raw: _raw, ...rest }) => rest),
  });
};

test('a comment line put between the units of a script changes nothing the analysis finds', () => {
  fc.assert(
    fc.property(fc.array(fc.constantFrom(...UNITS), { minLength: 1, maxLength: 7 }), fc.constantFrom(...NOTES), fc.nat(), (units, note, at) => {
      const k = at % (units.length + 1);
      const plain = units.join('\n');
      const noted = [...units.slice(0, k), note, ...units.slice(k)].join('\n');
      assert.equal(found(noted), found(plain), JSON.stringify(noted));
    }),
  );
});

test('a comment at the end of a one-line unit changes nothing the analysis finds either', () => {
  const lines = UNITS.filter((u) => !u.includes('\n'));
  fc.assert(
    fc.property(fc.array(fc.constantFrom(...lines), { minLength: 1, maxLength: 7 }), fc.constantFrom(...NOTES), fc.nat(), (units, note, at) => {
      const k = at % units.length;
      const noted = units.map((u, i) => (i === k ? `${u} ${note}` : u)).join('\n');
      assert.equal(found(noted), found(units.join('\n')), JSON.stringify(noted));
    }),
  );
});

test('every command says where its text stands, every comment starts at a hash and ends at its line, and a body ends with a line', () => {
  fc.assert(
    fc.property(
      fc.oneof(
        shellish,
        fc.array(fc.constantFrom(...UNITS, ...NOTES), { maxLength: 8 }).map((a) => a.join('\n')),
      ),
      (src) => {
        const script = parseBash(src);
        for (const c of script.commands) assert.equal(src.slice(c.at, c.at! + c.raw.length), c.raw, JSON.stringify(src));
        const ranges: [number, number][] = [];
        for (const [from, to] of script.comments ?? []) {
          assert.equal(src[from], '#', JSON.stringify(src));
          assert.ok(!src.slice(from, to).includes('\n') && (to === src.length || src[to] === '\n'), JSON.stringify(src));
          ranges.push([from, to]);
        }
        for (const [from, to] of script.bodies ?? []) {
          assert.ok(from === 0 || src[from - 1] === '\n', JSON.stringify(src));
          assert.ok(to === src.length || src[to - 1] === '\n', JSON.stringify(src));
          ranges.push([from, to]);
        }
        ranges.sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < ranges.length; i++) assert.ok(ranges[i - 1]![1] <= ranges[i]![0], `overlap in ${JSON.stringify(src)}`);
      },
    ),
  );
});

test('the code of a command is its text with comments blanked: as long, and different only inside a comment', () => {
  fc.assert(
    fc.property(
      fc.oneof(
        shellish,
        fc.array(fc.constantFrom(...UNITS, ...NOTES), { maxLength: 8 }).map((a) => a.join('\n')),
      ),
      (src) => {
        const { code } = analyzeCommand(src, 'bash');
        assert.equal(code.length, src.length, JSON.stringify(src));
        const comments = parseBash(src).comments ?? [];
        for (let i = 0; i < src.length; i++)
          if (code[i] !== src[i]) assert.ok(code[i] === ' ' && comments.some(([from, to]) => from <= i && i < to), `${JSON.stringify(src)} at ${i}`);
        for (const dialect of ['powershell', 'cmd'] as const) assert.equal(analyzeCommand(src, dialect).code, src);
      },
    ),
  );
  assert.equal(parsePowerShell('# note').comments, undefined);
});
