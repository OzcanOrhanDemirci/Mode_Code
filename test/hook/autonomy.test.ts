// SPDX-License-Identifier: Apache-2.0
/**
 * The safety-net hook's stop decision for a full-autonomy run (docs/autonomy.md), as Claude Code runs it:
 * a process that reads the Stop event and answers. Each case has a fresh data folder and a real git work
 * tree of its own in the temporary folder; nothing else is touched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptPlan, pauseRun, startRun, type Run } from '../../src/core/run.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const hook = join(root, 'src', 'hook', 'main.ts');
const SESSION = 'auto-session';

function git(dir: string, ...args: string[]): string {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

interface Place {
  home: string;
  repo: string;
  hookState: () => Record<string, any>;
  stop: (extra?: object) => Record<string, any> | null;
  setRun: (r: Run) => void;
  quota: (five: number, week: number) => void;
}

function place(run: (repo: string, head: string) => Run): Place {
  const base = mkdtempSync(join(tmpdir(), 'tc-auto-'));
  const home = join(base, 'data');
  const repo = join(base, 'repo');
  mkdirSync(join(home, 'state', 'sessions'), { recursive: true });
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'en', modules: { footer: false } }));
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-q', '-m', 'start');
  const head = git(repo, 'rev-parse', 'HEAD');
  const setRun = (r: Run) => {
    mkdirSync(join(home, 'runs', r.id), { recursive: true });
    writeFileSync(join(home, 'runs', r.id, 'run.json'), JSON.stringify(r));
    writeFileSync(
      join(home, 'state', 'sessions', `${SESSION}.mod.json`),
      JSON.stringify({ v: 1, sessionId: SESSION, aliveAt: Date.now(), runId: r.id, interaction: 'full', weeklyTarget: 60 }),
    );
  };
  const quota = (five: number, week: number) =>
    writeFileSync(
      join(home, 'state', 'quota.json'),
      JSON.stringify({
        windows: [
          { kind: 'five_hour', used: five, resetsAt: Date.now() + 3_600_000 },
          { kind: 'seven_day', used: week, resetsAt: Date.now() + 86_400_000 },
        ],
        measuredAt: Date.now(),
        source: 'mod',
      }),
    );
  setRun(run(repo, head));
  quota(10, 40);
  return {
    home,
    repo,
    setRun,
    quota,
    hookState: () => JSON.parse(readFileSync(join(home, 'state', 'sessions', `${SESSION}.hook.json`), 'utf8')),
    stop: (extra = {}) => {
      const r = spawnSync(process.execPath, ['--import', 'tsx', hook, 'Stop'], {
        cwd: root,
        input: JSON.stringify({ session_id: SESSION, cwd: repo, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Done.', ...extra }),
        encoding: 'utf8',
        env: { ...process.env, TERMINAL_CODE_HOME: home, TERMINAL_CODE_LANG: 'en' },
        timeout: 30_000,
      });
      assert.equal(r.status, 0, r.stderr);
      const text = (r.stdout ?? '').trim();
      return text ? JSON.parse(text) : null;
    },
  };
}

const newRun = (repo: string, head: string, now = Date.now()) =>
  startRun({
    id: 'r1',
    task: 'Add rate limiting',
    project: null,
    cwd: repo,
    sessionId: SESSION,
    workDir: join(repo, '..', 'work'),
    budget: { weeklyTarget: 60, source: '+20' },
    start: { commit: head, branch: 'main' },
    now,
  });
const planned = (repo: string, head: string) => {
  const r = acceptPlan(newRun(repo, head), { steps: [{ n: 1, title: 'Limiter', acceptance: 'tests pass' }], verification: ['npm test'] }, [], Date.now());
  assert.equal(r.ok, true);
  return r.run;
};

test('an unfinished run is turned back with what is missing; three attempts that change nothing let it stop as no progress', () => {
  const p = place(planned);
  try {
    const first = p.stop();
    const text = String(first?.hookSpecificOutput?.additionalContext ?? '');
    assert.equal(first?.hookSpecificOutput?.hookEventName, 'Stop');
    assert.match(text, /^🤖 Full autonomy: the run is not done\. Step 1\/1 \(Limiter\) has no milestone yet/);
    assert.match(text, /Attempts to stop with nothing changed: 1\/3\.$/);
    assert.equal(first?.decision, undefined, 'feedback that keeps the run going, not an error');
    assert.match(String(p.stop()?.hookSpecificOutput?.additionalContext), /2\/3/);
    // A change in the work tree is progress: the count starts again.
    writeFileSync(join(p.repo, 'b.txt'), 'b\n');
    assert.match(String(p.stop()?.hookSpecificOutput?.additionalContext), /1\/3/);
    assert.match(String(p.stop()?.hookSpecificOutput?.additionalContext), /2\/3/);
    assert.equal(p.stop(), null, 'the third attempt in a row with nothing changed is let through');
    const st = p.hookState();
    assert.deepEqual([st.autoAllowed.runId, st.autoAllowed.why, st.autoStop.streak], ['r1', 'noProgress', 0]);
    // A commit is progress too.
    git(p.repo, 'add', 'b.txt');
    git(p.repo, 'commit', '-q', '-m', 'b');
    assert.match(String(p.stop()?.hookSpecificOutput?.additionalContext), /1\/3/);
  } finally {
    rmSync(join(p.home, '..'), { recursive: true, force: true });
  }
});

test('the plan phase and the finish say what they need', () => {
  const p = place(newRun);
  try {
    assert.match(String(p.stop()?.hookSpecificOutput?.additionalContext), /Its plan is not accepted yet: write it at .*plan\.md/);
  } finally {
    rmSync(join(p.home, '..'), { recursive: true, force: true });
  }
});

test('a paused run, a reached budget and background work let the session stop', () => {
  const p = place(planned);
  try {
    p.quota(96, 40);
    assert.equal(p.stop(), null, 'the 5-hour window at its wrap-up line');
    assert.equal(p.hookState().autoAllowed.why, 'budget');
    p.quota(10, 59);
    assert.equal(p.stop(), null, 'the weekly budget one below its target');
    p.quota(10, 40);
    assert.ok(p.stop(), 'under budget it is turned back again');
    assert.equal(p.stop({ background_tasks: [{ id: 't', type: 'shell', status: 'running', description: 'build' }] }), null);
    assert.ok(p.stop({ background_tasks: [{ id: 't', type: 'shell', status: 'completed', description: 'build' }] }), 'finished background work does not count');
    const r = JSON.parse(readFileSync(join(p.home, 'runs', 'r1', 'run.json'), 'utf8')) as Run;
    const paused = pauseRun(r, 'person', Date.now());
    assert.equal(paused.ok, true);
    p.setRun(paused.run);
    assert.equal(p.stop(), null);
  } finally {
    rmSync(join(p.home, '..'), { recursive: true, force: true });
  }
});

test('the time limit lets a run stop', () => {
  const p = place((repo, head) => {
    const r = planned(repo, head);
    return { ...r, activeMs: 12 * 3_600_000 };
  });
  try {
    assert.equal(p.stop(), null);
    assert.equal(p.hookState().autoAllowed.why, 'timeout');
  } finally {
    rmSync(join(p.home, '..'), { recursive: true, force: true });
  }
});
