// SPDX-License-Identifier: Apache-2.0
/**
 * The reset at a task boundary (src/core/reset.ts): what arms it, which calls finish the piece of work and so let it
 * wait, when it goes on, the note's prompt and its reading back, what is carried into the new conversation and the
 * prompt it starts with.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  armOnBoundary,
  CARRY_TTL_MS,
  carriedState,
  carryFits,
  continuationPrompt,
  forkPrompt,
  gitSubcommand,
  inCluster,
  parseForkParts,
  RESET_GAP_MS,
  RESET_TOKENS,
  RESET_TOKENS_MAX,
  RESET_TOKENS_MIN,
  resetVerdict,
  withCarried,
  type Carry,
  type ClusterEnv,
} from '../../src/core/reset.js';
import { newModState } from '../../src/core/session.js';
import { emptyProvenance } from '../../src/core/provenance.js';
import { partProblems } from '../../src/core/handoff.js';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const arm = (over: Partial<Parameters<typeof armOnBoundary>[0]> = {}) =>
  armOnBoundary({ kinds: ['commit'], tokens: 250_000, interaction: 'autonomous', autoReset: true, threshold: RESET_TOKENS, now: NOW, ...over });

test('the limits: 200K by default, settable from 20K to 900K, one reset in 15 minutes, a carry waits 2 minutes', () => {
  assert.equal(RESET_TOKENS, 200_000);
  assert.equal(RESET_TOKENS_MIN, 20_000);
  assert.equal(RESET_TOKENS_MAX, 900_000);
  assert.equal(RESET_GAP_MS, 900_000);
  assert.equal(CARRY_TTL_MS, 120_000);
});

test('a commit or a push arms the reset in autonomous work and full autonomy, at the threshold and above', () => {
  assert.deepEqual(arm(), { kind: 'commit', tokens: 250_000, at: NOW });
  assert.deepEqual(arm({ interaction: 'full' }), { kind: 'commit', tokens: 250_000, at: NOW });
  // A push names the boundary, with or without its commit.
  assert.deepEqual(arm({ kinds: ['add', 'commit', 'push'] }), { kind: 'push', tokens: 250_000, at: NOW });
  assert.deepEqual(arm({ kinds: ['push'] }), { kind: 'push', tokens: 250_000, at: NOW });
  assert.deepEqual(arm({ tokens: 200_000 }), { kind: 'commit', tokens: 200_000, at: NOW });
  assert.equal(arm({ tokens: 199_999 }), null);
  assert.deepEqual(arm({ tokens: 20_000, threshold: 20_000 }), { kind: 'commit', tokens: 20_000, at: NOW });
  assert.equal(arm({ tokens: 19_999, threshold: 20_000 }), null);
});

test('nothing arms it in manual or with no way chosen, with the setting off, or for a call that is no commit or push', () => {
  assert.equal(arm({ interaction: 'manual' }), null);
  assert.equal(arm({ interaction: 'default' }), null);
  assert.equal(arm({ autoReset: false }), null);
  assert.equal(arm({ kinds: [] }), null);
  assert.equal(arm({ kinds: ['status', 'log', 'add'] }), null);
});

test("git's subcommand is the first word past its own options", () => {
  assert.equal(gitSubcommand(['commit', '-m', 'x']), 'commit');
  assert.equal(gitSubcommand(['-C', 'my dir', 'push']), 'push');
  assert.equal(gitSubcommand(['-c', 'k=v', '--no-pager', 'log']), 'log');
  assert.equal(gitSubcommand(['--no-pager']), null);
  assert.equal(gitSubcommand([]), null);
});

const env: ClusterEnv = {
  platform: 'linux',
  home: '/home/ada',
  cwd: '/home/ada/dev/app',
  memoryDirs: ['/home/ada/memory'],
  handoffDir: '/home/ada/.mode-code/handoffs',
};
const bash = (command: string) => inCluster('Bash', { command }, env);

test("finishing the work's chain keeps the reset waiting: the memory's commit, the project's commit, both pushes", () => {
  for (const command of [
    'git -C /home/ada/memory add project_x.md && git -C /home/ada/memory commit -s -m "docs: note x"',
    'cd /home/ada/memory && git push',
    'git add -A && git commit -s -m "feat: x" && git push -u origin feat/x',
    'git status --short; git log --oneline -3; git diff --stat; git show HEAD',
    'git fetch && git pull --ff-only',
    'git tag -l',
    'gh pr create --fill',
    'gh pr checks 12 --watch',
    'sleep 30 && gh run list --limit 1',
    'cd /home/ada/memory && pwd && git status',
    'git log --oneline -1 > /home/ada/memory/last.txt',
  ])
    assert.equal(bash(command), true, command);
  assert.equal(inCluster('PowerShell', { command: 'Set-Location C:/dev/app; git push' }, { ...env, platform: 'win32' }), true);
  for (const own of ['handoff', 'flow_step', 'request']) assert.equal(inCluster(`mcp__mode-code__${own}`, {}, env), true);
  assert.equal(inCluster('mcp__mode-code__catalog', {}, env), false);
  assert.equal(inCluster('TodoWrite', { todos: [] }, env), true);
  // The memory's notes, written and read: part of bringing it up to date.
  assert.equal(inCluster('Edit', { file_path: '/home/ada/memory/project_x.md' }, env), true);
  assert.equal(inCluster('Write', { file_path: '~/memory/MEMORY.md' }, env), true);
  assert.equal(inCluster('NotebookEdit', { notebook_path: '/home/ada/memory/n.ipynb' }, env), true);
  assert.equal(inCluster('Write', { file_path: '/home/ada/.mode-code/handoffs/app/n.md' }, env), true);
  assert.equal(inCluster('Read', { file_path: '/home/ada/memory/MEMORY.md' }, env), true);
  assert.equal(inCluster('Grep', { pattern: 'x', path: '/home/ada/memory' }, env), true);
  assert.equal(inCluster('Glob', { pattern: '*.md', path: '/home/ada/memory/terminal' }, env), true);
});

test('the next task is out of it: its first read, an edit of the project, a test, a new branch, git with other work', () => {
  assert.equal(inCluster('Read', { file_path: '/home/ada/dev/app/src/a.ts' }, env), false);
  assert.equal(inCluster('Read', { file_path: '/home/ada/.mode-code/handoffs/app/n.md' }, env), false);
  assert.equal(inCluster('Read', {}, env), false);
  assert.equal(inCluster('Grep', { pattern: 'x' }, env), false);
  assert.equal(inCluster('Edit', { file_path: '/home/ada/dev/app/src/a.ts' }, env), false);
  assert.equal(inCluster('Write', { file_path: '' }, env), false);
  // No path is no place, even where the session works in the memory itself.
  assert.equal(inCluster('Write', { file_path: '' }, { ...env, cwd: '/home/ada/memory' }), false);
  assert.equal(inCluster('Write', { file_path: 'x.md' }, { ...env, cwd: '/home/ada/memory' }), true);
  assert.equal(inCluster('Agent', { prompt: 'x' }, env), false);
  assert.equal(inCluster('WebFetch', { url: 'https://example.com' }, env), false);
  for (const command of [
    'npm test',
    'git switch -c feat/next',
    'git checkout main',
    'git commit -m x && npm test',
    'echo hi',
    'cd /home/ada/dev/app',
    'git add -A && git commit -m x > /home/ada/dev/app/out.txt',
    'git log > "$OUT"',
    '$GIT commit -m x',
    'gh issue list',
    'gh api repos/x/y',
    '',
  ])
    assert.equal(bash(command), false, command);
  assert.equal(inCluster('Bash', {}, env), false);
});

test('the reset goes on unless work runs in the background, the quota stops, the work wraps up, or one was just made', () => {
  const v = (over: Partial<Parameters<typeof resetVerdict>[0]> = {}) =>
    resetVerdict({ busy: false, lastResetAt: 0, now: NOW, quotaStop: false, wrapUp: false, ...over });
  assert.deepEqual(v(), { go: true });
  assert.deepEqual(v({ busy: true }), { go: false, why: 'busy' });
  assert.deepEqual(v({ quotaStop: true }), { go: false, why: 'quota' });
  assert.deepEqual(v({ wrapUp: true }), { go: false, why: 'wrapUp' });
  assert.deepEqual(v({ lastResetAt: NOW - RESET_GAP_MS + 1 }), { go: false, why: 'recent' });
  assert.deepEqual(v({ lastResetAt: NOW - RESET_GAP_MS }), { go: true });
  assert.deepEqual(v({ busy: true, quotaStop: true, wrapUp: true, lastResetAt: NOW }), { go: false, why: 'busy' });
  assert.deepEqual(v({ quotaStop: true, wrapUp: true }), { go: false, why: 'quota' });
  assert.deepEqual(v({ wrapUp: true, lastResetAt: NOW }), { go: false, why: 'wrapUp' });
});

test("the note's prompt asks for the four parts as JSON, no tool, the person's language, the person's words for decisions", () => {
  const p = forkPrompt();
  assert.match(p, /^\[Mode_Code\] Mode_Code is about to reset this conversation/);
  assert.match(p, /Do not call any tool\. Reply with one JSON object only, with four string fields/);
  assert.match(p, /in the language the person writes in/);
  for (const part of ['summary', 'open', 'decisions', 'next']) assert.match(p, new RegExp(`\\n${part}: `));
  assert.match(p, /in their own words where they gave them/);
  assert.match(p, /concrete enough to start on at once/);
  assert.match(p, /No keys, tokens or passwords\.$/);
});

test('the reply is read as JSON, fenced or bare, lists as lines; else as headings; nothing found is null', () => {
  const four = { summary: 'Did x.', open: 'y', decisions: 'z', next: 'w' };
  assert.deepEqual(parseForkParts(JSON.stringify(four)), four);
  assert.deepEqual(parseForkParts('Here it is:\n```json\n' + JSON.stringify({ ...four, summary: '  Did x.  ' }) + '\n```'), four);
  assert.deepEqual(parseForkParts(JSON.stringify({ ...four, open: ['a', 'b'] })), { ...four, open: '- a\n- b' });
  assert.deepEqual(parseForkParts(JSON.stringify({ ...four, open: ['a', 2] })), { summary: 'Did x.', decisions: 'z', next: 'w' });
  // What is not text is left out, for partProblems to find missing.
  assert.deepEqual(parseForkParts(JSON.stringify({ summary: 'x', open: 3, decisions: [1], next: null })), { summary: 'x' });
  assert.deepEqual(parseForkParts('## Summary\nDid x.\nAnd y.\n\n## Open\nnone\n**Decisions:** keep it\nnext: run the tests'), {
    summary: 'Did x.\nAnd y.',
    open: 'none',
    decisions: 'keep it',
    next: 'run the tests',
  });
  // A JSON object with none of the parts, or one that does not parse, is read as headings.
  assert.deepEqual(parseForkParts('{"a": 1}\nSummary: s'), { summary: 's' });
  assert.deepEqual(parseForkParts('{ not json }\nNEXT: go'), { next: 'go' });
  assert.equal(parseForkParts('I cannot write that.'), null);
  assert.equal(parseForkParts(''), null);
  assert.equal(parseForkParts('{}'), null);
  // What partProblems then says of a reply with a part missing.
  assert.deepEqual(
    partProblems(parseForkParts('summary: s\nopen: o') ?? {}, () => 0).map((p) => p.part),
    ['decisions', 'next'],
  );
});

test('a reset carries the way of working (full autonomy too), the flow, the budget and what the safety layer knows', () => {
  const s = {
    ...newModState('old', '1.2.0', NOW - 5000),
    mode: 'code' as const,
    interaction: 'full' as const,
    turnMode: 'plan' as const,
    flowId: 'f1',
    project: 'terminal',
    weeklyTarget: 40,
    weeklyTargetSource: '+10',
    wrapUp: false,
    resumeAt: NOW + 3_600_000,
    approvals: [{ toolUseId: 't1', at: NOW, rules: ['git.force-push'] }],
    blocks: { 'git.force-push': 2 },
    tainted: { source: 'WebFetch', at: NOW - 1000 },
    frozen: '/home/ada/dev/app/src',
    agents: { mode: 'free' as const, n: 3, rows: [], batch: null, untold: false as const, ultracode: false },
  };
  const c = carriedState(s);
  assert.deepEqual(c, {
    mode: 'code',
    interaction: 'full',
    flowId: 'f1',
    project: 'terminal',
    weeklyTarget: 40,
    weeklyTargetSource: '+10',
    wrapUp: false,
    resumeAt: NOW + 3_600_000,
    agents: s.agents,
    frozen: '/home/ada/dev/app/src',
    tainted: { source: 'WebFetch', at: NOW - 1000 },
  });
  const fresh = { ...newModState('new', '1.2.0', NOW), turnMode: 'chat' as const };
  const next = withCarried(fresh, c);
  assert.equal(next.sessionId, 'new');
  assert.equal(next.interaction, 'full');
  // The quota's resume keeps its time: a reset does not move it.
  assert.equal(next.resumeAt, NOW + 3_600_000);
  assert.deepEqual(next.tainted, { source: 'WebFetch', at: NOW - 1000 });
  // Each approval was for one call, and the blocks and the turn's mode are the old conversation's.
  assert.deepEqual(next.approvals, []);
  assert.deepEqual(next.blocks, {});
  assert.equal(next.turnMode, null);
  // Outside content the new conversation read already is never dropped by a carry without one.
  const read = { ...fresh, tainted: { source: 'peer', at: NOW } };
  assert.deepEqual(withCarried(read, { ...c, tainted: null }).tainted, { source: 'peer', at: NOW });
  assert.deepEqual(withCarried(read, c).tainted, { source: 'WebFetch', at: NOW - 1000 });
});

test('a carry is taken up by the conversation after the /clear only: another session, the same folder, a moment later', () => {
  const carry: Carry = {
    from: 'old',
    cwd: 'C:/dev/App',
    at: NOW,
    state: carriedState(newModState('old', '1.2.0', NOW)),
    prov: emptyProvenance(),
    request: null,
    note: null,
    tokens: 250_000,
    resets: 1,
    prompt: 'go on',
  };
  const fits = (over: Partial<Parameters<typeof carryFits>[1]> = {}) =>
    carryFits(carry, { sessionId: 'new', cwd: 'c:/dev/app', now: NOW + 1000, platform: 'win32', ...over });
  assert.equal(fits(), true);
  assert.equal(fits({ now: NOW }), true);
  assert.equal(fits({ now: NOW + CARRY_TTL_MS }), true);
  assert.equal(fits({ now: NOW + CARRY_TTL_MS + 1 }), false);
  assert.equal(fits({ now: NOW - 1 }), false);
  assert.equal(fits({ sessionId: 'old' }), false);
  assert.equal(fits({ cwd: 'C:/dev/other' }), false);
  // Case counts where the file system tells it.
  assert.equal(fits({ cwd: '/home/ada/App', platform: 'linux' }), false);
  assert.equal(carryFits({ ...carry, cwd: '/home/ada/App' }, { sessionId: 'new', cwd: '/home/ada/App', now: NOW, platform: 'linux' }), true);
});

test('the new conversation starts with why, what not to redo, the state and the note whole, in the person language', () => {
  const en = continuationPrompt({
    tokens: '246 K',
    note: '## Next\n\nRun the tests.\n',
    path: '/h/n.md',
    state: '[Mode_Code] Session state: autonomous.',
    lang: 'en',
  });
  assert.equal(
    en,
    "[Mode_Code] The conversation was reset at a task boundary to save tokens: it had 246 K of context, and every call read all of it again. The work goes on here, in a new conversation. The note below was written from that conversation just before the reset (its file: /h/n.md). Do not redo finished steps (git shows what is committed); read the rules and the memory only as far as the next step needs. Then go on with the note's next step.\n\n[Mode_Code] Session state: autonomous.\n\n## Next\n\nRun the tests.",
  );
  const tr = continuationPrompt({ tokens: '246 B', note: 'not', path: null, state: '', lang: 'tr' });
  assert.match(tr, /^\[Mode_Code\] Konuşma, token tasarrufu için bir görev sınırında sıfırlandı: bağlam 246 B idi/);
  assert.match(tr, /hemen önce bu konuşmadan yazıldı\. Biten adımları yeniden yapma/);
  assert.doesNotMatch(tr, /dosyası/);
  assert.match(tr, /sonraki adımla devam et\.\n\nnot$/);
});
