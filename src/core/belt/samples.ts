// SPDX-License-Identifier: Apache-2.0
/**
 * Belt samples with known answers: everyday calls that must pass in silence, the tool's own protections,
 * and a few questions. Paths are written with placeholders so the same samples run against a made-up
 * machine (self-tests, CI) and against the person's own (the installed hook compared with this build):
 *   {home} {project} {data} {claude} {temp} {outside}
 * Every sample is harmless: the belt only reads tool calls, it never runs them.
 */
import { DATA_DIR_NAME } from '../app.js';
import { firstShortName, type Platform } from '../paths.js';
import type { BeltContext, Verdict } from './types.js';

export interface BeltSample {
  name: string;
  tool: 'Bash' | 'PowerShell' | 'Monitor' | 'Write' | 'Edit' | 'Read';
  input: Record<string, string>;
  /** The expected verdict and the rules that must fire (none for allow). */
  verdict: Verdict;
  rules: string[];
  /** Platforms the sample applies to; all when absent. */
  only?: Platform[];
}

const allow = (name: string, tool: BeltSample['tool'], input: Record<string, string>, only?: Platform[]): BeltSample => ({
  name,
  tool,
  input,
  verdict: 'allow',
  rules: [],
  ...(only ? { only } : {}),
});

export const BELT_SAMPLES: readonly BeltSample[] = [
  // ── everyday work: silence ──
  allow('git status', 'Bash', { command: 'git status' }),
  allow('git log', 'Bash', { command: 'git log --oneline -5' }),
  allow('git diff', 'Bash', { command: 'git diff --stat HEAD~1' }),
  allow('tests', 'Bash', { command: 'npm test' }),
  allow('build and lint', 'Bash', { command: 'npm run build && npm run lint' }),
  allow('list the project', 'Bash', { command: 'ls -la {project}' }),
  allow('read a file', 'Bash', { command: 'cat {project}/README.md' }),
  allow('search', 'Bash', { command: 'grep -rn TODO {project}/src' }),
  allow('find', 'Bash', { command: 'find {project} -name "*.ts" -not -path "*/node_modules/*"' }),
  allow('write into the project', 'Bash', { command: 'echo hello > {project}/out.txt' }),
  allow('make and copy', 'Bash', { command: 'mkdir -p {project}/build && cp {project}/a.txt {project}/build/' }),
  allow('clean build output', 'Bash', { command: 'rm -rf {project}/dist' }),
  allow('clean a temporary folder', 'Bash', { command: 'rm -rf {temp}/tc-selftest' }),
  allow('inline node', 'Bash', { command: 'node -e "console.log(1)"' }),
  allow('commit', 'Bash', { command: 'cd {project} && git add -A && git commit -m "update"' }),
  allow('push a feature branch', 'Bash', { command: 'git push origin feature' }),
  allow('PowerShell listing', 'PowerShell', { command: 'Get-ChildItem {project} -Recurse | Select-Object -First 5' }),
  allow('PowerShell search', 'PowerShell', { command: 'Get-Content {project}/README.md | Select-String TODO' }),
  allow('PowerShell clean build output', 'PowerShell', { command: 'Remove-Item {project}/dist -Recurse -Force' }),
  allow('PowerShell make a folder', 'PowerShell', { command: 'New-Item -ItemType Directory {project}/build -Force' }),
  allow('write a source file', 'Write', { file_path: '{project}/src/app.ts', content: 'export const x = 1;\n' }),
  allow('write a scratch note', 'Write', { file_path: '{temp}/notes.txt', content: 'note' }),
  allow('edit a source file', 'Edit', { file_path: '{project}/src/app.ts', old_string: 'x = 1', new_string: 'x = 2' }),
  allow("read the tool's settings", 'Read', { file_path: '{data}/config.json' }),
  allow('watch a log', 'Monitor', { command: 'tail -f {project}/dev.log | grep --line-buffered ERROR' }),

  // ── the tool's own protections ──
  { name: "write the tool's settings", tool: 'Write', input: { file_path: '{data}/config.json', content: '{}' }, verdict: 'deny', rules: ['self.tool-files'] },
  { name: 'redirect into the data folder', tool: 'Bash', input: { command: 'echo x > {data}/config.json' }, verdict: 'deny', rules: ['self.tool-files'] },
  { name: 'delete the data folder', tool: 'Bash', input: { command: 'rm -rf {data}' }, verdict: 'deny', rules: ['self.tool-files'] },
  {
    name: "write Claude Code's settings",
    tool: 'Write',
    input: { file_path: '{claude}/settings.json', content: '{}' },
    verdict: 'deny',
    rules: ['self.claude-settings'],
  },
  {
    name: "edit Claude Code's settings",
    tool: 'Edit',
    input: { file_path: '{claude}/settings.json', old_string: '"hooks"', new_string: '"x"' },
    verdict: 'deny',
    rules: ['self.claude-settings'],
  },
  // Monitor runs its script in the Bash tool's shell: the same command, the same answer.
  {
    name: 'a watch script that writes into the data folder',
    tool: 'Monitor',
    input: { command: 'echo x > {data}/config.json' },
    verdict: 'deny',
    rules: ['self.tool-files'],
  },
  {
    name: 'PowerShell write into the data folder',
    tool: 'PowerShell',
    input: { command: 'Set-Content -Path {data}/config.json -Value x' },
    verdict: 'deny',
    rules: ['self.tool-files'],
  },
  {
    name: 'short name of the data folder',
    tool: 'Write',
    input: { file_path: `{home}/${firstShortName(DATA_DIR_NAME)}/config.json`, content: '{}' },
    verdict: 'deny',
    rules: ['self.tool-files'],
    only: ['win32'],
  },

  {
    name: 'delete data in the cloud',
    tool: 'Bash',
    input: { command: 'firebase firestore:delete /users --recursive' },
    verdict: 'deny',
    rules: ['data.delete-cloud'],
  },
  {
    name: 'a package runner in PowerShell',
    tool: 'PowerShell',
    input: { command: 'npx firebase database:remove /orders' },
    verdict: 'deny',
    rules: ['data.delete-cloud'],
  },

  // ── questions ──
  { name: 'delete untracked files', tool: 'Bash', input: { command: 'git clean -fdx' }, verdict: 'ask', rules: ['git.clean'] },
  { name: 'merge past the checks', tool: 'Bash', input: { command: 'gh pr merge 12 --admin' }, verdict: 'ask', rules: ['github.admin-merge'] },
  {
    name: 'recursive delete outside the project',
    tool: 'Bash',
    input: { command: 'rm -rf {outside}/old' },
    verdict: 'ask',
    rules: ['fs.delete-outside-project'],
  },
];

export interface SamplePlaces {
  home: string;
  project: string;
  data: string;
  claude: string;
  temp: string;
  outside: string;
}

/** A made-up machine for each platform, the same everywhere, so expected answers never depend on the host. */
export function samplePlaces(platform: Platform): SamplePlaces {
  if (platform === 'win32')
    return {
      home: 'C:/Users/selftest',
      project: 'C:/dev/selftest-app',
      data: 'C:/Users/selftest/.mode-code',
      claude: 'C:/Users/selftest/.claude',
      temp: 'C:/Users/selftest/AppData/Local/Temp',
      outside: 'C:/Users/selftest/scratch',
    };
  const home = platform === 'darwin' ? '/Users/selftest' : '/home/selftest';
  return {
    home,
    project: `${home}/dev/selftest-app`,
    data: `${home}/.mode-code`,
    claude: `${home}/.claude`,
    temp: platform === 'darwin' ? '/private/tmp' : '/tmp',
    outside: `${home}/scratch`,
  };
}

/** The belt context of the made-up machine: no git remote surprises, files of a fixed size. */
export function sampleContext(platform: Platform, places: SamplePlaces = samplePlaces(platform)): BeltContext {
  return {
    platform,
    home: places.home,
    cwd: places.project,
    projectDir: places.project,
    env: platform === 'win32' ? { TEMP: places.temp, TMP: places.temp } : { TMPDIR: places.temp },
    dataDir: places.data,
    memoryDirs: [],
    managedSettingsFiles: [],
    lang: 'en',
    config: {},
    git: { currentBranch: async () => 'feature', remoteUrl: async () => 'https://example.com/selftest/app.git', alias: async () => null },
    fileSize: async () => null,
  };
}

/** A sample's input with its placeholders filled in. */
export function fillSample(sample: BeltSample, places: SamplePlaces): Record<string, string> {
  const fill = (s: string) => s.replace(/\{(home|project|data|claude|temp|outside)\}/g, (_, k: keyof SamplePlaces) => places[k]);
  return Object.fromEntries(Object.entries(sample.input).map(([k, v]) => [k, fill(v)]));
}

export function samplesFor(platform: Platform): BeltSample[] {
  return BELT_SAMPLES.filter((s) => !s.only || s.only.includes(platform));
}
