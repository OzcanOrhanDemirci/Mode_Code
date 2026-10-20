// SPDX-License-Identifier: Apache-2.0
/**
 * The README's pictures, drawn by the program itself: the control center rendered from the test harness's
 * sample data (test/tui/harness.tsx), exactly as a terminal receives it, turned into SVG. Nothing is drawn
 * by hand, so a picture never shows a screen the program does not have.
 *
 *   docs/images/control-center.svg      a short tour, frame by frame (an animated SVG; still when the
 *                                       viewer asks for reduced motion)
 *   docs/images/control-center-tr.svg   the same tour in Turkish
 *
 * Usage: node --import tsx scripts/screenshots.ts     (npm run screenshots)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Colors are decided when the color library loads: ask for them before the program is imported.
// 24-bit colors: Mo is drawn in them (the named colors of the rest stay the 16 basic ones).
process.env.FORCE_COLOR = '3';
delete process.env.NO_COLOR;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ESC = String.fromCharCode(27);

const COLUMNS = 100;
const ROWS = 24;
const CELL = 8.4;
const LINE = 17;
const PAD = 16;
const BAR = 30;

/** A dark terminal palette (GitHub's), indexed by the SGR color number. */
const FG: Record<number, string> = {
  30: '#484f58',
  31: '#ff7b72',
  32: '#3fb950',
  33: '#d29922',
  34: '#58a6ff',
  35: '#bc8cff',
  36: '#39c5cf',
  37: '#b1bac4',
  90: '#6e7681',
  91: '#ffa198',
  92: '#56d364',
  93: '#e3b341',
  94: '#79c0ff',
  95: '#d2a8ff',
  96: '#56d4dd',
  97: '#f0f6fc',
};
const DEFAULT_FG = '#e6edf3';
const BACKGROUND = '#0d1117';

interface Style {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  inverse: boolean;
}

interface Run {
  col: number;
  width: number;
  text: string;
  style: Style;
}

const plainStyle = (): Style => ({ fg: null, bg: null, bold: false, dim: false, inverse: false });

function applySgr(style: Style, codes: number[]): Style {
  const s = { ...style };
  if (codes.length === 0) codes = [0];
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]!;
    if (c === 0) Object.assign(s, plainStyle());
    else if (c === 1) s.bold = true;
    else if (c === 2) s.dim = true;
    else if (c === 22) s.bold = s.dim = false;
    else if (c === 7) s.inverse = true;
    else if (c === 27) s.inverse = false;
    else if (c === 39) s.fg = null;
    else if (c === 49) s.bg = null;
    else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) s.fg = FG[c]!;
    else if ((c >= 40 && c <= 47) || (c >= 100 && c <= 107)) s.bg = FG[c - 10]!;
    else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
      const hex =
        '#' +
        codes
          .slice(i + 2, i + 5)
          .map((n) => n.toString(16).padStart(2, '0'))
          .join('');
      if (c === 38) s.fg = hex;
      else s.bg = hex;
      i += 4;
    } else if ((c === 38 || c === 48) && codes[i + 1] === 5) i += 2;
  }
  return s;
}

/** How many terminal cells a character takes: wide for East Asian wide characters and emoji. */
function cells(ch: string, width: (s: string) => number): number {
  return Math.max(0, width(ch));
}

/** One screen as runs of equally styled text, each at its own cell. */
function parse(ansi: string, width: (s: string) => number): Run[][] {
  const sgr = new RegExp(`${ESC}\\[([0-9;]*)m`, 'y');
  const other = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, 'y');
  const lines: Run[][] = [];
  let style = plainStyle();
  for (const line of ansi.replace(/\r/g, '').split('\n')) {
    const runs: Run[] = [];
    let col = 0;
    let i = 0;
    while (i < line.length) {
      sgr.lastIndex = i;
      const m = sgr.exec(line);
      if (m) {
        style = applySgr(style, m[1] ? m[1].split(';').map((n) => parseInt(n, 10)) : []);
        i = sgr.lastIndex;
        continue;
      }
      other.lastIndex = i;
      if (other.exec(line)) {
        i = other.lastIndex;
        continue;
      }
      const cp = line.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      i += ch.length;
      const w = cells(ch, width);
      if (w === 0) {
        // A joiner or a variation selector belongs to the character before it.
        const last = runs[runs.length - 1];
        if (last) last.text += ch;
        continue;
      }
      const last = runs[runs.length - 1];
      // A wide character (an emoji) gets a run of its own, and so does what follows it: fonts disagree on how
      // wide an emoji is, and the next run then starts at its exact cell whatever the font.
      if (last && JSON.stringify(last.style) === JSON.stringify(style) && w === 1 && last.width === [...last.text].length) {
        last.text += ch;
        last.width += w;
      } else runs.push({ col, width: w, text: ch, style: { ...style } });
      col += w;
    }
    lines.push(runs);
  }
  return lines;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function frameSvg(lines: Run[][]): string {
  const out: string[] = [];
  lines.forEach((runs, row) => {
    const y = BAR + PAD + row * LINE;
    for (const r of runs) {
      const fg = r.style.inverse ? (r.style.bg ?? BACKGROUND) : (r.style.fg ?? DEFAULT_FG);
      const bg = r.style.inverse ? (r.style.fg ?? DEFAULT_FG) : r.style.bg;
      const x = PAD + r.col * CELL;
      if (bg) out.push(`<rect x="${x.toFixed(1)}" y="${y}" width="${(r.width * CELL).toFixed(1)}" height="${LINE}" fill="${bg}"/>`);
      if (r.text.trim() === '') continue;
      if (/^[▀▄]+$/.test(r.text)) {
        // Half blocks (Mo is made of them) are drawn as the halves they are: crisp whatever the font.
        [...r.text].forEach((ch, i) => {
          const cx = (x + i * CELL).toFixed(1);
          const top = ch === '▀' ? fg : bg;
          const bottom = ch === '▀' ? bg : fg;
          if (top) out.push(`<rect x="${cx}" y="${y}" width="${CELL.toFixed(1)}" height="${LINE / 2}" fill="${top}"/>`);
          if (bottom) out.push(`<rect x="${cx}" y="${y + LINE / 2}" width="${CELL.toFixed(1)}" height="${LINE / 2}" fill="${bottom}"/>`);
        });
        continue;
      }
      const attrs = [
        `x="${x.toFixed(1)}"`,
        `y="${y + 13}"`,
        `fill="${fg}"`,
        r.style.bold ? 'font-weight="bold"' : '',
        r.style.dim ? 'opacity="0.6"' : '',
        // Every run fills exactly its cells, so columns line up whatever monospace font the viewer has.
        `textLength="${(r.width * CELL).toFixed(1)}"`,
        'lengthAdjust="spacingAndGlyphs"',
      ].filter(Boolean);
      out.push(`<text ${attrs.join(' ')}>${esc(r.text)}</text>`);
    }
  });
  return out.join('');
}

function svg(frames: Run[][][], title: string, seconds: number): string {
  const w = PAD * 2 + COLUMNS * CELL;
  const h = BAR + PAD * 2 + ROWS * LINE;
  const total = frames.length * seconds;
  const css = [
    `text{font-family:ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace;font-size:14px;white-space:pre}`,
    frames.length > 1
      ? `.f{opacity:0;animation:show ${total}s step-end infinite}@keyframes show{0%{opacity:1}${(100 / frames.length).toFixed(3)}%{opacity:0}100%{opacity:0}}` +
        frames.map((_, i) => `.f${i}{animation-delay:${i * seconds}s}`).join('') +
        `@media (prefers-reduced-motion:reduce){.f{animation:none}.f0{opacity:1}}`
      : '',
  ].join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(0)}" height="${h}" viewBox="0 0 ${w.toFixed(1)} ${h}" role="img" aria-label="${esc(title)}">`,
    `<title>${esc(title)}</title>`,
    `<style>${css}</style>`,
    `<rect width="100%" height="100%" rx="10" fill="${BACKGROUND}" stroke="#30363d"/>`,
    `<circle cx="20" cy="15" r="6" fill="#ff5f56"/><circle cx="40" cy="15" r="6" fill="#ffbd2e"/><circle cx="60" cy="15" r="6" fill="#27c93f"/>`,
    `<text x="${(w / 2).toFixed(1)}" y="20" fill="#8b949e" text-anchor="middle" style="font-size:12px">mode-code</text>`,
    ...frames.map((f, i) => `<g class="f f${i}">${frameSvg(f)}</g>`),
    `</svg>`,
    '',
  ].join('\n');
}

async function main() {
  const { draw, FakeData, KEY } = await import('../test/tui/harness.js');
  const { textWidth } = await import('../src/node/width.js');
  // The tour: the screens a newcomer looks at first, each reached the way a person reaches it.
  const tour: { address: string | null; type?: string; keys: string[] }[] = [
    { address: null, keys: [] },
    { address: null, keys: ['right'] },
    { address: 'protection/rules', keys: [] },
    { address: 'protection/test', type: 'git push --force origin main', keys: ['enter'] },
    { address: 'quota/usage', keys: [] },
    { address: 'claude-code/templates', keys: [] },
  ];
  mkdirSync(join(root, 'docs', 'images'), { recursive: true });
  for (const [lang, file, title] of [
    [
      'en',
      'control-center.svg',
      'The Mode_Code control center: Mo greeting on the first screen, home, the safety belt rules, a command tested against the belt, quota and rule templates',
    ],
    [
      'tr',
      'control-center-tr.svg',
      'Mode_Code kontrol merkezi: ilk ekranda karşılayan Mo, ana ekran, emniyet kemeri kuralları, kemerde sınanan bir komut, kota ve kural şablonları',
    ],
  ] as const) {
    const frames: Run[][][] = [];
    for (const shot of tour) {
      const s = await draw(new FakeData(lang), { columns: COLUMNS, rows: ROWS, address: shot.address });
      if (shot.type) await s.type(shot.type);
      if (shot.keys.length) await s.press(...shot.keys.map((k) => KEY[k as keyof typeof KEY] ?? k));
      // What a key starts (the belt's verdict) draws a moment later.
      await new Promise((r) => setTimeout(r, 200));
      frames.push(parse(s.ansi(), textWidth).slice(0, ROWS));
      s.close();
    }
    writeFileSync(join(root, 'docs', 'images', file), svg(frames, title, 3));
    console.log(`screenshots: docs/images/${file}: ${frames.length} frames`);
  }
  process.exit(0);
}

void main();
