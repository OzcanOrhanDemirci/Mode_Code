// SPDX-License-Identifier: Apache-2.0
/**
 * The UI kit (docs/design.md, Components): one kit, two hosts. Each component is written once against a host that
 * makes a box, a text and a pressable, so the same code draws in the control center (Ink, src/tui/kit.tsx) and
 * inside Claude Code (its elements, src/mod/kit-host.ts). The props the kit sets are the ones both hosts take; a
 * component never sets a colour without a mark and a word beside it. Pure: the in-process plugin uses it too.
 */
import { wrapText } from './text.js';
import { mark, MEANING_MARK, type MarkName, type Meaning } from './tokens.js';

/** What a component may hold: an element of the host, text, or nothing. */
export type Child<N> = N | string | null | undefined | false;

/** The layout props both hosts take (Ink's Box, and the subset Claude Code admits). */
export interface KitBox {
  flexDirection?: 'row' | 'column';
  flexGrow?: number;
  flexShrink?: number;
  width?: number;
  minWidth?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  paddingX?: number;
  justifyContent?: 'flex-start' | 'flex-end' | 'space-between';
}

/** The text props both hosts take. */
export interface KitText {
  color?: string;
  bold?: boolean;
  dimColor?: boolean;
  inverse?: boolean;
  underline?: boolean;
  wrap?: 'wrap' | 'truncate-end';
}

/** Something to press: by a click, by its key, or by Enter under the focus. */
export interface KitPress {
  /** Its address: unique among the pressables drawn together. */
  id: string;
  onPress(): void;
  /** One digit or lowercase letter that presses it where the surface lets a key do so. */
  hotkey?: string;
  /** The main action among several. */
  primary?: boolean;
  /** One sentence for pointing at it: what a press does (docs/design.md, the four questions). */
  describe?: string;
  /** It closes the window it stands in (Cancel): a host that draws a native close control draws it so. */
  dismiss?: boolean;
  /** The window's keyboard starts here, Enter acting on it at once: Cancel, where the main action lowers a protection. */
  autoFocus?: boolean;
}

export interface KitHost<N> {
  box(p: KitBox, ...children: Child<N>[]): N;
  text(p: KitText, ...children: Child<N>[]): N;
  /** A pressable around text (Claude Code's Button holds only text). */
  press(p: KitPress, ...children: Child<N>[]): N;
  /** The colour of a meaning here; undefined when colour is off. */
  color(m: Meaning): string | undefined;
  /** Marks in ASCII: no Unicode, or the person asked for plain. */
  plain: boolean;
  /** Columns a string takes. */
  measure(s: string): number;
}

const colored = (color: string | undefined): KitText => (color ? { color } : {});

/** A mark in its meaning's colour. */
export function markOf<N>(h: KitHost<N>, name: MarkName, meaning?: Meaning): N {
  return h.text(colored(meaning ? h.color(meaning) : undefined), mark(name, h.plain));
}

/** A switch's value: `● On` or `○ Off`, the word always there. */
export function switchValue<N>(h: KitHost<N>, on: boolean, word: string): N {
  return h.text({ bold: true, ...colored(h.color(on ? 'on' : 'off')) }, `${mark(on ? 'on' : 'off', h.plain)} ${word}`);
}

/** A choice's value: `‹ value ›`, read as "one of several". */
export function choiceValue<N>(h: KitHost<N>, word: string): N {
  return h.text({ bold: true, ...colored(h.color('focus')) }, `${mark('back', h.plain)} ${word} ${mark('more', h.plain)}`);
}

/** An action: `[ Label ]`, its key beside the label when it has one (every click target shows its key). */
export function action<N>(h: KitHost<N>, p: KitPress & { label: string; keyName?: string }): N {
  const key = p.keyName ?? p.hotkey;
  return h.press(p, h.text({ bold: !!p.primary, ...colored(p.primary ? h.color('focus') : undefined) }, `[ ${p.label}${key ? ` · ${key}` : ''} ]`));
}

/** An opener: `Label…`, a window opens and nothing changes until you act there. */
export function opener<N>(h: KitHost<N>, p: KitPress & { label: string }): N {
  return h.press(p, h.text(colored(h.color('focus')), `${p.label}${mark('opener', h.plain)}`));
}

/**
 * A row on the grid: the label column, the value column, the trailing column flush right (a time, a count, a
 * button, `›`). Rows of one block share `labelWidth`, so their values start, and their trailing ends, together.
 */
export function row<N>(h: KitHost<N>, p: { label: string; labelWidth: number; value: Child<N>; trailing?: Child<N>; width?: number; muted?: boolean }): N {
  const label = fit(h, p.label, p.labelWidth - 2);
  return h.box(
    { flexDirection: 'row', ...(p.width ? { width: p.width } : {}) },
    h.box({ width: p.labelWidth, flexShrink: 0 }, h.text(colored(h.color('off')), label)),
    h.box(
      { flexGrow: 1, flexShrink: 1 },
      typeof p.value === 'string' ? h.text({ wrap: 'truncate-end', ...(p.muted ? colored(h.color('off')) : {}) }, p.value) : p.value,
    ),
    p.trailing ? h.box({ flexShrink: 0, marginLeft: 1 }, typeof p.trailing === 'string' ? h.text(colored(h.color('off')), p.trailing) : p.trailing) : null,
  );
}

/** How a meter's level reads in words: where it is against its threshold. */
export type MeterLevel = 'low' | 'near' | 'over';

export function meterLevel(pct: number, threshold: number | null): MeterLevel {
  if (pct >= 100 || (threshold !== null && pct >= threshold)) return 'over';
  if (pct >= 80 || (threshold !== null && pct >= threshold - 10)) return 'near';
  return 'low';
}

/** A meter's cells: the filled part, the track, and the threshold's mark where it falls. */
export function meterCells(pct: number, width: number, threshold: number | null, plain: boolean): { fill: string; track: string; markAt: number | null } {
  const w = Math.max(4, Math.floor(width));
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const full = Math.round((p / 100) * w);
  const markAt = threshold !== null && threshold > 0 && threshold < 100 ? Math.min(w - 1, Math.round((threshold / 100) * w)) : null;
  return { fill: mark('fill', plain).repeat(full), track: mark('track', plain).repeat(w - full), markAt };
}

/**
 * A meter (docs/design.md, Meter): label · track `███░░░` with the threshold `│` · value · and, near or over the
 * threshold, a mark and words. The track shows where the meter ends, so two meters never run together.
 */
export function meter<N>(
  h: KitHost<N>,
  p: { label: string; labelWidth: number; pct: number; width: number; value: string; threshold?: number | null; words?: Partial<Record<MeterLevel, string>> },
): N {
  const threshold = p.threshold ?? null;
  const level = meterLevel(p.pct, threshold);
  const meaning: Meaning = level === 'over' ? 'bad' : level === 'near' ? 'ask' : 'on';
  const cells = meterCells(p.pct, p.width, threshold, h.plain);
  const bar = (cells.fill + cells.track).split('');
  if (cells.markAt !== null) bar[cells.markAt] = mark('threshold', h.plain);
  const filled = cells.fill.length;
  const word = p.words?.[level];
  return h.box(
    { flexDirection: 'row' },
    h.box({ width: p.labelWidth, flexShrink: 0 }, h.text({ wrap: 'truncate-end' }, fit(h, p.label, p.labelWidth - 1))),
    h.text(colored(h.color(meaning)), bar.slice(0, filled).join('')),
    h.text(colored(h.color('off')), bar.slice(filled).join('')),
    h.text({}, ` ${p.value}`),
    word ? h.text(colored(h.color(meaning)), ` ${mark(level === 'over' ? 'danger' : 'look', h.plain)} ${word}`) : null,
  );
}

/**
 * A notice: its meaning's mark and colour, and the undo of what it reports when there is one. One line, cut at the
 * edge (a toast, the bar); `wrap` lets a standing notice (the band above the prompt) run on under itself.
 */
export function notice<N>(h: KitHost<N>, p: { meaning: Meaning; text: string; undo?: KitPress & { label: string; keyName?: string }; wrap?: boolean }): N {
  return h.box(
    { flexDirection: 'row' },
    h.text({ wrap: p.wrap ? 'wrap' : 'truncate-end', ...colored(h.color(p.meaning)) }, `${mark(MEANING_MARK[p.meaning], h.plain)} ${p.text}`),
    p.undo ? h.box({ flexShrink: 0, marginLeft: 1 }, action(h, p.undo)) : null,
  );
}

/**
 * A confirmation with its preview (docs/design.md, Say, do, undo): what will happen, in words, before it does, and
 * the two ways out. Only what cannot be undone or lowers a protection asks.
 */
export function confirm<N>(
  h: KitHost<N>,
  p: { text: string; width: number; apply: KitPress & { label: string; keyName?: string }; cancel: KitPress & { label: string; keyName?: string } },
): N {
  return h.box(
    { flexDirection: 'column' },
    ...wrapText(`${mark('look', h.plain)} ${p.text}`, p.width, h.measure).map((line) => h.text(colored(h.color('ask')), line)),
    h.box({ flexDirection: 'row', marginTop: 1 }, action(h, { ...p.apply, primary: true }), h.text({}, '  '), action(h, p.cancel)),
  );
}

/** One option of a choice: its words, whether it is the one chosen now, and what picking it does. */
export interface ChoiceOption extends KitPress {
  label: string;
  chosen: boolean;
}

/**
 * A choice drawn as its options (docs/design.md, Choice): `◉ one  ○ two  ○ three`, each one pressable. The arrows and
 * Tab walk them and never change the value; only a press (Enter, Space, a click) picks. Side by side, or one under
 * another for long options.
 */
export function choices<N>(h: KitHost<N>, p: { options: readonly ChoiceOption[]; column?: boolean }): N {
  return h.box(
    { flexDirection: p.column ? 'column' : 'row' },
    ...p.options.map((o, i) =>
      h.box(
        { flexDirection: 'row', ...(i && !p.column ? { marginLeft: 2 } : {}) },
        h.press(
          o,
          h.text({ bold: o.chosen, ...colored(h.color(o.chosen ? 'focus' : 'off')) }, `${mark(o.chosen ? 'chosen' : 'option', h.plain)} `),
          h.text({ bold: o.chosen }, o.label),
        ),
      ),
    ),
  );
}

/**
 * A window (docs/design.md, Window): one sentence on what it is for, how it is now, its controls, then what applying
 * will do before it does, the main action and Cancel, and what went wrong if anything did. The same pattern in every
 * window, so each reads the same way.
 */
export function windowFrame<N>(
  h: KitHost<N>,
  p: {
    what: string;
    now: { label: string; text: string };
    width: number;
    controls: readonly Child<N>[];
    preview: { label: string; text: string } | null;
    apply: KitPress & { label: string };
    cancel: KitPress & { label: string };
    error?: string | null;
    after?: readonly Child<N>[];
    /** The label column the window's rows share (docs/design.md, Grid): its controls' labels counted in. */
    labelWidth?: number;
  },
): N {
  const width = Math.max(20, p.width);
  const labelWidth = p.labelWidth ?? Math.min(24, Math.max(h.measure(p.now.label), p.preview ? h.measure(p.preview.label) : 0) + 2);
  return h.box(
    { flexDirection: 'column' },
    ...wrapText(p.what, width, h.measure).map((line) => h.text(colored(h.color('off')), line)),
    h.box({ marginTop: 1 }, card(h, { lines: [p.now], width, labelWidth })),
    p.controls.length ? h.box({ flexDirection: 'column', marginTop: 1 }, ...p.controls) : null,
    p.preview ? h.box({ marginTop: 1 }, card(h, { lines: [{ ...p.preview, meaning: 'focus' }], width, labelWidth })) : null,
    h.box({ flexDirection: 'row', marginTop: 1 }, action(h, { ...p.apply, primary: true }), h.text({}, '  '), action(h, { ...p.cancel, dismiss: true })),
    p.error ? h.text({ wrap: 'wrap', ...colored(h.color('bad')) }, `${mark('bad', h.plain)} ${p.error}`) : null,
    ...(p.after ?? []),
  );
}

/** A key the person can press where they are, and what it does; with `onPress`, a click does the same. */
export interface Hint {
  key: string;
  label: string;
  onPress?: () => void;
  describe?: string;
}

/** The keys that work here, each one clickable when it does something a click can do. */
export function keyBar<N>(h: KitHost<N>, hints: readonly Hint[]): N {
  return h.box(
    { flexDirection: 'row' },
    ...hints.map((k, i) => {
      const body = [h.text({ bold: true, ...colored(h.color('focus')) }, k.key), h.text(colored(h.color('off')), ` ${k.label}`)];
      const gap = i ? h.text({}, '  ') : null;
      return k.onPress
        ? h.box({ flexDirection: 'row' }, gap, h.press({ id: `hint-${k.key}`, onPress: k.onPress, ...(k.describe ? { describe: k.describe } : {}) }, ...body))
        : h.box({ flexDirection: 'row' }, gap, ...body);
    }),
  );
}

/**
 * A card: labelled lines, wrapped at word boundaries in the value column (a wrapped line never starts with a space,
 * docs/design.md, Grid and spacing).
 */
export function card<N>(h: KitHost<N>, p: { lines: readonly { label: string; text: string; meaning?: Meaning }[]; width: number; labelWidth?: number }): N {
  const lw = p.labelWidth ?? Math.min(24, Math.max(0, ...p.lines.map((l) => h.measure(l.label))) + 2);
  const vw = Math.max(8, p.width - lw);
  return h.box(
    { flexDirection: 'column' },
    ...p.lines.flatMap((l) =>
      wrapText(l.text, vw, h.measure).map((line, i) =>
        h.box(
          { flexDirection: 'row' },
          h.box({ width: lw, flexShrink: 0 }, h.text(colored(h.color('off')), i === 0 ? fit(h, l.label, lw - 2) : '')),
          h.text(l.meaning ? colored(h.color(l.meaning)) : {}, line),
        ),
      ),
    ),
  );
}

/** An empty state: what will appear here, and the one action that makes it appear. */
export function empty<N>(h: KitHost<N>, p: { text: string; width: number; action?: KitPress & { label: string; keyName?: string } }): N {
  return h.box(
    { flexDirection: 'column' },
    ...wrapText(p.text, p.width, h.measure).map((line) => h.text(colored(h.color('off')), line)),
    p.action ? h.box({ marginTop: 1 }, action(h, p.action)) : null,
  );
}

/** Text cut to `max` columns with an ellipsis, never run into the next column. */
function fit<N>(h: KitHost<N>, s: string, max: number): string {
  if (max <= 0) return '';
  if (h.measure(s) <= max) return s;
  let out = '';
  for (const ch of s) {
    if (h.measure(out + ch) > max - 1) break;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}
