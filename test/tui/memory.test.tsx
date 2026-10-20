// SPDX-License-Identifier: Apache-2.0
/**
 * The memory in the control center (docs/memory.md): Settings › Memory (where it lives, the setup key,
 * handoff and morning settings), Memory and projects › Handoffs, and the morning report.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { draw, FakeData, KEY, NOW } from './harness.js';

test('Memory and projects › Memory: not set up, "s" leaves for the setup and comes back here', async () => {
  const data = new FakeData();
  const left: [string, string][] = [];
  const s = await draw(data, { address: 'memory/store', onLeave: (action, back) => left.push([action, back]) });
  try {
    const t = s.text();
    assert.match(t, /Lives on\s+not set up/);
    assert.match(t, /Claude Code\s+one memory per project \(its default\)/);
    assert.match(t, /s: set it up \(this computer, your GitHub, or both\)/);
    await s.press('s');
    assert.deepEqual(left, [['memory-setup', 'memory/store']]);
  } finally {
    s.close();
  }
});

test('Memory and projects › Memory: the place, the folder, the repository, whether Claude Code uses it, the sync', async () => {
  const data = new FakeData();
  data.memoryState = {
    store: {
      place: 'both',
      dir: '/home/ada/claude-memory',
      remote: 'https://github.com/ada/claude-memory.git',
      repo: 'ada/claude-memory',
      git: true,
      sync: 'auto',
      handoffs: true,
    },
    setting: '/home/ada/claude-memory',
    inUse: true,
    last: {
      at: NOW - 120_000,
      trigger: 'turn',
      session: 's',
      result: {
        repo: true,
        commit: 'ok',
        committed: 1,
        held: [],
        pull: 'skipped',
        push: 'ok',
        conflicts: [],
        ahead: 0,
        behind: 0,
        pulled: [],
        head: null,
        index: null,
        detail: '',
      },
    },
    local: { isRepo: true, dirty: 2, ahead: 1 },
    project: 'app',
    handoff: null,
  };
  const s = await draw(data, { address: 'memory/store' });
  try {
    // The pane wraps long rows: read it as one text.
    const t = s
      .text()
      .replace(/[│╭╮╰╯─]/g, '')
      .replace(/\s+/g, ' ');
    assert.match(t, /Lives on\s+this computer and your GitHub/);
    assert.match(t, /GitHub\s+ada\/claude-memory/);
    assert.match(t, /Claude Code\s+✓ writes its memory here/);
    assert.match(t, /Here\s+git history · 2 change\(s\) not recorded yet · 1 commit\(s\) not sent yet/);
    assert.match(t, /Sync\s+by itself · 2 min ago: fine/);
    assert.match(t, /s: change where it lives/);
  } finally {
    s.close();
  }
  // Without a terminal to leave for (no onLeave), the key says how to run it.
  const s2 = await draw(data, { address: 'memory/store' });
  try {
    await s2.press('s');
    assert.match(s2.text(), /Run mode-code memory setup in a terminal\./);
  } finally {
    s2.close();
  }
});

test('Memory and projects › Handoffs and morning report: each setting is edited in place', async () => {
  const data = new FakeData();
  const s = await draw(data, { address: 'memory/notes' });
  try {
    assert.match(s.text(), /Handoff notes\s+● on/);
    assert.match(s.text(), /Notes kept per project\s+20/);
    await s.press(KEY.enter);
    assert.deepEqual(data.saved.at(-1), { path: 'memory.handoff.enabled', value: false });
  } finally {
    s.close();
  }
});

test('Memory and projects › Handoffs: each note as it is kept; none yet says how one is written', async () => {
  const empty = await draw(new FakeData(), { address: 'memory/handoffs' });
  try {
    assert.match(empty.text(), /No handoff note yet/);
    assert.match(empty.text(), /Type "handoff"/);
  } finally {
    empty.close();
  }
  const dir = mkdtempSync(join(tmpdir(), 'tc-tuihandoff-'));
  try {
    const path = join(dir, '20261012-080000-abc.md').replace(/\\/g, '/');
    writeFileSync(path, '---\ntype: handoff\nproject: app\nat: 2026-10-12T08:00:00Z\n---\n\n# Handoff · app\n\n## Next\n\nWrite the setup.\n');
    const data = new FakeData();
    data.handoffList = [{ project: 'app', path, at: Date.parse('2026-10-12T08:00:00Z'), trigger: 'keyword', machine: 'mac', next: 'Write the setup.' }];
    const s = await draw(data, { address: 'memory/handoffs' });
    try {
      assert.match(s.text(), /app · Write the setup\./);
      await s.press(KEY.right);
      const t = s.text();
      assert.match(t, /Why\s+you asked for it/);
      assert.match(t, /## Next/);
      assert.match(t, /Write the setup\./);
    } finally {
      s.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Now: after a long gap, what happened while the person was away comes first', async () => {
  const data = new FakeData();
  data.morningReport = { since: NOW - 10 * 3_600_000, lines: [{ label: 'Full autonomy', text: 'Add rate limiting · done' }] };
  const s = await draw(data, { address: 'now' });
  try {
    assert.match(s.text(), /While you were away · since/);
    assert.match(s.text(), /Full autonomy\s+Add rate limiting · done/);
  } finally {
    s.close();
  }
});
