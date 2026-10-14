// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGuards, checkMode, type ModeGuard } from '../../src/core/guard.js';
import { assessQuota, DEFAULT_BUDGET, fromModRateLimits } from '../../src/core/quota.js';
import type { ClassifyEnv } from '../../src/core/footer.js';
import type { WorkMode } from '../../src/core/modes.js';

const env: ClassifyEnv = { platform: 'linux', home: '/home/u', cwd: '/home/u/proj', memoryRoots: ['/home/u/notes'], ignore: ['/tmp'] };
const zones = { temp: ['/tmp'], work: ['/home/u/work'], plan: ['/home/u/.claude/plans'] };
const guard = (mode: WorkMode, over: Partial<ModeGuard> = {}): ModeGuard => ({
  mode,
  zones,
  env: { TMPDIR: '/tmp' },
  flowStep: null,
  words: { code: 'code', free: 'free' },
  ...over,
});
const NOW = Date.parse('2026-10-12T06:00:00Z');
const q = (five: number) =>
  assessQuota(
    fromModRateLimits(
      [
        { kind: 'five_hour', percentUsed: five, resetsAt: '2026-10-12T08:00:00Z' },
        { kind: 'seven_day', percentUsed: 10 },
      ],
      NOW,
    ),
    DEFAULT_BUDGET,
    NOW,
  );
const verdict = (tool: string, input: Record<string, unknown>, mode: WorkMode, over: Partial<ModeGuard> = {}) =>
  checkMode(tool, input, guard(mode, over), env, 'en')?.what ?? 'allow';

test('chat mode: project and memory writes are refused, temporary files and reads are not', () => {
  assert.equal(verdict('Write', { file_path: '/home/u/proj/a.ts', content: '' }, 'chat'), 'file');
  assert.equal(verdict('Edit', { file_path: '/home/u/notes/n.md', old_string: 'a', new_string: 'b' }, 'chat'), 'file');
  assert.equal(verdict('Bash', { command: 'git commit -m x' }, 'chat'), 'local');
  assert.equal(verdict('Write', { file_path: '/tmp/try.ts', content: '' }, 'chat'), 'allow');
  assert.equal(verdict('Read', { file_path: '/home/u/proj/a.ts' }, 'chat'), 'allow');
  assert.equal(verdict('Bash', { command: 'git status' }, 'chat'), 'allow');
  assert.equal(verdict('Write', { file_path: '/home/u/work/r.md', content: '' }, 'chat'), 'file');
});

test('research writes reports into the work folder; plan also into Claude Code plan files', () => {
  assert.equal(verdict('Write', { file_path: '/home/u/work/f1/research.md', content: '' }, 'research'), 'allow');
  assert.equal(verdict('Write', { file_path: '/home/u/.claude/plans/p.md', content: '' }, 'research'), 'file');
  assert.equal(verdict('Write', { file_path: '/home/u/.claude/plans/p.md', content: '' }, 'plan'), 'allow');
  assert.equal(verdict('Write', { file_path: '/home/u/work/f1/plan.md', content: '' }, 'plan'), 'allow');
  assert.equal(verdict('Edit', { file_path: '/home/u/proj/src/a.ts', old_string: 'a', new_string: 'b' }, 'plan'), 'file');
});

test('shell commands: reads run; writes only into allowed folders; local and unknown programs only from inside them', () => {
  assert.equal(verdict('Bash', { command: 'rg -n foo src | head' }, 'research'), 'allow');
  assert.equal(verdict('Bash', { command: 'echo x > /tmp/a.txt' }, 'research'), 'allow');
  assert.equal(verdict('Bash', { command: 'echo x > notes.txt' }, 'research'), 'write');
  assert.equal(verdict('Bash', { command: 'echo x > "$OUT/a"' }, 'research'), 'dynamic');
  assert.equal(verdict('Bash', { command: 'npm test' }, 'research'), 'local');
  assert.equal(verdict('Bash', { command: 'cd /tmp/try && npm init -y && node bench.js' }, 'chat'), 'allow');
  assert.equal(verdict('Bash', { command: 'frobnicate' }, 'plan'), 'unknown');
  assert.equal(verdict('Bash', { command: 'cd /tmp && frobnicate' }, 'plan'), 'allow');
  assert.equal(verdict('Bash', { command: 'cd /tmp && git push' }, 'chat'), 'outside');
  assert.equal(verdict('Bash', { command: 'eval "$CMD"' }, 'chat'), 'unreadable');
  assert.equal(verdict('PowerShell', { command: 'Get-ChildItem | Select-Object Name' }, 'chat'), 'allow');
});

test('free and code modes add nothing to the belt', () => {
  for (const m of ['free', 'code'] as const) {
    assert.equal(verdict('Write', { file_path: '/home/u/proj/a.ts', content: '' }, m), 'allow');
    assert.equal(verdict('Bash', { command: 'git push' }, m), 'allow');
  }
});

test('outward tools: MCP writes and Claude Code tools that act outside are refused in restricted modes; reads are not', () => {
  assert.equal(verdict('mcp__gmail__send_message', { to: 'x' }, 'chat'), 'tool');
  assert.equal(verdict('mcp__gmail__search_threads', { q: 'x' }, 'chat'), 'allow');
  assert.equal(verdict('EnterWorktree', {}, 'research'), 'tool');
  assert.equal(verdict('Artifact', { action: 'publish' }, 'plan'), 'tool');
  assert.equal(verdict('Artifact', { action: 'read' }, 'plan'), 'allow');
  assert.equal(verdict('mcp__mode-code__flow_step', { step: 'research' }, 'research'), 'allow');
  // This tool's own tools are its own, whatever their names say.
  assert.equal(verdict('mcp__mode-code__update_notes', {}, 'chat'), 'allow');
  assert.equal(verdict('mcp__other__update_notes', {}, 'chat'), 'tool');
  assert.equal(verdict('WebSearch', { query: 'x' }, 'research'), 'allow');
  assert.equal(verdict('Agent', { prompt: 'x' }, 'research'), 'allow');
});

test('the refusal says the mode, what and why, and how to go on: switch words outside a flow, flow_step inside one', () => {
  const out = checkMode('Bash', { command: 'npm test' }, guard('research'), env, 'en')!.reason;
  assert.match(
    out,
    /^🔍 research mode: `npm` may change files around the folder it runs in, so here it runs only inside a temporary folder or the work folder \/home\/u\/work\./,
  );
  assert.match(out, /they type "code" or "free"/);
  const flow = checkMode('Bash', { command: 'npm test' }, guard('research', { flowStep: 'research' }), env, 'en')!.reason;
  assert.match(flow, /The flow is at its research step\. Finish the step and call flow_step/);
  const tr = checkMode('Write', { file_path: '/home/u/proj/a.ts', content: '' }, guard('chat', { words: { code: 'kod', free: 'serbest' } }), env, 'tr')!.reason;
  assert.match(tr, /^💬 sohbet modu: \/home\/u\/proj\/a\.ts dosyasına yazmak bu modun yazdığı yerlerin dışında \(geçici klasör\)\./);
  assert.match(tr, /"kod" ya da "serbest" yazar/);
});

test('checkGuards: the mode first, then the quota', () => {
  assert.equal(checkGuards('Write', { file_path: '/home/u/proj/a.ts', content: '' }, guard('chat'), q(99), env, 'en')?.kind, 'mode');
  assert.equal(checkGuards('Write', { file_path: '/tmp/a.ts', content: '' }, guard('chat'), null, env, 'en'), null);
});

test('quota wrap-up: no new heavy work; stop: only reads, notes and commits', () => {
  assert.equal(checkGuards('Agent', { prompt: 'x' }, null, q(50), env, 'en'), null);
  assert.equal(checkGuards('Agent', { prompt: 'x' }, null, q(96), env, 'en')?.kind, 'quota');
  assert.equal(checkGuards('Write', { file_path: '/home/u/proj/a.ts', content: '' }, null, q(96), env, 'en'), null);
  assert.equal(checkGuards('Write', { file_path: '/home/u/proj/a.ts', content: '' }, null, q(99), env, 'en')?.kind, 'quota');
  assert.equal(checkGuards('Write', { file_path: '/home/u/notes/n.md', content: '' }, null, q(99), env, 'en'), null);
  assert.equal(checkGuards('Bash', { command: 'git commit -m wip' }, null, q(99), env, 'en'), null);
  assert.equal(checkGuards('Read', { file_path: '/home/u/proj/a.ts' }, null, q(99), env, 'en'), null);
});
