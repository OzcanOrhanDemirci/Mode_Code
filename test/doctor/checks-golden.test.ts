// SPDX-License-Identifier: Apache-2.0
/**
 * Every check's full answer (status, whether it is a protection, the repair, the message and its values)
 * for a set of machines, kept in a golden file: any change to what the doctor concludes shows up whole in
 * review. Mutation testing showed the per-check tests left the protection flags and many values unwatched.
 */
import { test } from 'node:test';
import { runChecks } from '../../src/app/doctor/checks.js';
import type { Facts } from '../../src/app/doctor/types.js';
import { healthyFacts, ourHook, settingsFile } from '../helpers/facts.js';
import { golden } from '../helpers/golden.js';

const h = healthyFacts();
const machines: [string, Facts][] = [
  ['healthy Windows', h],
  ['not installed', healthyFacts({ manifest: null, hookNode: null, hooks: [], plugins: [], modSeen: null })],
  [
    'healthy macOS',
    healthyFacts({
      platform: 'darwin',
      gitBash: null,
      powershell: null,
      posixShell: { shell: '/bin/zsh', version: 'zsh 5.9' },
      shortNames: [],
      terminal: { ...h.terminal, codePage: null, program: 'iTerm.app' },
    }),
  ],
  [
    'broken everywhere',
    healthyFacts({
      node: { version: '20.1.0', execPath: 'x', sqlite: false },
      hookNode: { path: 'C:/gone/node.exe', exists: false, version: null },
      claude: { installs: ['C:/a/claude.exe', 'C:/b/claude.cmd'], version: '2.0.1' },
      settings: [
        settingsFile({ error: 'Unexpected token (line 2, column 3)' }),
        settingsFile({ scope: 'project', path: 'C:/dev/app/.claude/settings.json', pluginEnabled: false }),
      ],
      hooks: [ourHook('PreToolUse', { onFailure: null }), ourHook('Stop'), ourHook('Stop')],
      plugins: null,
      hookProgram: { ...h.hookProgram, hash: 'b'.repeat(64) },
      pluginFiles: { ...h.pluginFiles, missing: ['hooks/register.js'] },
      modSeen: null,
      aliases: [{ real: 'D:/dotfiles/claude', spelled: 'C:/Users/ada/.claude' }],
      shortNames: [{ long: 'C:/Users/ada/.claude', short: 'C:/Users/ada/CLAUDE~1', recognised: false }],
      memoryDirs: [{ path: 'C:/notes', exists: false, isRepo: false }],
      gitBash: { path: 'C:/Git/bin/bash.exe', tmp: 'C:/msys/tmp', expectedTmp: 'C:/Users/ada/AppData/Local/Temp' },
      powershell: { pwsh: null, windowsPowerShell: true },
      terminal: { ...h.terminal, columns: 50 },
      data: { ...h.data, renameWorks: false, freeBytes: 30 * 1048576, staleTemp: ['config.json.1.0a1b2c3d.tmp'], missingDirs: ['C:/x/state'] },
      config: { problems: [{ path: 'view', kind: 'type', detail: 'expected simple, recommended or detailed' }], exists: true },
      index: { exists: true, ok: false, detail: 'malformed', sessions: null },
      quota: { exists: true, valid: false, measuredAt: null },
      git: { version: null, projects: [{ path: 'C:/dev/app', exists: true, readable: false, error: 'fatal: detected dubious ownership', notRepo: false }] },
      transcripts: {
        files: 2,
        shape: {
          ...h.transcripts.shape!,
          assistantWithUsage: 0,
          tools: { ...h.transcripts.shape!.tools, StrReplace: { calls: 1, runsCommands: false, writesFiles: true } },
        },
        badSessionIds: ['a/b'],
      },
      selftest: [{ suite: 'belt', passed: 10, failed: 1, failures: [{ name: 'win32: x', expected: 'deny', actual: 'allow' }], ms: 1 }],
      hookAgreement: { samples: 30, agreed: 28, differences: [{ call: 'Write C:/x', mine: 'deny', theirs: 'allow' }], error: null },
    }),
  ],
  [
    'Linux with loose permissions and a case-folding disk',
    healthyFacts({
      platform: 'linux',
      gitBash: null,
      powershell: null,
      posixShell: { shell: null, version: null },
      shortNames: [],
      data: { ...h.data, caseInsensitive: true, looseModes: ['.terminal-code 777'] },
    }),
  ],
];

// A tour of the remaining branches, several checks per machine (they do not interact), with values set
// exactly on the boundaries: 50 MB and 500 MB free, 7 days, 60 columns, 90% of answers with blocks.
const MB = 1048576;
machines.push(
  [
    'tour 1: Node.js that does not start, Claude Code missing, the plugin missing, a missing hook program',
    healthyFacts({
      hookNode: { path: 'C:/node/node.exe', exists: true, version: null },
      claude: { installs: [], version: null },
      plugins: [],
      hookProgram: { ...h.hookProgram, exists: false, hash: null },
      pluginFiles: { ...h.pluginFiles, shipped: false },
      hookAgreement: null,
      shortNames: [],
      memoryDirs: [],
      gitBash: { path: null, tmp: null, expectedTmp: 'C:/Users/ada/AppData/Local/Temp' },
      data: { ...h.data, freeBytes: 50 * MB, caseInsensitive: null, staleStates: 2 },
      git: { version: '2.5', projects: [] },
      config: { problems: [], exists: false },
      index: { exists: false, ok: null, detail: null, sessions: null },
      quota: { exists: false, valid: false, measuredAt: null },
      transcripts: { files: 0, shape: null, badSessionIds: [] },
      selftest: null,
      terminal: { ...h.terminal, columns: 60 },
    }),
  ],
  [
    'tour 2: Node.js too old for the hooks, the plugin turned off, the hook program without a build, weakened hooks',
    healthyFacts({
      hookNode: { path: 'C:/node/node.exe', exists: true, version: '22.12.9' },
      claude: { installs: [], version: '2.1.296' },
      plugins: [{ id: 'terminal-code@terminal-code-local', enabled: false, version: 'dev', scope: 'user' }],
      hookProgram: { ...h.hookProgram, shippedHash: null },
      hooks: h.hooks.map((x) => (x.event === 'PreToolUse' ? { ...x, matcher: 'Bash' } : x)),
      hookAgreement: { samples: 0, agreed: 0, differences: [], error: 'spawn failed' },
      memoryDirs: [{ path: 'C:/notes', exists: true, isRepo: false }],
      gitBash: { path: 'C:/Git/bin/bash.exe', tmp: null, expectedTmp: 'C:/Users/ada/AppData/Local/Temp', error: 'timeout' },
      data: { ...h.data, freeBytes: 500 * MB - 1, missingDirs: ['C:/x/events'] },
      git: { version: '2.5', projects: [{ path: 'C:/gone', exists: false, readable: false, error: null, notRepo: false }] },
      quota: { exists: true, valid: true, measuredAt: h.measuredAt - 7 * 86400_000 },
      transcripts: { files: 1, shape: { ...h.transcripts.shape!, user: 0, assistant: 0 }, badSessionIds: [] },
      selftest: [{ suite: 'footer', passed: 3, failed: 1, failures: [{ name: 'f', expected: 'a', actual: 'b' }], ms: 1 }],
    }),
  ],
  [
    'tour 3: another data folder, duplicated hooks, another plugin version, MCP tools, a stricter belt',
    healthyFacts({
      platform: 'darwin',
      manifest: { ...h.manifest!, dataDir: 'D:/elsewhere/.terminal-code', version: 'older' },
      hooks: [...h.hooks, { ...h.hooks[1]! }, { ...h.hooks[0]!, scope: 'project' }],
      plugins: [{ id: 'terminal-code@terminal-code-local', enabled: true, version: 'older', scope: 'user' }],
      hookProgram: { ...h.hookProgram, hash: 'c'.repeat(64) },
      modSeen: { at: h.measuredAt, version: 'older' },
      gitBash: null,
      powershell: null,
      posixShell: { shell: '/bin/zsh', version: null },
      shortNames: [],
      data: { ...h.data, freeBytes: null, caseInsensitive: false },
      git: { version: '2.5', projects: [{ path: 'C:/plain', exists: true, readable: false, error: 'fatal: not a git repository', notRepo: true }] },
      transcripts: {
        files: 2,
        shape: {
          ...h.transcripts.shape!,
          assistant: 10,
          assistantWithBlocks: 9,
          timestamped: 0,
          tools: { mcp__shell__run: { calls: 2, runsCommands: true, writesFiles: false } },
        },
        badSessionIds: [],
      },
    }),
  ],
);

test('what the doctor concludes about each machine, check by check', () => {
  const lines: string[] = [];
  for (const [name, facts] of machines) {
    lines.push(`## ${name}`);
    for (const r of runChecks(facts)) {
      const params = r.summary.params ? ' ' + JSON.stringify(r.summary.params) : '';
      lines.push(
        `${r.id} ${r.status}${r.protection ? ' protection' : ''}${r.repair ? ` repair=${r.repair}` : ''}${r.hint ? ` hint=${r.hint.key}` : ''} ${r.summary.key}${params}`,
      );
      for (const d of r.details ?? []) lines.push(`    ${d.key}${d.params ? ' ' + JSON.stringify(d.params) : ''}`);
    }
    lines.push('');
  }
  golden('doctor-checks', lines.join('\n'));
});
