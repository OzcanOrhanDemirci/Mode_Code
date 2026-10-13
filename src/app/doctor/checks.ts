// SPDX-License-Identifier: Apache-2.0
/**
 * The maintenance checks: pure functions of the measured facts. Each states what it measured in one line,
 * names a repair when a safe one exists, and otherwise says what the person can do. A check never guesses:
 * what could not be measured is reported as such.
 */
import { MIN_CLAUDE_CODE_FOR_HOOKS, MIN_CLAUDE_CODE_FOR_MODS, PLUGIN_ID } from '../../core/app.js';
import { caseInsensitive } from '../../core/paths.js';
import { compareVersions } from '../../core/version.js';
import { isBeltTool } from '../../core/belt/tools.js';
import { BELT_MATCHER, HOOK_EVENTS } from '../../node/install.js';
import type { CheckGroup, CheckResult, CheckStatus, Facts, Message, RepairId } from './types.js';

export const MIN_NODE = '22.13.0';

/** Tools the belt judges. A tool outside this list that runs commands or writes files is a gap. */

type MessageKey = Message['key'];

function m(key: MessageKey, params?: Record<string, string | number>): Message {
  return { key, ...(params ? { params } : {}) };
}

function result(
  id: string,
  group: CheckGroup,
  protection: boolean,
  status: CheckStatus,
  summary: Message,
  extra: { details?: Message[]; repair?: RepairId; hint?: Message } = {},
): CheckResult {
  return { id, group, protection, status, summary, ...extra };
}

const mb = (n: number) => Math.round(n / 1048576);

/** A verdict as a word of the person's language (see render.ts: "@key" parameters are translated). */
function verdictWord(v: string): string {
  return ['allow', 'warn', 'ask', 'deny'].includes(v) ? `@verdict.${v}` : v;
}

type Check = (f: Facts) => CheckResult;

// ── Node.js ──

const nodeVersion: Check = (f) =>
  compareVersions(f.node.version, MIN_NODE) >= 0
    ? result('node.version', 'node', false, 'ok', m('doc.node.version.ok', { v: f.node.version, min: MIN_NODE }))
    : result('node.version', 'node', false, 'fail', m('doc.node.version.old', { v: f.node.version, min: MIN_NODE }), {
        hint: m('doc.node.version.hint', { min: MIN_NODE }),
      });

const nodeHooks: Check = (f) => {
  const id = 'node.hooks';
  if (!f.manifest || !f.hookNode) return result(id, 'node', true, 'skip', m('doc.notInstalled'));
  const canRepoint = compareVersions(f.node.version, MIN_NODE) >= 0;
  const repair = canRepoint ? ({ repair: 'repoint-node' } as const) : { hint: m('doc.node.version.hint', { min: MIN_NODE }) };
  if (!f.hookNode.exists) return result(id, 'node', true, 'fail', m('doc.node.hooks.gone', { path: f.hookNode.path }), repair);
  if (f.hookNode.version === null) return result(id, 'node', true, 'fail', m('doc.node.hooks.wontRun', { path: f.hookNode.path }), repair);
  if (compareVersions(f.hookNode.version, MIN_NODE) < 0)
    return result(id, 'node', true, 'fail', m('doc.node.hooks.old', { v: f.hookNode.version, min: MIN_NODE, path: f.hookNode.path }), repair);
  return result(id, 'node', true, 'ok', m('doc.node.hooks.ok', { v: f.hookNode.version, path: f.hookNode.path }));
};

const nodeSqlite: Check = (f) =>
  f.node.sqlite
    ? result('node.sqlite', 'node', false, 'ok', m('doc.node.sqlite.ok'))
    : result('node.sqlite', 'node', false, 'fail', m('doc.node.sqlite.missing'), { hint: m('doc.node.version.hint', { min: MIN_NODE }) });

// ── Claude Code ──

const claudeVersion: Check = (f) => {
  const id = 'claude.version';
  const v = f.claude.version;
  if (v === null) return result(id, 'claude', true, 'fail', m('doc.claude.missing'), { hint: m('doc.claude.installHint') });
  if (compareVersions(v, MIN_CLAUDE_CODE_FOR_HOOKS) < 0)
    return result(id, 'claude', true, 'fail', m('doc.claude.old', { v, min: MIN_CLAUDE_CODE_FOR_HOOKS }), { hint: m('doc.claude.updateHint') });
  if (compareVersions(v, MIN_CLAUDE_CODE_FOR_MODS) < 0)
    return result(id, 'claude', false, 'warn', m('doc.claude.noMods', { v, min: MIN_CLAUDE_CODE_FOR_MODS }), { hint: m('doc.claude.updateHint') });
  return result(id, 'claude', true, 'ok', m('doc.claude.ok', { v, min: MIN_CLAUDE_CODE_FOR_HOOKS }));
};

const claudeInstalls: Check = (f) => {
  const id = 'claude.installs';
  const n = f.claude.installs.length;
  if (n === 0)
    return f.claude.version
      ? result(id, 'claude', false, 'info', m('doc.claude.installs.notOnPath'))
      : result(id, 'claude', false, 'skip', m('doc.claude.missing'));
  if (n === 1) return result(id, 'claude', false, 'ok', m('doc.claude.installs.one', { path: f.claude.installs[0]! }));
  return result(id, 'claude', false, 'warn', m('doc.claude.installs.many', { n, path: f.claude.installs[0]! }), {
    details: f.claude.installs.map((p) => m('doc.line', { text: p })),
    hint: m('doc.claude.installs.hint'),
  });
};

const claudeSettings: Check = (f) => {
  const id = 'claude.settings';
  const broken = f.settings.filter((s) => s.exists && s.error);
  const read = f.settings.filter((s) => s.exists).length;
  if (!broken.length) return result(id, 'claude', true, 'ok', m('doc.claude.settings.ok', { n: read }));
  const user = broken.find((s) => s.scope === 'user' || s.scope === 'managed');
  const details = broken.map((s) => m('doc.claude.settings.broken', { scope: s.scope, path: s.path, error: s.error ?? '' }));
  const backup = f.manifest?.settingsBackup;
  return result(id, 'claude', true, user ? 'fail' : 'warn', m('doc.claude.settings.bad', { n: broken.length }), {
    details,
    hint: backup ? m('doc.claude.settings.hintBackup', { backup }) : m('doc.claude.settings.hint'),
  });
};

const claudeHooksOn: Check = (f) => {
  const id = 'claude.hooksOn';
  const off = f.settings.filter((s) => s.disableAllHooks);
  const managedOnly = f.settings.filter((s) => s.scope === 'managed' && s.allowManagedHooksOnly);
  if (managedOnly.length)
    return result(id, 'claude', true, 'fail', m('doc.claude.hooksOn.managedOnly', { path: managedOnly[0]!.path }), { hint: m('doc.claude.hooksOn.adminHint') });
  if (off.length) {
    const s = off[0]!;
    return result(id, 'claude', true, 'fail', m('doc.claude.hooksOn.disabled', { scope: s.scope, path: s.path }), {
      hint: s.scope === 'managed' ? m('doc.claude.hooksOn.adminHint') : m('doc.claude.hooksOn.removeHint', { path: s.path }),
    });
  }
  return result(id, 'claude', true, 'ok', m('doc.claude.hooksOn.ok'));
};

const claudePlugin: Check = (f) => {
  const id = 'claude.plugin';
  if (!f.manifest) return result(id, 'claude', false, 'skip', m('doc.notInstalled'));
  const off = f.settings.find((s) => s.pluginEnabled === false);
  if (off && off.scope !== 'user') return result(id, 'claude', false, 'info', m('doc.claude.plugin.offInScope', { scope: off.scope, path: off.path }));
  if (f.plugins === null) return result(id, 'claude', false, off ? 'warn' : 'info', m('doc.claude.plugin.unlisted'), off ? { repair: 'enable-plugin' } : {});
  const p = f.plugins.find((x) => x.id === PLUGIN_ID);
  if (!p) return result(id, 'claude', false, 'warn', m('doc.claude.plugin.missing', { id: PLUGIN_ID }), { repair: 'reinstall-plugin' });
  if (p.enabled === false || off) return result(id, 'claude', false, 'warn', m('doc.claude.plugin.disabled', { id: PLUGIN_ID }), { repair: 'enable-plugin' });
  if (p.version && p.version !== f.appVersion && f.appVersion !== 'dev')
    return result(id, 'claude', false, 'warn', m('doc.claude.plugin.otherVersion', { have: p.version, now: f.appVersion }), { repair: 'restore-plugin-files' });
  return result(id, 'claude', false, 'ok', m('doc.claude.plugin.ok', { id: PLUGIN_ID, v: p.version ?? '?' }));
};

// ── installation ──

const installManifest: Check = (f) => {
  const id = 'install.manifest';
  if (!f.manifest) return result(id, 'install', false, 'info', m('doc.install.none'), { hint: m('doc.install.hint') });
  if (f.manifest.dataDir.replace(/\\/g, '/').toLowerCase() !== f.dataDir.toLowerCase())
    return result(id, 'install', false, 'warn', m('doc.install.otherData', { recorded: f.manifest.dataDir, now: f.dataDir }));
  return result(id, 'install', false, 'ok', m('doc.install.ok', { v: f.manifest.version, when: new Date(f.manifest.installedAt).toISOString().slice(0, 10) }));
};

const installHookProgram: Check = (f) => {
  const id = 'install.hookProgram';
  if (!f.manifest) return result(id, 'install', true, 'skip', m('doc.notInstalled'));
  const h = f.hookProgram;
  if (!h.exists) return result(id, 'install', true, 'fail', m('doc.install.hook.missing', { path: h.path }), { repair: 'restore-hook-program' });
  if (!h.shippedHash) return result(id, 'install', true, 'info', m('doc.install.hook.noBuild'));
  if (h.hash === h.shippedHash) return result(id, 'install', true, 'ok', m('doc.install.hook.ok', { hash: h.hash.slice(0, 12) }));
  // Run from the source tree: the build next to it is what the installed copy is compared with.
  if (f.appVersion === 'dev') return result(id, 'install', true, 'warn', m('doc.install.hook.notThisBuild'), { repair: 'restore-hook-program' });
  if (f.manifest.version !== f.appVersion)
    return result(id, 'install', true, 'warn', m('doc.install.hook.older', { have: f.manifest.version, now: f.appVersion }), {
      repair: 'restore-hook-program',
    });
  // The same version, another program: the fingerprint taken at installation tells an earlier build of
  // this version (as installed) from a program changed since. Installations before it was recorded cannot tell.
  if (f.manifest.hookHash === h.hash)
    return result(id, 'install', true, 'warn', m('doc.install.hook.otherBuild', { version: f.appVersion }), { repair: 'restore-hook-program' });
  if (!f.manifest.hookHash) return result(id, 'install', true, 'fail', m('doc.install.hook.differs', { path: h.path }), { repair: 'restore-hook-program' });
  return result(id, 'install', true, 'fail', m('doc.install.hook.altered', { path: h.path }), { repair: 'restore-hook-program' });
};

const installHooks: Check = (f) => {
  const id = 'install.hooks';
  if (!f.manifest) return result(id, 'install', true, 'skip', m('doc.notInstalled'));
  const ours = f.hooks.filter((h) => h.ours);
  const user = ours.filter((h) => h.scope === 'user');
  const missing = HOOK_EVENTS.filter((ev) => !user.some((h) => h.event === ev));
  const pre = user.filter((h) => h.event === 'PreToolUse');
  const weak = pre.filter((h) => h.onFailure !== 'block' || h.matcher !== BELT_MATCHER);
  const details: Message[] = [];
  if (f.manifest.settingsFile.replace(/\\/g, '/').toLowerCase() !== `${f.claudeDir}/settings.json`.toLowerCase())
    details.push(m('doc.install.hooks.movedConfig', { recorded: f.manifest.settingsFile, now: `${f.claudeDir}/settings.json` }));
  if (missing.length)
    return result(
      id,
      'install',
      true,
      'fail',
      m('doc.install.hooks.missing', { events: missing.join(', '), n: HOOK_EVENTS.length - missing.length, of: HOOK_EVENTS.length }),
      {
        details,
        repair: 'restore-hooks',
      },
    );
  if (weak.length) {
    // A matcher exactly as installed, blocking on failure, comes from an earlier build that checked fewer tools.
    const recorded = (f.manifest.hooks.PreToolUse ?? []).map((g) => (g as { matcher?: unknown })?.matcher);
    const older = weak.every((h) => h.onFailure === 'block' && h.matcher !== null && recorded.includes(h.matcher));
    const have = new Set(weak.flatMap((h) => (h.matcher ?? '').split('|')));
    const tools = BELT_MATCHER.split('|').filter((t) => !have.has(t));
    if (older && tools.length)
      return result(id, 'install', true, 'fail', m('doc.install.hooks.older', { tools: tools.join(', ') }), { details, repair: 'restore-hooks' });
    return result(id, 'install', true, 'fail', m('doc.install.hooks.changed'), { details, repair: 'restore-hooks' });
  }
  const dupes = HOOK_EVENTS.filter((ev) => user.filter((h) => h.event === ev).length > 1);
  const elsewhere = ours.filter((h) => h.scope !== 'user');
  if (dupes.length || elsewhere.length)
    return result(id, 'install', false, 'warn', m('doc.install.hooks.duplicates', { n: dupes.length + elsewhere.length }), {
      details: [...dupes.map((e) => m('doc.line', { text: e })), ...elsewhere.map((h) => m('doc.line', { text: `${h.scope}: ${h.event}` }))],
      ...(dupes.length ? { repair: 'remove-duplicate-hooks' as const } : {}),
    });
  return result(id, 'install', true, 'ok', m('doc.install.hooks.ok', { n: HOOK_EVENTS.length }), details.length ? { details } : {});
};

const installPluginFiles: Check = (f) => {
  const id = 'install.pluginFiles';
  if (!f.manifest) return result(id, 'install', false, 'skip', m('doc.notInstalled'));
  const p = f.pluginFiles;
  if (!p.shipped) return result(id, 'install', false, 'info', m('doc.install.hook.noBuild'));
  const bad = [...p.missing, ...p.different];
  if (bad.length)
    return result(id, 'install', false, 'warn', m('doc.install.pluginFiles.bad', { n: bad.length }), {
      details: bad.slice(0, 8).map((x) => m('doc.line', { text: x })),
      repair: 'restore-plugin-files',
    });
  return result(id, 'install', false, 'ok', m('doc.install.pluginFiles.ok'));
};

const installModSeen: Check = (f) => {
  const id = 'install.modSeen';
  if (!f.manifest) return result(id, 'install', false, 'skip', m('doc.notInstalled'));
  if (!f.modSeen) return result(id, 'install', false, 'info', m('doc.install.modSeen.never'));
  if (f.modSeen.version !== f.appVersion)
    return result(id, 'install', false, 'info', m('doc.install.modSeen.other', { have: f.modSeen.version, now: f.appVersion }));
  return result(id, 'install', false, 'ok', m('doc.install.modSeen.ok', { when: new Date(f.modSeen.at).toISOString().slice(0, 16).replace('T', ' ') }));
};

// ── protection ──

const protectAgreement: Check = (f) => {
  const id = 'protect.agreement';
  const a = f.hookAgreement;
  if (!a) return result(id, 'protection', true, 'skip', m('doc.protect.agreement.notRun'));
  if (a.error) return result(id, 'protection', true, 'warn', m('doc.protect.agreement.error', { error: a.error }));
  if (a.agreed === a.samples) return result(id, 'protection', true, 'ok', m('doc.protect.agreement.ok', { n: a.samples }));
  return result(id, 'protection', true, 'fail', m('doc.protect.agreement.differ', { n: a.samples - a.agreed, of: a.samples }), {
    details: a.differences.slice(0, 6).map((x) => m('doc.protect.agreement.diff', { call: x.call, mine: verdictWord(x.mine), theirs: verdictWord(x.theirs) })),
    repair: 'restore-hook-program',
  });
};

const protectLinks: Check = (f) =>
  f.aliases.length
    ? result('protect.links', 'protection', true, 'info', m('doc.protect.links.some', { n: f.aliases.length }), {
        details: f.aliases.map((a) => m('doc.protect.links.one', { spelled: a.spelled, real: a.real })),
      })
    : result('protect.links', 'protection', true, 'ok', m('doc.protect.links.none'));

const protectShortNames: Check = (f) => {
  const id = 'protect.shortNames';
  if (f.platform !== 'win32') return result(id, 'protection', true, 'skip', m('doc.windowsOnly'));
  if (!f.shortNames.length) return result(id, 'protection', true, 'ok', m('doc.protect.shortNames.none'));
  const missed = f.shortNames.filter((s) => !s.recognised);
  const details = f.shortNames.map((s) => m('doc.protect.shortNames.one', { short: s.short, long: s.long }));
  if (missed.length)
    return result(id, 'protection', true, 'fail', m('doc.protect.shortNames.missed', { n: missed.length }), { details, hint: m('doc.reportHint') });
  return result(id, 'protection', true, 'ok', m('doc.protect.shortNames.ok', { n: f.shortNames.length }), { details });
};

const protectMemory: Check = (f) => {
  const id = 'protect.memory';
  if (!f.memoryDirs.length) return result(id, 'protection', false, 'info', m('doc.protect.memory.none'));
  const missing = f.memoryDirs.filter((d) => !d.exists);
  if (missing.length) return result(id, 'protection', false, 'warn', m('doc.protect.memory.missing', { path: missing[0]!.path }));
  const noGit = f.memoryDirs.filter((d) => !d.isRepo);
  if (noGit.length) return result(id, 'protection', false, 'info', m('doc.protect.memory.noGit', { n: f.memoryDirs.length }));
  return result(id, 'protection', false, 'ok', m('doc.protect.memory.ok', { n: f.memoryDirs.length }));
};

const dataMemoryStore: Check = (f) => {
  const id = 'data.memoryStore';
  const s = f.memoryStore;
  if (!s) return result(id, 'data', false, 'info', m('doc.memory.none'), { hint: m('doc.memory.setupHint') });
  if (!s.exists) return result(id, 'data', false, 'fail', m('doc.memory.missing', { dir: s.dir }), { hint: m('doc.memory.setupHint') });
  if (!s.inUse)
    return result(id, 'data', false, 'warn', s.setting ? m('doc.memory.elsewhere', { dir: s.setting }) : m('doc.memory.perProject'), {
      hint: m('doc.memory.setupHint'),
    });
  if (s.git && !s.isRepo) return result(id, 'data', false, 'warn', m('doc.memory.noGit', { dir: s.dir }), { hint: m('doc.memory.setupHint') });
  if (s.remote && !s.hasOrigin) return result(id, 'data', false, 'warn', m('doc.memory.noOrigin', { remote: s.remote }), { hint: m('doc.memory.setupHint') });
  const r = s.last?.result;
  if (r?.pull === 'conflict')
    return result(id, 'data', false, 'warn', m('doc.memory.conflict', { files: r.conflicts.join(', ') }), { hint: m('doc.memory.syncHint') });
  if (r && (r.push === 'auth' || r.pull === 'auth'))
    return result(id, 'data', false, 'warn', m('doc.memory.auth', { detail: r.detail }), { hint: m('doc.memory.syncHint') });
  if (r?.held.length) return result(id, 'data', false, 'info', m('doc.memory.held', { files: r.held.map((h) => h.path).join(', ') }));
  return result(id, 'data', false, 'ok', m('doc.memory.ok', { place: `@msetup.place.${s.place}`, dir: s.dir }));
};

// ── shells and terminal ──

const shellGitBash: Check = (f) => {
  const id = 'shell.gitBash';
  if (f.platform !== 'win32') return result(id, 'shell', true, 'skip', m('doc.windowsOnly'));
  const g = f.gitBash;
  if (!g) return result(id, 'shell', true, 'skip', m('doc.notMeasured'));
  if (!g.path) return result(id, 'shell', false, 'warn', m('doc.shell.gitBash.missing'), { hint: m('doc.shell.gitBash.hint') });
  if (!g.tmp) return result(id, 'shell', true, 'warn', m('doc.shell.gitBash.noTmp', { path: g.path, error: g.error ?? '?' }));
  if (g.tmp.toLowerCase() !== g.expectedTmp.toLowerCase())
    return result(id, 'shell', true, 'fail', m('doc.shell.gitBash.tmpDiffers', { tmp: g.tmp, expected: g.expectedTmp }), { hint: m('doc.reportHint') });
  return result(id, 'shell', true, 'ok', m('doc.shell.gitBash.ok', { path: g.path }));
};

const shellPowerShell: Check = (f) => {
  const id = 'shell.powershell';
  const p = f.powershell;
  if (!p) return result(id, 'shell', false, 'skip', m('doc.notMeasured'));
  if (p.pwsh) return result(id, 'shell', false, 'ok', m('doc.shell.pwsh.ok', { v: p.pwsh }));
  return result(id, 'shell', false, 'info', p.windowsPowerShell ? m('doc.shell.pwsh.only51') : m('doc.shell.pwsh.none'));
};

const shellPosix: Check = (f) => {
  const id = 'shell.posix';
  if (f.platform === 'win32') return result(id, 'shell', false, 'skip', m('doc.notMeasured'));
  const s = f.posixShell;
  if (!s || !s.shell) return result(id, 'shell', false, 'info', m('doc.shell.posix.unknown'));
  return result(id, 'shell', false, 'info', m('doc.shell.posix.info', { shell: s.shell, version: s.version ?? '?' }));
};

const shellTerminal: Check = (f) => {
  const t = f.terminal;
  const parts = [t.program ?? t.term ?? '?', t.columns ? `${t.columns}` : '?', t.codePage ? String(t.codePage) : '-'];
  const narrow = t.tty && t.columns !== null && t.columns < 60;
  return result(
    'shell.terminal',
    'shell',
    false,
    narrow ? 'warn' : 'info',
    m(narrow ? 'doc.shell.terminal.narrow' : 'doc.shell.terminal.info', { program: parts[0]!, columns: parts[1]!, cp: parts[2]! }),
  );
};

const shellLocale: Check = (f) =>
  result('shell.locale', 'shell', false, 'info', m('doc.shell.locale.info', { intl: f.locale.intl, lang: f.locale.lang ?? '-', chosen: f.locale.chosen }));

// ── files ──

const filesData: Check = (f) => {
  const id = 'files.data';
  const d = f.data;
  if (!d.exists)
    return f.manifest
      ? result(id, 'files', true, 'fail', m('doc.files.data.missing', { path: f.dataDir }), { repair: 'create-data-folders' })
      : result(id, 'files', false, 'skip', m('doc.notInstalled'));
  if (!d.writable) return result(id, 'files', true, 'fail', m('doc.files.data.readOnly', { path: f.dataDir }), { hint: m('doc.files.data.permHint') });
  if (!d.renameWorks) return result(id, 'files', false, 'warn', m('doc.files.data.noRename', { path: f.dataDir }));
  if (d.missingDirs.length)
    return result(id, 'files', false, 'warn', m('doc.files.data.missingDirs', { n: d.missingDirs.length }), {
      details: d.missingDirs.map((x) => m('doc.line', { text: x })),
      repair: 'create-data-folders',
    });
  return result(id, 'files', false, 'ok', m('doc.files.data.ok'));
};

const filesSpace: Check = (f) => {
  const id = 'files.space';
  const free = f.data.freeBytes;
  if (free === null) return result(id, 'files', false, f.data.exists ? 'info' : 'skip', m('doc.notMeasured'));
  if (free < 50 * 1048576) return result(id, 'files', false, 'fail', m('doc.files.space.low', { mb: mb(free) }));
  if (free < 500 * 1048576) return result(id, 'files', false, 'warn', m('doc.files.space.low', { mb: mb(free) }));
  return result(id, 'files', false, 'ok', m('doc.files.space.ok', { gb: (free / 1073741824).toFixed(1) }));
};

const filesCase: Check = (f) => {
  const id = 'files.case';
  const fsIgnores = f.data.caseInsensitive;
  if (fsIgnores === null) return result(id, 'files', true, f.data.exists ? 'info' : 'skip', m('doc.notMeasured'));
  const beltIgnores = caseInsensitive(f.platform);
  if (fsIgnores === beltIgnores) return result(id, 'files', true, 'ok', m(fsIgnores ? 'doc.files.case.insensitive' : 'doc.files.case.sensitive'));
  // The disk ignores case and the belt does not: another spelling of a protected path would slip through.
  if (fsIgnores) return result(id, 'files', true, 'fail', m('doc.files.case.gap'), { hint: m('doc.reportHint') });
  return result(id, 'files', true, 'info', m('doc.files.case.stricter'));
};

const filesLeftovers: Check = (f) => {
  const id = 'files.leftovers';
  if (f.data.staleTemp.length)
    return result(id, 'files', false, 'warn', m('doc.files.leftovers.temp', { n: f.data.staleTemp.length }), {
      details: f.data.staleTemp.slice(0, 5).map((x) => m('doc.line', { text: x })),
      repair: 'remove-stale-temp',
    });
  if (f.data.staleStates)
    return result(id, 'files', false, 'info', m('doc.files.leftovers.states', { n: f.data.staleStates }), { repair: 'prune-session-state' });
  return result(id, 'files', false, f.data.exists ? 'ok' : 'skip', m('doc.files.leftovers.none'));
};

const filesPermissions: Check = (f) => {
  const id = 'files.permissions';
  if (f.platform === 'win32') return result(id, 'files', true, 'skip', m('doc.notMeasured'));
  if (f.data.looseModes.length)
    return result(id, 'files', true, 'fail', m('doc.files.permissions.loose'), {
      details: f.data.looseModes.map((x) => m('doc.line', { text: x })),
      repair: 'tighten-permissions',
    });
  return result(id, 'files', true, f.data.exists ? 'ok' : 'skip', m('doc.files.permissions.ok'));
};

// ── git ──

const gitFound: Check = (f) =>
  f.git.version
    ? result('git.found', 'git', false, 'ok', m('doc.git.ok', { v: f.git.version }))
    : result('git.found', 'git', true, 'warn', m('doc.git.missing'), { hint: m('doc.git.hint') });

const gitProjects: Check = (f) => {
  const id = 'git.projects';
  const ps = f.git.projects;
  if (!ps.length) return result(id, 'git', false, 'skip', m('doc.git.projects.none'));
  const unreadable = ps.filter((p) => p.exists && !p.readable && p.error && !p.notRepo);
  const dubious = unreadable.find((p) => /dubious ownership/i.test(p.error ?? ''));
  const missing = ps.filter((p) => !p.exists);
  const notRepo = ps.filter((p) => p.notRepo);
  if (unreadable.length)
    return result(id, 'git', false, 'warn', m('doc.git.projects.unreadable', { n: unreadable.length }), {
      details: unreadable.slice(0, 5).map((p) => m('doc.line', { text: `${p.path}: ${p.error}` })),
      ...(dubious ? { hint: m('doc.git.projects.safeHint', { path: dubious.path }) } : {}),
    });
  if (missing.length)
    return result(id, 'git', false, 'info', m('doc.git.projects.missing', { n: missing.length }), {
      details: missing.slice(0, 5).map((p) => m('doc.line', { text: p.path })),
    });
  if (notRepo.length)
    return result(id, 'git', false, 'info', m('doc.git.projects.notRepo', { n: notRepo.length, of: ps.length }), {
      details: notRepo.slice(0, 5).map((p) => m('doc.line', { text: p.path })),
    });
  return result(id, 'git', false, 'ok', m('doc.git.projects.ok', { n: ps.length }));
};

// ── data ──

const dataConfig: Check = (f) => {
  const id = 'data.config';
  if (!f.config.exists) return result(id, 'data', false, 'info', m('doc.data.config.none'));
  if (f.config.problems.length)
    return result(id, 'data', false, 'warn', m('doc.data.config.problems', { n: f.config.problems.length }), {
      details: f.config.problems.slice(0, 6).map((p) => m('doc.line', { text: `${p.path || '(file)'}: ${p.detail}` })),
      repair: 'rewrite-config',
    });
  return result(id, 'data', false, 'ok', m('doc.data.config.ok'));
};

const dataIndex: Check = (f) => {
  const id = 'data.index';
  const i = f.index;
  if (!i.exists) return result(id, 'data', false, 'info', m('doc.data.index.none'));
  if (i.ok === false) return result(id, 'data', false, 'warn', m('doc.data.index.bad', { detail: i.detail ?? '?' }), { repair: 'rebuild-index' });
  return result(id, 'data', false, 'ok', m('doc.data.index.ok', { n: i.sessions ?? '?' }));
};

const dataQuota: Check = (f) => {
  const id = 'data.quota';
  const q = f.quota;
  if (!q.exists) return result(id, 'data', false, 'info', m('doc.data.quota.none'));
  if (!q.valid) return result(id, 'data', false, 'warn', m('doc.data.quota.bad'), { repair: 'remove-bad-quota' });
  const days = q.measuredAt === null ? 0 : Math.floor((f.measuredAt - q.measuredAt) / 86400_000);
  if (days >= 7) return result(id, 'data', false, 'info', m('doc.data.quota.old', { n: days }));
  return result(id, 'data', false, 'ok', m('doc.data.quota.ok'));
};

const dataTranscripts: Check = (f) => {
  const id = 'data.transcripts';
  const t = f.transcripts;
  if (!t.shape || !t.files) return result(id, 'data', false, 'info', m('doc.data.transcripts.none'));
  const s = t.shape;
  const rows = s.lines - s.unreadable;
  if (s.user + s.assistant === 0) return result(id, 'data', false, 'fail', m('doc.data.transcripts.unknown', { n: t.files }), { hint: m('doc.reportHint') });
  const problems: Message[] = [];
  if (s.assistant && s.assistantWithBlocks < s.assistant * 0.9) problems.push(m('doc.data.transcripts.noBlocks', { n: s.assistant - s.assistantWithBlocks }));
  if (s.assistant && s.assistantWithUsage === 0) problems.push(m('doc.data.transcripts.noUsage'));
  if (rows && s.timestamped === 0) problems.push(m('doc.data.transcripts.noTime'));
  if (problems.length) return result(id, 'data', false, 'warn', m('doc.data.transcripts.changed'), { details: problems, hint: m('doc.reportHint') });
  return result(id, 'data', false, 'ok', m('doc.data.transcripts.ok', { files: t.files, rows }));
};

const dataToolNames: Check = (f) => {
  const id = 'data.toolNames';
  const s = f.transcripts.shape;
  if (!s) return result(id, 'data', true, 'skip', m('doc.data.transcripts.none'));
  const risky = Object.entries(s.tools).filter(([, x]) => x.runsCommands || x.writesFiles);
  const covered = isBeltTool;
  const gaps = risky.filter(([n]) => !covered(n) && !n.startsWith('mcp__')).map(([n]) => n);
  const mcp = risky.filter(([n]) => n.startsWith('mcp__')).map(([n]) => n);
  if (gaps.length) return result(id, 'data', true, 'fail', m('doc.data.toolNames.gap', { names: gaps.join(', ') }), { hint: m('doc.reportHint') });
  const seen = risky.filter(([n]) => covered(n)).map(([n]) => n);
  if (mcp.length)
    return result(id, 'data', true, 'info', m('doc.data.toolNames.mcp', { n: mcp.length }), {
      details: mcp.slice(0, 8).map((x) => m('doc.line', { text: x })),
    });
  return result(id, 'data', true, 'ok', m('doc.data.toolNames.ok', { names: seen.join(', ') || '-' }));
};

const dataSessionIds: Check = (f) =>
  f.transcripts.badSessionIds.length
    ? result('data.sessionIds', 'data', false, 'warn', m('doc.data.sessionIds.bad', { ids: f.transcripts.badSessionIds.join(', ') }), {
        hint: m('doc.reportHint'),
      })
    : result('data.sessionIds', 'data', false, f.transcripts.shape ? 'ok' : 'skip', m('doc.data.sessionIds.ok'));

// ── self-tests ──

const selftestSuites: Check = (f) => {
  const id = 'selftest.suites';
  if (!f.selftest) return result(id, 'selftest', true, 'skip', m('doc.notMeasured'));
  const passed = f.selftest.reduce((n, s) => n + s.passed, 0);
  const failed = f.selftest.reduce((n, s) => n + s.failed, 0);
  if (!failed) return result(id, 'selftest', true, 'ok', m('doc.selftest.ok', { passed, suites: f.selftest.length }));
  const protective = f.selftest.some((s) => s.failed && (s.suite === 'belt' || s.suite === 'paths' || s.suite === 'shell'));
  return result(id, 'selftest', protective, protective ? 'fail' : 'warn', m('doc.selftest.failed', { failed, total: passed + failed }), {
    details: f.selftest.flatMap((s) =>
      s.failures.slice(0, 3).map((x) => m('doc.selftest.failure', { suite: s.suite, name: x.name, expected: x.expected, actual: x.actual })),
    ),
    hint: m('doc.reportHint'),
  });
};

// ── full autonomy ──

/** Off: said once. On: the start checks measurable here; each failure names its fix (docs/autonomy.md). */
const installAutonomy: Check = (f) => {
  const id = 'install.autonomy';
  if (!f.autonomy.enabled) return result(id, 'install', false, 'info', m('doc.autonomy.off'));
  const failed = f.autonomy.checks.filter((c) => c.ok === false);
  if (!failed.length) return result(id, 'install', false, 'ok', m('doc.autonomy.ready'));
  return result(id, 'install', false, 'warn', m('doc.autonomy.notReady', { n: failed.length }), {
    details: failed.map((c) => m(c.key, c.params)),
  });
};

/** Every check, in the order the report shows them. */
export const CHECKS: readonly Check[] = [
  nodeVersion,
  nodeHooks,
  nodeSqlite,
  claudeVersion,
  claudeInstalls,
  claudeSettings,
  claudeHooksOn,
  claudePlugin,
  installManifest,
  installHookProgram,
  installHooks,
  installPluginFiles,
  installModSeen,
  installAutonomy,
  protectAgreement,
  protectLinks,
  protectShortNames,
  protectMemory,
  shellGitBash,
  shellPowerShell,
  shellPosix,
  shellTerminal,
  shellLocale,
  filesData,
  filesSpace,
  filesCase,
  filesLeftovers,
  filesPermissions,
  gitFound,
  gitProjects,
  dataConfig,
  dataIndex,
  dataQuota,
  dataMemoryStore,
  dataTranscripts,
  dataToolNames,
  dataSessionIds,
  selftestSuites,
];

/** Runs every check on the facts. A check that throws is reported as failed, never skipped silently. */
export function runChecks(f: Facts): CheckResult[] {
  return CHECKS.map((c, i) => {
    try {
      return c(f);
    } catch (err) {
      return result(`check.${i}`, 'selftest', false, 'fail', m('doc.checkCrashed', { error: (err as Error)?.message ?? String(err) }), {
        hint: m('doc.reportHint'),
      });
    }
  });
}

export interface Tally {
  ok: number;
  info: number;
  warn: number;
  fail: number;
  skip: number;
  /** Failures of protections. */
  protectionFail: number;
}

export function tally(results: readonly CheckResult[]): Tally {
  const t: Tally = { ok: 0, info: 0, warn: 0, fail: 0, skip: 0, protectionFail: 0 };
  for (const r of results) {
    t[r.status]++;
    if (r.status === 'fail' && r.protection) t.protectionFail++;
  }
  return t;
}
