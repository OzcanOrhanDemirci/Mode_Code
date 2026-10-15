// SPDX-License-Identifier: Apache-2.0
/**
 * Automation › Bypass and Automation › Done without asking (docs/autonomy.md, "Bypass"): turning bypass on
 * for this computer, its time limit, and every call it let through, one by one, for the person to review.
 */
import { Box, Text } from 'ink';
import { ago } from '../../core/format.js';
import type { MessageKey } from '../../core/i18n/index.js';
import type { ToolEvent } from '../../app/data.js';
import type { ScreenProps } from '../nav.js';
import { Empty, Muted, Section, useEnv, useT } from '../ui.js';
import { SettingsEditor, type Field } from '../widgets.js';

export function Bypass({ width, open }: ScreenProps) {
  const { data } = useEnv();
  const t = useT();
  const b = data.config().bypass;
  const fields: Field[] = [
    {
      path: 'bypass.enabled',
      label: t('set.bypass.enabled'),
      help: t('set.bypass.enabledHelp'),
      value: b.enabled,
      type: { kind: 'bool' },
      confirmOn: { value: true, text: t('set.bypass.confirm') },
    },
    {
      path: 'bypass.maxHours',
      label: t('set.bypass.maxHours'),
      help: t('set.bypass.maxHoursHelp'),
      value: b.maxHours,
      type: { kind: 'number', min: 1, max: 24 },
    },
  ];
  return (
    <Box flexDirection="column" width={width}>
      <SettingsEditor fields={fields} open={open} width={width} />
      <Section title={t('set.bypass.tiers')}>
        {(['never', 'asked', 'always', 'through'] as const).map((tier) => (
          <Box key={tier}>
            <Box width={3} flexShrink={0}>
              <Text>{tier === 'never' ? '🔒' : tier === 'through' ? '⚡' : '?'}</Text>
            </Box>
            <Text wrap="wrap">{t(`set.bypass.tier.${tier}` as MessageKey)}</Text>
          </Box>
        ))}
      </Section>
      <Muted wrap="wrap">{t('set.bypass.note')}</Muted>
    </Box>
  );
}

/** One line of the list: a call bypass let through, or bypass going on or off. */
function line(e: ToolEvent, t: ReturnType<typeof useT>): { head: string; detail: string; tone: 'call' | 'on' | 'off' } {
  if (e.action === 'on') return { head: t('bypassed.on', { hours: e.hours ?? '?' }), detail: '', tone: 'on' };
  if (e.action === 'off')
    return {
      head: t('bypassed.off', { count: e.count ?? 0, minutes: e.minutes ?? 0, why: t(`bypassed.why.${e.why ?? 'person'}` as MessageKey) }),
      detail: '',
      tone: 'off',
    };
  const rules = (e.rules ?? []).map((r, i) => `${r} (${t(`verdict.${e.was?.[i] ?? 'ask'}` as MessageKey)})`).join(', ');
  const who = e.agent ? ` · ${t('bypassed.agent')}` : '';
  const outcome = e.outcome ? ` · ${t(`bypassed.outcome.${e.outcome}` as MessageKey)}` : '';
  return { head: `${e.tool ?? '?'}: ${e.what ?? ''}`, detail: `${rules}${who}${outcome}`, tone: 'call' };
}

export function Bypassed({ width, height }: ScreenProps) {
  const { data, lang, now, theme } = useEnv();
  const t = useT();
  const list = data.events(30).filter((e) => e.kind === 'bypass');
  if (!list.length) return <Empty>{t('bypassed.empty')}</Empty>;
  return (
    <Box flexDirection="column" width={width}>
      {list.slice(0, Math.max(4, Math.floor((height - 2) / 2))).map((e, i) => {
        const l = line(e, t);
        return (
          <Box key={i} flexDirection="column">
            <Box>
              <Box width={14} flexShrink={0}>
                <Text color={theme.muted}>{ago(e.at, now, lang)}</Text>
              </Box>
              <Text wrap="truncate-end" color={l.tone === 'call' ? undefined : theme.warn} bold={l.tone !== 'call'}>
                {l.tone === 'call' ? '' : '⚡ '}
                {l.head}
              </Text>
            </Box>
            {l.detail ? (
              <Box marginLeft={14}>
                <Muted wrap="truncate-end">{l.detail}</Muted>
              </Box>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}
