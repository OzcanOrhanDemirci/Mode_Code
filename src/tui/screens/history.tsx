// SPDX-License-Identifier: Apache-2.0
/**
 * Activity › History of changes (docs/design.md, Say, do, undo): every change to a setting, newest first, with when,
 * from what to what and where it came from; Enter or a click takes one back. A change made again since is not taken
 * back from its old row (the newer one is); one that would lower a protection asks first.
 */
import { useState } from 'react';
import { Box } from 'ink';
import { ago } from '../../core/format.js';
import { problemWords } from '../../core/config-words.js';
import { asksFirst, confirmText, valueIn, valueText } from '../../core/ux/catalog.js';
import { changeText, undoOf, type ChangeRow } from '../../core/ux/changes.js';
import { confirm } from '../../core/ux/kit.js';
import type { ScreenProps } from '../nav.js';
import { Empty, ListView, useEnv, useHints, useKit, useScreenKeys, useT } from '../ui.js';

export function History({ width, height, open }: ScreenProps) {
  const { data, lang, now, flash } = useEnv();
  const t = useT();
  const kit = useKit();
  const config = data.config();
  const rows = data.changes().slice().reverse();
  const [sel, setSel] = useState(0);
  const [asking, setAsking] = useState<ChangeRow | null>(null);
  const at = Math.min(sel, Math.max(0, rows.length - 1));

  /** Takes row `i` back, asking first when that lowers a protection. */
  const takeBack = (i: number, sure = false) => {
    const r = rows[i];
    if (!r) return;
    const back = undoOf(config, r);
    if (!back) {
      flash(t('changes.changedSince'), 'warn');
      return;
    }
    if (!sure && asksFirst(back.path, valueIn(config, back.path), back.to)) {
      setAsking(r);
      return;
    }
    setAsking(null);
    const problems = data.setConfig(back.path, back.to, 'undo');
    if (problems.length) {
      flash(t('set.rejected', { detail: problems.map((p) => problemWords(p.detail, lang)).join('; ') }), 'bad');
      return;
    }
    flash(t('changes.undone', { change: changeText({ path: r.path, from: r.to, to: r.from }, lang) }), 'ok', () => data.setConfig(r.path, r.to, 'undo'));
  };

  useScreenKeys((input, key) => {
    if (!rows.length) return false;
    if (asking) {
      if (key.return) takeBack(rows.indexOf(asking), true);
      else if (key.escape) setAsking(null);
      else return false;
      return true;
    }
    if (key.upArrow || input === 'k') setSel(Math.max(0, at - 1));
    else if (key.downArrow || input === 'j') setSel(Math.min(rows.length - 1, at + 1));
    else if (key.return) takeBack(at);
    else return false;
    return true;
  }, open);
  useHints(
    asking
      ? [
          { key: 'Enter', label: t('set.key.apply'), run: () => takeBack(rows.indexOf(asking), true) },
          { key: 'Esc', label: t('set.key.cancel'), run: () => setAsking(null) },
        ]
      : [{ key: 'Enter', label: t('changes.key.undo'), run: () => takeBack(at) }],
    open && rows.length > 0,
  );

  if (!rows.length) return <Empty>{t('changes.none')}</Empty>;
  return (
    <Box flexDirection="column" width={width}>
      {asking ? (
        <Box marginBottom={1}>
          {confirm(kit, {
            text: confirmText(asking.path, asking.from, lang) ?? t('set.confirmLower', { value: valueText(asking.path, asking.from, lang) }),
            width,
            apply: { id: 'apply-undo', label: t('set.key.apply'), keyName: 'Enter', onPress: () => takeBack(rows.indexOf(asking), true) },
            cancel: { id: 'cancel-undo', label: t('set.key.cancel'), keyName: 'Esc', onPress: () => setAsking(null) },
          })}
        </Box>
      ) : null}
      <ListView
        items={rows.map((r, i) => ({
          key: `${r.at}-${i}`,
          label: changeText({ path: r.path, from: r.from, to: r.to, who: r.who }, lang),
          right: ago(r.at, now, lang),
          dim: !undoOf(config, r),
        }))}
        selected={at}
        height={Math.max(3, height - (asking ? 6 : 0))}
        width={width}
        focused={open}
        onPress={(i) => {
          setSel(i);
          if (open) takeBack(i);
        }}
        onMove={open ? (d) => setSel((s) => Math.max(0, Math.min(rows.length - 1, s + d))) : undefined}
        describe={(i) => (rows[i] ? (undoOf(config, rows[i]!) ? t('changes.key.undo') : t('changes.changedSince')) : null)}
      />
    </Box>
  );
}
