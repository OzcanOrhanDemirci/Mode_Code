// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPlan, checkReport, sourceProblems } from '../../src/core/flow-checks.js';
import { tIn } from '../../src/core/i18n/index.js';

const keys = (ps: readonly { key: string }[]) => ps.map((p) => p.key.replace(/^flow\.check\./, ''));

const REPORT = `# Two-factor sign-in

## Question

How do we add a second factor?

## Findings

- The login handler lives in one file [2].
- TOTP is the common choice; WebAuthn is stronger [1][3].
  It needs a browser that supports it.

## Sources

1. https://www.rfc-editor.org/rfc/rfc6238: TOTP
2. src/auth/login.ts:42: the handler
3. \`docs/security.md\`
`;

test('a sourced report passes, and its file sources are handed back to be measured', () => {
  const r = checkReport(REPORT);
  assert.deepEqual(r.problems, []);
  assert.equal(r.findings, 2);
  assert.deepEqual(r.sources, [
    { n: 1, kind: 'url', url: 'https://www.rfc-editor.org/rfc/rfc6238' },
    { n: 2, kind: 'file', path: 'src/auth/login.ts', line: 42, lineEnd: null },
    { n: 3, kind: 'file', path: 'docs/security.md', line: null, lineEnd: null },
  ]);
});

test('Turkish headings, bracketed source numbers and ranges are read', () => {
  const tr = `# Rapor\n\n## Bulgular\n\n1. Ayar dosyası tek yerde [1, 2].\n\n## Kaynaklar\n\n- [1] C:/dev/app/src/config.ts:10-20\n- [2] https://example.org/a\n`;
  const r = checkReport(tr);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.sources[0], { n: 1, kind: 'file', path: 'C:/dev/app/src/config.ts', line: 10, lineEnd: 20 });
});

test('what a report lacks is said exactly', () => {
  assert.deepEqual(keys(checkReport('# Notes\n\nSome text.').problems), ['report.noFindings', 'report.noSources']);
  assert.deepEqual(keys(checkReport('## Findings\n\n## Sources\n').problems), ['report.emptyFindings', 'report.emptySources']);
  const r = checkReport('## Findings\n\n- No source here.\n- Cites a ghost [4].\n\n## Sources\n\n1. a book I read\n');
  assert.deepEqual(keys(r.problems), ['report.badSource', 'report.uncited', 'report.dangling']);
  assert.deepEqual(r.problems[2]!.params, { n: 4 });
  // A heading inside a code block is not a section.
  assert.deepEqual(keys(checkReport('```\n## Findings\n```\n').problems), ['report.noFindings', 'report.noSources']);
});

test('file sources are checked against the disk: missing files and lines beyond the end', () => {
  const r = checkReport(REPORT);
  const lines: Record<string, number> = { 'src/auth/login.ts': 30 };
  assert.deepEqual(
    sourceProblems(r.sources, (p) => lines[p] ?? null).map((x) => [x.key, x.params]),
    [
      ['flow.check.report.lineOutside', { n: 2, path: 'src/auth/login.ts', line: 42, lines: 30 }],
      ['flow.check.report.fileMissing', { n: 3, path: 'docs/security.md' }],
    ],
  );
  assert.deepEqual(
    sourceProblems(r.sources, () => 100),
    [],
  );
});

const PLAN = `# Plan

## Context

Why.

## Steps

### 1. Add the TOTP secret to the user record

The migration and the model.
Acceptance: a user has an optional secret; old users still sign in.

### 2. Ask for the code at sign-in

**Acceptance:** a wrong code is refused with a clear message.

## Verification

- \`npm test\`
- \`npm run lint\`

\`\`\`sh
npm run e2e -- --grep sign-in
\`\`\`
`;

test('a plan with numbered steps, acceptance criteria and commands passes', () => {
  const p = checkPlan(PLAN);
  assert.deepEqual(p.problems, []);
  assert.deepEqual(
    p.steps.map((s) => [s.n, s.title, s.acceptance]),
    [
      [1, 'Add the TOTP secret to the user record', 'a user has an optional secret; old users still sign in.'],
      [2, 'Ask for the code at sign-in', 'a wrong code is refused with a clear message.'],
    ],
  );
  assert.deepEqual(p.verification, ['npm test', 'npm run lint', 'npm run e2e -- --grep sign-in']);
});

test('Turkish plans and list-shaped steps are read too', () => {
  const tr = `## Adımlar\n\n1. **Göç dosyası**\n   Kabul: tablo oluşur.\n2. Ekran\n   Kabul ölçütü: kod sorulur.\n\n## Doğrulama\n\n\`flutter test\`\n`;
  const p = checkPlan(tr);
  assert.deepEqual(p.problems, []);
  assert.deepEqual(
    p.steps.map((s) => [s.n, s.acceptance]),
    [
      [1, 'tablo oluşur.'],
      [2, 'kod sorulur.'],
    ],
  );
  assert.deepEqual(checkPlan('## Adımlar\n\n### Adım 1: Göç\n\nKabul: tamam\n\n## Doğrulama\n\n- `npm test`\n').problems, []);
});

test('what a plan lacks is said exactly', () => {
  assert.deepEqual(keys(checkPlan('# Plan\n').problems), ['plan.noSteps', 'plan.noVerification']);
  const p = checkPlan('## Steps\n\n### 1. A\n\nAcceptance: ok\n\n### 3. C\n\nNo criteria here.\n\n## Verification\n\nRun the tests.\n');
  assert.deepEqual(keys(p.problems), ['plan.numbering', 'plan.noAcceptance', 'plan.noCommands']);
  assert.deepEqual(p.problems[0]!.params, { expected: 2, found: 3 });
  assert.deepEqual(keys(checkPlan('## Steps\n\nJust prose.\n\n## Verification\n\n`npm test`\n').problems), ['plan.noSteps']);
  assert.deepEqual(keys(checkPlan('## Steps\n\n### 1. A\n\nAcceptance:\n\n## Verification\n\n`x`\n').problems), ['plan.noAcceptance']);
});

test('every problem reads in both languages with its parameters filled in', () => {
  const r = checkReport('## Findings\n\n- x\n\n## Sources\n\n1. ?\n');
  for (const p of [...r.problems, ...checkPlan('## Steps\n\n### 2. B\n').problems])
    for (const lang of ['en', 'tr'] as const) assert.doesNotMatch(tIn(lang, p.key as never, p.params), /\{\w+\}/, `${p.key} ${lang}`);
});

test('a source names its file first; words in backticks after it are not the path', () => {
  const r = checkReport(
    '## Findings\n\n- One [1]. Two [2]. Three [3].\n\n## Sources\n\n1. note.txt:1: contains only `x`.\n2. `docs/a b.md`: spaces need backticks\n3. see `src/x.ts` for the rest\n',
  );
  assert.deepEqual(r.problems, []);
  assert.deepEqual(
    r.sources.map((s) => (s.kind === 'file' ? [s.path, s.line] : s.url)),
    [
      ['note.txt', 1],
      ['docs/a b.md', null],
      ['src/x.ts', null],
    ],
  );
});

test('one verification command per line: later code spans on the line are notes about it', () => {
  const p = checkPlan(
    '## Steps\n\n### 1. A\n\nAcceptance: ok\n\n## Verification\n\n- `node hello.js | od -c` (expect `hello\n`, no escape bytes)\n- `npm test` and `npm run lint` together\n',
  );
  assert.deepEqual(p.verification, ['node hello.js | od -c', 'npm test']);
});
