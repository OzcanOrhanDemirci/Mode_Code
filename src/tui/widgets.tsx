// SPDX-License-Identifier: Apache-2.0
/** Interactive pieces used inside open screens: a list of links, a text field, a settings editor. */
import { useState } from 'react';
import { Box, Text } from 'ink';
import type { MessageKey } from '../core/i18n/index.js';
import { useEnv, useScreenKeys, useT, ListView, Muted, type ListItem } from './ui.js';

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

export type FieldKind = { kind: 'bool' } | { kind: 'enum'; options: { value: string; label: string }[] } | { kind: 'number'; min: number; max: number };

export interface Field {
  path: string;
  label: string;
  help: string;
  value: unknown;
  type: FieldKind;
  /** Turning this off or down lowers a protection: confirm first and say so. */
  protective?: boolean;
  /** Changing to this value asks for a second Enter first, with this text shown (what it means). */
  confirmOn?: { value: unknown; text: string };
}

/** Edits settings in place: ↑↓ choose, Enter changes (twice for anything that lowers a protection), numbers are typed. */
export function SettingsEditor({ fields, open, width }: { fields: Field[]; open: boolean; width: number }) {
  const env = useEnv();
  const t = useT();
  const [sel, setSel] = useState(0);
  const [pending, setPending] = useState<{ path: string; value: unknown } | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const cur = fields[Math.min(sel, fields.length - 1)];

  const nextValue = (f: Field): unknown => {
    if (f.type.kind === 'bool') return !f.value;
    if (f.type.kind === 'enum') {
      const i = f.type.options.findIndex((o) => o.value === f.value);
      return f.type.options[(i + 1) % f.type.options.length]!.value;
    }
    return f.value;
  };
  const lowers = (f: Field, v: unknown) =>
    (!!f.protective && (v === false || (typeof v === 'number' && typeof f.value === 'number' && v < f.value))) || (!!f.confirmOn && f.confirmOn.value === v);
  const save = (path: string, value: unknown) => {
    const problems = env.data.setConfig(path, value);
    setPending(null);
    setTyping(null);
    if (problems.length) env.flash(t('set.rejected', { detail: problems.map((p) => p.detail).join('; ') }), 'bad');
    else env.flash(t('set.saved'), 'ok');
  };

  useScreenKeys((input, key) => {
    if (!cur) return false;
    if (typing !== null) {
      if (key.return) {
        const n = Number(typing);
        if (cur.type.kind === 'number' && Number.isFinite(n) && n >= cur.type.min && n <= cur.type.max) {
          if (lowers(cur, n) && !(pending && pending.path === cur.path && pending.value === n)) {
            setPending({ path: cur.path, value: n });
            return true;
          }
          save(cur.path, n);
        } else env.flash(t('set.range', { min: cur.type.kind === 'number' ? cur.type.min : 0, max: cur.type.kind === 'number' ? cur.type.max : 0 }), 'warn');
        return true;
      }
      if (key.escape) {
        setTyping(null);
        setPending(null);
        return true;
      }
      if (key.backspace || key.delete) {
        setTyping(typing.slice(0, -1));
        return true;
      }
      if (/^\d$/.test(input)) {
        setTyping((typing + input).slice(0, 4));
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
      if (cur.type.kind === 'number') {
        setTyping(String(cur.value ?? ''));
        return true;
      }
      const v = nextValue(cur);
      if (lowers(cur, v) && !(pending && pending.path === cur.path)) {
        setPending({ path: cur.path, value: v });
        return true;
      }
      save(cur.path, pending && pending.path === cur.path ? pending.value : v);
      return true;
    }
    return false;
  }, open);

  const show = (f: Field): string => {
    if (f.type.kind === 'bool') return f.value ? t('set.on') : t('set.off');
    if (f.type.kind === 'enum') return f.type.options.find((o) => o.value === f.value)?.label ?? String(f.value);
    return String(f.value);
  };
  const labelW = Math.min(30, Math.max(...fields.map((f) => f.label.length)) + 2);
  return (
    <Box flexDirection="column" width={width}>
      {fields.map((f, i) => {
        const selected = i === sel && open;
        return (
          <Box key={f.path}>
            <Text inverse={selected}>{(selected ? env.theme.sym.cursor : ' ') + ' ' + f.label.padEnd(labelW)}</Text>
            <Text bold color={f.type.kind === 'bool' ? (f.value ? env.theme.ok : env.theme.muted) : env.theme.accent}>
              {typing !== null && i === sel ? typing + '▏' : show(f)}
            </Text>
          </Box>
        );
      })}
      {cur ? (
        <Box marginTop={1} flexDirection="column">
          <Muted>{cur.help}</Muted>
          {pending && pending.path === cur.path ? (
            <Text color={env.theme.warn} wrap="wrap">
              {cur.confirmOn && cur.confirmOn.value === pending.value ? cur.confirmOn.text : t('set.confirmLower', { value: String(pending.value) })}
            </Text>
          ) : null}
          {open ? <Muted>{t(cur.type.kind === 'number' ? 'set.hintNumber' : 'set.hint')}</Muted> : null}
        </Box>
      ) : null}
    </Box>
  );
}

export function tKey(k: string): MessageKey {
  return k as MessageKey;
}
