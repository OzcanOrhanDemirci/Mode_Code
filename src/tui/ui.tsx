// SPDX-License-Identifier: Apache-2.0
/** Building blocks every screen uses, so all screens look and behave the same. */
import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { Key } from 'ink';
import type { Lang, MessageKey } from '../core/i18n/index.js';
import { tIn } from '../core/i18n/index.js';
import { meter, opener, type KitHost, type MeterLevel } from '../core/ux/kit.js';
import { wrapText } from '../core/ux/text.js';
import { fitWidth, textWidth } from '../node/width.js';
import type { HealthState } from '../app/health.js';
import type { DataSource } from './store.js';
import { inkHost } from './kit.js';
import { Pressable, Wheel } from './press.js';
import { makeTheme, stateColor, stateSymbol, type Theme } from './theme.js';

// ── context: data, theme, language, navigation, key routing ──

export interface Env {
  data: DataSource;
  theme: Theme;
  lang: Lang;
  now: number;
  /** Go to an address (used by links on screens). */
  go(address: string): void;
  /** An address as the person reads it: "Settings › Features". */
  place(address: string): string;
  /** Show a short message in the bar at the bottom; with `undo`, it offers to take back what it reports (u). */
  flash(text: string, kind?: 'ok' | 'warn' | 'bad', undo?: () => void): void;
  /** Bumps when data should be read again. */
  tick: number;
  /** Nothing moves: motion is reduced, or the clock is fixed (tests, the README's pictures). */
  still: boolean;
  /** Leaves for something that talks in the terminal, and comes back at `back` (absent in tests and without a terminal). */
  leave?: (action: LeaveAction, back: string) => void;
}

/** What the control center leaves the screen for. */
export type LeaveAction = 'memory-setup' | 'sync-setup' | 'update';

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
  // In the commit that draws the screen, as the pointer's targets are (src/tui/press.tsx): a key typed right after a
  // screen opens reaches it, instead of scrolling it (a passive effect left that gap; seen on a slow CI runner).
  useLayoutEffect(() => {
    if (!scope || !active) return;
    const h: KeyHandler = (i, k) => ref.current(i, k);
    scope.handlers.push(h);
    return () => {
      scope.handlers = scope.handlers.filter((x) => x !== h);
    };
  }, [scope, active]);
}

export const defaultTheme = makeTheme();

/** The UI kit (src/core/ux/kit.ts), drawn with this screen's theme. */
export function useKit(): KitHost<ReactNode> {
  const { theme } = useEnv();
  return useMemo(() => inkHost(theme), [theme]);
}

// ── pieces ──

export function Title({ children }: { children: ReactNode }) {
  const { theme } = useEnv();
  return (
    <Text bold color={theme.accent}>
      {children}
    </Text>
  );
}

/**
 * The columns prose has where it is drawn: the open screen's, the preview's. Text in these pieces is wrapped here at
 * word boundaries (src/core/ux/text.ts), so no line starts with the space a break fell on, as Ink's own wrap leaves it
 * (docs/design.md, Grid and spacing). Unknown (null), Ink wraps.
 */
export const ProseWidth = createContext<number | null>(null);

/** The words of children that are only text, or null when they hold anything else. */
function plainText(children: ReactNode): string | null {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children) && children.every((c) => typeof c === 'string' || typeof c === 'number')) return children.join('');
  return null;
}

/** Text children wrapped to `width` columns; anything else as it is. */
export function prose(children: ReactNode, width: number | null): ReactNode {
  const text = width === null ? null : plainText(children);
  return text === null ? children : wrapText(text, Math.max(8, width!), textWidth).join('\n');
}

export function Muted({ children, wrap }: { children: ReactNode; wrap?: 'wrap' | 'truncate-end' }) {
  const { theme } = useEnv();
  const width = useContext(ProseWidth);
  return (
    <Text color={theme.muted} wrap={wrap ?? 'wrap'}>
      {wrap === 'truncate-end' ? children : prose(children, width)}
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

/** A label: value row with the label column aligned; a long value wraps under itself, never under the label. */
export function Row({ label, children, width = 22, color }: { label: string; children: ReactNode; width?: number; color?: string | undefined }) {
  const { theme } = useEnv();
  const room = useContext(ProseWidth);
  return (
    <Box>
      <Box width={width} flexShrink={0} paddingRight={1}>
        <Text color={theme.muted} wrap="truncate-end">
          {label}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text {...(color ? { color } : {})} wrap="wrap">
          {prose(children, room === null ? null : room - width)}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * A labelled meter for 0-100 values (quota periods, limits): the kit's meter, its track showing where it ends, the
 * threshold marked when there is one (a budget), and words beside it once it is near or over.
 */
export function Gauge({
  label,
  pct,
  width,
  right,
  labelWidth = 14,
  threshold = null,
}: {
  label: string;
  pct: number;
  width: number;
  right?: string;
  labelWidth?: number;
  threshold?: number | null;
}) {
  const kit = useKit();
  const t = useT();
  const words: Record<MeterLevel, string> = { low: '', near: t('meter.near'), over: t(threshold === null ? 'meter.full' : 'meter.over') };
  return <>{meter(kit, { label, labelWidth, pct, width: Math.max(6, width), value: right ?? '', threshold, words })}</>;
}

export function Note({ children, kind = 'info' }: { children: ReactNode; kind?: 'info' | 'warn' | 'bad' | 'ok' }) {
  const { theme } = useEnv();
  const width = useContext(ProseWidth);
  const color = kind === 'warn' ? theme.warn : kind === 'bad' ? theme.bad : kind === 'ok' ? theme.ok : theme.muted;
  return (
    <Text color={color} wrap="wrap">
      {prose(children, width)}
    </Text>
  );
}

/** What an empty screen says: what would be here and how to get it. */
export function Empty({ children }: { children: ReactNode }) {
  const { theme } = useEnv();
  const width = useContext(ProseWidth);
  return (
    <Box marginTop={1}>
      <Text color={theme.muted} wrap="wrap">
        {prose(children, width)}
      </Text>
    </Box>
  );
}

/**
 * An empty page that leads on (docs/design.md, Voice: every empty page says what will appear there, and the one thing
 * that makes it appear): its words, and the page where that is done, a press away (Enter, or a click on it).
 */
export function EmptyState({ text, to, open }: { text: string; to: string; open: boolean }) {
  const env = useEnv();
  const kit = useKit();
  const t = useT();
  const width = useContext(ProseWidth) ?? 60;
  const place = env.place(to);
  const follow = () => env.go(to);
  useScreenKeys((_input, key) => {
    if (!key.return) return false;
    follow();
    return true;
  }, open);
  useHints([{ key: 'Enter', label: t('keys.open'), run: follow }], open);
  return (
    <Box marginTop={1} flexDirection="column" width={width}>
      <Text color={env.theme.muted}>{prose(text, width)}</Text>
      <Box marginTop={1}>
        {opener(kit, { id: `empty-${to}`, label: place.split(' › ').at(-1) ?? place, describe: t('now.goCard', { place }), onPress: follow })}
      </Box>
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

/**
 * A scrolling list with one selected row. With `onPress`, a click on a row does what Enter does on it, and the wheel
 * over the list moves the selection (`onMove`).
 */
export function ListView({
  items,
  selected,
  height,
  width,
  focused,
  onPress,
  onMove,
  describe,
}: {
  items: ListItem[];
  selected: number;
  height: number;
  width: number;
  focused: boolean;
  onPress?: ((index: number) => void) | undefined;
  onMove?: ((delta: number) => void) | undefined;
  /** What a click on the row does, for the bar at the bottom while the pointer is on it. */
  describe?: ((index: number) => string | null) | undefined;
}) {
  const { theme } = useEnv();
  // The "1-18 / 39" line takes a row of its own, so the rows never outgrow the height they were given.
  const counter = items.length > Math.max(1, height);
  const h = Math.max(1, counter ? height - 1 : height);
  const start = Math.max(0, Math.min(selected - Math.floor(h / 2), items.length - h));
  const visibleItems = items.slice(start, start + h);
  const rows = (
    <>
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
        const line = (hovered: boolean) => (
          <>
            <Text inverse={sel && focused} bold={sel} underline={hovered} {...(it.dim ? { color: theme.muted } : {})} wrap="truncate-end">
              {mark} {label}
            </Text>
            <Box flexGrow={1} />
            {right ? (
              <Text {...(color ? { color } : { color: theme.muted })} wrap="truncate-end">
                {right}{' '}
              </Text>
            ) : null}
          </>
        );
        return onPress ? (
          <Pressable key={it.key} width={width} onPress={() => onPress(idx)} describe={describe?.(idx) ?? undefined}>
            {line}
          </Pressable>
        ) : (
          <Box key={it.key} width={width} flexShrink={0}>
            {line(false)}
          </Box>
        );
      })}
      {counter ? (
        <Text color={theme.muted}>
          {' '}
          {start + 1}-{Math.min(items.length, start + h)} / {items.length}
        </Text>
      ) : null}
    </>
  );
  return onMove ? (
    <Wheel flexDirection="column" width={width} flexShrink={0} onWheel={(dir) => (onMove(dir === 'up' ? -1 : 1), true)}>
      {rows}
    </Wheel>
  ) : (
    <Box flexDirection="column" width={width} flexShrink={0}>
      {rows}
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

/** A key an open screen takes, as the bar at the bottom shows it; with `run`, a click on it does the same. */
export interface ScreenHint {
  key: string;
  label: string;
  run?: () => void;
}

/** Where open screens put their keys for the bar at the bottom (the app keeps them while the screen is drawn). */
export interface HintRegistry {
  set(id: string, hints: { current: ScreenHint[] } | null): void;
}

export const HintContext = createContext<HintRegistry | null>(null);

/**
 * Puts a screen's keys in the bar while `active` (docs/design.md: every click target shows its key, and what a key
 * reaches can be clicked). `run` does what the key does; the key itself stays the screen's (useScreenKeys).
 */
export function useHints(hints: ScreenHint[], active: boolean): void {
  const registry = useContext(HintContext);
  const id = useId();
  const ref = useRef(hints);
  ref.current = hints;
  const shape = hints.map((h) => `${h.key}\u0000${h.label}\u0000${h.run ? 1 : 0}`).join('\u0001');
  useEffect(() => {
    if (!registry || !active) return;
    registry.set(id, ref);
    return () => registry.set(id, null);
  }, [registry, active, id, shape]);
}
