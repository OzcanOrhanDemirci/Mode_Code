// SPDX-License-Identifier: Apache-2.0
/**
 * The built-in self-test suites. Each sample has one known answer; the suites run in a few milliseconds
 * and touch nothing outside memory. CI runs them as unit tests; `terminal-code doctor` runs them on the
 * person's machine, where another JavaScript engine version or another locale could change an answer.
 */
import type { Platform } from '../paths.js';
import { resolvePath, expandShortNames, firstShortName, isUnder } from '../paths.js';
import { DATA_DIR_NAME } from '../app.js';
import { evaluateToolCall } from '../belt/evaluate.js';
import { fillSample, sampleContext, samplePlaces, samplesFor } from '../belt/samples.js';
import { analyzeCommand } from '../shell/analyze.js';
import { maskSecrets, scanSecrets } from '../secrets/scan.js';
import { detectKeyword } from '../keywords.js';
import { buildFooter, checkFooter } from '../footer.js';
import { cloneDefaults, parseConfig, serializeConfig } from '../config.js';
import { fold } from '../text.js';
import { tIn, LANGUAGES, type Lang } from '../i18n/index.js';
import { en } from '../i18n/en.js';
import { compareVersions } from '../version.js';
import { commandEffects, strongest } from '../shell/effects.js';
import { checkMode, type ModeGuard } from '../guard.js';
import { checkPlan, checkReport } from '../flow-checks.js';
import { runSuite, type SuiteResult } from './types.js';

export type { SuiteResult } from './types.js';

const PLATFORMS: Platform[] = ['win32', 'darwin', 'linux'];

/** The belt on its samples, on a made-up machine for each platform. */
export function beltSuite(): Promise<SuiteResult> {
  return runSuite(
    'belt',
    PLATFORMS.flatMap((platform) =>
      samplesFor(platform).map((s) => ({
        name: `${platform}: ${s.name}`,
        run: async (): Promise<[string, string]> => {
          const places = samplePlaces(platform);
          const d = await evaluateToolCall(s.tool, fillSample(s, places), sampleContext(platform, places));
          const fired = [...new Set(d.findings.filter((f) => f.verdict === d.verdict).map((f) => f.rule))];
          const actual = [d.verdict, ...s.rules.filter((r) => (fired as string[]).includes(r))].join(' ');
          return [[s.verdict, ...s.rules].join(' '), actual];
        },
      })),
    ),
  );
}

/** The shell parsers: which programs a command line runs, in Bash, PowerShell and cmd. */
export function shellSuite(): Promise<SuiteResult> {
  const cases: [string, 'bash' | 'powershell', string][] = [
    ['git status && npm test', 'bash', 'git npm'],
    ['echo "a && b" ; ls', 'bash', 'echo ls'],
    ["bash -c 'git status'", 'bash', 'bash git'],
    ['FOO=1 npm run build | tee out.txt', 'bash', 'npm tee'],
    ['echo $(git rev-parse HEAD)', 'bash', 'echo git'],
    ['if true; then ls; fi', 'bash', 'true ls'],
    ['Get-ChildItem | Select-Object -First 3', 'powershell', 'get-childitem select-object'],
    ['gci; rm x', 'powershell', 'get-childitem remove-item'],
    ['cmd /c "dir && echo ok"', 'bash', 'cmd dir echo'],
    ['npx --yes prettier --check .', 'bash', 'prettier'],
  ];
  return runSuite(
    'shell',
    cases.map(([command, dialect, expected]) => ({
      name: `${dialect}: ${command}`,
      run: (): [string, string] => [
        expected,
        analyzeCommand(command, dialect)
          .invocations.map((i) => i.program)
          .join(' '),
      ],
    })),
  );
}

/** Path spellings: one form for each, on each platform. */
export function pathSuite(): Promise<SuiteResult> {
  const win = { platform: 'win32' as const, home: 'C:/Users/ada', cwd: 'C:/dev/app' };
  const mac = { platform: 'darwin' as const, home: '/Users/ada', cwd: '/Users/ada/app' };
  const cases: [string, () => string, string][] = [
    ['backslashes', () => resolvePath('C:\\Users\\ada\\.claude', win), 'C:/Users/ada/.claude'],
    ['Git Bash drive', () => resolvePath('/c/Users/ada/x', win), 'C:/Users/ada/x'],
    ['Git Bash /tmp', () => resolvePath('/tmp/x', win), 'C:/Users/ada/AppData/Local/Temp/x'],
    ['home variable', () => resolvePath('%USERPROFILE%\\x', win), 'C:/Users/ada/x'],
    ['relative with ..', () => resolvePath('../other/./y', win), 'C:/dev/other/y'],
    ['long path prefix', () => resolvePath('\\\\?\\C:\\x', win), 'C:/x'],
    ['macOS tilde', () => resolvePath('~/x', mac), '/Users/ada/x'],
    ['macOS case', () => String(isUnder('/USERS/ADA/x', '/Users/ada', 'darwin')), 'true'],
    [
      '8.3 short name',
      () => expandShortNames(`C:/Users/ada/${firstShortName(DATA_DIR_NAME)}/x`, [`C:/Users/ada/${DATA_DIR_NAME}`], 'win32'),
      `C:/Users/ada/${DATA_DIR_NAME}/x`,
    ],
  ];
  return runSuite(
    'paths',
    cases.map(([name, f, expected]) => ({ name, run: (): [string, string] => [expected, f()] })),
  );
}

/** The secret scanner: documented formats are found and never shown. Tokens are assembled at run time. */
export function secretSuite(): Promise<SuiteResult> {
  const body = (n: number) => Array.from({ length: n }, (_, i) => 'aB3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xY'[(i * 7 + 3) % 32]).join('');
  const tokens: [string, string][] = [
    ['github-token', 'ghp' + '_' + body(36)],
    ['anthropic-key', 'sk-' + 'ant-api03-' + body(90)],
    // Joined, not added: the bundler folds 'AK' + 'IA' + … into one literal that would ship looking like a key.
    ['aws-access-key-id', ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join('')],
    ['npm-token', 'npm' + '_' + body(36)],
  ];
  return runSuite('secrets', [
    ...tokens.map(([kind, token]) => ({
      name: `finds ${kind}`,
      run: (): [string, string] => [kind, scanSecrets(`value ${token} end`)[0]?.kind ?? 'nothing'],
    })),
    ...tokens.map(([kind, token]) => ({
      name: `masks ${kind}`,
      run: (): [string, string] => ['hidden', maskSecrets(`x=${token}`).includes(token.slice(4, 20)) ? 'shown' : 'hidden'],
    })),
    { name: 'plain text has nothing', run: (): [string, string] => ['0', String(scanSecrets('the build passed in 12 s; see README.md').length)] },
  ]);
}

/** Keywords: the spellings people type, including the Turkish letters keyboards swap. */
export function keywordSuite(): Promise<SuiteResult> {
  const projects = [{ id: 'terminal-code', names: ['terminal'] }];
  const cases: [string, string][] = [
    ['terminal devam', 'continue terminal-code'],
    ['TERMİNAL DEVAM', 'continue terminal-code'],
    ['termınal devam', 'continue terminal-code'],
    ['Terminal devam.', 'continue terminal-code'],
    ['devam', 'continue'],
    ['kota +5', 'quota'],
    ['terminal devam ederken bir şey sorayım', 'none'],
    ['dur', 'stop'],
    ['toparla', 'wrapUp'],
  ];
  return runSuite(
    'keywords',
    cases.map(([text, expected]) => ({
      name: text,
      run: (): [string, string] => {
        const k = detectKeyword(text, projects);
        return [expected, k ? [k.kind, k.project ?? ''].join(' ').trim() : 'none'];
      },
    })),
  );
}

/** Footer lines: what is built is what the check accepts, in both languages. */
export function footerSuite(): Promise<SuiteResult> {
  const langs = Object.keys(LANGUAGES) as Lang[];
  return runSuite(
    'footer',
    langs.map((lang) => ({
      name: `built lines pass the check (${lang})`,
      run: (): [string, string] => {
        const f = buildFooter(
          {
            memory: { state: 'pushed' },
            acts: { files: 2, memoryFiles: 0, settings: 0, git: 1, shell: 0, external: 0 },
            five: 72,
            week: 40,
            weeklyTarget: null,
            showFiveFrom: 70,
            showWeekFrom: 85,
          },
          lang,
        );
        return ['', checkFooter(f.expect, `Done.\n\n${f.lines.join('\n\n')}`, lang).join('; ')];
      },
    })),
  );
}

/** Settings: the defaults survive a round trip through the file; broken text gives the defaults. */
export function configSuite(): Promise<SuiteResult> {
  return runSuite('config', [
    {
      name: 'defaults round-trip',
      run: (): [string, string] => {
        const d = cloneDefaults();
        return [JSON.stringify(d), JSON.stringify(parseConfig(serializeConfig(d)).config)];
      },
    },
    { name: 'broken JSON gives defaults', run: (): [string, string] => [JSON.stringify(cloneDefaults()), JSON.stringify(parseConfig('{ nope').config)] },
    { name: 'broken JSON is reported', run: (): [string, string] => ['invalid-json', parseConfig('{ nope').problems[0]?.kind ?? 'none'] },
  ]);
}

/** Text handling that depends on the engine: folding, widths, version order, translations. */
export function textSuite(): Promise<SuiteResult> {
  const keys = Object.keys(en) as (keyof typeof en)[];
  return runSuite('text', [
    { name: 'fold Turkish İ', run: (): [string, string] => ['istanbul', fold('İSTANBUL')] },
    { name: 'fold dotless ı', run: (): [string, string] => ['istanbul', fold('ıstanbul')] },
    {
      name: 'versions order',
      run: (): [string, string] => [
        '-1 0 1',
        [compareVersions('2.1.9', '2.1.10'), compareVersions('1.0.0', '1.0'), compareVersions('1.0.0', '1.0.0-rc.1')].join(' '),
      ],
    },
    {
      name: 'every message exists in every language',
      run: (): [string, string] => {
        const missing = (Object.keys(LANGUAGES) as Lang[]).flatMap((l) => keys.filter((k) => !tIn(l, k)).map((k) => `${l}:${k}`));
        return ['', missing.slice(0, 5).join(' ')];
      },
    },
  ]);
}

/** Modes and flows: what a restricted mode lets through, and the checks of a flow's report and plan. */
export function modesSuite(): Promise<SuiteResult> {
  const env = { platform: 'linux' as const, home: '/home/ada', cwd: '/home/ada/app', env: { TMPDIR: '/tmp' } };
  const guard: ModeGuard = {
    mode: 'research',
    zones: { temp: ['/tmp'], work: ['/tmp/tc'], plan: [] },
    env: env.env,
    flowStep: null,
    words: { code: 'code', free: 'free' },
  };
  const kinds: [string, string][] = [
    ['git log --oneline | head', 'read'],
    ['rg TODO src > /tmp/todo.txt', 'write'],
    ['npm test', 'local'],
    ['git push', 'outside'],
    ['frobnicate', 'unknown'],
    ["sed -i 's/a/b/' f", 'write'],
    ['curl -X POST https://example.org', 'outside'],
  ];
  const guarded: [string, string, string][] = [
    ['Bash', 'cat README.md', 'allow'],
    ['Bash', 'echo x > notes.md', 'write'],
    ['Bash', 'cd /tmp && npm init -y', 'allow'],
    ['Write', '/tmp/tc/f/research.md', 'allow'],
    ['Write', '/home/ada/app/src/a.ts', 'file'],
  ];
  const report = '## Findings\n\n- x [1]\n\n## Sources\n\n1. https://example.org\n';
  const plan = '## Steps\n\n### 1. A\n\nAcceptance: works\n\n## Verification\n\n- `npm test`\n';
  return runSuite('modes', [
    ...kinds.map(([cmd, want]) => ({
      name: `class of ${cmd}`,
      run: (): [string, string] => [want, strongest(commandEffects(cmd, 'bash', env).effects)],
    })),
    ...guarded.map(([tool, arg, want]) => ({
      name: `research mode: ${tool} ${arg}`,
      run: (): [string, string] => [
        want,
        checkMode(tool, tool === 'Bash' ? { command: arg } : { file_path: arg, content: '' }, guard, env, 'en')?.what ?? 'allow',
      ],
    })),
    {
      name: 'a sourced report passes its check',
      run: (): [string, string] => [
        '',
        checkReport(report)
          .problems.map((p) => p.key)
          .join(' '),
      ],
    },
    {
      name: 'an unsourced finding fails it',
      run: (): [string, string] => ['flow.check.report.uncited', checkReport(report.replace(' [1]', '')).problems[0]?.key ?? ''],
    },
    { name: 'a plan with criteria and a command passes its check', run: (): [string, string] => ['npm test', checkPlan(plan).verification.join(' ')] },
  ]);
}

export const SUITES = {
  belt: beltSuite,
  modes: modesSuite,
  shell: shellSuite,
  paths: pathSuite,
  secrets: secretSuite,
  keywords: keywordSuite,
  footer: footerSuite,
  config: configSuite,
  text: textSuite,
};

/** Every suite, in a fixed order. */
export async function runAllSuites(): Promise<SuiteResult[]> {
  const out: SuiteResult[] = [];
  for (const f of Object.values(SUITES)) out.push(await f());
  return out;
}
