// SPDX-License-Identifier: Apache-2.0
/**
 * The doctor's checks on made-up facts: a healthy machine passes every check with no warning (the doctor
 * must not cry wolf either), and each check reacts to exactly the fact it is about, with the repair or the
 * hint the person needs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKS, runChecks, tally, MIN_NODE } from '../../src/app/doctor/checks.js';
import { en } from '../../src/core/i18n/en.js';
import { tr } from '../../src/core/i18n/tr.js';
import { APP_VERSION, MIN_CLAUDE_CODE_FOR_HOOKS, MIN_CLAUDE_CODE_FOR_MODS, PLUGIN_ID } from '../../src/core/app.js';
import { HOOK_EVENTS } from '../../src/node/install.js';
import { compareVersions } from '../../src/core/version.js';
import type { CheckResult, Facts } from '../../src/app/doctor/types.js';
import { healthyFacts, ourHook, settingsFile } from '../helpers/facts.js';

function check(id: string, f: Facts): CheckResult {
  const r = runChecks(f).find((x) => x.id === id);
  assert.ok(r, `no check ${id}`);
  return r;
}

const brief = (r: CheckResult) => `${r.status} ${r.summary.key}${r.repair ? ` → ${r.repair}` : ''}`;

test('a healthy machine: every check passes, none warns, none fails', () => {
  const results = runChecks(healthyFacts());
  const loud = results.filter((r) => r.status === 'warn' || r.status === 'fail');
  assert.deepEqual(loud.map(brief), []);
  assert.equal(results.length, CHECKS.length);
  const t = tally(results);
  assert.equal(t.fail + t.warn, 0);
  assert.ok(t.ok >= 28, `only ${t.ok} checks passed`);
});

test('every check id is unique, and every message and hint exists in both languages', () => {
  const variants: Facts[] = [
    healthyFacts(),
    healthyFacts({ manifest: null }),
    healthyFacts({
      claude: { installs: [], version: null },
      platform: 'linux',
      gitBash: null,
      powershell: null,
      posixShell: { shell: '/bin/zsh', version: null },
    }),
  ];
  for (const f of variants) {
    const results = runChecks(f);
    assert.equal(new Set(results.map((r) => r.id)).size, results.length);
    for (const r of results)
      for (const m of [r.summary, r.hint, ...(r.details ?? [])].filter((x) => x !== undefined)) {
        assert.ok(m.key in en, `${r.id}: ${m.key} missing in English`);
        assert.ok(m.key in tr, `${r.id}: ${m.key} missing in Turkish`);
      }
  }
});

test('an installation under an earlier name: running beside this one warns and says how to move it; its data alone is a note', () => {
  const prev = { id: 'old-name', name: 'Old Name', root: 'C:/Users/ada/.old-name', installed: false, hooks: 0, plugin: false };
  const quiet = [
    [healthyFacts(), 'skip doc.install.previous.never'],
    [healthyFacts({ previousNames: ['Old Name'] }), 'ok doc.install.previous.none'],
    [healthyFacts({ previous: prev, previousNames: ['Old Name'] }), 'info doc.install.previous.left'],
  ] as const;
  for (const [f, want] of quiet) {
    const r = check('install.previous', f);
    assert.equal(brief(r), want);
    assert.equal(r.protection, false, want);
  }
  assert.deepEqual(check('install.previous', quiet[1][0]).summary.params, { names: 'Old Name' });
  for (const p of [{ installed: true }, { hooks: 2 }, { plugin: true }]) {
    const r = check('install.previous', healthyFacts({ previous: { ...prev, ...p } }));
    assert.equal(brief(r), 'warn doc.install.previous.found', JSON.stringify(p));
    assert.equal(r.hint?.key, 'doc.install.previous.hint');
    assert.equal(r.protection, false);
  }
});

test('a check that throws is reported as a failure, not skipped', () => {
  const broken = healthyFacts({ settings: null as never });
  const results = runChecks(broken);
  const crashed = results.find((r) => r.summary.key === 'doc.checkCrashed');
  assert.equal(crashed?.status, 'fail');
  assert.equal(crashed?.protection, false, 'a crash is not counted as a weakened protection');
});

test('the tally counts protection failures apart: only failures, only of protections', () => {
  const r = (status: 'ok' | 'fail' | 'warn', protection: boolean) => ({
    id: 'x',
    group: 'node' as const,
    status,
    protection,
    summary: { key: 'doc.line' as const },
  });
  assert.deepEqual(tally([r('fail', true), r('fail', false), r('warn', true), r('ok', true)]), {
    ok: 1,
    info: 0,
    warn: 1,
    fail: 2,
    skip: 0,
    protectionFail: 1,
  });
});

test('version boundaries: exactly the minimum is enough, for this Node.js and for the hooks', () => {
  assert.equal(check('node.hooks', healthyFacts({ hookNode: { path: 'x', exists: true, version: MIN_NODE } })).status, 'ok');
  const repointable = check(
    'node.hooks',
    healthyFacts({ node: { version: MIN_NODE, execPath: 'x', sqlite: true }, hookNode: { path: 'x', exists: false, version: null } }),
  );
  assert.equal(repointable.repair, 'repoint-node', 'a Node.js at exactly the minimum can take over the hooks');
});

test('the plugin list could not be read and nothing turned it off: a note, not a protection problem', () => {
  const r = check('claude.plugin', healthyFacts({ plugins: null }));
  assert.deepEqual([r.status, r.protection, r.repair], ['info', false, undefined]);
});

test('Git Bash not measured on Windows is skipped as a protection check; data folder states carry the protection flag', () => {
  const g = check('shell.gitBash', healthyFacts({ gitBash: null }));
  assert.deepEqual([g.status, g.protection], ['skip', true]);
  const d = healthyFacts().data;
  const missing = check('files.data', healthyFacts({ data: { ...d, exists: false } }));
  assert.deepEqual([missing.status, missing.protection], ['fail', true]);
  const absent = check('files.data', healthyFacts({ manifest: null, data: { ...d, exists: false } }));
  assert.deepEqual([absent.status, absent.protection], ['skip', false]);
  const readOnly = check('files.data', healthyFacts({ data: { ...d, writable: false } }));
  assert.deepEqual([readOnly.status, readOnly.protection], ['fail', true]);
  assert.equal(check('files.space', healthyFacts({ data: { ...d, freeBytes: 500 * 1048576 } })).status, 'ok', 'exactly 500 MB is enough');
});

test('transcripts with a shape but no file are reported as none', () => {
  const shape = healthyFacts().transcripts.shape!;
  assert.equal(check('data.transcripts', healthyFacts({ transcripts: { files: 0, shape, badSessionIds: [] } })).summary.key, 'doc.data.transcripts.none');
});

test('a self-test failure is a protection failure when any failing suite guards something, whatever else passed', () => {
  const s = (suite: string, failed: number) => ({ suite, passed: 2, failed, failures: failed ? [{ name: 'n', expected: 'a', actual: 'b' }] : [], ms: 1 });
  for (const guarding of ['belt', 'paths', 'shell']) {
    const r = check('selftest.suites', healthyFacts({ selftest: [s('text', 0), s(guarding, 1)] }));
    assert.deepEqual([r.status, r.protection], ['fail', true], guarding);
  }
  const plain = check('selftest.suites', healthyFacts({ selftest: [s('belt', 0), s('footer', 1)] }));
  assert.deepEqual([plain.status, plain.protection], ['warn', false]);
});

test('Node.js: too old to run, the hooks node gone, too old or not starting', () => {
  assert.equal(brief(check('node.version', healthyFacts({ node: { version: '20.11.0', execPath: 'x', sqlite: false } }))), 'fail doc.node.version.old');
  assert.equal(check('node.version', healthyFacts({ node: { version: MIN_NODE, execPath: 'x', sqlite: true } })).status, 'ok');
  assert.equal(
    brief(check('node.hooks', healthyFacts({ hookNode: { path: 'C:/gone/node.exe', exists: false, version: null } }))),
    'fail doc.node.hooks.gone → repoint-node',
  );
  assert.equal(
    brief(check('node.hooks', healthyFacts({ hookNode: { path: 'C:/x/node.exe', exists: true, version: null } }))),
    'fail doc.node.hooks.wontRun → repoint-node',
  );
  assert.equal(
    brief(check('node.hooks', healthyFacts({ hookNode: { path: 'C:/x/node.exe', exists: true, version: '20.0.0' } }))),
    'fail doc.node.hooks.old → repoint-node',
  );
  // Repointing needs a good Node.js here; without one the person is told to install it.
  const both = check(
    'node.hooks',
    healthyFacts({ node: { version: '20.0.0', execPath: 'x', sqlite: true }, hookNode: { path: 'C:/gone', exists: false, version: null } }),
  );
  assert.equal(both.repair, undefined);
  assert.equal(both.hint?.key, 'doc.node.version.hint');
  assert.equal(check('node.hooks', healthyFacts({ manifest: null })).status, 'skip');
  assert.equal(brief(check('node.sqlite', healthyFacts({ node: { version: '24.0.0', execPath: 'x', sqlite: false } }))), 'fail doc.node.sqlite.missing');
});

test('Claude Code: missing, too old for the hooks, too old for the plugin, several installs', () => {
  assert.equal(brief(check('claude.version', healthyFacts({ claude: { installs: [], version: null } }))), 'fail doc.claude.missing');
  assert.equal(brief(check('claude.version', healthyFacts({ claude: { installs: ['x'], version: '2.0.0' } }))), 'fail doc.claude.old');
  // Below the hooks' minimum is a failure even where the plugin would load: protection comes first. The
  // "plugin needs newer" warning only exists while the plugin's minimum is the higher one.
  const mods: string = MIN_CLAUDE_CODE_FOR_MODS;
  const hooks: string = MIN_CLAUDE_CODE_FOR_HOOKS;
  const at = (version: string) => check('claude.version', healthyFacts({ claude: { installs: ['x'], version } })).status;
  if (compareVersions(mods, hooks) > 0) assert.equal(at(hooks), 'warn');
  else assert.equal(at(mods), compareVersions(mods, hooks) < 0 ? 'fail' : 'ok');
  assert.equal(at(hooks), compareVersions(mods, hooks) > 0 ? 'warn' : 'ok');
  const many = check('claude.installs', healthyFacts({ claude: { installs: ['C:/a/claude.exe', 'C:/b/claude.cmd'], version: '2.1.296' } }));
  assert.equal(brief(many), 'warn doc.claude.installs.many');
  assert.equal(many.details?.length, 2);
  assert.equal(check('claude.installs', healthyFacts({ claude: { installs: [], version: '2.1.296' } })).status, 'info');
});

test('Claude Code settings: a broken user file fails with the backup named; a broken project file warns', () => {
  const user = check('claude.settings', healthyFacts({ settings: [settingsFile({ error: 'Unexpected token (line 3, column 1)' })] }));
  assert.equal(brief(user), 'fail doc.claude.settings.bad');
  assert.equal(user.hint?.key, 'doc.claude.settings.hintBackup');
  assert.equal(user.repair, undefined, 'a file Claude Code cannot read is never rewritten');
  const project = check(
    'claude.settings',
    healthyFacts({ settings: [settingsFile(), settingsFile({ scope: 'project', path: 'C:/dev/app/.claude/settings.json', error: 'x' })] }),
  );
  assert.equal(project.status, 'warn');
  assert.equal(
    check('claude.settings', healthyFacts({ manifest: { ...healthyFacts().manifest!, settingsBackup: null }, settings: [settingsFile({ error: 'x' })] })).hint
      ?.key,
    'doc.claude.settings.hint',
  );
  // The branches for settings files that switch the hooks off are not covered by an agent-written test: the
  // safety belt (rightly) refuses to let an agent write such a fixture. See docs/testing.md, "Not covered".
  assert.equal(check('claude.hooksOn', healthyFacts()).status, 'ok');
});

test('the plugin: missing, off, off for this folder only, another version, not listable', () => {
  assert.equal(brief(check('claude.plugin', healthyFacts({ plugins: [] }))), `warn doc.claude.plugin.missing → reinstall-plugin`);
  assert.equal(
    brief(check('claude.plugin', healthyFacts({ plugins: [{ id: PLUGIN_ID, enabled: false, version: APP_VERSION, scope: 'user' }] }))),
    'warn doc.claude.plugin.disabled → enable-plugin',
  );
  assert.equal(check('claude.plugin', healthyFacts({ settings: [settingsFile(), settingsFile({ scope: 'project', pluginEnabled: false })] })).status, 'info');
  assert.equal(check('claude.plugin', healthyFacts({ plugins: null })).status, 'info');
  assert.equal(check('claude.plugin', healthyFacts({ manifest: null })).status, 'skip');
  const other = check('claude.plugin', healthyFacts({ plugins: [{ id: PLUGIN_ID, enabled: true, version: '0.0.1', scope: 'user' }] }));
  assert.equal(other.status, APP_VERSION === 'dev' ? 'ok' : 'warn');
  // What loads counts: read in place from its folder, the plugin loads the folder's version whatever was
  // recorded (an install over 1.0.0 left "1.0.0" recorded while 1.1.0 ran, measured 2026-10-15).
  const at = (p: { version: string | null; loads?: string | null }) =>
    check('claude.plugin', healthyFacts({ appVersion: '0.2.0', plugins: [{ id: PLUGIN_ID, enabled: true, scope: 'user', ...p }] }));
  assert.deepEqual(
    [brief(at({ version: '0.1.0', loads: '0.2.0' })), at({ version: '0.1.0', loads: '0.2.0' }).summary.params?.v],
    ['ok doc.claude.plugin.ok', '0.2.0'],
  );
  assert.equal(brief(at({ version: '0.2.0', loads: '0.1.0' })), 'warn doc.claude.plugin.otherVersion → update-plugin');
  assert.deepEqual(at({ version: '0.2.0', loads: '0.1.0' }).summary.params, { have: '0.1.0', now: '0.2.0' });
  assert.equal(brief(at({ version: '0.1.0' })), 'warn doc.claude.plugin.otherVersion → update-plugin', 'no folder reported: the record is what loads');
  assert.equal(brief(at({ version: '0.1.0', loads: null })), 'warn doc.claude.plugin.otherVersion → update-plugin');
  assert.equal(brief(at({ version: null, loads: null })), 'ok doc.claude.plugin.ok');
});

test('installation: the hook program missing, outdated, altered; hooks missing, weakened, doubled', () => {
  const m = healthyFacts().manifest!;
  assert.equal(check('install.manifest', healthyFacts({ manifest: null })).status, 'info');
  assert.equal(check('install.manifest', healthyFacts({ manifest: { ...m, dataDir: 'D:/elsewhere' } })).status, 'warn');
  const hp = healthyFacts().hookProgram;
  assert.equal(
    brief(check('install.hookProgram', healthyFacts({ hookProgram: { ...hp, exists: false, hash: null } }))),
    'fail doc.install.hook.missing → restore-hook-program',
  );
  assert.equal(check('install.hookProgram', healthyFacts({ hookProgram: { ...hp, shippedHash: null } })).status, 'info');
  const differs = check('install.hookProgram', healthyFacts({ hookProgram: { ...hp, hash: 'b'.repeat(64) } }));
  assert.equal(differs.repair, 'restore-hook-program');
  assert.ok(differs.status === 'fail' || differs.status === 'warn');

  const without = (ev: string) => healthyFacts().hooks.filter((h) => h.event !== ev);
  const missing = check('install.hooks', healthyFacts({ hooks: without('PreToolUse') }));
  assert.equal(brief(missing), 'fail doc.install.hooks.missing → restore-hooks');
  assert.equal(missing.summary.params?.events, 'PreToolUse');
  const weak = HOOK_EVENTS.map((e) => (e === 'PreToolUse' ? ourHook(e, { onFailure: null }) : ourHook(e)));
  assert.equal(brief(check('install.hooks', healthyFacts({ hooks: weak }))), 'fail doc.install.hooks.changed → restore-hooks');
  const narrow = HOOK_EVENTS.map((e) => (e === 'PreToolUse' ? ourHook(e, { matcher: 'Bash' }) : ourHook(e)));
  assert.equal(check('install.hooks', healthyFacts({ hooks: narrow })).status, 'fail');
  const doubled = [...healthyFacts().hooks, ourHook('Stop')];
  assert.equal(brief(check('install.hooks', healthyFacts({ hooks: doubled }))), 'warn doc.install.hooks.duplicates → remove-duplicate-hooks');
  const moved = check('install.hooks', healthyFacts({ claudeDir: 'D:/claude', hooks: [] }));
  assert.equal(moved.status, 'fail');
  assert.equal(moved.details?.[0]?.key, 'doc.install.hooks.movedConfig');
  // Somebody else's hooks never count as ours.
  assert.equal(
    check(
      'install.hooks',
      healthyFacts({ hooks: [...healthyFacts().hooks, ourHook('PreToolUse', { ours: false, command: 'node', args: ['C:/mine/guard.js'] })] }),
    ).status,
    'ok',
  );
});

test('installation: plugin files and the plugin seen in a session', () => {
  const pf = healthyFacts().pluginFiles;
  assert.equal(
    brief(check('install.pluginFiles', healthyFacts({ pluginFiles: { ...pf, different: ['hooks/register.js'] } }))),
    'warn doc.install.pluginFiles.bad → restore-plugin-files',
  );
  assert.equal(check('install.pluginFiles', healthyFacts({ pluginFiles: { ...pf, shipped: false } })).status, 'info');
  // The program /0 opens: recorded and there, never recorded (an installation before it was), or gone.
  const cc = healthyFacts().controlCenter;
  assert.equal(brief(check('install.controlCenter', healthyFacts())), 'ok doc.install.cli.ok');
  assert.equal(
    brief(check('install.controlCenter', healthyFacts({ controlCenter: { ...cc, recorded: null, exists: false } }))),
    'warn doc.install.cli.none → record-cli',
  );
  const gone = check('install.controlCenter', healthyFacts({ controlCenter: { ...cc, exists: false } }));
  assert.equal(brief(gone), 'warn doc.install.cli.gone → record-cli');
  assert.equal(gone.summary.params?.path, cc.recorded);
  const noBuild = check('install.controlCenter', healthyFacts({ controlCenter: { recorded: null, exists: false, shipped: null } }));
  assert.equal(noBuild.status, 'info');
  // Not a protection: without it /0 says the menu instead, and nothing guarded is weaker.
  for (const r of [noBuild, gone, check('install.controlCenter', healthyFacts({ controlCenter: { ...cc, recorded: null, exists: false } }))])
    assert.equal(r.protection, false, r.summary.key);
  assert.equal(check('install.controlCenter', healthyFacts({ manifest: null })).status, 'skip');
  assert.equal(check('install.modSeen', healthyFacts({ modSeen: null })).status, 'info');
  assert.equal(
    check('install.modSeen', healthyFacts({ modSeen: { at: 1, version: 'other' } })).summary.key,
    APP_VERSION === 'other' ? 'doc.install.modSeen.ok' : 'doc.install.modSeen.other',
  );
});

test('protection: the installed hook disagreeing, links, short names, memory folders', () => {
  const a = check(
    'protect.agreement',
    healthyFacts({ hookAgreement: { samples: 30, agreed: 29, differences: [{ call: 'Write C:/x', mine: 'deny', theirs: 'allow' }], error: null } }),
  );
  assert.equal(brief(a), 'fail doc.protect.agreement.differ → restore-hook-program');
  assert.equal(a.details?.[0]?.params?.mine, '@verdict.deny');
  assert.equal(check('protect.agreement', healthyFacts({ hookAgreement: null })).status, 'skip');
  assert.equal(check('protect.agreement', healthyFacts({ hookAgreement: { samples: 0, agreed: 0, differences: [], error: 'spawn failed' } })).status, 'warn');
  assert.equal(check('protect.links', healthyFacts({ aliases: [{ real: 'D:/dot/claude', spelled: 'C:/Users/ada/.claude' }] })).status, 'info');
  assert.equal(
    brief(check('protect.shortNames', healthyFacts({ shortNames: [{ long: 'a', short: 'b', recognised: false }] }))),
    'fail doc.protect.shortNames.missed',
  );
  assert.equal(check('protect.shortNames', healthyFacts({ shortNames: [] })).status, 'ok');
  assert.equal(check('protect.shortNames', healthyFacts({ platform: 'darwin' })).status, 'skip');
  assert.equal(check('protect.memory', healthyFacts({ memoryDirs: [] })).status, 'info');
  assert.equal(check('protect.memory', healthyFacts({ memoryDirs: [{ path: 'C:/m', exists: false, isRepo: false }] })).status, 'warn');
  assert.equal(check('protect.memory', healthyFacts({ memoryDirs: [{ path: 'C:/m', exists: true, isRepo: false }] })).status, 'info');
});

test('the memory store: not set up, missing, not used by Claude Code, without git or origin, a conflict, a refused sign-in, a file held back', () => {
  const store = healthyFacts().memoryStore!;
  const last = (over: object) => ({
    at: 1,
    trigger: 'turn' as const,
    session: null,
    result: {
      repo: true,
      commit: 'ok' as const,
      committed: 1,
      held: [],
      pull: 'ok' as const,
      push: 'ok' as const,
      conflicts: [],
      ahead: 0,
      behind: 0,
      detail: '',
      ...over,
    },
  });
  const at = (over: object | null, setting: string | null = 'C:/dev/notes/memory') => {
    const r = check('data.memoryStore', healthyFacts({ memoryStore: over && { ...store, ...over }, memorySetting: setting }));
    assert.equal(r.protection, false, 'the memory store is not one of the protections');
    return brief(r);
  };
  assert.equal(at({}), 'ok doc.memory.ok');
  assert.equal(at(null, null), 'info doc.memory.none');
  // A memory Claude Code keeps somewhere mode-code did not set up is said as it is (not "one per project").
  assert.equal(at(null), 'info doc.memory.outside');
  assert.equal(check('data.memoryStore', healthyFacts({ memoryStore: null })).hint?.key, 'doc.memory.adoptHint');
  assert.equal(at({ exists: false }), 'fail doc.memory.missing');
  assert.equal(at({ inUse: false, setting: 'C:/elsewhere' }), 'warn doc.memory.elsewhere');
  assert.equal(at({ inUse: false, setting: null }), 'warn doc.memory.perProject');
  assert.equal(at({ isRepo: false }), 'warn doc.memory.noGit');
  assert.equal(at({ isRepo: false, git: false, remote: null }), 'ok doc.memory.ok', 'a local folder kept without git is fine');
  assert.equal(at({ hasOrigin: false }), 'warn doc.memory.noOrigin');
  assert.equal(at({ last: last({ pull: 'conflict', conflicts: ['MEMORY.md'] }) }), 'warn doc.memory.conflict');
  assert.equal(at({ last: last({ pull: 'diverged' }) }), 'warn doc.memory.diverged');
  // Each problem says when that sync was: one from before an update may be fixed already (2026-10-13).
  const when = (over: object) =>
    check('data.memoryStore', healthyFacts({ memoryStore: { ...store, last: { ...last(over), at: 5 } } as never, memorySetting: 'C:/dev/notes/memory' }))
      .summary.params?.when;
  for (const over of [{ pull: 'diverged' }, { pull: 'conflict', conflicts: ['a'] }, { push: 'auth' }, { held: [{ path: 'k.md', reason: 'secret' }] }])
    assert.equal(when(over), '@at:5', JSON.stringify(over));
  assert.equal(at({ last: last({ push: 'auth', detail: 'denied' }) }), 'warn doc.memory.auth');
  assert.equal(at({ last: last({ pull: 'auth' }) }), 'warn doc.memory.auth');
  assert.equal(at({ last: last({ held: [{ path: 'k.md', reason: 'secret' }] }) }), 'info doc.memory.held');
  assert.equal(at({ last: last({ push: 'offline' }) }), 'ok doc.memory.ok', 'offline is tried again, not a problem');
});

test('shells: Git Bash missing or mapping /tmp elsewhere than the belt assumes; PowerShell; the terminal', () => {
  const gb = healthyFacts().gitBash!;
  assert.equal(check('shell.gitBash', healthyFacts({ gitBash: { ...gb, path: null, tmp: null } })).status, 'warn');
  assert.equal(check('shell.gitBash', healthyFacts({ gitBash: { ...gb, tmp: null, error: 'timeout' } })).status, 'warn');
  const differs = check('shell.gitBash', healthyFacts({ gitBash: { ...gb, tmp: 'C:/msys64/tmp' } }));
  assert.equal(brief(differs), 'fail doc.shell.gitBash.tmpDiffers');
  assert.equal(differs.protection, true);
  assert.equal(check('shell.gitBash', healthyFacts({ gitBash: { ...gb, tmp: 'c:/users/ADA/appdata/local/temp' } })).status, 'ok');
  assert.equal(check('shell.gitBash', healthyFacts({ platform: 'linux' })).status, 'skip');
  assert.equal(check('shell.powershell', healthyFacts({ powershell: { pwsh: null, windowsPowerShell: true } })).summary.key, 'doc.shell.pwsh.only51');
  assert.equal(check('shell.powershell', healthyFacts({ powershell: { pwsh: null, windowsPowerShell: false } })).summary.key, 'doc.shell.pwsh.none');
  const t = healthyFacts().terminal;
  assert.equal(check('shell.terminal', healthyFacts({ terminal: { ...t, columns: 50 } })).status, 'warn');
  assert.equal(check('shell.terminal', healthyFacts({ terminal: { ...t, tty: false, columns: 50 } })).status, 'info');
  assert.equal(
    check('shell.posix', healthyFacts({ platform: 'darwin', posixShell: { shell: '/bin/zsh', version: 'zsh 5.9' } })).summary.params?.shell,
    '/bin/zsh',
  );
});

test('files: data folder, space, letter case, leftovers, permissions', () => {
  const d = healthyFacts().data;
  assert.equal(brief(check('files.data', healthyFacts({ data: { ...d, exists: false } }))), 'fail doc.files.data.missing → create-data-folders');
  assert.equal(check('files.data', healthyFacts({ manifest: null, data: { ...d, exists: false } })).status, 'skip');
  assert.equal(brief(check('files.data', healthyFacts({ data: { ...d, writable: false } }))), 'fail doc.files.data.readOnly');
  assert.equal(check('files.data', healthyFacts({ data: { ...d, renameWorks: false } })).status, 'warn');
  assert.equal(brief(check('files.data', healthyFacts({ data: { ...d, missingDirs: ['x'] } }))), 'warn doc.files.data.missingDirs → create-data-folders');
  assert.equal(check('files.space', healthyFacts({ data: { ...d, freeBytes: 10 * 1048576 } })).status, 'fail');
  assert.equal(check('files.space', healthyFacts({ data: { ...d, freeBytes: 200 * 1048576 } })).status, 'warn');
  assert.equal(check('files.space', healthyFacts({ data: { ...d, freeBytes: null } })).status, 'info');
  // The disk ignores case but the belt (Linux rules) does not: a real gap.
  assert.equal(brief(check('files.case', healthyFacts({ platform: 'linux', data: { ...d, caseInsensitive: true } }))), 'fail doc.files.case.gap');
  assert.equal(check('files.case', healthyFacts({ platform: 'darwin', data: { ...d, caseInsensitive: false } })).status, 'info');
  assert.equal(check('files.case', healthyFacts({ platform: 'linux', data: { ...d, caseInsensitive: false } })).status, 'ok');
  assert.equal(
    brief(check('files.leftovers', healthyFacts({ data: { ...d, staleTemp: ['config.json.1.0a1b2c3d.tmp'] } }))),
    'warn doc.files.leftovers.temp → remove-stale-temp',
  );
  assert.equal(brief(check('files.leftovers', healthyFacts({ data: { ...d, staleStates: 3 } }))), 'info doc.files.leftovers.states → prune-session-state');
  assert.equal(
    brief(check('files.permissions', healthyFacts({ platform: 'linux', data: { ...d, looseModes: ['.mode-code 777'] } }))),
    'fail doc.files.permissions.loose → tighten-permissions',
  );
  assert.equal(check('files.permissions', healthyFacts()).status, 'skip');
});

test('git: missing, projects not repositories, unreadable with the safe.directory hint', () => {
  assert.equal(check('git.found', healthyFacts({ git: { version: null, projects: [] } })).status, 'warn');
  const p = (over: object) => ({ path: 'C:/dev/app', exists: true, readable: true, error: null, notRepo: false, ...over });
  assert.equal(
    check('git.projects', healthyFacts({ git: { version: '2.5', projects: [p({ readable: false, notRepo: true, error: 'fatal: not a git repository' })] } }))
      .status,
    'info',
  );
  const dubious = check(
    'git.projects',
    healthyFacts({ git: { version: '2.5', projects: [p({ readable: false, error: 'fatal: detected dubious ownership in repository' })] } }),
  );
  assert.equal(dubious.status, 'warn');
  assert.equal(dubious.hint?.key, 'doc.git.projects.safeHint');
  assert.equal(check('git.projects', healthyFacts({ git: { version: '2.5', projects: [p({ exists: false, readable: false })] } })).status, 'info');
  assert.equal(check('git.projects', healthyFacts({ git: { version: '2.5', projects: [] } })).status, 'skip');
});

test('data: settings problems, the index, the quota reading', () => {
  assert.equal(check('data.config', healthyFacts({ config: { problems: [], exists: false } })).status, 'info');
  const bad = check('data.config', healthyFacts({ config: { problems: [{ path: 'view', kind: 'type', detail: 'expected a string' }], exists: true } }));
  assert.equal(brief(bad), 'warn doc.data.config.problems → rewrite-config');
  assert.equal(
    brief(check('data.index', healthyFacts({ index: { exists: true, ok: false, detail: 'malformed', sessions: null } }))),
    'warn doc.data.index.bad → rebuild-index',
  );
  assert.equal(check('data.index', healthyFacts({ index: { exists: false, ok: null, detail: null, sessions: null } })).status, 'info');
  assert.equal(
    brief(check('data.quota', healthyFacts({ quota: { exists: true, valid: false, measuredAt: null } }))),
    'warn doc.data.quota.bad → remove-bad-quota',
  );
  assert.equal(
    check('data.quota', healthyFacts({ quota: { exists: true, valid: true, measuredAt: Date.parse('2026-10-01T00:00:00Z') } })).summary.key,
    'doc.data.quota.old',
  );
  assert.equal(check('data.quota', healthyFacts({ quota: { exists: false, valid: false, measuredAt: null } })).status, 'info');
});

test('data: a transcript format change, and a tool that changes files without the belt seeing it', () => {
  const shape = healthyFacts().transcripts.shape!;
  const t = (s: Partial<typeof shape>) => healthyFacts({ transcripts: { files: 3, shape: { ...shape, ...s }, badSessionIds: [] } });
  assert.equal(check('data.transcripts', t({ user: 0, assistant: 0 })).status, 'fail');
  assert.equal(check('data.transcripts', t({ assistantWithBlocks: 10 })).status, 'warn');
  assert.equal(check('data.transcripts', t({ assistantWithUsage: 0 })).status, 'warn');
  assert.equal(check('data.transcripts', t({ timestamped: 0 })).status, 'warn');
  assert.equal(check('data.transcripts', healthyFacts({ transcripts: { files: 0, shape: null, badSessionIds: [] } })).status, 'info');
  // A renamed file tool would slip past the belt's matcher: that is a protection failure.
  const gap = check('data.toolNames', t({ tools: { ...shape.tools, StrReplace: { calls: 2, runsCommands: false, writesFiles: true } } }));
  assert.equal(brief(gap), 'fail doc.data.toolNames.gap');
  assert.equal(gap.summary.params?.names, 'StrReplace');
  assert.equal(gap.protection, true);
  assert.equal(check('data.toolNames', t({ tools: { ...shape.tools, mcp__shell__run: { calls: 1, runsCommands: true, writesFiles: false } } })).status, 'info');
  assert.equal(check('data.toolNames', t({ tools: { Read: { calls: 3, runsCommands: false, writesFiles: false } } })).status, 'ok');
  assert.equal(check('data.sessionIds', healthyFacts({ transcripts: { ...healthyFacts().transcripts, badSessionIds: ['a/b'] } })).status, 'warn');
});

test('self-tests: a belt failure fails as a protection; another suite only warns', () => {
  const failing = (suite: string) =>
    healthyFacts({ selftest: [{ suite, passed: 3, failed: 1, failures: [{ name: 's', expected: 'a', actual: 'b' }], ms: 1 }] });
  const belt = check('selftest.suites', failing('belt'));
  assert.equal(belt.status, 'fail');
  assert.equal(belt.protection, true);
  assert.equal(belt.details?.[0]?.key, 'doc.selftest.failure');
  assert.equal(check('selftest.suites', failing('footer')).status, 'warn');
  assert.equal(check('selftest.suites', healthyFacts({ selftest: null })).status, 'skip');
});

test('full autonomy: off is a note; on, the start checks that would fail here are named, each with its fix', () => {
  assert.equal(brief(check('install.autonomy', healthyFacts())), 'info doc.autonomy.off');
  const ready = healthyFacts({
    autonomy: { enabled: true, checks: [{ id: 'platform', ok: true, key: 'auto.gate.platform.ok', params: { platform: 'linux' } }] },
  });
  assert.equal(brief(check('install.autonomy', ready)), 'ok doc.autonomy.ready');
  assert.equal(check('install.autonomy', ready).protection, false);
  const notReady = check(
    'install.autonomy',
    healthyFacts({
      autonomy: {
        enabled: true,
        checks: [
          { id: 'platform', ok: false, key: 'auto.gate.platform.windows' },
          { id: 'budget', ok: null, key: 'auto.cli.atStart' },
          { id: 'sandbox', ok: false, key: 'auto.gate.sandbox.gaps', params: { settings: 'sandbox.enabled' } },
        ],
      },
    }),
  );
  assert.equal(brief(notReady), 'warn doc.autonomy.notReady');
  assert.deepEqual(notReady.summary.params, { n: 2 });
  assert.deepEqual(
    notReady.details?.map((d) => d.key),
    ['auto.gate.platform.windows', 'auto.gate.sandbox.gaps'],
  );
  assert.equal(notReady.protection, false, 'full autonomy is a feature, not a protection: a run that cannot start harms nothing');
});

test('sync across computers: not set up, missing, without git or origin, a sync that failed, settings waiting, fine', () => {
  const sync = {
    place: 'github',
    dir: 'C:/Users/ada/.mode-code/sync',
    name: 'PC',
    exists: true,
    isRepo: true,
    hasOrigin: true,
    others: 1,
    last: null,
    pending: [] as string[],
  };
  const at = (over: object | null) => {
    const r = check('data.sync', healthyFacts({ sync: over && { ...sync, ...over } }));
    assert.equal(r.protection, false);
    return brief(r);
  };
  const result = (over: object) => ({
    repo: true,
    commit: 'ok' as const,
    committed: 1,
    held: [],
    pull: 'ok' as const,
    push: 'ok' as const,
    conflicts: [],
    ahead: 0,
    behind: 0,
    pulled: [],
    index: null,
    head: null,
    detail: 'why',
    ...over,
  });
  const last = (over: object, error: string | null = null) => ({ at: 1, trigger: 'turn' as const, session: null, written: 1, result: result(over), error });
  assert.equal(at(null), 'info doc.sync.none');
  assert.equal(at({}), 'ok doc.sync.ok');
  assert.deepEqual(check('data.sync', healthyFacts({ sync })).summary.params, { place: '@scli.place.github', name: 'PC', n: 1 });
  assert.equal(at({ exists: false }), 'fail doc.sync.missing');
  assert.equal(at({ isRepo: false }), 'warn doc.sync.noGit');
  assert.equal(at({ hasOrigin: false }), 'warn doc.sync.noOrigin');
  assert.equal(at({ place: 'folder', isRepo: false, hasOrigin: false }), 'ok doc.sync.ok', 'a folder another service syncs has no git');
  assert.equal(at({ last: last({ push: 'auth' }) }), 'warn doc.sync.problem');
  assert.deepEqual(check('data.sync', healthyFacts({ sync: { ...sync, last: last({ push: 'auth' }) } })).summary.params, { detail: 'why' });
  assert.equal(at({ last: last({}, 'EACCES') }), 'warn doc.sync.problem');
  assert.deepEqual(check('data.sync', healthyFacts({ sync: { ...sync, last: { ...last({}), result: null, error: 'EACCES' } } })).summary.params, {
    detail: 'EACCES',
  });
  assert.equal(at({ last: last({ push: 'offline' }) }), 'ok doc.sync.ok', 'offline is tried again, not a problem');
  assert.equal(at({ last: { ...last({}), result: null } }), 'ok doc.sync.ok');
  assert.equal(at({ pending: ['belt.verdicts'] }), 'warn doc.sync.pending');
  assert.equal(check('data.sync', healthyFacts({ sync: { ...sync, pending: ['a', 'b'] } })).summary.params?.keys, 'a, b');
});

test('bypass: off is a note; on, for how long and in how many sessions; a weakened floor rule is a warning', () => {
  assert.equal(brief(check('protection.bypass', healthyFacts())), 'info doc.bypass.off');
  assert.equal(check('protection.bypass', healthyFacts()).protection, false, 'a note, not a protection');
  const on = (onNow: number) => healthyFacts({ bypass: { enabled: true, maxHours: 2, onNow, floorWeakened: [] } });
  assert.equal(brief(check('protection.bypass', on(0))), 'info doc.bypass.on');
  assert.equal(check('protection.bypass', on(2)).protection, false);
  assert.equal(brief(check('protection.bypass', on(2))), 'info doc.bypass.onNow');
  assert.deepEqual(check('protection.bypass', on(2)).summary.params, { n: 2, hours: 2 });
  const weak = check('protection.bypass', healthyFacts({ bypass: { enabled: false, maxHours: 2, onNow: 0, floorWeakened: ['data.delete-cloud'] } }));
  assert.equal(brief(weak), 'warn doc.bypass.floorWeakened');
  assert.equal(weak.protection, true);
  assert.deepEqual(
    weak.details?.map((d) => d.params?.text),
    ['data.delete-cloud'],
  );
});
