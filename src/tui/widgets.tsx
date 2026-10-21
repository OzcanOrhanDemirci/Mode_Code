// SPDX-License-Identifier: Apache-2.0
/** Interactive pieces used inside open screens: a list of links, a text field, a settings editor and its card. */
import { useState } from 'react';
import { Box, Text } from 'ink';
import type { MessageKey } from '../core/i18n/index.js';
import type { Config } from '../core/config.js';
import { problemWords } from '../core/config-words.js';
import {
  amount,
  asksFirst,
  blockedBy,
  confirmText,
  defaultOf,
  effectOf,
  explain,
  nameOf,
  nextValue,
  settingOf,
  valueIn,
  valueText,
  type SettingPath,
} from '../core/ux/catalog.js';
import { changeText } from '../core/ux/changes.js';
import { action, card, choiceValue, confirm, switchValue } from '../core/ux/kit.js';
import { mark } from '../core/ux/tokens.js';
import { fitWidth, textWidth } from '../node/width.js';
import { Pressable } from './press.js';
import { useEnv, useHints, useKeepInView, useKit, useScreenKeys, useT, ListView, Muted, Row, type ListItem } from './ui.js';

export interface Link extends ListItem {
  address: string;
}

/** A list whose rows lead to other screens. Enter (or →) follows the selected link. */
export function LinkList({ items, height, width, open, emptyText }: { items: Link[]; height: number; width: number; open: boolean; emptyText?: string }) {
  const env = useEnv();
  const [sel, setSel] = useState(0);
  const follow = (i = sel) => {
    const it = items[Math.min(i, items.length - 1)];
    if (it) env.go(it.address);
  };
  useScreenKeys((input, key) => {
    if (!items.length) return false;
    if (key.upArrow || input === 'k') {
      setSel((s) => Math.max(0, s - 1));
      return true;
    }
    if (key.downArrow || input === 'j') {
      setSel((s) => Math.min(items.length - 1, s + 1));
      return true;
    }
    if (key.return || key.rightArrow) {
      follow();
      return true;
    }
    return false;
  }, open);
  useLinkHints(open && items.length > 0, () => follow());
  if (!items.length) return emptyText ? <Muted>{emptyText}</Muted> : null;
  // A click on a row follows its link, here or beside a list (a preview's links lead too).
  return (
    <ListView
      items={items}
      selected={Math.min(sel, items.length - 1)}
      height={height}
      width={width}
      focused={open}
      onPress={(i) => {
        setSel(i);
        follow(i);
      }}
      onMove={open ? (d) => setSel((s) => Math.max(0, Math.min(items.length - 1, s + d))) : undefined}
      describe={(i) => (items[i] ? `${items[i]!.label}${env.place(items[i]!.address) ? ` · ${env.place(items[i]!.address)}` : ''}` : null)}
    />
  );
}

/** A one-line text field that takes the keyboard while it is active. */
export function TextField({
  label,
  value,
  onChange,
  onSubmit,
  onCancel,
  active,
  placeholder,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  onSubmit(v: string): void;
  onCancel?(): void;
  active: boolean;
  placeholder?: string;
}) {
  const { theme } = useEnv();
  useScreenKeys((input, key) => {
    if (key.return) {
      onSubmit(value);
      return true;
    }
    if (key.escape) {
      if (onCancel) {
        onCancel();
        return true;
      }
      return false;
    }
    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      return true;
    }
    if (key.ctrl && input === 'u') {
      onChange('');
      return true;
    }
    if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && !key.tab) {
      onChange(value + input);
      return true;
    }
    return false;
  }, active);
  return (
    <Box>
      <Text color={theme.muted}>{label} </Text>
      <Text {...(active ? { inverse: false } : {})}>
        {value || (placeholder ? '' : '')}
        {!value && placeholder ? <Text color={theme.muted}>{placeholder}</Text> : null}
        {active ? <Text inverse> </Text> : null}
      </Text>
    </Box>
  );
}

/**
 * A setting shown in an editor: its config path and its value; everything else (its name, its kind, what each value
 * does, what asks twice) comes from the catalog (src/core/ux/catalog.ts), so no screen writes its own words.
 */
export interface Field {
  path: SettingPath;
  value: unknown;
  /** Lines this screen adds to the setting's card, under what it is (a pack's size, a program it misses). */
  more?: string[];
}

/**
 * Edits settings in place: ↑↓ choose, Enter or Space changes (twice for anything that lowers a protection or says
 * what it means first), numbers are typed; d puts the selected setting back to its default, D the whole list, each
 * after showing what goes back. Under the list the selected setting answers the four questions (docs/design.md):
 * what it is, how it is now, what the change does before it is made, and how to take it back.
 */
export function SettingsEditor({ fields, open, width }: { fields: Field[]; open: boolean; width: number }) {
  const env = useEnv();
  const t = useT();
  const kit = useKit();
  const lang = env.lang;
  const [sel, setSel] = useState(0);
  const [pending, setPending] = useState<{ path: string; value: unknown } | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  // A choice of more than two being picked: its options stand out, ←→ move the mark, Enter applies the one marked.
  const [choosing, setChoosing] = useState<{ path: string; value: unknown } | null>(null);
  // Back to the defaults: what would change, shown before it does.
  const [reset, setReset] = useState<{ path: SettingPath; from: unknown; to: unknown }[] | null>(null);
  const cur = fields[Math.min(sel, fields.length - 1)];
  const kindOf = (f: Field) => settingOf(f.path)!.def.kind;
  // What has the focus stays in view on a long page: the selected row, or what a press asks before it acts.
  const keepRef = useKeepInView(open);

  /** Saves a value; the bar says what changed and offers to take it back (u), to the value it had. */
  const save = (f: Field, value: unknown) => {
    const before = f.value;
    const problems = env.data.setConfig(f.path, value, 'center');
    setPending(null);
    setTyping(null);
    if (problems.length) {
      env.flash(t('set.rejected', { detail: problems.map((p) => problemWords(p.detail, lang)).join('; ') }), 'bad');
      return;
    }
    env.flash(t('set.changed', { name: nameOf(f.path, lang), value: valueText(f.path, value, lang) }), 'ok', () => {
      const again = env.data.setConfig(f.path, before, 'undo');
      if (again.length) env.flash(t('set.rejected', { detail: again.map((p) => problemWords(p.detail, lang)).join('; ') }), 'bad');
      else env.flash(t('set.undone', { name: nameOf(f.path, lang), value: valueText(f.path, before, lang) }), 'ok');
    });
  };
  /** Applies `v`, or holds it for a second press when it asks first. */
  const offer = (f: Field, v: unknown) => {
    if (asksFirst(f.path, f.value, v) && !(pending && pending.path === f.path && pending.value === v)) {
      setPending({ path: f.path, value: v });
      return;
    }
    save(f, v);
  };

  /**
   * Enter or Space on a setting: a number opens for typing; a choice of more than two shows its options, and a second
   * Enter applies the one marked; a switch or a choice of two moves to the other value. Asking first where it must.
   */
  const change = (f: Field) => {
    const k = kindOf(f);
    if (k.kind === 'number') {
      setTyping(String(f.value ?? ''));
      return;
    }
    if (pending && pending.path === f.path) return offer(f, pending.value);
    if (k.kind === 'choice' && k.options.length > 2) {
      if (!choosing || choosing.path !== f.path) return setChoosing({ path: f.path, value: f.value });
      setChoosing(null);
      if (JSON.stringify(choosing.value) !== JSON.stringify(f.value)) offer(f, choosing.value);
      return;
    }
    offer(f, nextValue(f.path, f.value));
  };
  /** ← or → while picking: the mark moves to the option before or after, round. */
  const step = (f: Field, by: 1 | -1) => {
    const k = kindOf(f);
    if (k.kind !== 'choice' || !choosing) return;
    const i = k.options.indexOf(choosing.value as never);
    setChoosing({ path: f.path, value: k.options[(i + by + k.options.length) % k.options.length] });
  };
  const submitTyped = () => {
    if (!cur || typing === null) return;
    const k = kindOf(cur);
    const n = typedNumber(typing, cur);
    if (n !== null) offer(cur, n);
    else env.flash(t('set.range', { min: k.kind === 'number' ? k.min : 0, max: k.kind === 'number' ? k.max : 0 }), 'warn');
  };
  const cancel = () => {
    setTyping(null);
    setPending(null);
    setReset(null);
    setChoosing(null);
  };
  /** d (one) or D (the list): what goes back to its default, held for Enter; nothing to do is said so. */
  const askReset = (list: Field[]) => {
    const back = list.map((f) => ({ path: f.path, from: f.value, to: defaultOf(f.path) })).filter((c) => JSON.stringify(c.from) !== JSON.stringify(c.to));
    setPending(null);
    if (back.length) setReset(back);
    else env.flash(list.length === 1 ? t('set.atDefault', { name: nameOf(list[0]!.path, lang) }) : t('set.pageAtDefaults'), 'ok');
  };
  const applyReset = () => {
    if (!reset) return;
    const back = reset;
    setReset(null);
    const problems = env.data.setConfigMany(
      back.map((c) => ({ path: c.path, value: c.to })),
      'default',
    );
    if (problems.length) {
      env.flash(t('set.rejected', { detail: problems.map((p) => problemWords(p.detail, lang)).join('; ') }), 'bad');
      return;
    }
    env.flash(t('set.defaulted', { changes: back.map((c) => changeText(c, lang)).join('; ') }), 'ok', () => {
      env.data.setConfigMany(
        back.map((c) => ({ path: c.path, value: c.from })),
        'undo',
      );
      env.flash(t('changes.undone', { change: back.map((c) => changeText({ path: c.path, from: c.to, to: c.from }, lang)).join('; ') }), 'ok');
    });
  };

  useScreenKeys((input, key) => {
    if (!cur) return false;
    if (typing !== null) {
      if (key.return) {
        submitTyped();
        return true;
      }
      if (key.escape) {
        cancel();
        return true;
      }
      if (key.backspace || key.delete) {
        setTyping(typing.slice(0, -1));
        setPending(null);
        return true;
      }
      if (/^\d$/.test(input)) {
        setTyping((typing + input).slice(0, 4));
        setPending(null);
        return true;
      }
      return true;
    }
    if (choosing) {
      // Picking: the arrows move the mark (← does not leave the page), Enter applies, Esc keeps the value as it was.
      if (key.leftArrow || input === 'h') step(cur, -1);
      else if (key.rightArrow || input === 'l') step(cur, 1);
      else if (key.return || input === ' ') change(cur);
      else if (key.escape) setChoosing(null);
      else if (!key.upArrow && !key.downArrow) return false;
      // ↑ or ↓ leave the choice as it was and move to the next setting, as they do otherwise.
      if (!key.upArrow && !key.downArrow) return true;
      setChoosing(null);
    }
    if (key.upArrow || input === 'k') {
      setSel((s) => Math.max(0, s - 1));
      setPending(null);
      return true;
    }
    if (key.downArrow || input === 'j') {
      setSel((s) => Math.min(fields.length - 1, s + 1));
      setPending(null);
      return true;
    }
    if (reset) {
      if (key.return) applyReset();
      else if (key.escape) setReset(null);
      else return false;
      return true;
    }
    if (key.escape && pending) {
      setPending(null);
      return true;
    }
    if (key.return || input === ' ') {
      change(cur);
      return true;
    }
    if (input === 'd' || input === 'D') {
      askReset(input === 'd' ? [cur] : fields);
      return true;
    }
    return false;
  }, open);

  // The keys of this list in the bar, each one a click away too.
  const curKind = cur ? kindOf(cur).kind : 'switch';
  useHints(
    typing !== null
      ? [
          { key: '0-9', label: t('set.key.type') },
          { key: 'Enter', label: t('set.key.save'), run: submitTyped },
          { key: 'Esc', label: t('set.key.cancel'), run: cancel },
        ]
      : reset
        ? [
            { key: 'Enter', label: t('set.key.apply'), run: applyReset },
            { key: 'Esc', label: t('set.key.cancel'), run: cancel },
          ]
        : pending || choosing
          ? [
              ...(choosing ? [{ key: '←→', label: t('set.key.choose') }] : []),
              { key: 'Enter', label: t('set.key.apply'), run: () => cur && change(cur) },
              { key: 'Esc', label: t('set.key.cancel'), run: cancel },
            ]
          : [
              { key: 'Enter', label: t(curKind === 'number' ? 'set.key.type' : 'set.key.change'), run: () => cur && change(cur) },
              { key: 'd', label: t('set.key.default'), run: () => cur && askReset([cur]) },
              { key: 'D', label: t('set.key.pageDefault'), run: () => askReset(fields) },
            ],
    open && !!cur,
  );

  // The values stand in one column two cells past the longest label, as far as the longest value and the trailing
  // column leave room. A label too long for the column is cut: run into its value, "serbest" and "açık" read as one
  // word. A switch reads `● on`, a choice `‹ value ›` (docs/design.md, the look tells the kind); the trailing column
  // says whether a value is the default, changed, or of no effect now (another setting keeps it from mattering).
  const valueW =
    Math.max(
      ...fields.map((f) => {
        const k = kindOf(f);
        const values = k.kind === 'switch' ? [true, false] : k.kind === 'choice' ? [...k.options] : [k.max];
        return Math.max(...values.map((v) => textWidth(valueText(f.path, v, lang))));
      }),
    ) + 4;
  const trail = { default: t('set.row.default'), changed: t('set.row.changed'), idle: t('set.row.idle') };
  const trailW = Math.max(...Object.values(trail).map(textWidth));
  // A setting that matters only while another on this page holds a value stands under it, indented.
  const paths = new Set(fields.map((f) => f.path as string));
  const under = (f: Field) => {
    const g = settingOf(f.path)!.def.gate;
    return g && paths.has(g.id) ? 2 : 0;
  };
  const labelW = Math.max(12, Math.min(40, width - 2 - valueW - trailW - 1, Math.max(...fields.map((f) => textWidth(nameOf(f.path, lang)) + under(f))) + 2));
  const config = env.data.config();
  const changed = fields.filter((f) => JSON.stringify(f.value) !== JSON.stringify(defaultOf(f.path)));
  const muted = env.theme.muted ? { color: env.theme.muted } : {};
  const valueOf = (f: Field, i: number, idle: boolean) => {
    if (typing !== null && i === sel) return <Text bold>{typing + '▏'}</Text>;
    const kind = kindOf(f);
    // Picking: every option, the one marked ◉ and the others ○, as the contract's other look of a choice.
    if (choosing && choosing.path === f.path && kind.kind === 'choice')
      return (
        <Text wrap="wrap">
          {kind.options.map((o, n) => (
            <Text key={String(o)} bold={o === choosing.value} {...(o === choosing.value ? {} : muted)}>
              {`${n ? '  ' : ''}${mark(o === choosing.value ? 'chosen' : 'option', env.theme.plain)} ${valueText(f.path, o, lang)}`}
            </Text>
          ))}
        </Text>
      );
    const k = kind.kind;
    const word = valueText(f.path, f.value, lang);
    // Of no effect now, it is drawn dimmed: still a control, its mark and word still there.
    if (idle) return <Text {...muted}>{k === 'switch' ? `${mark(f.value === true ? 'on' : 'off', env.theme.plain)} ${word}` : word}</Text>;
    return k === 'switch' ? switchValue(kit, f.value === true, word) : k === 'choice' ? choiceValue(kit, word) : kit.text({ bold: true }, word);
  };
  // What the page holds now, in words: what differs from the defaults (a press puts them back), or that nothing does.
  const shown = changed
    .slice(0, 3)
    .map((f) => `${nameOf(f.path, lang)}: ${valueText(f.path, f.value, lang)} (${t('ux.defaultIs', { value: valueText(f.path, defaultOf(f.path), lang) })})`);
  const nowText = !changed.length
    ? t('set.now.defaults')
    : `${shown.join('; ')}${changed.length > 3 ? `; ${t('set.now.more', { n: changed.length - 3 })}` : ''}${changed.length < fields.length ? `; ${t('set.now.rest')}` : ''}.`;
  return (
    <Box flexDirection="column" width={width}>
      {fields.length > 1 ? (
        <Box flexDirection="column" marginBottom={1} width={width}>
          {card(kit, { lines: [{ label: t('ux.q.now'), text: nowText }], width, labelWidth: cardLabelW(t) })}
          {changed.length ? (
            <Box marginLeft={cardLabelW(t)}>
              {action(kit, { id: 'page-defaults', label: t('set.now.back'), keyName: 'D', describe: t('set.now.backCard'), onPress: () => askReset(fields) })}
            </Box>
          ) : null}
        </Box>
      ) : null}
      {fields.map((f, i) => {
        const selected = i === sel && open;
        const indent = ' '.repeat(under(f));
        const idle = blockedBy(config, f.path) !== null;
        const at = idle ? 'idle' : changed.includes(f) ? 'changed' : 'default';
        // A click selects the setting and changes it, as Enter does; pointing at it says what it is.
        return (
          <Box key={f.path} ref={i === sel && !reset && !pending && !choosing ? keepRef : undefined} flexShrink={0} width={width}>
            <Pressable
              width={width}
              onPress={() => {
                setSel(i);
                if (open) change(f);
              }}
              describe={`${nameOf(f.path, lang)}: ${explain(config, f.path, lang, env.place).what}`}
            >
              {(hovered) => (
                <>
                  <Text inverse={selected} underline={hovered} {...(idle ? muted : {})}>
                    {(selected ? env.theme.sym.cursor : ' ') +
                      ' ' +
                      indent +
                      fitWidth(nameOf(f.path, lang), labelW - 2 - indent.length).padEnd(labelW - indent.length)}
                  </Text>
                  <Box flexGrow={1}>{valueOf(f, i, idle)}</Box>
                  <Text {...(at === 'changed' ? {} : muted)}>{trail[at].padStart(trailW)}</Text>
                </>
              )}
            </Pressable>
          </Box>
        );
      })}
      {reset ? (
        <Box marginTop={1} ref={keepRef}>
          {confirm(kit, {
            text:
              reset.length === 1
                ? t('set.defaultConfirm', { change: changeText(reset[0]!, lang) })
                : t('set.pageDefaultConfirm', { changes: reset.map((c) => changeText(c, lang)).join('; ') }),
            width,
            apply: { id: 'apply-default', label: t('set.key.apply'), keyName: 'Enter', onPress: applyReset },
            cancel: { id: 'cancel-default', label: t('set.key.cancel'), keyName: 'Esc', onPress: cancel },
          })}
        </Box>
      ) : null}
      {cur ? (
        <Box ref={pending || choosing ? keepRef : undefined} flexDirection="column" flexShrink={0}>
          <SettingCard
            field={cur}
            typed={typing === null ? null : typedNumber(typing, cur)}
            pending={pending && pending.path === cur.path ? { value: pending.value } : null}
            chosen={choosing && choosing.path === cur.path ? { value: choosing.value } : null}
            open={open}
            width={width}
            onApply={() => change(cur)}
            onCancel={cancel}
          />
        </Box>
      ) : null}
    </Box>
  );
}

/** The label column of a setting's card, and of the line above the settings that says what the page holds now. */
function cardLabelW(t: (k: MessageKey) => string): number {
  return Math.max(...(['ux.q.what', 'ux.q.now', 'ux.q.change', 'ux.q.apply', 'ux.q.back', 'ux.q.who'] as const).map((q) => textWidth(t(q)))) + 2;
}

/** A typed number when it is one the setting takes, else null. */
function typedNumber(typing: string, f: Field): number | null {
  const k = settingOf(f.path)!.def.kind;
  const n = Number(typing);
  return typing !== '' && k.kind === 'number' && Number.isFinite(n) && n >= k.min && n <= k.max ? n : null;
}

/**
 * The four answers for the selected setting, from the catalog, and, when a press asks first, what it is about to do
 * with the two ways out (apply, cancel), each a key and a click.
 */
function SettingCard({
  field,
  typed,
  pending,
  chosen,
  open,
  width,
  onApply,
  onCancel,
}: {
  field: Field;
  typed: number | null;
  pending: { value: unknown } | null;
  /** The option marked while a choice is picked: what applying it does stands first. */
  chosen?: { value: unknown } | null;
  open: boolean;
  width: number;
  onApply(): void;
  onCancel(): void;
}) {
  const env = useEnv();
  const t = useT();
  const kit = useKit();
  const lang = env.lang;
  const e = explain(env.data.config(), field.path, lang, env.place);
  const k = settingOf(field.path)!.def.kind;
  const w = cardLabelW(t);
  const now = `${e.now} (${e.isDefault ? t('ux.default') : t('ux.defaultIs', { value: e.defaultText })})`;
  // What a press that lowers a protection would do, said with its effect before Enter applies it.
  const warning = pending
    ? (confirmText(field.path, pending.value, lang) ??
      t('set.confirmLower', {
        name: nameOf(field.path, lang),
        value: valueText(field.path, pending.value, lang),
        effect: effectOf(field.path, pending.value, lang),
      }))
    : null;
  const changes = chosen ? [...e.changes].sort((a, b) => Number(b.value === chosen.value) - Number(a.value === chosen.value)) : e.changes;
  // A press that asks first says so before anything else: on a short terminal the card's end may fall below the pane.
  return (
    <Box marginTop={1} flexDirection="column">
      {warning ? (
        <Box marginBottom={1}>
          {confirm(kit, {
            text: warning,
            width,
            apply: { id: 'apply', label: t('set.key.apply'), keyName: 'Enter', onPress: onApply },
            cancel: { id: 'cancel', label: t('set.key.cancel'), keyName: 'Esc', onPress: onCancel },
          })}
        </Box>
      ) : null}
      <Row label={t('ux.q.what')} width={w}>
        {e.what}
      </Row>
      {field.more?.map((m, i) => (
        <Row key={i} label="" width={w} color={env.theme.muted}>
          {m}
        </Row>
      ))}
      <Row label={t('ux.q.now')} width={w}>
        {`${now}. ${e.nowEffect}`}
      </Row>
      {e.blocked ? (
        <Row label="" width={w} color={env.theme.warn}>
          {e.blocked}
        </Row>
      ) : null}
      {k.kind === 'number' ? (
        <Row label={t('ux.q.change')} width={w}>
          {typed !== null ? `${amount(typed, k.unit, lang)}: ${effectOf(field.path, typed, lang)}` : t('ux.range', { min: e.range!.min, max: e.range!.max })}
        </Row>
      ) : (
        changes.map((c, i) => (
          <Row
            key={String(c.value)}
            label={i === 0 ? t(chosen && c.value === chosen.value ? 'ux.q.apply' : 'ux.q.change') : ''}
            width={w}
            {...(i === 0 ? {} : { color: env.theme.muted })}
          >
            {`${c.text}: ${c.effect}`}
          </Row>
        ))
      )}
      <Row label={t('ux.q.back')} width={w}>
        {e.back}
      </Row>
      {e.personOnly ? (
        <Row label={t('ux.q.who')} width={w}>
          {t('ux.personOnly')}
        </Row>
      ) : null}
    </Box>
  );
}

/** A link list's keys in the bar: Enter follows the selected link (a click on a row does the same). */
function useLinkHints(open: boolean, follow: () => void): void {
  const t = useT();
  useHints([{ key: 'Enter', label: t('keys.open'), run: follow }], open);
}

export function tKey(k: string): MessageKey {
  return k as MessageKey;
}

/** The fields for these settings, with their values in `config`. */
export function fieldsOf(config: Readonly<Config>, paths: readonly SettingPath[]): Field[] {
  return paths.map((path) => ({ path, value: valueIn(config, path) }));
}
