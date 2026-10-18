// SPDX-License-Identifier: Apache-2.0
/**
 * The command line, end to end, as separate processes: install with a stand-in `claude`, check, repair,
 * every --json contract, uninstall. Defined once and run twice: against the TypeScript source
 * (test/process) and against the shipped bundle (test/dist), so what is tested is what ships; and by
 * scripts/test-package.mjs a third time, against the copy npm installed from the package's tarball.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { built, bundleCli, cli, ROOT, world } from '../helpers/proc.js';

export function defineCliTests(mode: 'source' | 'dist' | 'package'): void {
  const dist = mode !== 'source';
  const skip = (t: { skip(msg: string): void }) => {
    if (!built()) {
      t.skip('needs the build: npm run build');
      return true;
    }
    return false;
  };
  const opt = { dist };

  test(`${mode}: version, help, an unknown command, open without a terminal`, (t) => {
    if (dist && skip(t)) return;
    const w = world();
    try {
      const v = cli(w, ['--version'], opt);
      assert.equal(v.code, 0);
      assert.match(v.out.trim(), dist ? /^\d+\.\d+\.\d+/ : /^dev$/);
      assert.equal(cli(w, ['version'], opt).out, v.out);
      const h = cli(w, ['help'], opt);
      assert.equal(h.code, 0);
      for (const c of ['status', 'doctor', 'install', 'uninstall', 'belt', 'secrets', 'config']) assert.match(h.out, new RegExp(c));
      assert.equal(cli(w, ['--help'], opt).out, h.out);
      const u = cli(w, ['frobnicate'], opt);
      assert.equal(u.code, 2);
      assert.match(u.err, /frobnicate/);
      assert.equal(cli(w, ['open', 'home'], opt).code, 2, 'no terminal: refuses instead of hanging');
    } finally {
      w.done();
    }
  });

  test(`${mode}: before installing, status and doctor say so and fail nothing they cannot know`, (t) => {
    if (skip(t)) return;
    const w = world();
    try {
      const s = cli(w, ['status', '--json'], opt);
      assert.equal(s.code, 0, s.err);
      assert.equal(s.json?.schema, 'mode-code.status/1');
      assert.equal(s.json?.installed, false);
      assert.equal(s.json?.claudeCode, '2.1.296');
      const d = cli(w, ['doctor', '--json', '--quick'], opt);
      assert.equal(d.json?.schema, 'mode-code.doctor/1');
      assert.ok(Array.isArray(d.json?.checks) && d.json.checks.length >= 30);
      const byId = Object.fromEntries((d.json?.checks as { id: string; status: string }[]).map((c) => [c.id, c.status]));
      assert.equal(byId['install.manifest'], 'info');
      assert.equal(byId['install.hooks'], 'skip');
      assert.equal(byId['claude.version'], 'ok');
      assert.equal(byId['selftest.suites'], 'ok');
      assert.equal(d.code, d.json?.tally.fail ? 1 : 0);
    } finally {
      w.done();
    }
  });

  test(`${mode}: install --dry-run lists every change and makes none`, (t) => {
    if (skip(t)) return;
    const w = world();
    try {
      const r = cli(w, ['install', '--dry-run', '--json'], opt);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.json?.schema, 'mode-code.install-plan/1');
      assert.deepEqual(
        r.json?.plan.steps.map((s: { kind: string }) => s.kind),
        ['data-folder', 'hook-program', 'marketplace', 'plugin', 'settings-hooks', 'config', 'self-test'],
      );
      assert.deepEqual(r.json?.plan.blockers, []);
      assert.equal(existsSync(w.data), false, 'nothing was created');
      assert.equal(existsSync(join(w.claudeDir, 'settings.json')), false);
      assert.deepEqual(w.claudeState().calls, [['--version']]);
    } finally {
      w.done();
    }
  });

  test(`${mode}: no Claude Code, or one too old: install refuses and says why`, (t) => {
    if (skip(t)) return;
    const none = world({ claude: null });
    const old = world({ claude: { version: '2.0.0' } });
    try {
      const a = cli(none, ['install', '--dry-run', '--json'], opt);
      assert.equal(a.code, 1);
      assert.deepEqual(
        a.json?.plan.blockers.map((b: { key: string }) => b.key),
        ['install.block.noClaude'],
      );
      const b = cli(old, ['install', '--dry-run', '--json'], opt);
      assert.equal(b.code, 1);
      assert.deepEqual(
        b.json?.plan.blockers.map((x: { key: string }) => x.key),
        ['install.block.oldClaude'],
      );
    } finally {
      none.done();
      old.done();
    }
  });

  test(`${mode}: install, check, break, repair, uninstall: the whole life of an installation`, { timeout: 180_000 }, (t) => {
    if (skip(t)) return;
    const w = world({ lang: 'en' });
    try {
      const memory = join(w.claudeDir, 'memory-here');
      const mine = { theme: 'dark', autoMemoryDirectory: memory, hooks: { Notification: [{ hooks: [{ type: 'command', command: 'echo done' }] }] } };
      writeFileSync(join(w.claudeDir, 'settings.json'), JSON.stringify(mine));
      const i = cli(w, ['install', '--yes', '--json', '--lang', 'en'], opt);
      assert.equal(i.code, 0, i.out + i.err);
      assert.equal(i.json?.ok, true);
      assert.ok(i.json?.steps.every((s: { ok: boolean }) => s.ok));
      // Nobody chose a memory folder: the one Claude Code is set to keep is protected.
      assert.deepEqual(JSON.parse(readFileSync(join(w.data, 'config.json'), 'utf8')).memory.dirs, [memory]);
      const settings = JSON.parse(readFileSync(join(w.claudeDir, 'settings.json'), 'utf8'));
      assert.equal(settings.theme, 'dark');
      assert.deepEqual(settings.hooks.Notification, mine.hooks.Notification);
      assert.equal(settings.hooks.PreToolUse[0].hooks[0].onFailure, 'block');
      assert.ok(w.claudeState().plugins.some((p) => p.id === 'mode-code@mode-code-local'));
      // The program /0 opens beside a session: this build's own, recorded where the plugin reads it.
      const recorded = JSON.parse(readFileSync(join(w.data, 'install', 'manifest.json'), 'utf8')).cli;
      assert.match(recorded, /\/dist\/cli\.mjs$/);
      assert.ok(existsSync(recorded), recorded);

      const s = cli(w, ['status', '--json'], opt);
      assert.equal(s.json?.installed, true);
      assert.equal(s.code, 0, 'no protection is broken');

      const healthy = cli(w, ['doctor', '--json'], opt);
      const fails = (healthy.json?.checks as { id: string; status: string; protection: boolean }[]).filter((c) => c.status === 'fail');
      // On a machine where the real environment has a problem (no git, say) that is not about the installation, it may fail
      // here too; the installation's own checks must pass.
      for (const id of ['install.hooks', 'install.hookProgram', 'node.hooks', 'protect.agreement', 'install.pluginFiles'])
        assert.ok(!fails.some((f) => f.id === id), `${id} failed on a fresh installation`);
      const ccStatus = (healthy.json?.checks as { id: string; status: string }[]).find((c) => c.id === 'install.controlCenter')?.status;
      assert.equal(ccStatus, 'ok');

      // Break it the way an accident would: the hooks gone from the settings, the hook program deleted; and the
      // record an installation before /0 opened anything has: no command-line program in it.
      writeFileSync(join(w.claudeDir, 'settings.json'), JSON.stringify(mine));
      const hook = join(w.data, 'bin', 'hook.mjs');
      writeFileSync(hook, 'process.exit(0);\n');
      const older = JSON.parse(readFileSync(join(w.data, 'install', 'manifest.json'), 'utf8'));
      delete older.cli;
      writeFileSync(join(w.data, 'install', 'manifest.json'), JSON.stringify(older));
      const broken = cli(w, ['doctor', '--json'], opt);
      assert.equal(broken.code, 1);
      const status = (id: string, j: Record<string, any> | null) => (j?.checks as { id: string; status: string }[]).find((c) => c.id === id)?.status;
      assert.equal(status('install.hooks', broken.json), 'fail');
      assert.equal(status('install.hookProgram', broken.json), dist ? 'fail' : 'warn');
      const said = (id: string, j: Record<string, any> | null) =>
        (j?.checks as { id: string; summary: { key: string } }[]).find((c) => c.id === id)?.summary.key;
      // The installation recorded the program's fingerprint: a change since is called a change.
      assert.equal(said('install.hookProgram', broken.json), dist ? 'doc.install.hook.altered' : 'doc.install.hook.notThisBuild');
      assert.equal(said('install.controlCenter', broken.json), 'doc.install.cli.none');
      const fixed = cli(w, ['doctor', '--json', '--fix'], opt);
      const repairs = fixed.json?.repairs as { id: string; verified: boolean }[];
      assert.ok(repairs.some((r) => r.id === 'restore-hooks' && r.verified));
      assert.ok(repairs.some((r) => r.id === 'restore-hook-program' && r.verified));
      assert.ok(repairs.some((r) => r.id === 'record-cli' && r.verified));
      assert.equal(status('install.hooks', fixed.json), 'ok');
      assert.equal(status('install.controlCenter', fixed.json), 'ok');
      const manifest = JSON.parse(readFileSync(join(w.data, 'install', 'manifest.json'), 'utf8'));
      assert.equal(manifest.hookHash, createHash('sha256').update(readFileSync(hook)).digest('hex'), 'the repair recorded the program it put back');
      assert.equal(manifest.cli, recorded, 'the repair recorded the program /0 opens, the one the installation did');
      const after = JSON.parse(readFileSync(join(w.claudeDir, 'settings.json'), 'utf8'));
      assert.equal(after.theme, 'dark', "the person's settings survived the repair");
      assert.ok(after.hooks.PreToolUse);
      assert.ok(existsSync(join(w.data, 'state', 'doctor.json')), 'the control center can show the last check');

      // What Claude Code itself writes when a plugin is installed, and leaves empty when it is removed.
      const withRecords = { ...after, enabledPlugins: { 'mode-code@mode-code-local': true }, extraKnownMarketplaces: { 'mode-code-local': { source: {} } } };
      writeFileSync(join(w.claudeDir, 'settings.json'), JSON.stringify(withRecords));
      const u = cli(w, ['uninstall', '--yes', '--json'], opt);
      assert.equal(u.code, 0, u.out + u.err);
      const left = JSON.parse(readFileSync(join(w.claudeDir, 'settings.json'), 'utf8'));
      assert.deepEqual(left, mine, 'removal restores the settings exactly');
      assert.equal(existsSync(hook), false);
      assert.ok(existsSync(join(w.data, 'config.json')), 'settings and history stay unless --purge');
    } finally {
      w.done();
    }
  });

  test(`${mode}: commands that lower a protection refuse inside an agent's shell`, (t) => {
    if (skip(t)) return;
    const w = world();
    try {
      const agent = { ...w, env: { ...w.env, CLAUDECODE: '1' } };
      const i = cli(agent, ['install', '--dry-run', '--json'], opt);
      assert.ok(i.json?.plan.blockers.some((b: { key: string }) => b.key === 'install.block.agent'));
      assert.equal(cli(agent, ['config', 'set', 'belt.disabled', '["git.clean"]'], opt).code, 1);
      // Where the shared place is decides whose settings come in: the person's, never an agent's.
      assert.equal(cli(agent, ['config', 'set', 'sync.dir', '"/elsewhere"'], opt).code, 1);
      assert.equal(cli(agent, ['uninstall', '--yes'], opt).code, 1);
      // Plain settings are fine from anywhere.
      assert.equal(cli(agent, ['config', 'set', 'view', '"detailed"'], opt).code, 0);
    } finally {
      w.done();
    }
  });

  test(`${mode}: the doctor under an agent puts the hooks back but never installs code into the protection`, { timeout: 180_000 }, (t) => {
    if (skip(t)) return;
    const w = world();
    try {
      assert.equal(cli(w, ['install', '--yes', '--json'], opt).code, 0);
      const hook = join(w.data, 'bin', 'hook.mjs');
      writeFileSync(hook, 'process.exit(0);\n');
      writeFileSync(join(w.claudeDir, 'settings.json'), '{}');
      const agent = { ...w, env: { ...w.env, CLAUDECODE: '1' } };
      const r = cli(agent, ['doctor', '--fix', '--json'], opt);
      assert.ok(r.json, `doctor --fix --json printed no JSON (exit ${r.code}):\n${r.err || r.out}`);
      const planned = r.json.repairsPlanned as { id: string; refused: boolean }[];
      assert.equal(planned.find((p) => p.id === 'restore-hook-program')?.refused, true);
      assert.equal(readFileSync(hook, 'utf8'), 'process.exit(0);\n', 'the hook program was not replaced');
      const settings = JSON.parse(readFileSync(join(w.claudeDir, 'settings.json'), 'utf8'));
      assert.ok(settings.hooks?.PreToolUse, 'the hooks were put back, with the recorded Node.js');
      assert.equal(r.code, 1, 'a protection is still broken, and it says so');
    } finally {
      w.done();
    }
  });

  test(`${mode}: config: path, get, set with validation`, (t) => {
    if (skip(t)) return;
    const w = world();
    try {
      assert.equal(cli(w, ['config', 'path'], opt).out.trim().replace(/\\/g, '/'), `${w.data.replace(/\\/g, '/')}/config.json`);
      assert.equal(cli(w, ['config', 'get', 'language'], opt).out.trim(), 'auto');
      assert.equal(cli(w, ['config', 'set', 'language', '"tr"'], opt).code, 0);
      assert.equal(cli(w, ['config', 'get', 'language'], opt).out.trim(), 'tr');
      assert.equal(cli(w, ['config', 'set', 'language', '"klingon"'], opt).code, 1);
      assert.equal(cli(w, ['config', 'get', 'no.such.key'], opt).code, 1);
      assert.equal(cli(w, ['config', 'set', 'view'], opt).code, 2);
      assert.equal(cli(w, ['config', 'frob'], opt).code, 2);
    } finally {
      w.done();
    }
  });

  test(`${mode}: belt rules, test and events`, (t) => {
    if (skip(t)) return;
    const w = world();
    try {
      const rules = cli(w, ['belt', 'rules', '--json'], opt);
      assert.equal(rules.json?.schema, 'mode-code.belt-rules/1');
      assert.ok(rules.json?.rules.length >= 30);
      const tst = cli(w, ['belt', 'test', '--command', 'git status', '--json'], opt);
      assert.equal(tst.json?.decision.verdict, 'allow');
      const prot = cli(w, ['belt', 'test', '--path', join(w.data, 'config.json'), '--json'], opt);
      assert.equal(prot.json?.decision.verdict, 'deny');
      assert.equal(cli(w, ['belt', 'events', '--json'], opt).json?.events.length, 0);
      assert.equal(cli(w, ['belt', 'frob'], opt).code, 2);
    } finally {
      w.done();
    }
  });

  test(`${mode}: secrets: a token in a file is found and shown masked`, (t) => {
    if (skip(t)) return;
    const w = world();
    try {
      const dir = join(w.root, 'notes');
      mkdirSync(dir);
      const token = 'ghp' + '_' + 'aB3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xYzA1b';
      writeFileSync(join(dir, 'note.md'), `token: ${token}\n`);
      const r = cli(w, ['secrets', dir, '--json'], opt);
      assert.equal(r.code, 1);
      assert.equal(r.json?.findings[0].kind, 'github-token');
      assert.ok(!r.out.includes(token), 'the token itself is never printed');
      writeFileSync(join(dir, 'note.md'), 'nothing here\n');
      assert.equal(cli(w, ['secrets', dir], opt).code, 0);
      assert.equal(cli(w, ['secrets'], opt).code, 2, 'no memory folder and no path: nothing to scan');
    } finally {
      w.done();
    }
  });

  test(`${mode}: quota, tokens, sessions and report read what is there and say when nothing is`, (t) => {
    if (skip(t)) return;
    const w = world();
    try {
      assert.equal(cli(w, ['quota'], opt).code, 1, 'no reading yet');
      mkdirSync(join(w.data, 'state'), { recursive: true });
      const now = Date.now();
      writeFileSync(
        join(w.data, 'state', 'quota.json'),
        JSON.stringify({ measuredAt: now, windows: [{ kind: 'five_hour', used: 42, resetsAt: now + 3600_000 }] }),
      );
      const q = cli(w, ['quota', '--json'], opt);
      assert.equal(q.code, 0);
      assert.equal(q.json?.reading.windows[0].used, 42);
      const proj = join(w.claudeDir, 'projects', 'C--work-app');
      mkdirSync(proj, { recursive: true });
      const ts = new Date(now - 60_000).toISOString();
      const rows = [
        { type: 'user', sessionId: 's1', cwd: 'C:/work/app', timestamp: ts, message: { role: 'user', content: 'fix the bug' } },
        {
          type: 'assistant',
          sessionId: 's1',
          timestamp: ts,
          message: {
            id: 'm1',
            role: 'assistant',
            model: 'claude-opus-5-5',
            usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300 },
            content: [],
          },
        },
      ];
      writeFileSync(join(proj, 's1.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
      const tok = cli(w, ['tokens', '--json'], opt);
      assert.equal(tok.json?.total.output, 20);
      assert.equal(cli(w, ['sessions', '--json'], opt).json?.sessions.length, 1);
      const rep = cli(w, ['report', '--json'], opt);
      assert.equal(rep.code, 0);
      assert.equal(rep.json?.schema, 'mode-code.report/1');
    } finally {
      w.done();
    }
  });

  test(`${mode}: flow lists the flows on record and shows one; an unknown id fails`, (t) => {
    if (skip(t)) return;
    const w = world({ lang: 'en' });
    try {
      assert.match(cli(w, ['flow'], opt).out, /No flows yet/);
      const now = Date.now();
      const flow = {
        v: 1,
        id: '20261012-0900-add-sign-in',
        variant: 'plan',
        task: 'Add sign-in',
        project: null,
        cwd: 'C:/work/app',
        createdAt: now - 60_000,
        updatedAt: now,
        status: 'waiting',
        current: 1,
        steps: [
          { kind: 'plan', status: 'done', startedAt: now - 60_000, doneAt: now, evidence: { kind: 'plan', steps: 2, commands: 1 } },
          { kind: 'approve', status: 'active', startedAt: now, doneAt: null, evidence: null },
          { kind: 'code', status: 'pending', startedAt: null, doneAt: null, evidence: null },
        ],
        sessionId: 's1',
        workDir: 'C:/tmp/w/20261012-0900-add-sign-in',
        reportPath: 'C:/tmp/w/20261012-0900-add-sign-in/research.md',
        planPath: 'C:/tmp/w/20261012-0900-add-sign-in/plan.md',
        approval: null,
        verification: [],
        history: [{ at: now, event: 'start', detail: 'plan' }],
      };
      mkdirSync(join(w.data, 'flows', flow.id), { recursive: true });
      writeFileSync(join(w.data, 'flows', flow.id, 'flow.json'), JSON.stringify(flow));
      const list = cli(w, ['flow'], opt);
      assert.equal(list.code, 0);
      assert.match(list.out, /waiting for approval/);
      assert.match(list.out, /2\/3 ⏸ approval/);
      assert.equal(cli(w, ['flow', '--json'], opt).json?.flows[0].id, flow.id);
      const show = cli(w, ['flow', 'show', '20261012'], opt);
      assert.equal(show.code, 0);
      assert.match(show.out, /2 steps, 1 verification command/);
      assert.equal(cli(w, ['flow', 'show', flow.id, '--json'], opt).json?.schema, 'mode-code.flow/1');
      assert.equal(cli(w, ['flow', 'show', 'nope'], opt).code, 1);
    } finally {
      w.done();
    }
  });

  test(`${mode}: autonomy: off by default; enable asks, is refused for an agent, and saves; runs are listed, shown, reported and rolled back`, (t) => {
    if (skip(t)) return;
    const w = world({ lang: 'en' });
    try {
      const empty = cli(w, ['autonomy'], opt);
      assert.equal(empty.code, 0);
      assert.match(empty.out, /Full autonomy is off/);
      assert.match(empty.out, /No run yet/);
      // Without a terminal and without --yes nothing changes; an agent's shell is refused even with --yes.
      const piped = cli(w, ['autonomy', 'enable'], opt);
      assert.equal(piped.code, 2);
      assert.match(piped.out, /Full autonomy: what turning it on means/);
      assert.match(piped.out, /No terminal to confirm in/);
      const agent = spawnSync(
        process.execPath,
        [...(opt.dist ? [bundleCli()] : ['--import', import.meta.resolve('tsx'), join(ROOT, 'src', 'cli', 'main.tsx')]), 'autonomy', 'enable', '--yes'],
        {
          cwd: w.root,
          env: { ...w.env, CLAUDECODE: '1', TSX_TSCONFIG_PATH: join(ROOT, 'tsconfig.json') },
          encoding: 'utf8',
        },
      );
      assert.equal(agent.status, 1);
      assert.equal(cli(w, ['config', 'set', 'autonomy.enabled', 'true'], opt).code, 0, 'the person in their own terminal');
      assert.equal(cli(w, ['autonomy', 'disable'], opt).code, 0);
      assert.equal(cli(w, ['autonomy', 'enable', '--yes'], opt).code, 0);
      assert.equal(cli(w, ['config', 'get', 'autonomy.enabled'], opt).out.trim(), 'true');
      const now = Date.now();
      const run = {
        v: 1,
        id: '20261013-1210-rate-limit',
        task: 'Add rate limiting to the API',
        project: null,
        cwd: 'C:/work/api',
        sessionId: 's1',
        createdAt: now - 3_600_000,
        updatedAt: now,
        aliveAt: now,
        status: 'paused',
        phase: 'work',
        pause: { reason: 'quota', at: now, detail: '' },
        budget: { weeklyTarget: 52, source: '+10' },
        start: { commit: 'a'.repeat(40), branch: 'main', ref: 'refs/mode-code/runs/20261013-1210-rate-limit/0' },
        workDir: 'C:/tmp/w/20261013-1210-rate-limit',
        planPath: 'C:/tmp/w/20261013-1210-rate-limit/plan.md',
        reportPath: 'C:/tmp/w/20261013-1210-rate-limit/report.md',
        notesPath: 'C:/tmp/w/20261013-1210-rate-limit/notes.md',
        plan: {
          steps: [
            { n: 1, title: 'Limiter', acceptance: 'tests' },
            { n: 2, title: 'Wire it in', acceptance: '429' },
          ],
          verification: ['npm test'],
          required: [],
          acceptedAt: now,
          revisions: 0,
        },
        milestones: [
          {
            n: 1,
            at: now,
            commit: 'b'.repeat(40),
            ref: 'r',
            commits: 2,
            review: { verdict: 'pass', findings: [], model: 'opus', at: now, signals: { deletedTests: 0, skipMarkers: 0 } },
            note: '',
          },
        ],
        deferred: [{ at: now, kind: 'push', tool: 'Bash', what: 'git push origin main', reason: 'pushes to the protected branch main', count: 2 }],
        blockers: [],
        finish: null,
        activeMs: 3_000_000,
        runningSince: null,
        history: [{ at: now, event: 'start' }],
      };
      mkdirSync(join(w.data, 'runs', run.id), { recursive: true });
      writeFileSync(join(w.data, 'runs', run.id, 'run.json'), JSON.stringify(run));
      writeFileSync(join(w.data, 'runs', run.id, 'report.md'), '# Rate limiting\n\n## What mode-code measured\n');
      const list = cli(w, ['autonomy'], opt);
      assert.match(list.out, /Full autonomy is on/);
      assert.match(list.out, /paused \(quota budget\)/);
      assert.match(list.out, /1\/2 work/);
      assert.equal(cli(w, ['autonomy', '--json'], opt).json?.runs[0].id, run.id);
      const show = cli(w, ['autonomy', 'show', '20261013'], opt);
      assert.equal(show.code, 0);
      assert.match(show.out, /✓  1\. Limiter  bbbbbbbbbbbb · PASS/);
      assert.match(show.out, /push git push origin main ×2/);
      assert.match(cli(w, ['autonomy', 'report', run.id], opt).out, /^# Rate limiting/);
      const back = cli(w, ['autonomy', 'rollback', run.id, '1'], opt);
      assert.match(back.out, /git switch -c back-20261013-1210-rate-limit-1 bbbbbbbbbbbb/);
      assert.match(back.out, /git reset --hard bbbbbbbbbbbb/);
      assert.equal(cli(w, ['autonomy', 'rollback', run.id, '2'], opt).code, 1, 'no milestone 2 yet');
      assert.equal(cli(w, ['autonomy', 'show', 'nope'], opt).code, 1);
      // The checks from here: this temporary folder is no git work tree, so a run would not start here.
      const check = cli(w, ['autonomy', 'check', '--json'], opt);
      assert.equal(check.json?.schema, 'mode-code.autonomy.check/1');
      assert.ok(check.json?.checks.some((c: any) => c.id === 'project' && c.ok === false));
      assert.ok(check.json?.checks.some((c: any) => c.id === 'budget' && c.ok === null));
      // The agent cannot widen what a session does unasked through the settings either.
      const set = spawnSync(
        process.execPath,
        [
          ...(opt.dist ? [bundleCli()] : ['--import', import.meta.resolve('tsx'), join(ROOT, 'src', 'cli', 'main.tsx')]),
          'config',
          'set',
          'autonomy.maxHours',
          '72',
        ],
        {
          cwd: w.root,
          env: { ...w.env, CLAUDECODE: '1', TSX_TSCONFIG_PATH: join(ROOT, 'tsconfig.json') },
          encoding: 'utf8',
        },
      );
      assert.equal(set.status, 1);
    } finally {
      w.done();
    }
  });

  test(`${mode}: templates: listed, previewed, applied into CLAUDE.md`, (t) => {
    if (skip(t)) return;
    const w = world();
    try {
      const list = cli(w, ['template', 'list', '--json'], opt);
      assert.ok(list.json?.templates.length >= 5);
      const id = 'measured'; // needs no git remote
      const dry = cli(w, ['template', 'apply', id, '--dry-run'], opt);
      assert.equal(dry.code, 0, dry.err);
      assert.equal(existsSync(join(w.root, 'CLAUDE.md')), false);
      assert.equal(cli(w, ['template', 'apply', 'no-such-template'], opt).code, 2);
    } finally {
      w.done();
    }
  });

  test(`${mode}: try --print shows the one-session command and starts nothing`, (t) => {
    if (skip(t)) return;
    const w = world();
    try {
      const r = cli(w, ['try', '--print'], opt);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /--plugin-dir/);
      assert.match(r.out, /--settings/);
      assert.deepEqual(w.claudeState().calls, [], 'claude itself was not run');
    } finally {
      w.done();
    }
  });

  test(`${mode}: doctor --self-check passes; --report names no user`, { timeout: 180_000 }, (t) => {
    if (skip(t)) return;
    const w = world();
    try {
      const r = cli(w, ['doctor', '--self-check', '--json'], opt);
      assert.equal(r.code, 0, r.out.slice(0, 2000) + r.err);
      assert.equal(r.json?.ok, true);
      const rep = cli(w, ['doctor', '--report', '--quick'], opt);
      assert.match(rep.out, /^## Problem report for Mode_Code/);
    } finally {
      w.done();
    }
  });
}
