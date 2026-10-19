// SPDX-License-Identifier: Apache-2.0
/**
 * The mouse in the control center (docs/design.md, One way to act). The terminal reports the pointer as escape
 * sequences on the same input as the keys; Ink drops them. So the control center reads its input through a stand-in
 * that takes the pointer's sequences out before Ink sees the rest and hands them, parsed, to the screen.
 *
 * Reporting is the terminal's own (xterm's): 1000 presses, 1002 drags, 1003 moves with no button down (for "point at
 * it to see what it is"), 1006 the SGR encoding, which has no limit on the column. Everything that turns it on is
 * turned off again on every way out (`MOUSE_OFF`): a terminal left reporting would print sequences at the shell.
 */
import { EventEmitter } from 'node:events';

export type PointerKind = 'press' | 'release' | 'move' | 'wheel';

export interface PointerEvent {
  kind: PointerKind;
  /** Which button: pressed, released or held during a move; 'none' for a move with no button down. */
  button: 'left' | 'middle' | 'right' | 'none';
  /** A wheel step's direction. */
  wheel?: 'up' | 'down';
  /** The cell, from 0: column and row of the terminal. */
  x: number;
  y: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

export const MOUSE_ON = '\u001B[?1000h\u001B[?1002h\u001B[?1003h\u001B[?1006h';
export const MOUSE_OFF = '\u001B[?1003l\u001B[?1002l\u001B[?1000l\u001B[?1006l';

const BUTTONS = ['left', 'middle', 'right', 'none'] as const;

function decode(code: number, x: number, y: number, release: boolean): PointerEvent {
  const mods = { shift: (code & 4) !== 0, alt: (code & 8) !== 0, ctrl: (code & 16) !== 0 };
  const at = { x: Math.max(0, x - 1), y: Math.max(0, y - 1) };
  if (code & 64) return { kind: 'wheel', button: 'none', wheel: (code & 1) === 0 ? 'up' : 'down', ...at, ...mods };
  const button = BUTTONS[code & 3]!;
  if (code & 32) return { kind: 'move', button, ...at, ...mods };
  return { kind: release || button === 'none' ? 'release' : 'press', button, ...at, ...mods };
}

// SGR: ESC [ < code ; column ; row (M press or move, m release). X10, for a terminal that ignores 1006:
// ESC [ M and three bytes, each 32 more than its value.
// eslint-disable-next-line no-control-regex
const SEQUENCE = /\u001B\[<(\d+);(\d+);(\d+)([Mm])|\u001B\[M([\s\S])([\s\S])([\s\S])/g;
// The start of a sequence the chunk cut: kept for the next chunk.
// eslint-disable-next-line no-control-regex
const PARTIAL = /\u001B\[(?:<[\d;]*|M[\s\S]{0,2})$/;

/**
 * Takes the pointer's sequences out of a chunk of input: what is left for the keys, the events in order, and the
 * start of a sequence the chunk ended in (to put before the next chunk).
 */
export function takePointer(chunk: string): { rest: string; events: PointerEvent[]; carry: string } {
  const events: PointerEvent[] = [];
  let rest = chunk.replace(SEQUENCE, (_all, code?: string, col?: string, row?: string, end?: string, b?: string, cx?: string, cy?: string) => {
    if (code !== undefined) events.push(decode(Number(code), Number(col), Number(row), end === 'm'));
    else events.push(decode(b!.charCodeAt(0) - 32, cx!.charCodeAt(0) - 32, cy!.charCodeAt(0) - 32, false));
    return '';
  });
  const partial = PARTIAL.exec(rest);
  const carry = partial ? partial[0] : '';
  if (carry) rest = rest.slice(0, partial!.index);
  return { rest, events, carry };
}

/**
 * The terminal's mouse reporting while the control center is drawn: `on()` once it is, `off()` as it ends, while the
 * screen is still its own (under Windows' console, ConPTY, a mode turned off after the screen was left never reaches
 * the terminal: measured). The program's end and a kill turn it off too, for the ways out the app does not see; a
 * terminal left reporting would print the pointer's sequences at the shell.
 */
export function mouseReporting(
  write: (s: string) => void,
  proc: { once(event: string, fn: () => void): unknown; exit(code: number): unknown },
): { on(): void; off(): void } {
  let on = false;
  const off = () => {
    if (!on) return;
    on = false;
    write(MOUSE_OFF);
  };
  proc.once('exit', off);
  for (const [sig, code] of [
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ] as const)
    proc.once(sig, () => {
      off();
      proc.exit(code);
    });
  return {
    on: () => {
      on = true;
      write(MOUSE_ON);
    },
    off,
  };
}

/** Where the pointer's events go: the control center listens while it is drawn. */
export class PointerHub {
  private readonly emitter = new EventEmitter();
  emit(e: PointerEvent): void {
    this.emitter.emit('pointer', e);
  }
  on(fn: (e: PointerEvent) => void): () => void {
    this.emitter.on('pointer', fn);
    return () => this.emitter.off('pointer', fn);
  }
}

/**
 * The input Ink reads, with the pointer's sequences taken out and handed to `hub`. Everything else is the stream's
 * own: raw mode, the encoding, its events. Ink reads it chunk by chunk on 'readable'.
 */
export function pointerInput<S extends NodeJS.ReadableStream>(stdin: S, hub: PointerHub): S {
  let carry = '';
  const read = (): string | null => {
    for (;;) {
      const chunk = (stdin as unknown as { read(): string | Buffer | null }).read();
      if (chunk === null) return null;
      const r = takePointer(carry + String(chunk));
      carry = r.carry;
      for (const e of r.events) hub.emit(e);
      if (r.rest) return r.rest;
    }
  };
  return new Proxy(stdin, {
    get(target, prop) {
      if (prop === 'read') return read;
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}
