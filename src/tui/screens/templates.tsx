// SPDX-License-Identifier: Apache-2.0
/** Rule templates for the folder the control center was opened in: see them, apply one, remove one. */
import { useState } from 'react';
import { Box, Text } from 'ink';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MessageKey } from '../../core/i18n/index.js';
import { shortPath } from '../../core/format.js';
import { TEMPLATES } from '../../core/templates.js';
import type { ScreenProps } from '../nav.js';
import { Muted, Note, useEnv, useHints, useScreenKeys, useT } from '../ui.js';
import { Pressable } from '../press.js';

export function Templates({ width, open }: ScreenProps) {
  const { data, lang, theme, flash } = useEnv();
  const t = useT();
  const [sel, setSel] = useState(0);
  const [pending, setPending] = useState<{ id: string; on: boolean } | null>(null);
  const [, setVersion] = useState(0);
  const { applied, remote } = data.templates();
  const cur = TEMPLATES[Math.min(sel, TEMPLATES.length - 1)]!;
  /** a applies, x removes; both change a file the person keeps, so the first press asks and the second does it. */
  const setTo = (on: boolean) => {
    if (on === applied.includes(cur.id)) return;
    if (!pending || pending.id !== cur.id || pending.on !== on) {
      setPending({ id: cur.id, on });
      return;
    }
    const err = data.setTemplate(cur.id, on);
    setPending(null);
    setVersion((v) => v + 1);
    flash(err ? t(err as MessageKey, { id: cur.id }) : t(on ? 'template.applied' : 'template.removed'), err ? 'bad' : 'ok');
  };
  useScreenKeys((input, key) => {
    if (key.upArrow || input === 'k') {
      setSel((s) => Math.max(0, s - 1));
      setPending(null);
      return true;
    }
    if (key.downArrow || input === 'j') {
      setSel((s) => Math.min(TEMPLATES.length - 1, s + 1));
      setPending(null);
      return true;
    }
    if (key.escape && pending) {
      setPending(null);
      return true;
    }
    if (input === 'a' || input === 'x') {
      setTo(input === 'a');
      return true;
    }
    return false;
  }, open);
  const isOn = applied.includes(cur.id);
  useHints(
    pending
      ? [
          { key: pending.on ? 'a' : 'x', label: t(pending.on ? 'keys.apply' : 'keys.remove'), run: () => setTo(pending.on) },
          { key: 'Esc', label: t('set.key.cancel'), run: () => setPending(null) },
        ]
      : [isOn ? { key: 'x', label: t('keys.remove'), run: () => setTo(false) } : { key: 'a', label: t('keys.apply'), run: () => setTo(true) }],
    open,
  );
  return (
    <Box flexDirection="column" width={width}>
      <Muted>{t('templates.folder', { folder: shortPath(join(data.cwd, 'CLAUDE.md'), homedir(), Math.max(20, width - 20)) })}</Muted>
      <Box marginTop={1} flexDirection="column">
        {TEMPLATES.map((x, i) => {
          const on = applied.includes(x.id);
          const selected = open && i === sel;
          return (
            <Pressable
              key={x.id}
              onPress={() => {
                setSel(i);
                setPending(null);
              }}
            >
              <Text inverse={selected} wrap="truncate-end">
                {selected ? theme.sym.cursor : ' '} <Text color={on ? theme.ok : theme.muted}>{on ? theme.sym.ok : theme.sym.off}</Text> {x.name[lang]}
                {x.needsRemote && !remote ? <Text color={theme.muted}> · {t('templates.needsRemote')}</Text> : null}
              </Text>
            </Pressable>
          );
        })}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>{cur.name[lang]}</Text>
        <Muted>{cur.description[lang]}</Muted>
        {cur.rules[lang].map((r) => (
          <Text key={r} wrap="wrap">
            {'  - '}
            {r}
          </Text>
        ))}
        {(cur.changes?.(remote ?? '…') ?? []).map((ch) => (
          <Text key={ch.path} color={theme.accent} wrap="wrap">
            {'  + '}
            {ch.text[lang]}
          </Text>
        ))}
      </Box>
      {pending ? (
        <Box marginTop={1}>
          <Note kind="warn">{t(pending.on ? 'templates.confirmApply' : 'templates.confirmRemove')}</Note>
        </Box>
      ) : null}
    </Box>
  );
}
