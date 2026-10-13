// SPDX-License-Identifier: Apache-2.0
/** Building blocks every screen uses, so all screens look and behave the same. */
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { Key } from 'ink';
import type { Lang, MessageKey } from '../core/i18n/index.js';
import { tIn } from '../core/i18n/index.js';
import { bar as barText } from '../core/format.js';
import { fitWidth, textWidth } from '../node/width.js';
import type { HealthState } from '../app/health.js';
import type { DataSource } from './store.js';
import { makeTheme, stateColor, stateSymbol, type Theme } from './theme.js';

// ── context: data, theme, language, navigation, key routing ──

export interface Env {
  data: DataSource;
  theme: Theme;
  lang: Lang;
  now: number;
  /** Go to an address (used by links on screens). */
  go(address: string): void;
  /** Show a short message in the status bar. */
  flash(text: string, kind?: 'ok' | 'warn' | 'bad'): void;
  /** Bumps when data should be read again. */
  tick: number;
  /** Leaves for something that talks in the terminal, and comes back at `back` (absent in tests and without a terminal). */
  leave?: (action: LeaveAction, back: string) => void;
}

/** What the control center leaves the screen for. */
export type LeaveAction = 'memory-setup' | 'sync-setup';

export const EnvContext = createContext<Env | null>(null);

export function useEnv(): Env {
  const e = useContext(EnvContext);
  if (!e) throw new Error('EnvContext missing');
  return e;
}

export function useT(): (key: MessageKey, params?: Record<string, string | number>) => string {
  const { lang } = useEnv();
  return (key, params) => tIn(lang, key, params);
}

export type KeyHandler = (input: string, key: Key) => boolean;

/**
 * Screens that take keys (editors, inputs, link lists) register handlers here while they are open. The app
 * offers each key to every registered handler, newest first, until one takes it.
 */
export interface KeyScope {
  handlers: KeyHandler[];
}

export const KeyScopeContext = createContext<KeyScope | null>(null);

export function dispatchKey(scope: KeyScope, input: string, key: Key): boolean {
  for (const h of [...scope.handlers].reverse()) if (h(input, key)) return true;
  return false;
}

export function useScreenKeys(handler: KeyHandler, active: boolean): void {
  const scope = useContext(KeyScopeContext);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!scope || !active) return;
    const h: KeyHandler = (i, k) => ref.current(i, k);
    scope.handlers.push(h);
    return () => {
      scope.handlers = scope.handlers.filter((x) => x !== h);
    };
  }, [scope, active]);
}

export const defaultTheme = makeTheme();

// ── pieces ──

export function Title({ children }: { children: ReactNode }) {
  const { theme } = useEnv();
  return (
    <Text bold color={theme.accent}>
      {children}
    </Text>
  );
}

export function Muted({ children, wrap }: { children: ReactNode; wrap?: 'wrap' | 'truncate-end' }) {
  const { theme } = useEnv();
  return (
    <Text color={theme.muted} wrap={wrap ?? 'wrap'}>
      {children}
    </Text>
  );
}

export function Section({ title, children, gap = 1 }: { title?: string; children: ReactNode; gap?: number }) {
  return (
    <Box flexDirection="column" marginBottom={gap}>
      {title ? <Title>{title}</Title> : null}
      {children}
    </Box>
  );
}

export function StateMark({ state, word = true }: { state: HealthState; word?: boolean }) {
  const { theme } = useEnv();
  const t = useT();
  return (
    <Text color={stateColor(theme, state)}>
      {stateSymbol(theme, state)}
      {word ? ' ' + t(`health.state.${state}` as MessageKey) : ''}
    </Text>
  );
}

/** A label: value row with the label column aligned. */
export function Row({ label, children, width = 22, color }: { label: string; children: ReactNode; width?: number; color?: string }) {
  const { theme } = useEnv();
  return (
    <Box>
      <Box width={width} flexShrink={0} paddingRight={1}>
        <Text color={theme.muted} wrap="truncate-end">
          {label}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text {...(color ? { color } : {})} wrap="wrap">
          {children}
        </Text>
      </Box>
    </Box>
  );
}

/** A labelled bar for 0-100 values (quota windows, limits). */
export function Gauge({ label, pct, width, right, labelWidth = 14 }: { label: string; pct: number; width: number; right?: string; labelWidth?: number }) {
  const { theme } = useEnv();
  const w = Math.max(6, width);
  const color = pct >= 95 ? theme.bad : pct >= 80 ? theme.warn : theme.ok;
  return (
    <Box>
      <Box width={labelWidth} flexShrink={0}>
        <Text wrap="truncate-end">{label}</Text>
      </Box>
      <Text color={color}>{barText(pct, w, theme.plain)}</Text>
      {right ? <Text> {right}</Text> : null}
    </Box>
  );
}

export function Note({ children, kind = 'info' }: { children: ReactNode; kind?: 'info' | 'warn' | 'bad' | 'ok' }) {
  const { theme } = useEnv();
  const color = kind === 'warn' ? theme.warn : kind === 'bad' ? theme.bad : kind === 'ok' ? theme.ok : theme.muted;
  return (
    <Text color={color} wrap="wrap">
      {children}
    </Text>
  );
}

/** What an empty screen says: what would be here and how to get it. */
export function Empty({ children }: { children: ReactNode }) {
  const { theme } = useEnv();
  return (
    <Box marginTop={1}>
      <Text color={theme.muted} wrap="wrap">
        {children}
      </Text>
    </Box>
  );
}

export interface ListItem {
  key: string;
  label: string;
  right?: string;
  state?: HealthState | 'info';
  dim?: boolean;
}

/** A scrolling list with one selected row. */
export function ListView({
  items,
  selected,
  height,
  width,
  focused,
}: {
  items: ListItem[];
  selected: number;
  height: number;
  width: number;
  focused: boolean;
}) {
  const { theme } = useEnv();
  // The "1-18 / 39" line takes a row of its own, so the rows never outgrow the height they were given.
  const counter = items.length > Math.max(1, height);
  const h = Math.max(1, counter ? height - 1 : height);
  const start = Math.max(0, Math.min(selected - Math.floor(h / 2), items.length - h));
  const visibleItems = items.slice(start, start + h);
  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      {visibleItems.map((it, i) => {
        const idx = start + i;
        const sel = idx === selected;
        const mark = sel ? theme.sym.cursor : ' ';
        const color = it.state && it.state !== 'info' ? stateColor(theme, it.state) : undefined;
        // Row: cursor, space, label, at least one space, badge, one space. The label keeps at least 12 columns; the badge gives way first.
        const inner = Math.max(4, width - 2);
        const rightMax = Math.max(0, inner - Math.min(textWidth(it.label), 12) - 2);
        const right = it.right ? fitWidth(it.right, Math.min(rightMax, Math.ceil(inner * 0.45))) : '';
        const label = fitWidth(it.label, Math.max(1, inner - (right ? textWidth(right) + 2 : 0)));
        return (
          <Box key={it.key} width={width} flexShrink={0}>
            <Text inverse={sel && focused} bold={sel} {...(it.dim ? { color: theme.muted } : {})} wrap="truncate-end">
              {mark} {label}
            </Text>
            <Box flexGrow={1} />
            {right ? (
              <Text {...(color ? { color } : { color: theme.muted })} wrap="truncate-end">
                {right}{' '}
              </Text>
            ) : null}
          </Box>
        );
      })}
      {counter ? (
        <Text color={theme.muted}>
          {' '}
          {start + 1}-{Math.min(items.length, start + h)} / {items.length}
        </Text>
      ) : null}
    </Box>
  );
}

/** A small table: header row bold, columns padded to the widest cell (truncated to the space given). */
export function Table({ rows, widths, right = [] }: { rows: string[][]; widths: number[]; right?: number[] }) {
  const { theme } = useEnv();
  return (
    <Box flexDirection="column">
      {rows.map((r, i) => (
        <Box key={i}>
          {r.map((cell, c) => {
            const w = widths[c] ?? 10;
            const text = cell.length > w - 1 ? cell.slice(0, Math.max(1, w - 2)) + '…' : cell;
            const padded = right.includes(c) ? text.padStart(w - 1) + ' ' : text.padEnd(w);
            return (
              <Text key={c} bold={i === 0} {...(i === 0 ? { color: theme.muted } : {})}>
                {padded}
              </Text>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

/** Key hints at the bottom of the screen: "↑↓ move  → open  …". */
export function KeyHints({ hints }: { hints: [string, string][] }) {
  const { theme } = useEnv();
  return (
    <Box flexWrap="wrap">
      {hints.map(([k, v]) => (
        <Box key={k + v} marginRight={2}>
          <Text bold color={theme.accent}>
            {k}
          </Text>
          <Text color={theme.muted}> {v}</Text>
        </Box>
      ))}
    </Box>
  );
}
