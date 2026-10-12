// SPDX-License-Identifier: Apache-2.0
// The belt replayed over transcripts: counts by verdict and rule, the period honoured, no command text kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replay } from '../../src/app/replay.js';
import { cloneDefaults } from '../../src/core/config.js';
import { layout } from '../../src/core/layout.js';
import { toolPath } from '../../src/node/env.js';

test('replay counts what the belt would have asked, blocked and noted, and keeps no command text', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tc-replay-'));
  try {
    const claudeDir = join(root, 'claude');
    const data = toolPath(join(root, 'data'));
    const project = toolPath(join(root, 'app'));
    const dir = join(claudeDir, 'projects', 'app');
    mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
    const call = (name: string, input: object, minutesAgo: number) =>
      JSON.stringify({
        type: 'assistant',
        cwd: project,
        timestamp: at(minutesAgo),
        message: { content: [{ type: 'tool_use', id: `t${Math.random()}`, name, input }] },
      });
    const lines = [
      call('Bash', { command: 'git status' }, 5),
      call('Bash', { command: 'git clean -fdx' }, 4),
      call('Write', { file_path: `${data}/config.json`, content: '{}' }, 3),
      call('Bash', { command: 'git reset --hard' }, 2),
      call('Read', { file_path: `${project}/README.md` }, 1),
      call('Bash', { command: 'git clean -fdx' }, 60 * 24 * 40), // older than the period
      'not json',
    ];
    writeFileSync(join(dir, 's1.jsonl'), lines.join('\n') + '\n');
    writeFileSync(join(dir, 'old.jsonl'), call('Bash', { command: 'git clean -fdx' }, 60 * 24 * 40) + '\n');
    const old = new Date(now - 40 * 86400_000);
    utimesSync(join(dir, 'old.jsonl'), old, old);
    const r = await replay({ claudeDir, config: cloneDefaults(), layout: layout(data), lang: 'en', days: 30, now });
    assert.equal(r.files, 1, 'a file untouched for longer than the period is not read');
    assert.equal(r.calls, 4, 'reads are not checked, and calls before the period do not count');
    assert.deepEqual([r.asked, r.blocked, r.noted], [1, 1, 1]);
    assert.equal(r.sessionsAsked, 1);
    // The three shell commands as the restricted modes see them: a read and two changes to the repository.
    assert.deepEqual(r.modes, { shell: 3, read: 1, write: 0, local: 2, outside: 0, unknown: 0, unreadable: 0 });
    assert.deepEqual(
      r.byRule.map((x) => `${x.verdict} ${x.rule} ${x.count}`),
      ['ask git.clean 1', 'warn git.discard-work 1', 'deny self.tool-files 1'], // by count, then by rule
    );
    assert.doesNotMatch(JSON.stringify(r), /git clean|config\.json|reset --hard/, 'only counts come out');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
