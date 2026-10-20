// SPDX-License-Identifier: Apache-2.0
/**
 * The control center. Three columns (where you came from · where you are · what is selected), a bar at the bottom
 * that says what is under the focus or the pointer and which keys work there, and the same keys everywhere:
 *   ↑↓ move · →/Enter open · ←/Esc back · 1-8 categories · / filter · Ctrl+K go anywhere · ? help · r refresh · q quit
 * The mouse does what the keys do (docs/design.md, One way to act): a click acts on what it lands on, pointing at
 * something says what it is, the wheel scrolls what is under the pointer.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize, type Key } from 'ink';
import { APP_NAME } from '../core/app.js';
import { tIn, type MessageKey } from '../core/i18n/index.js';
import { fold } from '../core/text.js';
import { percent } from '../core/format.js';
import { keyBar, notice, type Hint } from '../core/ux/kit.js';
import { TOAST_MS } from '../core/ux/tokens.js';
import { allEntries, CATEGORY_IDS, resolve, resolveAddress, searchEntries, visible, type NavNode } from './nav.js';
import type { DataSource } from './store.js';
import { buildTree } from './tree.js';
import { makeTheme, noColorAsked, stateColor, type Theme } from './theme.js';
import { inkHost } from './kit.js';
import { textWidth } from '../node/width.js';
import type { PointerEvent, PointerHub } from './pointer.js';
import { PointerContext, PointerRegistry, Pressable } from './press.js';
import {
  dispatchKey,
  EnvContext,
  HintContext,
  KeyScopeContext,
  ListView,
  Muted,
  ProseWidth,
  prose,
  type Env,
  type HintRegistry,
  type KeyScope,
  type LeaveAction,
  type ListItem,
  type ScreenHint,
} from './ui.js';

export interface AppProps {
  data: DataSource;
  /** Address to open at start ("security/rules"). */
  address?: string | null;
  plain?: boolean;
  /** Colour off (NO_COLOR); read from the environment when not given. */
  noColor?: boolean;
  /** Fixed clock for tests. */
  now?: () => number;
  size?: { columns: number; rows: number };
  /** Leaves the control center for something that talks in the terminal (the memory setup), then comes back at `back`. */
  onLeave?: (action: LeaveAction, back: string) => void;
  /** The pointer's events (src/tui/pointer.ts), where the terminal reports the mouse. */
  pointer?: PointerHub;
  /**
   * Called just before the control center ends, while the screen is still its own: what was turned on for it is
   * turned off there (the mouse; under Windows' console a mode turned off after the screen was left is lost).
   */
  onQuit?: () => void;
  /** Hands over what the pointer can reach (tests point at every target of a screen). */
  onRegistry?: (registry: PointerRegistry) => void;
}

interface Flash {
  text: string;
  kind: 'ok' | 'warn' | 'bad';
  at: number;
  /** Takes back what the message reports (u, or a click on it). */
  undo?: () => void;
}

function itemsOf(nodes: NavNode[]): ListItem[] {
  return nodes.map((n) => ({ key: n.id, label: n.label, ...(n.badge ? { right: n.badge.text, state: n.badge.state ?? 'info' } : {}) }));
}

export function App(props: AppProps) {
  const { data } = props;
  const app = useApp();
  const win = useWindowSize();
  const columns = props.size?.columns ?? win.columns ?? 100;
  const rows = props.size?.rows ?? win.rows ?? 30;
  const clock = props.now ?? Date.now;
  const config = data.config();
  const noColor = props.noColor ?? noColorAsked(process.env);
  const theme = useMemo(
    () =>
      makeTheme({
        plain: props.plain || config.accessibility.plain,
        highContrast: config.accessibility.highContrast,
        reduceMotion: config.accessibility.reduceMotion,
        noColor,
      }),
    [props.plain, config.accessibility.plain, config.accessibility.highContrast, config.accessibility.reduceMotion, noColor],
  );
  const kit = useMemo(() => inkHost(theme), [theme]);
  const lang = data.lang;
  const view = config.view;
  const t = (k: MessageKey, p?: Record<string, string | number>) => tIn(lang, k, p);

  const [tick, setTick] = useState(0);
  const now = useMemo(() => clock(), [tick]);
  // Every page, whatever the view: an address and the palette reach them all (docs/design.md, the view level hides
  // pages from the lists only, never a setting).
  const roots = useMemo(() => buildTree(data, lang, now), [tick, lang, view, data]);

  // ── navigation state ──
  /** A page the view hides that was asked for by its address: the lists along its way show it. */
  const [reveal, setReveal] = useState<string | null>(null);
  const shown = (nodes: NavNode[], prefix: readonly string[], open: string | null = reveal) =>
    nodes.filter((n) => {
      if (visible(n, view)) return true;
      const a = [...prefix, n.id].join('/');
      return open !== null && (open === a || open.startsWith(`${a}/`));
    });
  const [chain, setChain] = useState<string[]>([]);
  const [sel, setSel] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<{ text: string; typing: boolean } | null>(null);
  const [overlay, setOverlay] = useState<'help' | 'palette' | null>(null);
  const [palette, setPalette] = useState({ text: '', sel: 0 });
  const [flash, setFlash] = useState<Flash | null>(null);
  const [scroll, setScroll] = useState(0);
  const keyScope = useRef<KeyScope>({ handlers: [] }).current;
  // What the pointer can reach, and what it rests on; the keys the open screen adds to the bar.
  const pointer = useRef(new PointerRegistry()).current;
  useEffect(() => {
    props.onRegistry?.(pointer);
  }, []);
  const [hover, setHover] = useState<{ id: string | null; describe: string | null }>({ id: null, describe: null });
  pointer.onHoverGone = () => setHover({ id: null, describe: null });
  const [screenHints, setScreenHints] = useState<ReadonlyMap<string, { current: ScreenHint[] }>>(new Map());
  const hintRegistry = useMemo<HintRegistry>(
    () => ({
      set: (id, hints) =>
        setScreenHints((m) => {
          if (hints === null && !m.has(id)) return m;
          const next = new Map(m);
          if (hints === null) next.delete(id);
          else next.set(id, hints);
          return next;
        }),
    }),
    [],
  );

  const chainNodes = useMemo(() => resolve(roots, chain.join('/'), 'detailed'), [roots, chain]);
  const listOwner = chainNodes[chainNodes.length - 1] ?? null;
  const listKey = chain.join('/');
  const allHere = useMemo(() => (listOwner ? (listOwner.children?.() ?? []) : roots), [listOwner, roots]);
  const rawList = useMemo(() => shown(allHere, chain), [allHere, view, reveal, chain]);
  /** Pages of this list the view leaves out: a line under it says how many, and where the view is changed. */
  const hidden = allHere.length - rawList.length;
  const list = useMemo(() => {
    if (!filter?.text) return rawList;
    const f = fold(filter.text);
    return rawList.filter((n) => fold([n.label, ...(n.keywords ?? [])].join(' ')).includes(f));
  }, [rawList, filter]);
  const index = Math.min(sel[listKey] ?? 0, Math.max(0, list.length - 1));
  const selected = list[index] ?? null;

  const go = (address: string) => {
    // An old address (the map before 1.2) leads where its page went.
    const target = resolveAddress(roots, address);
    const nodes = target.chain;
    if (!nodes.length) {
      showFlash(t('nav.notFound', { address }), 'warn');
      return;
    }
    const ids = nodes.map((n) => n.id);
    const last = nodes[nodes.length - 1]!;
    setReveal(target.address);
    // Select each node along the way in its list, so ← walks back through the same places.
    const updates: Record<string, number> = {};
    let level: NavNode[] = shown(roots, [], target.address);
    nodes.forEach((n, i) => {
      updates[ids.slice(0, i).join('/')] = Math.max(
        0,
        level.findIndex((x) => x.id === n.id),
      );
      level = n.children ? shown(n.children(), ids.slice(0, i + 1), target.address) : [];
    });
    setSel((s) => ({ ...s, ...updates }));
    setFilter(null);
    setOverlay(null);
    if (last.children && !last.screen) {
      setChain(ids);
      setOpen(false);
    } else {
      setChain(ids.slice(0, -1));
      setOpen(!!last.screen);
    }
  };

  const quit = () => {
    props.onQuit?.();
    app.exit();
  };
  const showFlash = (text: string, kind: Flash['kind'] = 'ok', undo?: () => void) => {
    setFlash({ text, kind, at: Date.now(), ...(undo ? { undo } : {}) });
    // A change was made: the lists beside it read their badges again ("off" turns "on" there too).
    if (undo) setTick((x) => x + 1);
  };
  // A note goes after a few seconds, the result of a change (with its undo) stays longer, a problem longest.
  useEffect(() => {
    if (!flash) return;
    const h = setTimeout(() => setFlash(null), flash.kind !== 'ok' ? TOAST_MS.attention : flash.undo ? TOAST_MS.result : TOAST_MS.note);
    return () => clearTimeout(h);
  }, [flash]);
  const undo = () => {
    const u = flash?.undo;
    if (!u) return false;
    setFlash(null);
    u();
    setTick((x) => x + 1);
    return true;
  };

  useEffect(() => {
    if (props.address) go(props.address);
  }, []);

  useEffect(() => setScroll(0), [open, listKey, index]);

  // Live numbers (quota, events) refresh by themselves; the session index on "r".
  useEffect(() => {
    const h = setInterval(() => setTick((x) => x + 1), 15_000);
    return () => clearInterval(h);
  }, []);

  const env: Env = {
    data,
    theme,
    lang,
    now,
    go,
    place: (address) =>
      resolveAddress(roots, address)
        .chain.map((n) => n.label)
        .join(' › '),
    flash: showFlash,
    tick,
    still: theme.reduceMotion || !!props.now,
    ...(props.onLeave
      ? {
          leave: (action: LeaveAction, back: string) => {
            props.onLeave!(action, back);
            quit();
          },
        }
      : {}),
  };

  const move = (delta: number) => setSel((s) => ({ ...s, [listKey]: Math.max(0, Math.min(list.length - 1, index + delta)) }));
  const enterNode = (node: NavNode | null) => {
    if (!node) return;
    if (node.children) {
      setChain([...chain, node.id]);
      setFilter(null);
    } else if (node.screen) setOpen(true);
  };
  const enter = () => enterNode(selected);
  /** A click on a row of the list: it is selected and opened, as Enter would. */
  const openAt = (i: number) => {
    setSel((s) => ({ ...s, [listKey]: i }));
    enterNode(list[i] ?? null);
  };
  /** Where a crumb of the location bar leads: the start, or the level it names. */
  const toLevel = (k: number) => {
    setChain(chain.slice(0, k));
    setOpen(false);
    setFilter(null);
  };
  const back = () => {
    if (open) {
      setOpen(false);
      return;
    }
    if (filter) {
      setFilter(null);
      return;
    }
    if (chain.length) {
      const parent = chain.slice(0, -1);
      setChain(parent);
    }
  };

  // The palette finds every page, those the view leaves out of the lists too, by its old place as well.
  const paletteEntries = useMemo(() => (overlay === 'palette' ? allEntries(roots, 'detailed') : []), [overlay, roots]);
  const paletteRoom = Math.max(1, rows - 4 - 2 - 3);
  const paletteResults = useMemo(
    () => searchEntries(paletteEntries, palette.text, fold, Math.min(12, paletteRoom)),
    [paletteEntries, palette.text, paletteRoom],
  );

  // The pointer: the target under it acts or describes itself; a wheel step nothing took scrolls the page or the list.
  const onPointer = useRef<(e: PointerEvent) => void>(() => {});
  onPointer.current = (e) => {
    const r = pointer.dispatch(e);
    if (r.hoverChanged) setHover({ id: pointer.hovered, describe: r.describe });
    if (e.kind === 'wheel' && !r.wheeled && !overlay) {
      const d = e.wheel === 'up' ? -1 : 1;
      if (open) setScroll((s) => Math.max(0, s + d));
      else move(d);
    }
  };
  useEffect(() => props.pointer?.on((e) => onPointer.current(e)), [props.pointer]);

  useInput((input: string, key: Key) => {
    // 0. Ctrl+C ends it from anywhere (the app ends itself, so what it turned on is turned off first)
    if (key.ctrl && input === 'c') {
      quit();
      return;
    }
    // 1. overlays take every key
    if (overlay === 'help') {
      if (key.escape || input === '?' || input === 'q' || key.return) setOverlay(null);
      return;
    }
    if (overlay === 'palette') {
      if (key.escape) setOverlay(null);
      else if (key.return) {
        const e = paletteResults[palette.sel];
        if (e) go(e.address);
      } else if (key.upArrow) setPalette((p) => ({ ...p, sel: Math.max(0, p.sel - 1) }));
      else if (key.downArrow) setPalette((p) => ({ ...p, sel: Math.min(paletteResults.length - 1, p.sel + 1) }));
      else if (key.backspace || key.delete) setPalette((p) => ({ text: p.text.slice(0, -1), sel: 0 }));
      else if (input && !key.ctrl && !key.meta) setPalette((p) => ({ text: p.text + input, sel: 0 }));
      return;
    }
    if (key.ctrl && input === 'k') {
      setPalette({ text: '', sel: 0 });
      setOverlay('palette');
      return;
    }
    // 2. an open screen that takes keys (fields, lists) goes first
    if (open && dispatchKey(keyScope, input, key)) return;
    // 3. the list filter while typing
    if (filter?.typing) {
      if (key.escape) setFilter(null);
      else if (key.return) setFilter({ ...filter, typing: false });
      else if (key.backspace || key.delete) setFilter({ ...filter, text: filter.text.slice(0, -1) });
      else if (key.upArrow) move(-1);
      else if (key.downArrow) move(1);
      else if (input && !key.ctrl && !key.meta) {
        setFilter({ ...filter, text: filter.text + input });
        setSel((s) => ({ ...s, [listKey]: 0 }));
      }
      return;
    }
    // 4. the same keys everywhere; u takes back the change the bar reports (docs/design.md, Say, do, undo)
    if (input === 'u' && !key.ctrl && undo()) return;
    if (input === 'q' && !open) {
      quit();
      return;
    }
    if (input === 'q' && open) {
      setOpen(false);
      return;
    }
    if (input === '?') {
      setOverlay('help');
      return;
    }
    if (input === 'r') {
      data.refresh();
      setTick((x) => x + 1);
      showFlash(t('nav.refreshed'));
      return;
    }
    if (/^[1-8]$/.test(input)) {
      const id = CATEGORY_IDS[parseInt(input, 10) - 1]!;
      const node = roots.find((n) => n.id === id);
      const i = shown(roots, []).findIndex((n) => n.id === id);
      // A category that is one screen (Now) opens it; the others open their list.
      if (node && node.screen && !node.children) go(id);
      else if (i >= 0) {
        setSel((s) => ({ ...s, '': i }));
        setChain([id]);
        setOpen(false);
        setFilter(null);
      }
      return;
    }
    if (key.escape || key.leftArrow || input === 'h') {
      back();
      return;
    }
    if (open) {
      // Keys no open screen took scroll it.
      if (key.upArrow || input === 'k') setScroll((s) => Math.max(0, s - 1));
      else if (key.downArrow || input === 'j') setScroll((s) => s + 1);
      else if (key.pageUp) setScroll((s) => Math.max(0, s - 10));
      else if (key.pageDown) setScroll((s) => s + 10);
      else if (key.home || input === 'g') setScroll(0);
      return;
    }
    if (key.upArrow || input === 'k') move(-1);
    else if (key.downArrow || input === 'j') move(1);
    else if (key.pageUp) move(-10);
    else if (key.pageDown) move(10);
    else if (key.home || input === 'g') setSel((s) => ({ ...s, [listKey]: 0 }));
    else if (key.end || input === 'G') setSel((s) => ({ ...s, [listKey]: list.length - 1 }));
    else if (key.return || key.rightArrow || input === 'l') enter();
    else if (input === '/') setFilter({ text: '', typing: true });
  });

  // ── layout ──
  const bodyH = Math.max(6, rows - 4);
  const crumbs = [APP_NAME, ...chainNodes.map((n) => n.label), ...(open && selected ? [selected.label] : [])];
  const address = [...chain, ...(selected ? [selected.id] : [])].join('/');
  const health = data.health();
  const belt = health.features.find((f) => f.id === 'belt');
  const q = data.quota();

  // Each crumb of the location bar leads back to its level with a click; the screen open now is where you are.
  const header = (
    <Box width={columns} justifyContent="space-between">
      <Box flexShrink={1} overflow="hidden">
        {crumbs.map((c, k) => {
          const here = k === crumbs.length - 1;
          const label = (
            <Text bold {...(k === 0 ? { color: theme.accent } : {})} wrap="truncate-end">
              {c}
            </Text>
          );
          return (
            <Box key={k} flexShrink={k === 0 ? 0 : 1}>
              {k ? <Text color={theme.muted}>{theme.sym.sep}</Text> : null}
              {here ? (
                label
              ) : (
                <Pressable onPress={() => toLevel(k)} describe={t('nav.toLevel', { place: c })}>
                  {label}
                </Pressable>
              )}
            </Box>
          );
        })}
      </Box>
      <Text color={theme.muted} wrap="truncate-start">
        {belt ? (
          <Text color={stateColor(theme, belt.state)}>
            {theme.sym.shield} {t(`health.state.${belt.state}` as MessageKey)}
          </Text>
        ) : null}
        {q.assessment.week ? `  ${t('nav.week')} ${percent(q.assessment.week.used, lang)}` : ''}
        {q.assessment.five ? `  ${t('nav.five')} ${percent(q.assessment.five.used, lang)}` : ''}
      </Text>
    </Box>
  );

  // The keys that work here, the open screen's own first; each one a click does too, but moving (that is the rows).
  const openPalette = () => {
    setPalette({ text: '', sel: 0 });
    setOverlay('palette');
  };
  // A click runs what the screen holds at that moment (its row may have changed since the bar was drawn).
  const own: Hint[] = open
    ? [...screenHints.values()].flatMap((r) =>
        r.current.map((h, i) => ({ key: h.key, label: h.label, ...(h.run ? { onPress: () => r.current[i]?.run?.() } : {}) })),
      )
    : [];
  const allHints: Hint[] = overlay
    ? [{ key: 'Esc', label: t('keys.close'), onPress: () => setOverlay(null) }]
    : open
      ? [
          ...own,
          { key: '←/Esc', label: t('keys.back'), onPress: back },
          { key: '?', label: t('keys.help'), onPress: () => setOverlay('help') },
          { key: 'Ctrl+K', label: t('keys.palette'), onPress: openPalette },
          { key: 'q', label: t('keys.close'), onPress: () => setOpen(false) },
        ]
      : [
          { key: '↑↓', label: t('keys.move') },
          { key: '→', label: t('keys.open'), onPress: enter },
          { key: '←', label: t('keys.back'), onPress: back },
          { key: '1-8', label: t('keys.categories') },
          { key: '/', label: t('keys.filter'), onPress: () => setFilter({ text: '', typing: true }) },
          { key: 'Ctrl+K', label: t('keys.palette'), onPress: openPalette },
          { key: '?', label: t('keys.help'), onPress: () => setOverlay('help') },
          { key: 'q', label: t('keys.quit'), onPress: quit },
        ];
  // One line of hints: on a narrow terminal the less essential ones give way (help still lists them all).
  const hintWidth = (h: Hint[]) => h.reduce((n, k) => n + textWidth(k.key) + textWidth(k.label) + 3, 0);
  const hints = [...allHints];
  for (const drop of ['1-8', '/', 'Ctrl+K', '←', '?']) {
    if (hintWidth(hints) <= columns) break;
    const i = hints.findIndex((k) => k.key === drop);
    if (i >= 0) hints.splice(i, 1);
  }
  // Still too wide: the screen's own keys give way from the last (its first one stays), then the rest from the end.
  for (let mine = overlay ? 0 : own.length; hintWidth(hints) > columns && hints.length > 1;) {
    if (mine > 1) hints.splice(--mine, 1);
    else hints.pop();
  }

  // The bar: what was just done (and its undo), else what the pointer rests on, else the address of the screen (the
  // one the palette and the command line take).
  const context = flash
    ? notice(kit, {
        meaning: flash.kind === 'bad' ? 'bad' : flash.kind === 'warn' ? 'ask' : 'on',
        text: flash.text,
        ...(flash.undo ? { undo: { id: 'undo', label: t('keys.undo'), keyName: 'u', onPress: () => void undo() } } : {}),
      })
    : hover.describe
      ? notice(kit, { meaning: 'focus', text: hover.describe })
      : kit.text({ wrap: 'truncate-end', ...(theme.muted ? { color: theme.muted } : {}) }, address ? `${t('nav.address')}: ${address}` : ' ');
  const footer = (
    <Box width={columns} flexDirection="column">
      <Box width={columns} overflow="hidden">
        {context}
      </Box>
      {keyBar(kit, hints)}
    </Box>
  );

  let body: React.ReactNode;
  if (overlay === 'help') body = <Help env={env} width={columns} height={bodyH} />;
  else if (overlay === 'palette')
    body = (
      <Box flexDirection="column" width={columns} height={bodyH} borderStyle={theme.border} borderColor={theme.accent} paddingX={1}>
        <Box>
          <Text bold>{t('palette.title')}</Text>
          <Text color={theme.muted}> {t('palette.hint')}</Text>
        </Box>
        <Box>
          <Text color={theme.accent}>{'> '}</Text>
          <Text>{palette.text}</Text>
          <Text inverse> </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          {paletteResults.length ? (
            paletteResults.map((e, i) => (
              <Pressable key={e.address} onPress={() => go(e.address)} describe={t('nav.toLevel', { place: e.path.join(theme.sym.sep) })}>
                <Text inverse={i === palette.sel} wrap="truncate-end">
                  {i === palette.sel ? theme.sym.cursor : ' '} {e.path.join(theme.sym.sep)} <Text color={theme.muted}>{e.address}</Text>
                </Text>
              </Pressable>
            ))
          ) : (
            <Muted>{t('palette.none')}</Muted>
          )}
        </Box>
      </Box>
    );
  else if (open && selected?.screen) {
    const side = columns >= 110 && list.length > 1;
    const sideW = side ? Math.min(30, Math.floor(columns * 0.24)) : 0;
    const mainW = columns - sideW;
    body = (
      <Box width={columns} height={bodyH}>
        {side ? (
          <Box width={sideW} flexDirection="column" borderStyle={theme.border} borderColor={theme.muted} overflow="hidden">
            <ListView
              items={itemsOf(list)}
              selected={index}
              height={bodyH - 3}
              width={sideW - 2}
              focused={false}
              onPress={(i) => setSel((s) => ({ ...s, [listKey]: i }))}
              describe={(i) => describeNode(list[i])}
            />
          </Box>
        ) : null}
        <Box width={mainW} height={bodyH} flexDirection="column" borderStyle={theme.border} borderColor={theme.accent} paddingX={1} overflow="hidden">
          <ProseWidth.Provider value={mainW - 4}>
            <Box flexDirection="column" flexShrink={0}>
              <Text bold>{selected.label}</Text>
              {selected.description ? <Muted>{selected.description}</Muted> : null}
            </Box>
            <Box marginTop={1} flexDirection="column" overflow="hidden" flexGrow={1}>
              <Box flexDirection="column" flexShrink={0} marginTop={-scroll}>
                {selected.screen({ width: mainW - 4, height: bodyH - 5, open: true })}
              </Box>
            </Box>
          </ProseWidth.Provider>
        </Box>
      </Box>
    );
  } else {
    const three = columns >= 100;
    const two = columns >= 64;
    const parentNodes = chainNodes.length ? resolve(roots, chain.slice(0, -1).join('/'), 'detailed') : [];
    const parentList = chainNodes.length
      ? shown(chain.length > 1 ? (parentNodes[parentNodes.length - 1]?.children?.() ?? []) : roots, chain.slice(0, -1))
      : null;
    const parentIndex = parentList
      ? Math.max(
          0,
          parentList.findIndex((n) => n.id === chain[chain.length - 1]),
        )
      : 0;
    const aW = three && parentList ? Math.min(28, Math.floor(columns * 0.2)) : 0;
    const bW = two ? Math.min(46, Math.floor((columns - aW) * 0.42)) : columns;
    const cW = columns - aW - bW;
    const more = hidden > 0 && !filter?.text;
    const listH = bodyH - 2 - (filter ? 1 : 0) - (more ? 1 : 0);
    body = (
      <Box width={columns} height={bodyH}>
        {aW && parentList ? (
          <Box width={aW} flexDirection="column" borderStyle={theme.border} borderColor={theme.muted} overflow="hidden">
            <ListView
              items={itemsOf(parentList)}
              selected={parentIndex}
              height={bodyH - 2}
              width={aW - 2}
              focused={false}
              onPress={(i) => go([...chain.slice(0, -1), parentList[i]!.id].join('/'))}
              describe={(i) => describeNode(parentList[i])}
            />
          </Box>
        ) : null}
        <Box width={bW} flexDirection="column" borderStyle={theme.border} borderColor={theme.accent} overflow="hidden">
          {list.length ? (
            <ListView
              items={itemsOf(list)}
              selected={index}
              height={listH}
              width={bW - 2}
              focused
              onPress={openAt}
              onMove={move}
              describe={(i) => describeNode(list[i])}
            />
          ) : (
            <Box paddingX={1}>
              <Muted>{filter?.text ? t('nav.noMatch') : t('nav.empty')}</Muted>
            </Box>
          )}
          {more ? (
            // The view leaves these out of the list, never out of reach: the palette finds them, a click changes the view.
            <Pressable onPress={() => go('settings/general')} describe={t('nav.hiddenCard', { place: env.place('settings/general') })}>
              <Text color={theme.muted} wrap="truncate-end">
                {` ${t('nav.hidden', { n: hidden })}`}
              </Text>
            </Pressable>
          ) : null}
          {filter ? (
            <Text color={theme.accent}>
              {' /'}
              {filter.text}
              {filter.typing ? <Text inverse> </Text> : null}
            </Text>
          ) : null}
        </Box>
        {cW > 10 ? (
          <Box width={cW} flexDirection="column" borderStyle={theme.border} borderColor={theme.muted} paddingX={1} overflow="hidden">
            <ProseWidth.Provider value={cW - 4}>
              {selected ? (
                <Preview node={selected} width={cW - 4} height={bodyH - 2} theme={theme} t={t} shown={(nodes) => shown(nodes, [...chain, selected.id])} />
              ) : null}
            </ProseWidth.Provider>
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <EnvContext.Provider value={env}>
      <KeyScopeContext.Provider value={keyScope}>
        <PointerContext.Provider value={{ registry: pointer, hovered: hover.id }}>
          <HintContext.Provider value={hintRegistry}>
            <Box flexDirection="column" width={columns} height={rows}>
              {header}
              {body}
              {footer}
            </Box>
          </HintContext.Provider>
        </PointerContext.Provider>
      </KeyScopeContext.Provider>
    </EnvContext.Provider>
  );
}

/** What a click on a row of the map does, said where the pointer rests: its name, and what it is for. */
function describeNode(n: NavNode | undefined): string | null {
  if (!n) return null;
  return n.description ? `${n.label}: ${n.description}` : n.label;
}

function Preview({
  node,
  width,
  height,
  theme,
  t,
  shown,
}: {
  node: NavNode;
  width: number;
  height: number;
  theme: Theme;
  t: (k: MessageKey) => string;
  /** The children the view lists. */
  shown: (nodes: NavNode[]) => NavNode[];
}) {
  if (node.children && !node.screen) {
    const kids = shown(node.children());
    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="column" flexShrink={0}>
          <Text bold>{node.label}</Text>
          {node.description ? <Muted>{node.description}</Muted> : null}
        </Box>
        <Box marginTop={1} flexDirection="column">
          {kids.slice(0, Math.max(1, height - 4)).map((k) => (
            <Text key={k.id} wrap="truncate-end">
              <Text color={theme.muted}>{theme.sym.more} </Text>
              {k.label}
              {k.badge ? <Text color={k.badge.state && k.badge.state !== 'info' ? stateColor(theme, k.badge.state) : theme.muted}> {k.badge.text}</Text> : null}
            </Text>
          ))}
          {kids.length > height - 4 ? <Muted>{`+${kids.length - (height - 4)}`}</Muted> : null}
          {!kids.length ? <Muted>{t('nav.empty')}</Muted> : null}
        </Box>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Box flexDirection="column" flexShrink={0}>
        <Text bold>{node.label}</Text>
        {node.description ? <Muted>{node.description}</Muted> : null}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Box flexDirection="column" flexShrink={0}>
          {node.screen?.({ width, height: height - 3, open: false })}
        </Box>
      </Box>
    </Box>
  );
}

function Help({ env, width, height }: { env: Env; width: number; height: number }) {
  const t = (k: MessageKey) => tIn(env.lang, k);
  const keys: [string, MessageKey][] = [
    ['↑ ↓  j k', 'help.k.move'],
    ['→ Enter l', 'help.k.open'],
    ['← Esc h', 'help.k.back'],
    ['1 … 8', 'help.k.categories'],
    ['/', 'help.k.filter'],
    ['Ctrl+K', 'help.k.palette'],
    ['r', 'help.k.refresh'],
    ['u', 'help.k.undo'],
    [t('help.mouseKey'), 'help.k.mouse'],
    ['?', 'help.k.help'],
    ['q', 'help.k.quit'],
  ];
  const terms: MessageKey[] = ['term.belt', 'term.mod', 'term.hook', 'term.quota', 'term.cache', 'term.keyword', 'term.view'];
  return (
    <Box flexDirection="column" width={width} height={height} borderStyle={env.theme.border} borderColor={env.theme.accent} paddingX={1} overflow="hidden">
      <Text bold>{t('help.title')}</Text>
      <Box marginTop={1} flexDirection="column">
        {keys.map(([k, v]) => (
          <Box key={k}>
            <Box width={14} flexShrink={0}>
              <Text bold color={env.theme.accent}>
                {k}
              </Text>
            </Box>
            <Text>{prose(t(v), width - 18)}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>{t('help.terms')}</Text>
        {terms.map((k) => (
          <Text key={k} wrap="wrap">
            {prose(t(k), width - 4)}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Muted>{t('help.close')}</Muted>
      </Box>
    </Box>
  );
}
