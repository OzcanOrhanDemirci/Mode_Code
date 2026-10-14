// SPDX-License-Identifier: Apache-2.0
/**
 * Statements that must hold for every input, checked on generated ones. Where a unit test shows that a
 * case works, these show that no case breaks: the parsers never throw and always finish, paths settle
 * after one resolution, settings survive their file, secrets stay masked, widths are never exceeded.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fc, segment, shellish } from '../helpers/prop.js';
import { analyzeCommand } from '../../src/core/shell/analyze.js';
import { evaluateToolCall } from '../../src/core/belt/evaluate.js';
import { VERDICT_ORDER } from '../../src/core/belt/types.js';
import { expandShortNames, isUnder, joinPath, pathKey, resolvePath, type PathEnv } from '../../src/core/paths.js';
import { parseConfig, serializeConfig, normalizeConfig } from '../../src/core/config.js';
import { maskSecrets, scanSecrets } from '../../src/core/secrets/scan.js';
import { detectKeyword } from '../../src/core/keywords.js';
import { fold, truncate } from '../../src/core/text.js';
import { fitWidth, textWidth } from '../../src/node/width.js';
import { compareVersions } from '../../src/core/version.js';
import { assessQuota, DEFAULT_BUDGET } from '../../src/core/quota.js';
import { currentTurn, transcriptShape } from '../../src/core/transcript.js';
import { buildFooter, checkFooter } from '../../src/core/footer.js';
import { linuxCtx, macCtx, winCtx } from '../helpers/belt.js';

const WIN: PathEnv = { platform: 'win32', home: 'C:/Users/ada', cwd: 'C:/dev/app' };
const MAC: PathEnv = { platform: 'darwin', home: '/Users/ada', cwd: '/Users/ada/app' };
const LINUX: PathEnv = { platform: 'linux', home: '/home/ada', cwd: '/home/ada/app' };

test('the shell parsers never throw, always finish, and answer the same twice', () => {
  fc.assert(
    fc.property(shellish, fc.constantFrom('bash' as const, 'powershell' as const), (cmd, dialect) => {
      const started = Date.now();
      const a = analyzeCommand(cmd, dialect);
      assert.ok(Date.now() - started < 1000, `slow: ${JSON.stringify(cmd)}`);
      assert.ok(Array.isArray(a.invocations) && Array.isArray(a.issues));
      for (const inv of a.invocations) {
        assert.equal(typeof inv.program, 'string');
        assert.equal(inv.args.length, inv.dynamic.length);
        assert.equal(inv.args.length, inv.glob.length);
        assert.equal(inv.writes.length, inv.writeAppend.length);
      }
      assert.deepEqual(analyzeCommand(cmd, dialect), a);
    }),
  );
});

test('the parsers survive any text at all, binary and huge nesting included', () => {
  fc.assert(
    fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (cmd) => {
      analyzeCommand(cmd, 'bash');
      analyzeCommand(cmd, 'powershell');
    }),
  );
  for (const deep of ['$('.repeat(400) + 'x' + ')'.repeat(400), '"'.repeat(5000), '`'.repeat(3001), '{ '.repeat(800), '\\'.repeat(9999)]) {
    const started = Date.now();
    analyzeCommand(deep, 'bash');
    analyzeCommand(deep, 'powershell');
    assert.ok(Date.now() - started < 2000);
  }
});

test('the belt answers every call with one of its four verdicts, never an exception, and the verdict is its strongest finding', async () => {
  const ctxs = [winCtx(), macCtx(), linuxCtx()];
  await fc.assert(
    fc.asyncProperty(
      shellish,
      fc.constantFrom('Bash', 'PowerShell', 'Write', 'Edit', 'Read', 'MultiEdit', 'NotebookEdit', 'Weird'),
      fc.integer({ min: 0, max: 2 }),
      async (text, tool, ci) => {
        const input = tool === 'Bash' || tool === 'PowerShell' ? { command: text } : { file_path: text, content: text, old_string: 'a', new_string: text };
        const d = await evaluateToolCall(tool, input, ctxs[ci]!);
        assert.ok(['allow', 'warn', 'ask', 'deny'].includes(d.verdict));
        const strongest = d.findings.reduce((m, f) => Math.max(m, VERDICT_ORDER[f.verdict]), 0);
        assert.equal(VERDICT_ORDER[d.verdict], strongest);
        for (const f of d.findings) assert.ok(f.reason.length > 0 && f.rule.length > 0);
      },
    ),
    { numRuns: Math.max(100, Math.floor(Number(process.env.TC_RUNS ?? 300) / 2)) },
  );
});

test('resolving a path twice changes nothing; the result is absolute, with no . or .. left', () => {
  for (const env of [WIN, MAC, LINUX]) {
    const prefix =
      env.platform === 'win32'
        ? fc.constantFrom('', 'C:/', 'c:\\', '/c/', '~/', '%USERPROFILE%\\', '\\\\?\\C:\\', 'D:')
        : fc.constantFrom('', '/', '~/', '$HOME/', './', '../');
    fc.assert(
      fc.property(prefix, fc.array(segment, { maxLength: 8 }), fc.constantFrom('/', '\\'), (pre, segs, sep) => {
        const p = pre + segs.join(env.platform === 'win32' ? sep : '/');
        const once = resolvePath(p, env);
        assert.equal(resolvePath(once, env), once, `${p} → ${once}`);
        assert.match(once, env.platform === 'win32' ? /^(?:[A-Z]:\/|\/\/)/ : /^\//);
        assert.ok(!once.split('/').some((s, i) => (s === '.' || s === '..') && i > 0), once);
      }),
    );
  }
});

test('isUnder: a folder holds itself and what is joined to it; case counts only on Linux', () => {
  fc.assert(
    fc.property(fc.array(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 1, maxLength: 4 }), fc.stringMatching(/^[a-z]{1,6}$/), (segs, child) => {
      for (const env of [WIN, MAC, LINUX]) {
        const dir = resolvePath(segs.join('/'), env);
        assert.ok(isUnder(dir, dir, env.platform));
        assert.ok(isUnder(joinPath(dir, child), dir, env.platform));
        assert.ok(!isUnder(dir + child, dir, env.platform) || child === '', 'a sibling with a shared prefix is not inside');
        assert.equal(
          isUnder(joinPath(dir, child).toUpperCase(), dir, env.platform),
          env.platform !== 'linux' || joinPath(dir, child).toUpperCase() === joinPath(dir, child),
        );
        assert.equal(pathKey(dir.toUpperCase(), env.platform) === pathKey(dir, env.platform), env.platform !== 'linux' || dir.toUpperCase() === dir);
      }
    }),
  );
});

test('8.3 expansion never touches a path without a short segment, and settles after one pass', () => {
  const known = ['C:/Users/ada', 'C:/Users/ada/.claude', 'C:/Users/ada/.mode-code', 'C:/dev/app'];
  fc.assert(
    fc.property(fc.array(segment, { maxLength: 6 }), (segs) => {
      const p = resolvePath('C:/' + segs.join('/'), WIN);
      const once = expandShortNames(p, known, 'win32');
      if (!/~\d/.test(p)) assert.equal(once, p);
      assert.equal(expandShortNames(once, known, 'win32'), once);
      assert.equal(expandShortNames(p, known, 'linux'), p);
    }),
  );
});

test('settings: any JSON gives a valid config without throwing, and a config survives its own file', () => {
  fc.assert(
    fc.property(fc.jsonValue(), (v) => {
      const a = normalizeConfig(v);
      const b = parseConfig(serializeConfig(a.config));
      assert.deepEqual(b.config, a.config);
      assert.deepEqual(b.problems, []);
    }),
  );
  fc.assert(
    fc.property(fc.string({ maxLength: 200 }), (text) => {
      const r = parseConfig(text);
      assert.ok(r.config && Array.isArray(r.problems));
    }),
  );
});

test('secrets: masking twice is masking once, and a generated token never survives masking', () => {
  const alnum = fc.stringMatching(/^[A-Za-z0-9]{36}$/);
  fc.assert(
    fc.property(fc.string({ maxLength: 80 }), alnum, fc.string({ maxLength: 80 }), (before, body, after) => {
      const token = 'ghp' + '_' + body;
      const text = `${before} ${token} ${after}`;
      const once = maskSecrets(text);
      assert.equal(maskSecrets(once), once);
      assert.ok(!once.includes(body.slice(4, 30)), 'the middle of the token is gone');
      scanSecrets(before + after);
    }),
  );
});

test('keywords: any text is read without throwing; "<registered name> devam" is always continue', () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 120 }), (text) => {
      detectKeyword(text, [{ id: 'app', names: ['app'] }]);
    }),
  );
  fc.assert(
    fc.property(fc.stringMatching(/^[a-zçğıöşü]{3,12}$/), fc.constantFrom('', '.', '!', ' '), (name, end) => {
      fc.pre(!['devam', 'dur', 'kota', 'sohbet', 'durum', 'manuel', 'yardim', 'yardım', 'toparla'].includes(fold(name)));
      const k = detectKeyword(`${name} devam${end}`, [{ id: 'p', names: [name] }]);
      assert.equal(k?.kind, 'continue');
      assert.equal(k?.project, 'p');
    }),
  );
});

test('text: a cut never exceeds its width, widths are never negative', () => {
  fc.assert(
    fc.property(fc.string({ unit: 'grapheme', maxLength: 60 }), fc.integer({ min: 0, max: 80 }), (s, n) => {
      assert.ok(textWidth(s) >= 0);
      assert.ok(textWidth(fitWidth(s, n)) <= Math.max(0, n));
      assert.ok([...truncate(s, Math.max(1, n))].length <= Math.max(1, n));
    }),
  );
});

test('versions: compare is a total order', () => {
  const ver = fc
    .tuple(fc.nat(30), fc.nat(30), fc.nat(30), fc.option(fc.constantFrom('rc.1', 'beta', 'alpha.2')))
    .map(([a, b, c, pre]) => `${a}.${b}.${c}${pre ? '-' + pre : ''}`);
  fc.assert(
    fc.property(ver, ver, ver, (a, b, c) => {
      assert.equal(compareVersions(a, a), 0);
      assert.equal(compareVersions(a, b), -compareVersions(b, a) || 0);
      if (compareVersions(a, b) <= 0 && compareVersions(b, c) <= 0) assert.ok(compareVersions(a, c) <= 0);
    }),
  );
});

test('quota: more use never gives a milder level', () => {
  const now = Date.parse('2026-10-12T10:00:00Z');
  const rank = { ok: 0, wrapUp: 1, stop: 2 } as const;
  fc.assert(
    fc.property(
      fc.float({ min: 0, max: 100, noNaN: true }),
      fc.float({ min: 0, max: 100, noNaN: true }),
      fc.float({ min: 0, max: 100, noNaN: true }),
      (a, b, week) => {
        const level = (five: number) =>
          assessQuota(
            {
              measuredAt: now,
              source: 'mod',
              windows: [
                { kind: 'five_hour', used: five, resetsAt: now + 3600_000 },
                { kind: 'seven_day', used: week, resetsAt: now + 86400_000 },
              ],
            },
            DEFAULT_BUDGET,
            now,
          ).level;
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        assert.ok(rank[level(lo)] <= rank[level(hi)]);
      },
    ),
  );
});

test('transcripts: any lines are read without throwing', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.oneof(
          fc.string({ maxLength: 60 }),
          fc.jsonValue().map((v) => JSON.stringify(v)),
        ),
        { maxLength: 30 },
      ),
      (lines) => {
        currentTurn(lines);
        const s = transcriptShape(lines);
        assert.equal(s.lines, lines.length);
      },
    ),
  );
});

test('footer: the lines the tool builds always pass its own check, in both languages', () => {
  const memory = fc.constantFrom(
    { state: null },
    { state: 'pushed' as const },
    { state: 'unchanged' as const },
    { state: 'dirty' as const, count: 2 },
    { state: 'ahead' as const, count: 1 },
    { state: 'unknown' as const },
    { state: 'noUpstream' as const },
  );
  const acts = fc.record({ files: fc.nat(5), memoryFiles: fc.nat(3), settings: fc.nat(2), git: fc.nat(3), shell: fc.nat(3), external: fc.nat(2) });
  const pct = fc.option(fc.integer({ min: 0, max: 100 }), { nil: null });
  fc.assert(
    fc.property(
      memory,
      acts,
      pct,
      pct,
      fc.option(fc.integer({ min: 1, max: 100 }), { nil: null }),
      fc.constantFrom('en' as const, 'tr' as const),
      (mem, a, five, week, target, lang) => {
        const f = buildFooter({ memory: mem as never, acts: a, five, week, weeklyTarget: target, showFiveFrom: 70, showWeekFrom: 85 }, lang);
        assert.deepEqual(checkFooter(f.expect, `Done.\n\n${f.lines.join('\n\n')}`, lang), []);
      },
    ),
  );
});
