// SPDX-License-Identifier: Apache-2.0
/** Settings: only the tool's own settings. Every change is saved at once; lowering a protection asks first. */
import { useState } from 'react';
import { Box, Text } from 'ink';
import { homedir } from 'node:os';
import { APP_NAME, APP_VERSION, CLI_NAME, NAME_IS_FINAL, REPO_URL } from '../../core/app.js';
import { LANGUAGES, type MessageKey } from '../../core/i18n/index.js';
import { keywordTables } from '../../core/settings-view.js';
import { ago, shortPath } from '../../core/format.js';
import { KEYWORD_LISTS } from '../../core/keywords.js';
import { nextOf } from '../../core/handoff.js';
import type { ScreenProps } from '../nav.js';
import { Muted, Note, Row, Section, StateMark, useEnv, useScreenKeys, useT } from '../ui.js';
import { SettingsEditor, TextField, type Field } from '../widgets.js';

export function General({ width, open }: ScreenProps) {
  const { data } = useEnv();
  const t = useT();
  const c = data.config();
  const fields: Field[] = [
    {
      path: 'language',
      label: t('set.language'),
      help: t('set.languageHelp'),
      value: c.language,
      type: { kind: 'enum', options: [{ value: 'auto', label: t('set.auto') }, ...Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }))] },
    },
    {
      path: 'view',
      label: t('set.view'),
      help: t('set.viewHelp'),
      value: c.view,
      type: {
        kind: 'enum',
        options: [
          { value: 'simple', label: t('view.simple') },
          { value: 'recommended', label: t('view.recommended') },
          { value: 'detailed', label: t('view.detailed') },
        ],
      },
    },
  ];
  return <SettingsEditor fields={fields} open={open} width={width} />;
}

export function Modules({ width, open }: ScreenProps) {
  const { data } = useEnv();
  const t = useT();
  const m = data.config().modules;
  const b = (key: keyof typeof m, protective = false): Field => ({
    path: `modules.${key}`,
    label: t(`mod.${key}` as MessageKey),
    help: t(`mod.${key}.help` as MessageKey),
    value: m[key],
    type: { kind: 'bool' },
    protective,
  });
  return (
    <Box flexDirection="column" width={width}>
      <SettingsEditor
        fields={[b('keywords'), b('footer'), b('quota', true), b('secrets', true), b('status'), b('notifications'), b('quietWork')]}
        open={open}
        width={width}
      />
      <Box marginTop={1}>
        <Muted>{t('mod.beltNote')}</Muted>
      </Box>
    </Box>
  );
}

export function FooterAndQuota({ width, open }: ScreenProps) {
  const { data } = useEnv();
  const t = useT();
  const c = data.config();
  const n = (path: string, label: MessageKey, help: MessageKey, value: number, protective = false): Field => ({
    path,
    label: t(label),
    help: t(help),
    value,
    type: { kind: 'number', min: 0, max: 100 },
    protective,
  });
  const fields: Field[] = [
    {
      path: 'footer.mode',
      label: t('set.footerMode'),
      help: t('set.footerModeHelp'),
      value: c.footer.mode,
      type: {
        kind: 'enum',
        options: [
          { value: 'draw', label: t('footer.mode.draw') },
          { value: 'check', label: t('footer.mode.check') },
          { value: 'off', label: t('footer.mode.off') },
        ],
      },
    },
    n('footer.showFiveFrom', 'set.showFiveFrom', 'set.showFromHelp', c.footer.showFiveFrom),
    n('footer.showWeekFrom', 'set.showWeekFrom', 'set.showFromHelp', c.footer.showWeekFrom),
    n('quota.fiveHourWrapUp', 'set.fiveWrap', 'set.fiveWrapHelp', c.quota.fiveHourWrapUp),
    n('quota.fiveHourStop', 'set.fiveStop', 'set.fiveStopHelp', c.quota.fiveHourStop),
    n('quota.defaultWeeklyTarget', 'set.weekTarget', 'set.weekTargetHelp', c.quota.defaultWeeklyTarget),
    { path: 'quota.autoResume', label: t('set.autoResume'), help: t('set.autoResumeHelp'), value: c.quota.autoResume, type: { kind: 'bool' } },
  ];
  return <SettingsEditor fields={fields} open={open} width={width} />;
}

export function Accessibility({ width, open }: ScreenProps) {
  const { data } = useEnv();
  const t = useT();
  const a = data.config().accessibility;
  const b = (key: keyof typeof a): Field => ({
    path: `accessibility.${key}`,
    label: t(`a11y.${key}` as MessageKey),
    help: t(`a11y.${key}.help` as MessageKey),
    value: a[key],
    type: { kind: 'bool' },
  });
  return <SettingsEditor fields={[b('plain'), b('highContrast'), b('reduceMotion')]} open={open} width={width} />;
}

/** A list of strings edited in place: a adds (typed), x removes the selected one (asks first). */
function StringList({
  items,
  open,
  width,
  addLabel,
  onAdd,
  onRemove,
  render,
  emptyText,
}: {
  items: string[];
  open: boolean;
  width: number;
  addLabel: string;
  onAdd(v: string): void;
  onRemove(i: number): void;
  render?(s: string): string;
  emptyText: string;
}) {
  const { theme } = useEnv();
  const t = useT();
  const [sel, setSel] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useScreenKeys(
    (input, key) => {
      if (adding !== null) return false;
      if (key.upArrow || input === 'k') {
        setSel((s) => Math.max(0, s - 1));
        setConfirmRemove(false);
        return true;
      }
      if (key.downArrow || input === 'j') {
        setSel((s) => Math.min(items.length - 1, s + 1));
        setConfirmRemove(false);
        return true;
      }
      if (input === 'a') {
        setAdding('');
        return true;
      }
      if (input === 'x' && items.length) {
        if (!confirmRemove) setConfirmRemove(true);
        else {
          onRemove(Math.min(sel, items.length - 1));
          setConfirmRemove(false);
          setSel((s) => Math.max(0, s - 1));
        }
        return true;
      }
      if (key.escape && confirmRemove) {
        setConfirmRemove(false);
        return true;
      }
      return false;
    },
    open && adding === null,
  );
  return (
    <Box flexDirection="column" width={width}>
      {items.length ? (
        items.map((s, i) => (
          <Text key={s + i} inverse={open && i === sel} wrap="truncate-end">
            {open && i === sel ? theme.sym.cursor : ' '} {render ? render(s) : s}
          </Text>
        ))
      ) : (
        <Muted>{emptyText}</Muted>
      )}
      {confirmRemove ? <Note kind="warn">{t('list.confirmRemove')}</Note> : null}
      {adding !== null ? (
        <Box marginTop={1}>
          <TextField
            label={addLabel}
            value={adding}
            onChange={setAdding}
            onSubmit={(v) => {
              if (v.trim()) onAdd(v.trim());
              setAdding(null);
            }}
            onCancel={() => setAdding(null)}
            active={open}
          />
        </Box>
      ) : open ? (
        <Box marginTop={1}>
          <Muted>{t('list.hint')}</Muted>
        </Box>
      ) : null}
    </Box>
  );
}

/** Where the memory lives (docs/memory.md): its place, whether Claude Code uses it, its sync; "s" opens the setup. */
export function MemoryStore({ width, open }: ScreenProps) {
  const { data, flash, theme, leave, lang, now } = useEnv();
  const t = useT();
  const v = data.memory();
  useScreenKeys((input) => {
    if (input !== 's') return false;
    if (leave) leave('memory-setup', 'settings/memory/store');
    else flash(t('mem.setupCli'), 'warn');
    return true;
  }, open);
  const s = v.store;
  const last = v.last;
  return (
    <Box flexDirection="column" width={width}>
      <Muted>{t('mem.intro')}</Muted>
      <Box marginTop={1} flexDirection="column">
        <Row label={t('mem.place')}>{s ? t(`msetup.place.${s.place}` as MessageKey) : t('mem.notSetUp')}</Row>
        {s ? <Row label={t('mcli.folder')}>{shortPath(s.dir, homedir(), width - 24)}</Row> : null}
        {s && (s.repo || s.remote) ? <Row label="GitHub">{s.repo ?? s.remote ?? ''}</Row> : null}
        <Row label={t('mcli.claude')} {...(s ? { color: v.inUse ? theme.ok : theme.bad } : {})}>
          {s
            ? v.inUse
              ? `✓ ${t('mcli.inUse')}`
              : `✗ ${t('mcli.notInUse', { dir: v.setting ? shortPath(v.setting, homedir(), 40) : t('mcli.perProject') })}`
            : v.setting
              ? shortPath(v.setting, homedir(), width - 24)
              : t('mcli.perProject')}
        </Row>
        {s && v.local ? (
          <Row label={t('mcli.local')}>
            {[
              v.local.isRepo ? t('mcli.local.repo') : t('mcli.local.noRepo'),
              v.local.dirty ? t('mcli.local.dirty', { n: v.local.dirty }) : '',
              v.local.ahead ? t('mcli.local.ahead', { n: v.local.ahead }) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Row>
        ) : null}
        {s ? (
          <Row label={t('mcli.sync')}>
            {t(`mcli.sync.${s.sync}` as MessageKey)}
            {last
              ? ` · ${ago(last.at, now, lang)}: ${t(`mem.last.${last.result.pull === 'conflict' ? 'conflict' : last.result.pull === 'diverged' ? 'diverged' : last.result.held.length ? 'held' : 'ok'}` as MessageKey)}`
              : ''}
          </Row>
        ) : null}
        {v.handoff ? <Row label={t('mcli.handoff')}>{`${ago(v.handoff.note.at, now, lang)} · ${nextOf(v.handoff.note, width - 40)}`}</Row> : null}
        {v.pendingNotes ? (
          <Row label={t('mcli.notes')} color={theme.warn}>
            {t('mcli.notes.pending', { n: v.pendingNotes, cmd: `${CLI_NAME} memory notes` })}
          </Row>
        ) : null}
      </Box>
      <Box marginTop={1}>
        <Note kind={s ? 'info' : 'warn'}>{t(s ? 'mem.changeKey' : 'mem.setupKey')}</Note>
      </Box>
    </Box>
  );
}

/** Sync across computers (docs/sync.md): where it lives, the computers, the last sync, what waits; "s" opens the setup. */
export function Sync({ width, open }: ScreenProps) {
  const { data, flash, theme, leave, lang, now } = useEnv();
  const t = useT();
  const v = data.sync();
  useScreenKeys((input) => {
    if (input !== 's') return false;
    if (leave) leave('sync-setup', 'settings/sync');
    else flash(t('sync.setupCli'), 'warn');
    return true;
  }, open);
  const s = v.setting;
  const names = new Map(v.machines.map((m) => [m.id, m.name]));
  return (
    <Box flexDirection="column" width={width}>
      <Muted wrap="wrap">{t('sync.intro')}</Muted>
      <Box marginTop={1} flexDirection="column">
        <Row label={t('scli.where')}>{s ? `${t(`scli.place.${s.place}` as MessageKey)}${s.repo ? ` · ${s.repo}` : ''}` : t('scli.title.none')}</Row>
        {s ? (
          <Row label={t('mcli.folder')} {...(v.exists ? {} : { color: theme.bad })}>
            {shortPath(s.dir, homedir(), width - 24)}
          </Row>
        ) : null}
        {s ? <Row label={t('scli.this')}>{`${s.machine.name} (${s.machine.id})`}</Row> : null}
        {s
          ? v.machines
              .filter((m) => !m.self)
              .map((m, i) => (
                <Row key={m.id} label={i === 0 ? t('scli.others') : ''}>
                  {`${m.name}${m.platform ? ` · ${m.platform}` : ''} · ${m.lastSeen ? t('scli.seen', { when: ago(m.lastSeen, now, lang) }) : t('scli.seen.never')}`}
                </Row>
              ))
          : null}
        {s ? <Row label={t('scli.last')}>{v.last ? ago(v.last.at, now, lang) : t('scli.last.none')}</Row> : null}
        {v.pending.map((p, i) => (
          <Row key={p.key} label={i === 0 ? t('scli.pending') : ''} color={theme.warn}>
            {t('scli.pending.line', { key: p.key, machine: names.get(p.machine) ?? p.machine, when: ago(p.at, now, lang) })}
          </Row>
        ))}
        {v.pending.length ? (
          <Row label="">{t('scli.pending.hint', { approve: `${CLI_NAME} sync approve <setting>`, ignore: `${CLI_NAME} sync ignore <setting>` })}</Row>
        ) : null}
        {v.applied.length ? <Row label={t('scli.applied')}>{t('scli.applied.text', { n: v.applied.length })}</Row> : null}
        {v.homeless.length ? (
          <Row label={t('scli.projects')}>{t('scli.projects.text', { ids: v.homeless.join(', '), cmd: `${CLI_NAME} sync project` })}</Row>
        ) : null}
        {s ? <Row label={t('scli.handoffs')}>{t(`scli.handoffs.${v.handoffs}` as MessageKey)}</Row> : null}
      </Box>
      <Box marginTop={1}>
        <Note kind={s ? 'info' : 'warn'}>{t(s ? 'sync.changeKey' : 'sync.setupKey')}</Note>
      </Box>
    </Box>
  );
}

/** Handoff notes and the morning report: when they are written and offered. */
export function MemoryHandoffs({ width, open }: ScreenProps) {
  const { data } = useEnv();
  const t = useT();
  const m = data.config().memory;
  const b = (path: string, label: MessageKey, help: MessageKey, value: boolean): Field => ({
    path,
    label: t(label),
    help: t(help),
    value,
    type: { kind: 'bool' },
  });
  const n = (path: string, label: MessageKey, help: MessageKey, value: number, min: number, max: number): Field => ({
    path,
    label: t(label),
    help: t(help),
    value,
    type: { kind: 'number', min, max },
  });
  const fields: Field[] = [
    b('memory.handoff.enabled', 'set.handoff.enabled', 'set.handoff.enabledHelp', m.handoff.enabled),
    b('memory.handoff.onCompact', 'set.handoff.onCompact', 'set.handoff.onCompactHelp', m.handoff.onCompact),
    b('memory.handoff.onEnd', 'set.handoff.onEnd', 'set.handoff.onEndHelp', m.handoff.onEnd),
    n('memory.handoff.keep', 'set.handoff.keep', 'set.handoff.keepHelp', m.handoff.keep, 1, 500),
    n('memory.handoff.maxAgeDays', 'set.handoff.maxAgeDays', 'set.handoff.maxAgeDaysHelp', m.handoff.maxAgeDays, 1, 365),
    b('memory.morning.enabled', 'set.morning.enabled', 'set.morning.enabledHelp', m.morning.enabled),
    n('memory.morning.afterHours', 'set.morning.afterHours', 'set.morning.afterHoursHelp', m.morning.afterHours, 1, 72),
  ];
  return <SettingsEditor fields={fields} open={open} width={width} />;
}

/** The folders the safety belt protects as memory (deletes refused, shrinking asked about). */
export function Memory({ width, open }: ScreenProps) {
  const { data, flash } = useEnv();
  const t = useT();
  const dirs = data.config().memory.dirs;
  const save = (next: string[]) => {
    const problems = data.setConfig('memory.dirs', next);
    flash(problems.length ? t('set.rejected', { detail: problems[0]!.detail }) : t('set.saved'), problems.length ? 'bad' : 'ok');
  };
  return (
    <Box flexDirection="column" width={width}>
      <Muted>{t('memory.intro')}</Muted>
      <Box marginTop={1}>
        <StringList
          items={dirs}
          open={open}
          width={width}
          addLabel={t('memory.addLabel')}
          onAdd={(v) => save([...dirs, v])}
          onRemove={(i) => save(dirs.filter((_, j) => j !== i))}
          render={(x) => shortPath(x, homedir(), width - 4)}
          emptyText={t('memory.none')}
        />
      </Box>
    </Box>
  );
}

/** Full autonomy: off until the person turns it on here (after reading what it means), its limits, the checks from here. */
export function Autonomy({ width, open }: ScreenProps) {
  const { data, theme } = useEnv();
  const t = useT();
  const a = data.config().autonomy;
  const fields: Field[] = [
    {
      path: 'autonomy.enabled',
      label: t('set.autonomy.enabled'),
      help: t('set.autonomy.enabledHelp'),
      value: a.enabled,
      type: { kind: 'bool' },
      confirmOn: { value: true, text: `${t('auto.cli.warnBody').replace(/\n/g, ' ')} ${t('set.autonomy.confirm')}` },
    },
    {
      path: 'autonomy.maxHours',
      label: t('set.autonomy.maxHours'),
      help: t('set.autonomy.maxHoursHelp'),
      value: a.maxHours,
      type: { kind: 'number', min: 1, max: 72 },
    },
    {
      path: 'autonomy.stallMinutes',
      label: t('set.autonomy.stallMinutes'),
      help: t('set.autonomy.stallMinutesHelp'),
      value: a.stallMinutes,
      type: { kind: 'number', min: 10, max: 720 },
    },
  ];
  const g = data.autonomyCheck();
  return (
    <Box flexDirection="column" width={width}>
      <SettingsEditor fields={fields} open={open} width={width} />
      <Section title={t('set.autonomy.check')}>
        {g.checks.map((c) => (
          <Box key={c.id}>
            <Box width={3} flexShrink={0}>
              <Text color={c.ok === true ? theme.ok : c.ok === false ? theme.bad : theme.muted}>{c.ok === true ? '✓' : c.ok === false ? '✗' : '·'}</Text>
            </Box>
            <Box width={20} flexShrink={0}>
              <Text>{t(`auto.gate.name.${c.id}` as MessageKey)}</Text>
            </Box>
            <Text wrap="truncate-end" {...(c.ok === null ? { color: theme.muted } : {})}>
              {t(c.key, c.params)}
            </Text>
          </Box>
        ))}
      </Section>
      <Muted wrap="wrap">{t('set.autonomy.note')}</Muted>
    </Box>
  );
}

export function Projects({ width, open }: ScreenProps) {
  const { data, flash } = useEnv();
  const t = useT();
  const list = data.config().projects;
  const save = (next: unknown[]) => {
    const problems = data.setConfig('projects', next);
    flash(problems.length ? t('set.rejected', { detail: problems[0]!.detail }) : t('set.saved'), problems.length ? 'bad' : 'ok');
  };
  return (
    <Box flexDirection="column" width={width}>
      <Muted>{t('projects.intro')}</Muted>
      <Box marginTop={1}>
        <StringList
          items={list.map((p) => `${p.id}: ${p.names.join(', ')}${p.path ? ` (${shortPath(p.path, homedir(), 40)})` : ''}`)}
          open={open}
          width={width}
          addLabel={t('projects.addLabel')}
          onAdd={(v) => {
            const m = /^([a-z0-9][a-z0-9-]{0,47})\s*:\s*([^|]+?)(?:\|\s*(.+))?$/.exec(v.trim());
            if (!m) {
              flash(t('projects.addFormat'), 'warn');
              return;
            }
            const names = m[2]!
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean);
            save([...list, { id: m[1], names, ...(m[3] ? { path: m[3].trim() } : {}) }]);
          }}
          onRemove={(i) => save(list.filter((_, j) => j !== i))}
          emptyText={t('projects.none')}
        />
      </Box>
    </Box>
  );
}

export function Keywords({ width }: ScreenProps) {
  const { data, theme, lang } = useEnv();
  const t = useT();
  const tables = keywordTables(data.config());
  const projects = data.config().projects;
  return (
    <Box flexDirection="column" width={width}>
      <Muted>{t('kw.intro')}</Muted>
      <Box marginTop={1} flexDirection="column">
        {KEYWORD_LISTS.map((k) => (
          <Box key={k}>
            <Box width={16} flexShrink={0}>
              <Text bold>{t(`kw.kind.${k}` as MessageKey)}</Text>
            </Box>
            <Box flexGrow={1}>
              <Text wrap="wrap">
                {(tables[lang]?.[k] ?? []).join(', ')}
                {lang !== 'en' ? <Text color={theme.muted}> · {(tables.en[k] ?? []).join(', ')}</Text> : null}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>{t('kw.examples')}</Text>
        <Muted>{projects.length ? t('kw.exampleProject', { name: projects[0]!.names[0] ?? projects[0]!.id }) : t('kw.exampleNoProject')}</Muted>
        <Muted>{t('kw.rules')}</Muted>
      </Box>
    </Box>
  );
}

export function Maintenance({ width }: ScreenProps) {
  const { data, lang, now, theme } = useEnv();
  const t = useT();
  const h = data.health();
  const m = h.manifest;
  const last = data.doctorSummary();
  return (
    <Box flexDirection="column" width={width}>
      <Section title={t('maint.lastCheck')}>
        {last ? (
          <>
            <Text>
              {t('maint.lastCheckLine', { when: ago(last.at, now, lang), ok: last.tally.ok, warn: last.tally.warn, fail: last.tally.fail })}
              {last.quick ? ` ${t('maint.lastCheckQuick')}` : ''}
            </Text>
            {last.problems.slice(0, 6).map((p) => (
              <Note key={p.id} kind={p.status === 'fail' ? 'bad' : 'warn'}>
                {t(p.summary.key, p.summary.params)}
              </Note>
            ))}
          </>
        ) : (
          <Muted>{t('maint.lastCheckNever')}</Muted>
        )}
      </Section>
      <Section>
        <Row label={t('maint.installed')}>
          {m ? t('maint.installedAt', { when: ago(m.installedAt, now, lang), version: m.version }) : t('health.notInstalled')}
        </Row>
        <Row label="Claude Code">{h.claude ?? t('cli.notFound')}</Row>
        <Row label="Node.js">{process.version}</Row>
        <Row label={t('cli.doctor.data')}>{shortPath(data.layout.root, homedir(), width - 24)}</Row>
        <Row label={t('maint.plugin')}>
          <StateMark state={h.features.find((f) => f.id === 'mod')?.state ?? 'absent'} />
        </Row>
        <Row label={t('maint.modSeen')}>{h.modSeen ? `${ago(h.modSeen.at, now, lang)} · ${h.modSeen.version}` : t('time.never')}</Row>
      </Section>
      <Section title={t('maint.commands')}>
        {(
          [
            ['doctor', 'maint.doctor'],
            ['doctor --fix', 'maint.doctorFix'],
            ['doctor --self-check', 'maint.selfCheck'],
            ['install', 'maint.install'],
            ['uninstall', 'maint.uninstall'],
            ['uninstall --purge', 'maint.purge'],
          ] as const
        ).map(([cmd, key]) => (
          <Box key={cmd}>
            <Box width={34} flexShrink={0}>
              <Text color={theme.accent}>
                {CLI_NAME} {cmd}
              </Text>
            </Box>
            <Muted>{t(key)}</Muted>
          </Box>
        ))}
      </Section>
      {data.configProblems().length ? (
        <Section title={t('maint.configProblems')}>
          {data.configProblems().map((p, i) => (
            <Note key={i} kind="warn">
              {p.path || '(file)'}: {p.detail}
            </Note>
          ))}
        </Section>
      ) : null}
      <Muted>{t('maint.runOutside')}</Muted>
    </Box>
  );
}

export function About({ width }: ScreenProps) {
  const { theme } = useEnv();
  const t = useT();
  return (
    <Box flexDirection="column" width={width}>
      <Text bold>
        {APP_NAME} {APP_VERSION}
      </Text>
      <Muted>{t('help.tagline')}</Muted>
      <Box marginTop={1} flexDirection="column">
        <Row label={t('about.license')}>Apache-2.0</Row>
        <Row label={t('about.source')}>{REPO_URL}</Row>
        <Row label={t('about.privacy')}>{t('about.privacyText')}</Row>
        {NAME_IS_FINAL ? null : <Row label={t('about.name')}>{t('about.nameText')}</Row>}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted} wrap="wrap">
          {t('about.claude')}
        </Text>
      </Box>
    </Box>
  );
}
