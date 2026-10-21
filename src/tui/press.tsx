// SPDX-License-Identifier: Apache-2.0
/**
 * What the pointer can reach in the control center (docs/design.md, One way to act): every pressable registers its
 * box here while it is drawn; a pointer event is matched to the boxes under it, measured as Ink laid them out, and
 * cut by the panes they scroll in. Click = Enter (on the innermost box under the pointer), pointing = its sentence in
 * the bar at the bottom, the wheel = scrolling what is under the pointer. Pointing only explains; it never acts.
 */
import { Children, cloneElement, createContext, Fragment, isValidElement, useContext, useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Box, measureElement, Text, type DOMElement } from 'ink';
import type { PointerEvent } from './pointer.js';

export interface TargetSpec {
  /** A click: the same as Enter on it. */
  onPress?: () => void;
  /** A wheel step over it; true when it scrolled (else the step goes to what holds it). */
  onWheel?: (dir: 'up' | 'down') => boolean;
  /** What it is and what a press does, for the bar at the bottom while the pointer is on it. */
  describe?: string | null;
}

interface Entry {
  node: () => DOMElement | null;
  spec: () => TargetSpec;
}

interface Box4 {
  x: number;
  y: number;
  width: number;
  height: number;
}

const inside = (b: Box4, x: number, y: number) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;

/** The box a pane that cuts its content (overflow hidden) leaves visible: a target outside it cannot be hit. */
function visibleIn(node: DOMElement, x: number, y: number): boolean {
  for (let n = node.parentNode; n; n = n.parentNode) {
    if (n.style?.overflow === 'hidden' || n.style?.overflowY === 'hidden' || n.style?.overflowX === 'hidden')
      if (!inside(measureElement(n), x, y)) return false;
  }
  return true;
}

/** The targets drawn now, and which one the pointer rests on. */
export class PointerRegistry {
  private readonly entries = new Map<string, Entry>();
  private down: string | null = null;
  hovered: string | null = null;
  /** Told when the target the pointer rested on is no longer drawn, so its sentence leaves the bar. */
  onHoverGone: () => void = () => {};

  register(id: string, entry: Entry): () => void {
    this.entries.set(id, entry);
    return () => {
      if (this.entries.get(id) === entry) this.entries.delete(id);
      if (this.hovered === id) {
        this.hovered = null;
        this.onHoverGone();
      }
    };
  }

  /** Every target a click presses, where it is drawn now (a test points at each one). */
  pressables(): { id: string; x: number; y: number; width: number; height: number }[] {
    const out: { id: string; x: number; y: number; width: number; height: number }[] = [];
    for (const [id, e] of this.entries) {
      const node = e.node();
      if (!node || !e.spec().onPress) continue;
      const b = measureElement(node);
      if (b.width && b.height && visibleIn(node, b.x, b.y)) out.push({ id, ...b });
    }
    return out;
  }

  /** Presses a target, as a click on it does; false when it is no longer drawn. */
  press(id: string): boolean {
    const onPress = this.entries.get(id)?.spec().onPress;
    if (!onPress) return false;
    onPress();
    return true;
  }

  /** The targets under a cell, the innermost (smallest) first. */
  hits(x: number, y: number): { id: string; spec: TargetSpec }[] {
    const found: { id: string; spec: TargetSpec; area: number; order: number }[] = [];
    let order = 0;
    for (const [id, e] of this.entries) {
      order++;
      const node = e.node();
      if (!node) continue;
      const b = measureElement(node);
      if (!b.width || !b.height || !inside(b, x, y) || !visibleIn(node, x, y)) continue;
      found.push({ id, spec: e.spec(), area: b.width * b.height, order });
    }
    return found.sort((a, b) => a.area - b.area || b.order - a.order).map(({ id, spec }) => ({ id, spec }));
  }

  /**
   * Hands an event to the target under it. A click acts on release over the target it was pressed on (a press that
   * slid off does nothing). Returns what happened, so the screen can give the wheel a default and the bar its sentence.
   */
  dispatch(e: PointerEvent): { pressed: boolean; wheeled: boolean; hoverChanged: boolean; describe: string | null } {
    const hits = this.hits(e.x, e.y);
    const top = hits.find((h) => h.spec.onPress || h.spec.describe) ?? null;
    let pressed = false;
    let wheeled = false;
    if (e.kind === 'press' && e.button === 'left') this.down = top?.spec.onPress ? top.id : null;
    else if (e.kind === 'release' && this.down !== null) {
      const target = hits.find((h) => h.id === this.down && h.spec.onPress);
      this.down = null;
      if (target) {
        target.spec.onPress!();
        pressed = true;
      }
    } else if (e.kind === 'wheel') {
      for (const h of hits)
        if (h.spec.onWheel?.(e.wheel!)) {
          wheeled = true;
          break;
        }
    }
    // What the pointer rests on: the innermost target it could press or that says what it is; its sentence, or the
    // nearest one around it that has one.
    const describing = top?.spec.describe ? top : (hits.find((h) => h.spec.describe) ?? null);
    const id = top?.id ?? null;
    const hoverChanged = id !== this.hovered;
    this.hovered = id;
    return { pressed, wheeled, hoverChanged, describe: describing?.spec.describe ?? null };
  }
}

export const PointerContext = createContext<{ registry: PointerRegistry; hovered: string | null } | null>(null);

/** The open page keeps in view the element that has the focus: a widget hands over its focused box (src/tui/app.tsx). */
export const KeepInView = createContext<(node: DOMElement | null) => void>(() => {});

/**
 * Registers a box as a target while it is drawn. `spec` is read when the pointer comes, so it is always current. A
 * layout effect: it runs in the same commit that draws the box, so no click can land between the frame that shows it
 * and its registration (a passive effect left that gap, and a click on a just-drawn key was lost on a slow run).
 */
export function usePointerTarget(spec: TargetSpec): { ref: React.RefObject<DOMElement | null>; hovered: boolean } {
  const ctx = useContext(PointerContext);
  const ref = useRef<DOMElement | null>(null);
  const current = useRef(spec);
  current.current = spec;
  const id = useId();
  useLayoutEffect(() => {
    if (!ctx) return;
    return ctx.registry.register(id, { node: () => ref.current, spec: () => current.current });
  }, [ctx?.registry, id]);
  return { ref, hovered: !!ctx && ctx.hovered === id };
}

/**
 * What the pointer rests on, drawn so: every text in it underlined (docs/design.md, One way to act: pointing at
 * something shows that it is there to press). Texts inside boxes and fragments are reached; a component of its own
 * draws its pointed look itself (a pressable that takes `(hovered) => …`).
 */
export function underlined(node: ReactNode, on = true): ReactNode {
  // Mapped pointed or not, so the children keep their keys (and their state) as the pointer comes and goes.
  return Children.map(node, (c) => {
    if (!isValidElement<{ children?: ReactNode; underline?: boolean }>(c)) return c;
    if (c.type === Text) return on ? cloneElement(c, { underline: true }) : c;
    if (c.type === Box || c.type === Fragment) return cloneElement(c, {}, underlined(c.props.children, on));
    return c;
  });
}

/**
 * A box the pointer can press: a click does `onPress`, pointing shows `describe` in the bar and underlines what it
 * holds. The keyboard reaches the same thing by its own key (shown beside it); this adds the mouse, never a second
 * behaviour. Children given as `(hovered) => …` draw their own pointed look.
 */
export function Pressable({
  onPress,
  describe,
  keep,
  children,
  ...box
}: {
  onPress: () => void;
  describe?: string | undefined;
  /** It has the focus: the open page keeps it in view. */
  keep?: boolean;
  children?: ReactNode | ((hovered: boolean) => ReactNode);
} & Omit<React.ComponentProps<typeof Box>, 'children'>) {
  const { ref, hovered } = usePointerTarget({ onPress, describe: describe ?? null });
  const keepInView = useContext(KeepInView);
  useEffect(() => {
    if (keep) keepInView(ref.current);
  });
  return (
    <Box ref={ref} flexShrink={0} {...box}>
      {typeof children === 'function' ? children(hovered) : underlined(children, hovered)}
    </Box>
  );
}

/** A box that takes the wheel: a step over it scrolls it (the list it holds, the page it shows). */
export function Wheel({ onWheel, children, ...box }: { onWheel: (dir: 'up' | 'down') => boolean; children: ReactNode } & React.ComponentProps<typeof Box>) {
  const { ref } = usePointerTarget({ onWheel });
  return (
    <Box ref={ref} {...box}>
      {children}
    </Box>
  );
}
