// SPDX-License-Identifier: Apache-2.0
/**
 * Working › Recent tasks and Parallel agents (docs/autonomy.md, docs/agents.md): the last tasks given full autonomy,
 * to copy one again; turning the parallel agent mode on.
 */
import { useState } from 'react';
import { Box, Text } from 'ink';
import { AGENTS_ICON } from '../../core/agents.js';
import { ago } from '../../core/format.js';
import type { MessageKey } from '../../core/i18n/index.js';
import type { ScreenProps } from '../nav.js';
import { EmptyState, Muted, Section, useEnv, useHints, useScreenKeys, useT } from '../ui.js';
import { Pressable } from '../press.js';
import { fieldsOf, SettingsEditor } from '../widgets.js';

/**
 * The last three tasks given full autonomy (the person, 2026-10-15: "so the prompt is not lost"): the one
 * picked whole, the others by their first line; Enter or c copies the whole task.
 */
export function RecentTasks({ width, open }: ScreenProps) {
  const { data, lang, now, theme, flash } = useEnv();
  const t = useT();
  const list = data.autoPrompts();
  const [sel, setSel] = useState(0);
  const at = Math.min(sel, Math.max(0, list.length - 1));
  const copy = (i = at) => {
    const p = list[i];
    if (!p) return;
    const r = data.copy(p.text);
    flash(t(r.via === 'system' ? 'prompts.copied' : 'prompts.copiedTerminal'), r.via === 'system' ? 'ok' : 'warn');
  };
  useScreenKeys((input, key) => {
    if (!list.length) return false;
    if (key.upArrow || input === 'k') {
      setSel(Math.max(0, at - 1));
      return true;
    }
    if (key.downArrow || input === 'j') {
      setSel(Math.min(list.length - 1, at + 1));
      return true;
    }
    if (key.return || input === 'c') {
      copy();
      return true;
    }
    return false;
  }, open);
  useHints([{ key: 'Enter/c', label: t('prompts.copy'), run: () => copy() }], open && list.length > 0);
  if (!list.length) return <EmptyState text={t('prompts.empty')} to="work/full-auto" open={open} />;
  // A click on a task picks it and copies it, as Enter does.
  return (
    <Box flexDirection="column" width={width}>
      {list.map((p, i) => (
        <Pressable
          key={`${p.at}-${i}`}
          flexDirection="column"
          marginTop={i ? 1 : 0}
          onPress={() => {
            setSel(i);
            copy(i);
          }}
          describe={t('prompts.copy')}
        >
          <Text bold={i === at} inverse={i === at && open} color={i === at ? undefined : theme.muted} wrap="truncate-end">
            {i === at ? theme.sym.cursor : ' '} {t('prompts.meta', { ago: ago(p.at, now, lang), budget: p.budget })}
          </Text>
          <Box marginLeft={2}>
            <Text wrap={i === at ? 'wrap' : 'truncate-end'} {...(i === at ? {} : { color: theme.muted })}>
              {i === at ? p.text : p.text.split('\n')[0]}
            </Text>
          </Box>
        </Pressable>
      ))}
    </Box>
  );
}

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
