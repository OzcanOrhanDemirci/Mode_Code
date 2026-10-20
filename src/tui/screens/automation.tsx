// SPDX-License-Identifier: Apache-2.0
/** Working › Parallel agents (docs/agents.md): turning the parallel agent mode on, and the sessions at work here. */
import { Box, Text } from 'ink';
import { AGENTS_ICON } from '../../core/agents.js';
import { ago } from '../../core/format.js';
import type { MessageKey } from '../../core/i18n/index.js';
import type { ScreenProps } from '../nav.js';
import { Muted, Section, useEnv, useT } from '../ui.js';
import { fieldsOf, SettingsEditor } from '../widgets.js';

/**
 * Parallel agents (docs/agents.md): whether the mode can be set in a session, and whether Claude Code's read-only
 * helpers stay free; what each of the strip's three settings does, as the strip shows it; the Claude Code sessions
 * running on this computer, each one's own agents beside the others' work.
 */
export function ParallelAgents({ width, open }: ScreenProps) {
  const { data, lang, now, theme } = useEnv();
  const t = useT();
  const sessions = data.claudeSessions();
  const fields = fieldsOf(data.config(), ['agents.enabled', 'agents.helpers']);
  return (
    <Box flexDirection="column" width={width}>
      <SettingsEditor fields={fields} open={open} width={width} />
      <Section title={t('set.agents.modes')}>
        {(['off', 'free', 'assigned'] as const).map((m) => (
          <Box key={m}>
            <Box width={14} flexShrink={0}>
              <Text>{`${AGENTS_ICON} ${t('ctl.strip.agents')}${m === 'off' ? '' : m === 'free' ? ' ≤N' : ' =N'}`}</Text>
            </Box>
            <Text wrap="wrap">{t(`set.agents.mode.${m}` as MessageKey)}</Text>
          </Box>
        ))}
      </Section>
      <Muted wrap="wrap">{t('set.agents.note')}</Muted>
      <Section title={t('set.agents.sessions')}>
        {sessions === null ? (
          <Muted wrap="wrap">{t('set.agents.sessionsUnread')}</Muted>
        ) : !sessions.length ? (
          <Muted>{t('set.agents.sessionsNone')}</Muted>
        ) : (
          sessions.map((s, i) => (
            <Box key={s.sessionId ?? i}>
              <Box width={2} flexShrink={0}>
                <Text color={s.status === 'busy' ? theme.accent : theme.muted}>{s.status === 'busy' ? '●' : '○'}</Text>
              </Box>
              <Text wrap="truncate-end">
                {s.name} <Muted>· {[s.kind, s.status, s.startedAt ? ago(s.startedAt, now, lang) : null, s.cwd].filter(Boolean).join(' · ')}</Muted>
              </Text>
            </Box>
          ))
        )}
      </Section>
    </Box>
  );
}
