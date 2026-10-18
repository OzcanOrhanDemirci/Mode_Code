// SPDX-License-Identifier: Apache-2.0
// The safety-net hook at a stop with an assigned agent batch (core/agents.ts): fewer agents started than the person
// asked for turns Claude back once, with what is left; never twice for one batch, never with the mode off in the
// settings, never for a batch a later prompt sealed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newModState } from '../../src/core/session.js';
import type { AgentsState } from '../../src/core/agents.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const hook = join(root, 'src', 'hook', 'main.ts');
const SESSION = 'agents-session';

function place(agents: AgentsState, config: Record<string, unknown> = { agents: { enabled: true } }) {
  const home = mkdtempSync(join(tmpdir(), 'tc-agents-'));
  mkdirSync(join(home, 'state', 'sessions'), { recursive: true });
  writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'en', modules: { footer: false }, ...config }));
  const mod = { ...newModState(SESSION, 'test', Date.now()), agents };
  writeFileSync(join(home, 'state', 'sessions', `${SESSION}.mod.json`), JSON.stringify(mod));
  const stop = () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', hook, 'Stop'], {
      cwd: root,
      input: JSON.stringify({ session_id: SESSION, cwd: home, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Done.' }),
      encoding: 'utf8',
      env: { ...process.env, MODE_CODE_HOME: home, MODE_CODE_LANG: 'en' },
      timeout: 30_000,
    });
    assert.equal(r.status, 0, r.stderr);
    const text = (r.stdout ?? '').trim();
    return text ? (JSON.parse(text) as { hookSpecificOutput?: { additionalContext?: string } }) : null;
  };
  return { stop, done: () => rmSync(home, { recursive: true, force: true }) };
}

const batch = (started: number, sealed = false): AgentsState => ({
  mode: 'assigned',
  n: 3,
  rows: [
    { task: '', kind: 'code', model: null },
    { task: 'Read the logs.', kind: 'research', model: null },
    { task: '', kind: 'plan', model: null },
  ],
  batch: { at: 1_760_000_000_000, started: Array.from({ length: started }, (_, i) => ({ row: i, toolUseId: `t${i}` })), sealed },
  untold: false,
  ultracode: false,
});

test('fewer agents than asked: turned back once with what is left, and not again for the same batch', { timeout: 60_000 }, () => {
  const p = place(batch(1));
  try {
    const first = p.stop();
    assert.match(
      String(first?.hookSpecificOutput?.additionalContext),
      /exactly 3 agent\(s\) for this request; 1 started\. Start the rest now \(2\. research, 3\. plan\), as they asked\. Do not work around it\. This is said once\./,
    );
    assert.equal(p.stop(), null, 'once per batch');
  } finally {
    p.done();
  }
});

test('nothing to say: all started, a sealed batch, another mode, ultracode, or the mode off in the settings', { timeout: 120_000 }, () => {
  for (const [why, agents, config] of [
    ['all started', batch(3), undefined],
    ['sealed by a later prompt', batch(1, true), undefined],
    ['free mode', { ...batch(1), mode: 'free' }, undefined],
    ['ultracode', { ...batch(1), ultracode: true }, undefined],
    ['off in the settings', batch(1), { agents: { enabled: false } }],
  ] as const) {
    const p = place(agents as AgentsState, config as Record<string, unknown> | undefined);
    try {
      assert.equal(p.stop(), null, why);
    } finally {
      p.done();
    }
  }
});
