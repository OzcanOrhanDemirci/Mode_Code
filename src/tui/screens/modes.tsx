// SPDX-License-Identifier: Apache-2.0
/**
 * Working › Modes and ways of working (docs/modes.md): what each mode lets Claude change, how each way of working
 * goes on, and the key that picks it on the session's strip. Picking is the strip's (only the person picks, inside the
 * session); this page says what each one does, and holds the two features they need.
 */
import { Box, Text } from 'ink';
import { commandOf, type ControlAction } from '../../core/controls.js';
import { controlText, type ControlId } from '../../core/ux/catalog.js';
import { wrapText } from '../../core/ux/text.js';
import { MODE_ICON, type WorkMode } from '../../core/modes.js';
import type { MessageKey } from '../../core/i18n/index.js';
import { textWidth } from '../../node/width.js';
import type { ScreenProps } from '../nav.js';
import { Muted, Section, useEnv, useT } from '../ui.js';
import { fieldsOf, SettingsEditor } from '../widgets.js';

const MODES: readonly WorkMode[] = ['chat', 'research', 'plan', 'code', 'free'];

export function Modes({ width, open }: ScreenProps) {
  const { data, theme, lang } = useEnv();
  const t = useT();
  const modes = MODES.map((m) => ({
    id: `mode.${m}` as ControlId,
    name: `${MODE_ICON[m] ? `${MODE_ICON[m]} ` : ''}${t(`mode.name.${m}` as MessageKey)}`,
    action: { kind: 'mode', mode: m } as ControlAction,
  }));
  const ways = [
    { id: 'style.manual' as ControlId, name: t('kw.kind.manualStyle'), action: { kind: 'style', style: 'manual' } as ControlAction },
    { id: 'style.autonomous' as ControlId, name: t('kw.kind.autonomous'), action: { kind: 'style', style: 'autonomous' } as ControlAction },
    { id: 'style.full' as ControlId, name: t('kw.kind.fullAuto'), action: { kind: 'style', style: 'full' } as ControlAction },
    { id: 'flow' as ControlId, name: t('page.flows'), action: { kind: 'flow' } as ControlAction },
  ];
  const labelW = Math.min(18, Math.max(...[...modes, ...ways].map((r) => textWidth(r.name))) + 2);
  // The keys are numbers, in a column of their own on the right.
  const keyOf = (r: { action: ControlAction }) => `/${commandOf(r.action, lang)}`;
  const keyW = 4;
  const textW = Math.max(12, width - labelW - keyW);
  // A row of information, not a control: the name, what a press on the strip does, and the strip's key (on the right).
  const row = (r: { id: ControlId; name: string; action: ControlAction }) => {
    const lines = wrapText(controlText(r.id, 'press', lang), textW - 1, textWidth);
    return (
      <Box key={r.id} width={width}>
        <Box width={labelW} flexShrink={0}>
          <Text bold wrap="truncate-end">
            {r.name}
          </Text>
        </Box>
        <Box width={textW} flexShrink={0} flexDirection="column">
          {lines.map((l, i) => (
            <Text key={i}>{l}</Text>
          ))}
        </Box>
        <Box width={keyW} flexShrink={0} justifyContent="flex-end">
          <Text color={theme.accent}>{keyOf(r)}</Text>
        </Box>
      </Box>
    );
  };
  // The two switches first: what Enter changes is where the focus is, in view, before the tables that only inform.
  return (
    <Box flexDirection="column" width={width}>
      <Muted>{t('modes.page.pick')}</Muted>
      <Box marginTop={1} marginBottom={1} flexDirection="column">
        <SettingsEditor fields={fieldsOf(data.config(), ['modules.modes', 'modules.keywords'])} open={open} width={width} />
      </Box>
      <Section title={t('modes.page.modes')}>{modes.map(row)}</Section>
      <Section title={t('modes.page.ways')}>{ways.map(row)}</Section>
    </Box>
  );
}
