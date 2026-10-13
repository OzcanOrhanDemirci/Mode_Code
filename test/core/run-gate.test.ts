// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  asksNobody,
  AT_FIRST_STEP,
  checkGate,
  GATE_CHECKS,
  gateOpen,
  interopOn,
  sandboxGaps,
  windowsMounts,
  wslVersion,
  type GateFacts,
} from '../../src/core/run-gate.js';
import { assessQuota, type QuotaReading } from '../../src/core/quota.js';
import { tIn } from '../../src/core/i18n/index.js';

const NOW = Date.parse('2026-10-13T09:00:00Z');
const fixture = (name: string) => readFileSync(join(import.meta.dirname, '..', 'fixtures', 'wsl', name), 'utf8');
/** Measured in a WSL2 distribution (Ubuntu 24.04, WSL 2.6.2), 2026-10-13: as installed, and after the setup in docs/autonomy.md. */
const MOUNTS_DEFAULT = fixture('mounts-default.txt');
const MOUNTS_ISOLATED = fixture('mounts-isolated.txt');
const INTEROP_ENABLED = fixture('interop-enabled.txt');
const OSRELEASE = '6.6.87.2-microsoft-standard-WSL2\n';

const reading = (week: number, five = 10): QuotaReading => ({
  windows: [
    { kind: 'five_hour', used: five, resetsAt: NOW + 3_600_000 },
    { kind: 'seven_day', used: week, resetsAt: NOW + 5 * 86_400_000 },
  ],
  measuredAt: NOW - 60_000,
  source: 'mod',
});
const budget = (target: number, week = 41) => ({
  explicit: true,
  target,
  quota: assessQuota(
    reading(week),
    {
      weeklyTarget: target,
      weeklyTargetSource: '+10',
      fiveHourWrapUp: 95,
      fiveHourStop: 99,
      defaultWeeklyTarget: 99,
      defaultWeeklyWrapUp: 97,
      staleMinutes: 360,
    },
    NOW,
  ),
});
const STRICT = { sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false } };

/** Every fact as it is in the distribution set up as docs/autonomy.md says, with a run about to start. */
const good = (): GateFacts => ({
  enabled: true,
  budget: budget(51),
  platform: 'linux',
  wsl: { osrelease: OSRELEASE, interop: null, mounts: MOUNTS_ISOLATED },
  settings: STRICT,
  probe: { ran: true, refused: true, detail: "touch: cannot touch '/home/ada/.terminal-code-sandbox-probe': Read-only file system" },
  permissionMode: 'bypassPermissions',
  permissionMeasured: true,
  hookRan: true,
  modes: true,
  git: { topLevel: '/home/ada/api', cwd: '/home/ada/api', tracked: 0, sameFolder: true },
  alone: { flow: false, ownRun: false, elsewhere: false, paused: null },
});
const failed = (f: GateFacts) =>
  checkGate(f)
    .checks.filter((c) => c.ok === false)
    .map((c) => `${c.id}:${c.key}`);

test('the distribution set up as the guide says passes every check, in the fixed order', () => {
  const g = checkGate(good());
  assert.equal(g.ok, true, JSON.stringify(g.checks.filter((c) => c.ok !== true)));
  assert.deepEqual(
    g.checks.map((c) => c.id),
    GATE_CHECKS,
  );
  assert.ok(g.checks.every((c) => c.ok === true));
});

test('WSL as installed: interop on and C: mounted; both are named, with the fix', () => {
  assert.deepEqual(windowsMounts(MOUNTS_DEFAULT), ['/mnt/c']);
  assert.deepEqual(windowsMounts(MOUNTS_ISOLATED), [], 'the driver share (9p, aname=drivers) is not a Windows drive');
  assert.equal(interopOn(INTEROP_ENABLED), true);
  assert.equal(interopOn(null), false, 'interop off: the binfmt entry does not exist');
  assert.equal(interopOn('disabled\ninterpreter /init\n'), false);
  assert.equal(interopOn(''), true, 'an entry that exists but reads empty counts as on');
  assert.deepEqual(failed({ ...good(), wsl: { osrelease: OSRELEASE, interop: INTEROP_ENABLED, mounts: MOUNTS_DEFAULT } }), ['wsl:auto.gate.wsl.both']);
  assert.deepEqual(failed({ ...good(), wsl: { osrelease: OSRELEASE, interop: INTEROP_ENABLED, mounts: MOUNTS_ISOLATED } }), ['wsl:auto.gate.wsl.interop']);
  assert.deepEqual(failed({ ...good(), wsl: { osrelease: OSRELEASE, interop: null, mounts: MOUNTS_DEFAULT } }), ['wsl:auto.gate.wsl.mounts']);
  const both = checkGate({ ...good(), wsl: { osrelease: OSRELEASE, interop: INTEROP_ENABLED, mounts: MOUNTS_DEFAULT } }).checks.find((c) => c.id === 'wsl')!;
  assert.match(tIn('en', both.key, both.params), /\/mnt\/c.*\[interop\] enabled=false.*\[automount\] enabled=false.*wsl --terminate/);
});

test('WSL versions and Windows drive mounts in every form WSL writes them', () => {
  assert.equal(wslVersion(OSRELEASE), 2);
  assert.equal(wslVersion('5.15.153.1-microsoft-standard-WSL2'), 2);
  assert.equal(wslVersion('4.4.0-19041-Microsoft'), 1);
  assert.equal(wslVersion('6.8.0-45-generic'), null);
  assert.equal(wslVersion(null), null);
  assert.deepEqual(windowsMounts('D:\\134 /mnt/d virtiofs rw,relatime 0 0\nC: /mnt/c drvfs rw 0 0\nnone /mnt/my\\040disk 9p rw,aname=drvfs;path=E:\\ 0 0\n'), [
    '/mnt/d',
    '/mnt/c',
    '/mnt/my disk',
  ]);
  assert.deepEqual(windowsMounts('tmpfs /tmp tmpfs rw 0 0\n/dev/sdd / ext4 rw 0 0\n'), []);
  assert.deepEqual(failed({ ...good(), wsl: { osrelease: '4.4.0-19041-Microsoft', interop: null, mounts: MOUNTS_ISOLATED } }), ['wsl:auto.gate.wsl.v1']);
  // What cannot be read fails: an empty mount table is an unread one.
  for (const wsl of [
    { osrelease: null, interop: null, mounts: MOUNTS_ISOLATED },
    { osrelease: OSRELEASE, interop: null, mounts: null },
    { osrelease: OSRELEASE, interop: null, mounts: '  \n' },
  ])
    assert.deepEqual(failed({ ...good(), wsl }), ['wsl:auto.gate.wsl.unreadable']);
  // Not WSL (plain Linux, macOS): the check does not apply.
  assert.equal(checkGate({ ...good(), wsl: null }).checks.find((c) => c.id === 'wsl')!.ok, null);
  assert.equal(checkGate({ ...good(), wsl: null }).ok, true);
});

test('native Windows is refused, with the way to WSL2; the sandbox checks do not apply there', () => {
  const g = checkGate({ ...good(), platform: 'win32', wsl: null, probe: null });
  assert.equal(g.ok, false);
  assert.deepEqual(failed({ ...good(), platform: 'win32', wsl: null, probe: null }), ['platform:auto.gate.platform.windows']);
  assert.deepEqual(
    g.checks.filter((c) => c.ok === null).map((c) => c.id),
    ['wsl', 'sandbox', 'probe'],
  );
});

test('the sandbox must be strict: every gap is named by its setting', () => {
  assert.deepEqual(sandboxGaps(STRICT), []);
  assert.deepEqual(sandboxGaps({}), ['sandbox.enabled', 'sandbox.failIfUnavailable', 'sandbox.allowUnsandboxedCommands']);
  assert.deepEqual(
    sandboxGaps({
      sandbox: {
        ...STRICT.sandbox,
        excludedCommands: ['docker compose *'],
        network: { allowAllUnixSockets: true, allowUnixSockets: ['/var/run/docker.sock'] },
        enableWeakerNestedSandbox: true,
      },
    }),
    ['sandbox.excludedCommands', 'sandbox.network.allowAllUnixSockets', 'sandbox.network.allowUnixSockets', 'sandbox.enableWeakerNestedSandbox'],
  );
  // Only true and false count: a string "true" is not on.
  assert.deepEqual(sandboxGaps({ sandbox: { enabled: 'true', failIfUnavailable: true, allowUnsandboxedCommands: 'false' } }), [
    'sandbox.enabled',
    'sandbox.allowUnsandboxedCommands',
  ]);
  assert.deepEqual(failed({ ...good(), settings: { sandbox: { enabled: true } } }), ['sandbox:auto.gate.sandbox.gaps']);
  assert.deepEqual(failed({ ...good(), settings: null }), ['sandbox:auto.gate.sandbox.unreadable']);
});

test('the live probe: unmeasured is not passed; a write that went through fails; a probe that could not run fails', () => {
  const unmeasured = checkGate({ ...good(), probe: null });
  assert.equal(unmeasured.checks.find((c) => c.id === 'probe')!.ok, null);
  assert.equal(unmeasured.ok, false, 'a run never starts without the probe');
  assert.deepEqual(failed({ ...good(), probe: { ran: true, refused: false, detail: '' } }), ['probe:auto.gate.probe.wrote']);
  assert.deepEqual(failed({ ...good(), probe: { ran: false, refused: false, detail: 'denied by the belt' } }), ['probe:auto.gate.probe.didNotRun']);
});

test('permission modes: only those in which nothing waits for an answer', () => {
  for (const m of ['bypassPermissions', 'dontAsk', 'auto']) assert.equal(asksNobody(m, null), true, m);
  for (const m of ['default', 'plan', 'acceptEdits', null, 'something-new']) assert.equal(asksNobody(m, STRICT), false, String(m));
  assert.equal(asksNobody('acceptEdits', { sandbox: { network: { strictAllowlist: true } } }), true);
  assert.deepEqual(failed({ ...good(), permissionMode: 'acceptEdits' }), ['permission:auto.gate.permission.network']);
  assert.deepEqual(failed({ ...good(), permissionMode: 'default' }), ['permission:auto.gate.permission.asks']);
  assert.deepEqual(failed({ ...good(), permissionMode: null }), ['permission:auto.gate.permission.unknown']);
});

test('at the prompt the permission mode is not measurable yet: nothing fails for it, but nothing starts on it', () => {
  // Claude Code runs the plugin's prompt hook before the safety-net hook: the mode on record is an earlier prompt's.
  for (const permissionMode of ['bypassPermissions', 'default', null]) {
    const atPrompt = checkGate({ ...good(), probe: null, permissionMode, permissionMeasured: false });
    const check = atPrompt.checks.find((c) => c.id === 'permission')!;
    assert.deepEqual([check.ok, check.key], [null, 'auto.gate.permission.atStart'], String(permissionMode));
    assert.equal(gateOpen(atPrompt), true, 'the run may go on to its first step');
    assert.equal(atPrompt.ok, false, 'and starts only there');
  }
  // Measured as passing but with the probe still unmeasured, or the other way round: no start either.
  assert.equal(checkGate({ ...good(), probe: null }).ok, false);
  assert.equal(checkGate({ ...good(), permissionMeasured: false }).ok, false);
  assert.deepEqual(AT_FIRST_STEP, ['probe', 'permission']);
  // A failure measured at the prompt closes the way at once.
  assert.equal(gateOpen(checkGate({ ...good(), probe: null, permissionMeasured: false, enabled: false })), false);
});

test('budget: explicit, measured, fresh and not reached', () => {
  assert.deepEqual(failed({ ...good(), budget: { explicit: false, target: null, quota: budget(51).quota } }), ['budget:auto.gate.budget.missing']);
  assert.deepEqual(failed({ ...good(), budget: budget(41, 41) }), ['budget:auto.gate.budget.reached']);
  const none = assessQuota(
    null,
    { weeklyTarget: 51, weeklyTargetSource: '+10', fiveHourWrapUp: 95, fiveHourStop: 99, defaultWeeklyTarget: 99, defaultWeeklyWrapUp: 97, staleMinutes: 360 },
    NOW,
  );
  assert.deepEqual(failed({ ...good(), budget: { explicit: true, target: 51, quota: none } }), ['budget:auto.gate.budget.noReading']);
  const old = assessQuota(
    { ...reading(41), measuredAt: NOW - 7 * 3_600_000 },
    { weeklyTarget: 51, weeklyTargetSource: '+10', fiveHourWrapUp: 95, fiveHourStop: 99, defaultWeeklyTarget: 99, defaultWeeklyWrapUp: 97, staleMinutes: 360 },
    NOW,
  );
  assert.deepEqual(failed({ ...good(), budget: { explicit: true, target: 51, quota: old } }), ['budget:auto.gate.budget.stale']);
  const five = {
    ...budget(51),
    quota: assessQuota(
      reading(41, 96),
      {
        weeklyTarget: 51,
        weeklyTargetSource: '+10',
        fiveHourWrapUp: 95,
        fiveHourStop: 99,
        defaultWeeklyTarget: 99,
        defaultWeeklyWrapUp: 97,
        staleMinutes: 360,
      },
      NOW,
    ),
  };
  assert.deepEqual(failed({ ...good(), budget: five }), ['budget:auto.gate.budget.reached'], 'the 5-hour window at its wrap-up line counts too');
});

test('the project, the safety net, modes and being alone', () => {
  assert.deepEqual(failed({ ...good(), git: { topLevel: null, cwd: '/home/ada', tracked: 0, sameFolder: false } }), ['project:auto.gate.project.noGit']);
  assert.deepEqual(failed({ ...good(), git: { topLevel: '/home/ada/api', cwd: '/home/ada/api/src', tracked: 0, sameFolder: false } }), [
    'project:auto.gate.project.notTop',
  ]);
  assert.deepEqual(failed({ ...good(), git: { ...good().git, tracked: 3 } }), ['project:auto.gate.project.dirty']);
  assert.deepEqual(failed({ ...good(), hookRan: false }), ['hook:auto.gate.hook.missing']);
  assert.deepEqual(failed({ ...good(), modes: false }), ['modes:auto.gate.modes.off']);
  assert.deepEqual(failed({ ...good(), enabled: false }), ['enabled:auto.gate.enabled.off']);
  assert.deepEqual(failed({ ...good(), alone: { flow: true, ownRun: false, elsewhere: false, paused: null } }), ['alone:auto.gate.alone.flow']);
  assert.deepEqual(failed({ ...good(), alone: { flow: false, ownRun: true, elsewhere: false, paused: null } }), ['alone:auto.gate.alone.run']);
  assert.deepEqual(failed({ ...good(), alone: { flow: false, ownRun: false, elsewhere: true, paused: null } }), ['alone:auto.gate.alone.elsewhere']);
  const paused = checkGate({
    ...good(),
    alone: { flow: false, ownRun: false, elsewhere: false, paused: { id: 'r1', cont: 'devam', cancel: 'tam otonom iptal' } },
  }).checks.find((c) => c.id === 'alone')!;
  assert.equal(
    tIn('tr', paused.key, paused.params),
    'Bu klasörde duraklatılmış bir koşu bekliyor (r1): "devam" ile sürdür ya da "tam otonom iptal" ile bitir.',
  );
});

test('every check reads in both languages with its parameters filled', () => {
  const variants: GateFacts[] = [
    good(),
    { ...good(), platform: 'win32', wsl: null, probe: null, enabled: false, hookRan: false },
    {
      ...good(),
      wsl: { osrelease: OSRELEASE, interop: INTEROP_ENABLED, mounts: MOUNTS_DEFAULT },
      settings: {},
      permissionMode: 'default',
      git: { topLevel: null, cwd: '/x', tracked: 0, sameFolder: false },
    },
  ];
  for (const f of variants)
    for (const c of checkGate(f).checks)
      for (const lang of ['en', 'tr'] as const) {
        const text = tIn(lang, c.key, c.params);
        assert.doesNotMatch(text, /\{\w+\}/, `${lang} ${c.key}`);
        assert.ok(tIn(lang, `auto.gate.name.${c.id}`).length > 2);
      }
});

test('the edges of the checks: a target without a budget word, a budget measured against another target, a drive over 9p', () => {
  assert.deepEqual(failed({ ...good(), budget: { ...budget(51), explicit: false } }), ['budget:auto.gate.budget.missing']);
  // The reading at the target counts as reached, even when the assessment was made against another target.
  const other = assessQuota(
    reading(51),
    { weeklyTarget: null, fiveHourWrapUp: 95, fiveHourStop: 99, defaultWeeklyTarget: 99, defaultWeeklyWrapUp: 97, staleMinutes: 360 },
    NOW,
  );
  assert.equal(other.level, 'ok');
  assert.deepEqual(failed({ ...good(), budget: { explicit: true, target: 51, quota: other } }), ['budget:auto.gate.budget.reached']);
  assert.deepEqual(failed({ ...good(), budget: { explicit: true, target: 52, quota: other } }), []);
  // A Windows drive mounted over 9p without the drvfs name is still a Windows drive.
  assert.deepEqual(windowsMounts('C:\\134 /mnt/c 9p rw,noatime,cache=5 0 0\n'), ['/mnt/c']);
  assert.deepEqual(windowsMounts('incomplete line\n\n'), []);
});
