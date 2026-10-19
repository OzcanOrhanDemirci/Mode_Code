// SPDX-License-Identifier: Apache-2.0
/**
 * Claude Code: a read-only map of the person's setup, with explanations. Changes are made with Claude
 * Code's own commands (/permissions, /mcp, /plugin, /memory); each screen names the one to use.
 */
import { Box, Text } from 'ink';
import { homedir } from 'node:os';
import { compact, percent, shortPath } from '../../core/format.js';
import type { MessageKey } from '../../core/i18n/index.js';
import type { ScreenProps } from '../nav.js';
import { Empty, Gauge, Muted, Note, Section, useEnv, useT } from '../ui.js';
import { useState } from 'react';
import { PACKS } from '../../core/packs.js';
import { CORE_SKILLS } from '../../core/skills.js';
import { EXTERNAL_SKILLS } from '../../core/skills-external.js';
import { findProgram } from '../../node/packs.js';
import { SettingsEditor, type Field } from '../widgets.js';

function Cmd({ children }: { children: string }) {
  const { theme } = useEnv();
  return <Text color={theme.accent}>{children}</Text>;
}

export function Instructions({ width }: ScreenProps) {
  const { data, lang, theme } = useEnv();
  const t = useT();
  const env = data.claude();
  const mem = env.instructions.find((i) => i.kind === 'memory-index');
  return (
    <Box flexDirection="column" width={width}>
      <Section>
        {env.instructions.map((i) => (
          <Box key={i.path}>
            <Box width={20} flexShrink={0}>
              <Text color={i.exists ? undefined : theme.muted}>{t(`instr.${i.kind}` as MessageKey)}</Text>
            </Box>
            <Box width={12} flexShrink={0}>
              <Text color={theme.muted}>{i.exists ? `${compact(i.bytes, lang)}B` : t('instr.none')}</Text>
            </Box>
            <Text color={theme.muted} wrap="truncate-middle">
              {shortPath(i.path, homedir(), Math.max(20, width - 34))}
            </Text>
          </Box>
        ))}
      </Section>
      {mem && mem.exists && mem.limit ? (
        <Section title={t('instr.memoryLimit')}>
          <Gauge
            label={t('instr.lines')}
            pct={(mem.lines / mem.limit.lines) * 100}
            width={Math.min(30, width - 40)}
            right={`${mem.lines} / ${mem.limit.lines}`}
          />
          <Gauge
            label={t('instr.size')}
            pct={(mem.bytes / mem.limit.bytes) * 100}
            width={Math.min(30, width - 40)}
            right={`${compact(mem.bytes, lang)}B / ${compact(mem.limit.bytes, lang)}B`}
          />
          {mem.lines > mem.limit.lines || mem.bytes > mem.limit.bytes ? (
            <Note kind="bad">{t('instr.over')}</Note>
          ) : (
            <Muted>{t('instr.under', { pct: percent(Math.max(mem.lines / mem.limit.lines, mem.bytes / mem.limit.bytes) * 100, lang) })}</Muted>
          )}
        </Section>
      ) : null}
      <Muted>{t('instr.explain', { dir: shortPath(env.memoryDir, homedir(), 60) })}</Muted>
      <Box marginTop={1}>
        <Text color={theme.muted}>
          {t('instr.edit')} <Cmd>/memory</Cmd>
        </Text>
      </Box>
    </Box>
  );
}

export function SettingsSources({ width }: ScreenProps) {
  const { data, theme } = useEnv();
  const t = useT();
  const env = data.claude();
  return (
    <Box flexDirection="column" width={width}>
      <Muted>{t('ccset.intro')}</Muted>
      <Box marginTop={1} flexDirection="column">
        {env.settings.map((s) => (
          <Box key={s.scope + s.path} flexDirection="column" marginBottom={1}>
            <Box>
              <Box width={12} flexShrink={0}>
                <Text bold>{t(`scope.${s.scope}` as MessageKey)}</Text>
              </Box>
              <Text color={s.exists ? undefined : theme.muted} wrap="truncate-middle">
                {shortPath(s.path, homedir(), Math.max(20, width - 14))}
              </Text>
            </Box>
            <Box marginLeft={12}>
              {s.error ? (
                <Text color={theme.bad}>{t('ccset.invalid', { error: s.error })}</Text>
              ) : s.json ? (
                <Muted wrap="truncate-end">{Object.keys(s.json).join(', ') || t('ccset.empty')}</Muted>
              ) : (
                <Muted>{t('ccset.missing')}</Muted>
              )}
            </Box>
          </Box>
        ))}
      </Box>
      {env.hooksDisabledBy.length ? <Note kind="bad">{t('health.belt.disabledAll', { scope: env.hooksDisabledBy.join(', ') })}</Note> : null}
      <Muted>{t('ccset.order')}</Muted>
    </Box>
  );
}

export function Hooks({ width, height }: ScreenProps) {
  const { data, theme } = useEnv();
  const t = useT();
  const env = data.claude();
  if (!env.hooks.length) return <Empty>{t('hooks.none')}</Empty>;
  const byEvent = new Map<string, typeof env.hooks>();
  for (const h of env.hooks) byEvent.set(h.event, [...(byEvent.get(h.event) ?? []), h]);
  let budget = Math.max(6, height - 4);
  return (
    <Box flexDirection="column" width={width}>
      {[...byEvent.entries()].map(([event, list]) => {
        if (budget <= 0) return null;
        budget -= 1 + list.length;
        return (
          <Box key={event} flexDirection="column" marginBottom={1}>
            <Text bold>
              {event} <Text color={theme.muted}>({list.length})</Text>
            </Text>
            {list.map((h, i) => (
              <Text key={i} wrap="truncate-end" color={h.ours ? theme.accent : undefined}>
                {'  '}
                {h.ours ? theme.sym.shield + ' ' : ''}[{t(`scope.${h.scope}` as MessageKey)}] {h.matcher ? `${h.matcher}: ` : ''}
                {shortPath([h.command, ...h.args].join(' '), homedir(), Math.max(20, width - 30))}
                {h.onFailure === 'block' ? <Text color={theme.muted}> · onFailure: block</Text> : null}
              </Text>
            ))}
          </Box>
        );
      })}
      <Muted>{t('hooks.explain')}</Muted>
    </Box>
  );
}

export function Permissions({ width }: ScreenProps) {
  const { data, theme } = useEnv();
  const t = useT();
  const env = data.claude();
  if (!env.permissions.length) return <Empty>{t('perm.none')}</Empty>;
  return (
    <Box flexDirection="column" width={width}>
      {(['deny', 'ask', 'allow'] as const).map((kind) => {
        const list = env.permissions.filter((p) => p.kind === kind);
        if (!list.length) return null;
        return (
          <Box key={kind} flexDirection="column" marginBottom={1}>
            <Text bold color={kind === 'deny' ? theme.bad : kind === 'ask' ? theme.warn : theme.ok}>
              {t(`perm.${kind}` as MessageKey)} ({list.length})
            </Text>
            {list.slice(0, 40).map((p, i) => (
              <Text key={i} wrap="truncate-end">
                {'  '}
                <Text color={theme.muted}>[{t(`scope.${p.scope}` as MessageKey)}]</Text> {p.rule}
              </Text>
            ))}
          </Box>
        );
      })}
      <Muted>{t('perm.explain')}</Muted>
      <Text color={theme.muted}>
        {t('perm.edit')} <Cmd>/permissions</Cmd>
      </Text>
    </Box>
  );
}

export function Mcp({ width }: ScreenProps) {
  const { data, theme } = useEnv();
  const t = useT();
  const env = data.claude();
  return (
    <Box flexDirection="column" width={width}>
      {env.mcp.length ? (
        env.mcp.map((m) => (
          <Box key={m.scope + m.name}>
            <Box width={24} flexShrink={0}>
              <Text bold>{m.name}</Text>
            </Box>
            <Box width={12} flexShrink={0}>
              <Text color={theme.muted}>{t(`scope.${m.scope}` as MessageKey)}</Text>
            </Box>
            <Text color={theme.muted} wrap="truncate-end">
              {m.transport} · {m.target}
            </Text>
          </Box>
        ))
      ) : (
        <Muted>{t('mcp.none')}</Muted>
      )}
      <Box marginTop={1}>
        <Muted>{t('mcp.explain')}</Muted>
      </Box>
      <Text color={theme.muted}>
        {t('mcp.edit')} <Cmd>/mcp</Cmd>
      </Text>
    </Box>
  );
}

export function Plugins({ width, open }: ScreenProps) {
  const { data, theme } = useEnv();
  const t = useT();
  if (!open) return <Muted>{t('plugins.openToLoad')}</Muted>;
  const list = data.plugins();
  return (
    <Box flexDirection="column" width={width}>
      {list === null ? (
        <Note kind="warn">{t('plugins.failed')}</Note>
      ) : list.length ? (
        list.map((p) => (
          <Box key={p.id}>
            <Box width={40} flexShrink={0}>
              <Text bold color={p.enabled === false ? theme.muted : undefined}>
                {p.id}
              </Text>
            </Box>
            <Text color={theme.muted}>
              {p.version ?? ''} {p.scope ? `· ${p.scope}` : ''} {p.enabled === false ? `· ${t('set.off')}` : ''}
            </Text>
          </Box>
        ))
      ) : (
        <Muted>{t('plugins.none')}</Muted>
      )}
      <Box marginTop={1}>
        <Text color={theme.muted}>
          {t('plugins.edit')} <Cmd>/plugin</Cmd>
        </Text>
      </Box>
    </Box>
  );
}

/** Tool packs (docs/packs.md): Automatic use, and each pack's mode; which are on is per project (`mode-code packs`). */
export function Packs({ width, open }: ScreenProps) {
  const { data } = useEnv();
  const t = useT();
  const c = data.config();
  // Which programs are on this computer: looked up once as the page opens.
  const [missing] = useState(() => new Map(PACKS.map((p) => [p.id, p.tools.map((x) => x.program).filter((x) => findProgram(x) === null)])));
  const modes = (['auto', 'always', 'me', 'never'] as const).map((value) => ({ value, label: t(`packs.mode.${value}` as MessageKey) }));
  const fields: Field[] = [
    {
      path: 'packs.autoUse',
      label: t('packs.autoUse'),
      help: t('packs.autoUseHelp'),
      value: c.packs.autoUse,
      type: { kind: 'bool' },
      confirmOn: { value: true, text: t('packs.autoConfirm') },
    },
    ...PACKS.map((p): Field => ({
      path: `packs.items.${p.id}`,
      label: p.name,
      help: [
        p.summary,
        t('packs.itemTokens', { n: p.tokens }),
        missing.get(p.id)?.length ? t('packs.itemMissing', { programs: missing.get(p.id)!.join(', '), pack: p.id }) : '',
      ]
        .filter(Boolean)
        .join(' '),
      value: c.packs.items[p.id] ?? 'auto',
      type: { kind: 'enum', options: modes },
      confirmOn: { value: 'always', text: t('packs.alwaysConfirm') },
    })),
  ];
  return (
    <Box flexDirection="column" width={width}>
      <SettingsEditor fields={fields} open={open} width={width} />
      <Box marginTop={1}>
        <Muted>{t('packs.whereOn')}</Muted>
      </Box>
    </Box>
  );
}

/** Commands and skills (docs/skills.md): Mode_Code's own, and the skills of others, each off until turned on here. */
export function Skills({ width, open }: ScreenProps) {
  const { data } = useEnv();
  const t = useT();
  const c = data.config();
  const states = (['off', 'me', 'on'] as const).map((value) => ({ value, label: t(`skills.state.${value}` as MessageKey) }));
  const fields: Field[] = Object.entries(EXTERNAL_SKILLS).map(([id, s]) => ({
    path: `skills.items.${id}`,
    label: id,
    help: `${t(`skills.about.${id}` as MessageKey)} (${s.repo}, ${s.license}; ${t('skills.suggested', { state: t(`skills.state.${s.suggested}` as MessageKey) })})`,
    value: c.skills.items[id] ?? 'off',
    type: { kind: 'enum', options: states },
    confirmOn: { value: 'on', text: t('skills.onConfirm') },
  }));
  const own = CORE_SKILLS.filter((s) => s.kind === 'skill').map((s) => s.id);
  return (
    <Box flexDirection="column" width={width}>
      <Muted>{t('skills.own', { n: CORE_SKILLS.length, skills: own.join(', ') })}</Muted>
      <Box marginTop={1}>
        <SettingsEditor fields={fields} open={open} width={width} />
      </Box>
    </Box>
  );
}

export function Extensions({ width }: ScreenProps) {
  const { data, theme } = useEnv();
  const t = useT();
  const env = data.claude();
  const group = (title: MessageKey, list: { scope: string; name: string }[]) => (
    <Section title={`${t(title)} (${list.length})`}>
      {list.length ? (
        <Text wrap="wrap">
          {list.map((x, i) => (
            <Text key={x.scope + x.name}>
              {i ? ', ' : ''}
              {x.name}
              {x.scope === 'project' ? <Text color={theme.muted}> ({t('scope.project')})</Text> : null}
            </Text>
          ))}
        </Text>
      ) : (
        <Muted>{t('ext.none')}</Muted>
      )}
    </Section>
  );
  return (
    <Box flexDirection="column" width={width}>
      {group('ext.skills', env.skills)}
      {group('ext.agents', env.agents)}
      {group('ext.commands', env.commands)}
      <Muted>{t('ext.explain')}</Muted>
    </Box>
  );
}
