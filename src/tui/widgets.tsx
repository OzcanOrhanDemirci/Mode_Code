// SPDX-License-Identifier: Apache-2.0
/** Interactive pieces used inside open screens: a list of links, a text field, a settings editor and its card. */
import { useState } from 'react';
import { Box, Text } from 'ink';
import type { MessageKey } from '../core/i18n/index.js';
import { truncate } from '../core/text.js';
import type { Config } from '../core/config.js';
import { amount, asksFirst, confirmText, effectOf, explain, nameOf, nextValue, settingOf, valueIn, valueText, type SettingPath } from '../core/ux/catalog.js';
import { useEnv, useScreenKeys, useT, ListView, Muted, Row, type ListItem } from './ui.js';

export interface Link extends ListItem {
  address: string;
}

/** A list whose rows lead to other screens. Enter (or →) follows the selected link. */
export function LinkList({ items, height, width, open, emptyText }: { items: Link[]; height: number; width: number; open: boolean; emptyText?: string }) {
  const env = useEnv();
  const [sel, setSel] = useState(0);
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
      const it = items[Math.min(sel, items.length - 1)];
      if (it) env.go(it.address);
      return true;
    }
    return false;
  }, open);
  if (!items.length) return emptyText ? <Muted>{emptyText}</Muted> : null;
  return <ListView items={items} selected={Math.min(sel, items.length - 1)} height={height} width={width} focused={open} />;
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
 * what it means first), numbers are typed. Under the list the selected setting answers the four questions
 * (docs/design.md): what it is, how it is now, what the change does before it is made, and how to take it back.
 */
export function SettingsEditor({ fields, open, width }: { fields: Field[]; open: boolean; width: number }) {
  const env = useEnv();
  const t = useT();
  const lang = env.lang;
  const [sel, setSel] = useState(0);
  const [pending, setPending] = useState<{ path: string; value: unknown } | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const cur = fields[Math.min(sel, fields.length - 1)];
  const kindOf = (f: Field) => settingOf(f.path)!.def.kind;

  const save = (f: Field, value: unknown) => {
    const problems = env.data.setConfig(f.path, value);
    setPending(null);
    setTyping(null);
    if (problems.length) env.flash(t('set.rejected', { detail: problems.map((p) => p.detail).join('; ') }), 'bad');
    else env.flash(t('set.changed', { name: nameOf(f.path, lang), value: valueText(f.path, value, lang) }), 'ok');
  };
  /** Applies `v`, or holds it for a second press when it asks first. */
  const offer = (f: Field, v: unknown) => {
    if (asksFirst(f.path, f.value, v) && !(pending && pending.path === f.path && pending.value === v)) {
      setPending({ path: f.path, value: v });
      return;
    }
    save(f, v);
  };

  useScreenKeys((input, key) => {
    if (!cur) return false;
    const k = kindOf(cur);
    if (typing !== null) {
      if (key.return) {
        const n = typedNumber(typing, cur);
        if (n !== null) offer(cur, n);
        else env.flash(t('set.range', { min: k.kind === 'number' ? k.min : 0, max: k.kind === 'number' ? k.max : 0 }), 'warn');
        return true;
      }
      if (key.escape) {
        setTyping(null);
        setPending(null);
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
    if (key.escape && pending) {
      setPending(null);
      return true;
    }
    if (key.return || input === ' ') {
      if (k.kind === 'number') {
        setTyping(String(cur.value ?? ''));
        return true;
      }
      offer(cur, pending && pending.path === cur.path ? pending.value : nextValue(cur.path, cur.value));
      return true;
    }
    return false;
  }, open);

  // The values stand in one column two cells past the longest label, as far as the longest value leaves room. A
  // label too long for the column is cut: run into its value, "serbest" and "açık" read as one word.
  const valueW = Math.max(
    ...fields.map((f) => {
      const k = kindOf(f);
      const values = k.kind === 'switch' ? [true, false] : k.kind === 'choice' ? [...k.options] : [k.max];
      return Math.max(...values.map((v) => valueText(f.path, v, lang).length));
    }),
  );
  const labelW = Math.max(12, Math.min(40, width - 2 - valueW, Math.max(...fields.map((f) => nameOf(f.path, lang).length)) + 2));
  return (
    <Box flexDirection="column" width={width}>
      {fields.map((f, i) => {
        const selected = i === sel && open;
        return (
          <Box key={f.path}>
            <Text inverse={selected}>{(selected ? env.theme.sym.cursor : ' ') + ' ' + truncate(nameOf(f.path, lang), labelW - 2).padEnd(labelW)}</Text>
            <Text bold color={kindOf(f).kind === 'switch' ? (f.value ? env.theme.ok : env.theme.muted) : env.theme.accent}>
              {typing !== null && i === sel ? typing + '▏' : valueText(f.path, f.value, lang)}
            </Text>
          </Box>
        );
      })}
      {cur ? (
        <SettingCard
          field={cur}
          typed={typing === null ? null : typedNumber(typing, cur)}
          pending={pending && pending.path === cur.path ? { value: pending.value } : null}
          open={open}
        />
      ) : null}
    </Box>
  );
}

/** A typed number when it is one the setting takes, else null. */
function typedNumber(typing: string, f: Field): number | null {
  const k = settingOf(f.path)!.def.kind;
  const n = Number(typing);
  return typing !== '' && k.kind === 'number' && Number.isFinite(n) && n >= k.min && n <= k.max ? n : null;
}

/** The four answers for the selected setting, from the catalog, and what a press is about to do when it asks first. */
function SettingCard({ field, typed, pending, open }: { field: Field; typed: number | null; pending: { value: unknown } | null; open: boolean }) {
  const env = useEnv();
  const t = useT();
  const lang = env.lang;
  const e = explain(env.data.config(), field.path, lang, env.place);
  const k = settingOf(field.path)!.def.kind;
  const w = Math.max(...(['ux.q.what', 'ux.q.now', 'ux.q.change', 'ux.q.back', 'ux.q.who'] as const).map((q) => t(q).length)) + 2;
  const now = `${e.now} (${e.isDefault ? t('ux.default') : t('ux.defaultIs', { value: e.defaultText })})`;
  const warning = pending
    ? (confirmText(field.path, pending.value, lang) ?? t('set.confirmLower', { value: valueText(field.path, pending.value, lang) }))
    : null;
  // A press that asks first says so before anything else: on a short terminal the card's end may fall below the pane.
  return (
    <Box marginTop={1} flexDirection="column">
      {warning ? (
        <Box marginBottom={1}>
          <Text color={env.theme.warn} wrap="wrap">
            {warning}
          </Text>
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
        e.changes.map((c, i) => (
          <Row key={String(c.value)} label={i === 0 ? t('ux.q.change') : ''} width={w} {...(i === 0 ? {} : { color: env.theme.muted })}>
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
      {open ? <Muted>{t(k.kind === 'number' ? 'set.hintNumber' : 'set.hint')}</Muted> : null}
    </Box>
  );
}

export function tKey(k: string): MessageKey {
  return k as MessageKey;
}

/** The fields for these settings, with their values in `config`. */
export function fieldsOf(config: Readonly<Config>, paths: readonly SettingPath[]): Field[] {
  return paths.map((path) => ({ path, value: valueIn(config, path) }));
}
