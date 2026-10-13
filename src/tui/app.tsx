// SPDX-License-Identifier: Apache-2.0
/**
 * The control center. Three columns (where you came from · where you are · what is selected), a location
 * bar with the address of the screen, and the same keys everywhere:
 *   ↑↓ move · →/Enter open · ←/Esc back · 1-7 categories · / filter · Ctrl+K go anywhere · ? help · r refresh · q quit
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize, type Key } from 'ink';
import { APP_NAME } from '../core/app.js';
import { tIn, type MessageKey } from '../core/i18n/index.js';
import { fold } from '../core/text.js';
import { percent } from '../core/format.js';
import { allEntries, CATEGORY_IDS, resolve, searchEntries, visible, type NavNode } from './nav.js';
import type { DataSource } from './store.js';
import { buildTree } from './tree.js';
import { makeTheme, stateColor, type Theme } from './theme.js';
import { dispatchKey, EnvContext, KeyHints, KeyScopeContext, ListView, Muted, type Env, type KeyScope, type LeaveAction, type ListItem } from './ui.js';

export interface AppProps {
  data: DataSource;
  /** Address to open at start ("security/rules"). */
  address?: string | null;
  plain?: boolean;
  /** Fixed clock for tests. */
  now?: () => number;
  size?: { columns: number; rows: number };
  /** Leaves the control center for something that talks in the terminal (the memory setup), then comes back at `back`. */
  onLeave?: (action: LeaveAction, back: string) => void;
}

interface Flash {
  text: string;
  kind: 'ok' | 'warn' | 'bad';
  at: number;
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
  const theme = useMemo(
    () =>
      makeTheme({
        plain: props.plain || config.accessibility.plain,
        highContrast: config.accessibility.highContrast,
        reduceMotion: config.accessibility.reduceMotion,
      }),
    [props.plain, config.accessibility.plain, config.accessibility.highContrast, config.accessibility.reduceMotion],
  );
  const lang = data.lang;
  const view = config.view;
  const t = (k: MessageKey, p?: Record<string, string | number>) => tIn(lang, k, p);

  const [tick, setTick] = useState(0);
  const now = useMemo(() => clock(), [tick]);
  const roots = useMemo(() => buildTree(data, lang, now).filter((n) => visible(n, view)), [tick, lang, view, data]);

  // ── navigation state ──
  const [chain, setChain] = useState<string[]>([]);
  const [sel, setSel] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<{ text: string; typing: boolean } | null>(null);
  const [overlay, setOverlay] = useState<'help' | 'palette' | null>(null);
  const [palette, setPalette] = useState({ text: '', sel: 0 });
  const [flash, setFlash] = useState<Flash | null>(null);
  const [scroll, setScroll] = useState(0);
  const keyScope = useRef<KeyScope>({ handlers: [] }).current;

  const chainNodes = useMemo(() => resolve(roots, chain.join('/'), view), [roots, chain, view]);
  const listOwner = chainNodes[chainNodes.length - 1] ?? null;
  const listKey = chain.join('/');
  const rawList = useMemo(() => (listOwner ? (listOwner.children?.() ?? []).filter((n) => visible(n, view)) : roots), [listOwner, roots, view]);
  const list = useMemo(() => {
    if (!filter?.text) return rawList;
    const f = fold(filter.text);
    return rawList.filter((n) => fold([n.label, ...(n.keywords ?? [])].join(' ')).includes(f));
  }, [rawList, filter]);
  const index = Math.min(sel[listKey] ?? 0, Math.max(0, list.length - 1));
  const selected = list[index] ?? null;

  const go = (address: string) => {
    const nodes = resolve(roots, address, view);
    if (!nodes.length) {
      showFlash(t('nav.notFound', { address }), 'warn');
      return;
    }
    const ids = nodes.map((n) => n.id);
    const last = nodes[nodes.length - 1]!;
    // Select each node along the way in its list, so ← walks back through the same places.
    const updates: Record<string, number> = {};
    let level: NavNode[] = roots;
    nodes.forEach((n, i) => {
      updates[ids.slice(0, i).join('/')] = Math.max(
        0,
        level.findIndex((x) => x.id === n.id),
      );
      level = n.children ? n.children().filter((x) => visible(x, view)) : [];
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

  const showFlash = (text: string, kind: Flash['kind'] = 'ok') => setFlash({ text, kind, at: Date.now() });
  useEffect(() => {
    if (!flash) return;
    const h = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(h);
  }, [flash]);

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
    flash: showFlash,
    tick,
    ...(props.onLeave
      ? {
          leave: (action: LeaveAction, back: string) => {
            props.onLeave!(action, back);
            app.exit();
          },
        }
      : {}),
  };

  const move = (delta: number) => setSel((s) => ({ ...s, [listKey]: Math.max(0, Math.min(list.length - 1, index + delta)) }));
  const enter = () => {
    if (!selected) return;
    if (selected.children) {
      setChain([...chain, selected.id]);
      setFilter(null);
    } else if (selected.screen) setOpen(true);
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

  const paletteEntries = useMemo(() => (overlay === 'palette' ? allEntries(roots, view) : []), [overlay, roots, view]);
  const paletteRoom = Math.max(1, rows - 4 - 2 - 3);
  const paletteResults = useMemo(
    () => searchEntries(paletteEntries, palette.text, fold, Math.min(12, paletteRoom)),
    [paletteEntries, palette.text, paletteRoom],
  );

  useInput((input: string, key: Key) => {
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
    // 4. the same keys everywhere
    if (input === 'q' && !open) {
      app.exit();
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
    if (/^[1-7]$/.test(input)) {
      const id = CATEGORY_IDS[parseInt(input, 10) - 1]!;
      const i = roots.findIndex((n) => n.id === id);
      if (i >= 0) {
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

  const header = (
    <Box width={columns} justifyContent="space-between">
      <Text wrap="truncate-end">
        <Text bold color={theme.accent}>
          {crumbs[0]}
        </Text>
        <Text color={theme.muted}>{crumbs.length > 1 ? theme.sym.sep : ''}</Text>
        <Text bold>{crumbs.slice(1).join(theme.sym.sep)}</Text>
      </Text>
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

  const allHints: [string, string][] = open
    ? [
        ['←/Esc', t('keys.back')],
        ['?', t('keys.help')],
        ['Ctrl+K', t('keys.palette')],
        ['q', t('keys.close')],
      ]
    : [
        ['↑↓', t('keys.move')],
        ['→', t('keys.open')],
        ['←', t('keys.back')],
        ['1-7', t('keys.categories')],
        ['/', t('keys.filter')],
        ['Ctrl+K', t('keys.palette')],
        ['?', t('keys.help')],
        ['q', t('keys.quit')],
      ];
  // One line of hints: on a narrow terminal the less essential ones give way (help still lists them all).
  const hintWidth = (h: [string, string][]) => h.reduce((n, [k, v]) => n + k.length + v.length + 3, 0);
  const hints = [...allHints];
  for (const drop of ['1-7', '/', 'Ctrl+K', '←']) {
    if (hintWidth(hints) <= columns) break;
    const i = hints.findIndex(([k]) => k === drop);
    if (i >= 0) hints.splice(i, 1);
  }

  const footer = (
    <Box width={columns} flexDirection="column">
      {flash ? (
        <Text color={flash.kind === 'bad' ? theme.bad : flash.kind === 'warn' ? theme.warn : theme.ok} wrap="truncate-end">
          {flash.text}
        </Text>
      ) : (
        <Text color={theme.muted} wrap="truncate-end">
          {address ? `${t('nav.address')}: ${address}` : ' '}
        </Text>
      )}
      <KeyHints hints={hints} />
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
              <Text key={e.address} inverse={i === palette.sel} wrap="truncate-end">
                {i === palette.sel ? theme.sym.cursor : ' '} {e.path.join(theme.sym.sep)} <Text color={theme.muted}>{e.address}</Text>
              </Text>
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
            <ListView items={itemsOf(list)} selected={index} height={bodyH - 3} width={sideW - 2} focused={false} />
          </Box>
        ) : null}
        <Box width={mainW} height={bodyH} flexDirection="column" borderStyle={theme.border} borderColor={theme.accent} paddingX={1} overflow="hidden">
          <Box flexDirection="column" flexShrink={0}>
            <Text bold>{selected.label}</Text>
            {selected.description ? <Muted>{selected.description}</Muted> : null}
          </Box>
          <Box marginTop={1} flexDirection="column" overflow="hidden" flexGrow={1}>
            <Box flexDirection="column" flexShrink={0} marginTop={-scroll}>
              {selected.screen({ width: mainW - 4, height: bodyH - 5, open: true })}
            </Box>
          </Box>
        </Box>
      </Box>
    );
  } else {
    const three = columns >= 100;
    const two = columns >= 64;
    const parentNodes = chainNodes.length ? resolve(roots, chain.slice(0, -1).join('/'), view) : [];
    const parentList = chainNodes.length
      ? (chain.length > 1 ? (parentNodes[parentNodes.length - 1]?.children?.() ?? []) : roots).filter((n) => visible(n, view))
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
    const listH = bodyH - 2 - (filter ? 1 : 0);
    body = (
      <Box width={columns} height={bodyH}>
        {aW && parentList ? (
          <Box width={aW} flexDirection="column" borderStyle={theme.border} borderColor={theme.muted} overflow="hidden">
            <ListView items={itemsOf(parentList)} selected={parentIndex} height={bodyH - 2} width={aW - 2} focused={false} />
          </Box>
        ) : null}
        <Box width={bW} flexDirection="column" borderStyle={theme.border} borderColor={theme.accent} overflow="hidden">
          {list.length ? (
            <ListView items={itemsOf(list)} selected={index} height={listH} width={bW - 2} focused />
          ) : (
            <Box paddingX={1}>
              <Muted>{filter?.text ? t('nav.noMatch') : t('nav.empty')}</Muted>
            </Box>
          )}
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
            {selected ? <Preview node={selected} width={cW - 4} height={bodyH - 2} theme={theme} t={t} /> : null}
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <EnvContext.Provider value={env}>
      <KeyScopeContext.Provider value={keyScope}>
        <Box flexDirection="column" width={columns} height={rows}>
          {header}
          {body}
          {footer}
        </Box>
      </KeyScopeContext.Provider>
    </EnvContext.Provider>
  );
}

function Preview({ node, width, height, theme, t }: { node: NavNode; width: number; height: number; theme: Theme; t: (k: MessageKey) => string }) {
  if (node.children && !node.screen) {
    const kids = node.children();
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
    ['1 … 7', 'help.k.categories'],
    ['/', 'help.k.filter'],
    ['Ctrl+K', 'help.k.palette'],
    ['r', 'help.k.refresh'],
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
            <Text>{t(v)}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>{t('help.terms')}</Text>
        {terms.map((k) => (
          <Text key={k} wrap="wrap">
            {t(k)}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Muted>{t('help.close')}</Muted>
      </Box>
    </Box>
  );
}
