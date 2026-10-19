// SPDX-License-Identifier: Apache-2.0
/**
 * Automation › Recent tasks, Bypass, Done without asking and Parallel agents (docs/autonomy.md, docs/agents.md):
 * the last tasks given full autonomy, to copy one again; turning bypass on for this computer, its time limit, and
 * every call it let through, one by one, for the person to review; turning the parallel agent mode on.
 */
import { useState } from 'react';
import { Box, Text } from 'ink';
import { AGENTS_ICON } from '../../core/agents.js';
import { ago } from '../../core/format.js';
import type { MessageKey } from '../../core/i18n/index.js';
import type { ToolEvent } from '../../app/data.js';
import type { ScreenProps } from '../nav.js';
import { Empty, Muted, Section, useEnv, useHints, useScreenKeys, useT } from '../ui.js';
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
  if (!list.length) return <Empty>{t('prompts.empty')}</Empty>;
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

export function Bypass({ width, open }: ScreenProps) {
  const { data } = useEnv();
  const t = useT();
  const fields = fieldsOf(data.config(), ['bypass.enabled', 'bypass.maxHours']);
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
