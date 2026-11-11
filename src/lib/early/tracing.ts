// Handwriting tracing sheets (#244 PR 2): numbers and shapes as single-stroke paths, laid out on US Letter
// pages. Pure (no DOM): the view draws the layout as SVG and prints it with window.print(). Tested in
// tracing.test.ts. Letters wait for PR 3.
//
// Units are hundredths of an inch, so a page is 850 x 1100 and the SVG sets width="8.5in". Glyphs are
// GLYPH_H tall (1.5 in), the size kindergarten tracing paper uses for a first try at numbers.

import type { ShapeId } from "./types";

export const PAGE_W = 850;
export const PAGE_H = 1100;
export const MARGIN = 50;
/** Glyph height: 1.5 in. */
export const GLYPH_H = 150;
const ROW_GAP = 60;
const GLYPH_GAP = 34;
/** The name/date line and title at the top of every page. */
export const HEADER_H = 150;

export interface Glyph {
  /** One path per pen stroke, in drawing order, each starting with "M x,y". */
  strokes: string[];
  /** The glyph's box in its own coordinates: [x0, y0, width, height]. Ink fills the height. */
  box: [number, number, number, number];
}

// Digits in a 60 x 100 box, written the way K handwriting programs teach them: 0 from the top going
// left, 4 (open top) and 5 in two strokes. Each stroke's first point is the start dot.
const DIGITS: Record<string, Glyph> = {
  "0": { box: [0, 0, 60, 100], strokes: ["M30,0 C10,0 0,25 0,50 C0,75 10,100 30,100 C50,100 60,75 60,50 C60,25 50,0 30,0"] },
  "1": { box: [0, 0, 60, 100], strokes: ["M30,0 L30,100"] },
  "2": { box: [0, 0, 60, 100], strokes: ["M4,24 C6,8 18,0 31,0 C46,0 57,10 57,25 C57,42 40,58 2,100 L60,100"] },
  "3": { box: [0, 0, 60, 100], strokes: ["M6,14 C14,3 23,0 31,0 C46,0 56,10 56,23 C56,37 45,47 28,47 C46,47 59,58 59,73 C59,90 46,100 30,100 C18,100 8,95 2,86"] },
  "4": { box: [0, 0, 60, 100], strokes: ["M8,0 L4,64 L60,64", "M44,0 L44,100"] },
  "5": { box: [0, 0, 60, 100], strokes: ["M10,0 L6,44 C14,38 22,36 31,36 C48,36 59,49 59,67 C59,87 46,100 29,100 C17,100 8,95 2,87", "M10,0 L56,0"] },
  "6": { box: [0, 0, 60, 100], strokes: ["M50,6 C44,2 38,0 31,0 C12,0 2,22 2,58 C2,84 13,100 31,100 C48,100 59,87 59,70 C59,53 47,42 31,42 C17,42 6,50 2,62"] },
  "7": { box: [0, 0, 60, 100], strokes: ["M2,0 L58,0 L20,100"] },
  "8": { box: [0, 0, 60, 100], strokes: ["M55,20 C55,8 44,0 30,0 C16,0 5,8 5,22 C5,36 18,43 30,48 C44,54 58,61 58,76 C58,91 46,100 30,100 C14,100 2,91 2,76 C2,61 16,54 30,48 C42,43 55,36 55,20"] },
  "9": { box: [0, 0, 60, 100], strokes: ["M57,24 C57,10 46,0 30,0 C14,0 3,11 3,24 C3,38 14,48 30,48 C45,48 57,38 57,24 L57,100"] },
};

// The shapes the Shapes pack teaches, outlined the way the activity draws them (pictures.tsx).
const SHAPES: Record<ShapeId, Glyph> = {
  circle: { box: [0, 0, 100, 100], strokes: ["M50,0 A50,50 0 0 0 50,100 A50,50 0 0 0 50,0"] },
  square: { box: [0, 0, 100, 100], strokes: ["M0,0 L0,100 L100,100 L100,0 L0,0"] },
  triangle: { box: [0, 0, 110, 100], strokes: ["M55,0 L0,100 L110,100 L55,0"] },
  rectangle: { box: [0, 0, 150, 100], strokes: ["M0,0 L0,100 L150,100 L150,0 L0,0"] },
  star: { box: [4.9, 6, 90.2, 85], strokes: ["M50,6 L61.8,37.6 L95.1,38.2 L69,59 L78.2,91 L50,72 L21.8,91 L31,59 L4.9,38.2 L38.2,37.6 L50,6"] },
  heart: { box: [6, 8, 88, 80], strokes: [
    "M50,20 C46,13 39,8 30,8 C17,8 6,18 6,32 C6,50 20,66 50,88",
    "M50,20 C54,13 61,8 70,8 C83,8 94,18 94,32 C94,50 80,66 50,88",
  ] },
};

/** The first point of a stroke: where its start dot goes. */
export function strokeStart(path: string): [number, number] {
  const m = /^M\s*(-?[\d.]+)[ ,]\s*(-?[\d.]+)/.exec(path);
  if (!m) throw new Error(`stroke does not start with a move: ${path}`);
  return [Number(m[1]), Number(m[2])];
}

/** A glyph placed on the page: its strokes, scaled so its ink is GLYPH_H tall, with x/y its top-left. */
export interface Placed {
  glyph: Glyph;
  x: number;
  y: number;
  scale: number;
  /** The model the child copies (solid) or one to trace (dashed). */
  model: boolean;
}

/** One printed glyph: a number made of digits side by side, or a shape. */
export type Mark = { kind: "number"; n: number } | { kind: "shape"; shape: ShapeId };

const DIGIT_GAP = 22; // between the digits of 14, in page units

/** The glyph(s) for a mark and its width on the page at GLYPH_H. */
function markParts(mark: Mark): { glyphs: Array<{ glyph: Glyph; dx: number }>; width: number; scale: number } {
  if (mark.kind === "shape") {
    const glyph = SHAPES[mark.shape];
    const scale = GLYPH_H / glyph.box[3];
    return { glyphs: [{ glyph, dx: 0 }], width: glyph.box[2] * scale, scale };
  }
  const digits = String(mark.n).split("").map((d) => DIGITS[d]);
  const scale = GLYPH_H / 100;
  let dx = 0;
  const glyphs = digits.map((glyph, i) => {
    const at = dx;
    dx += glyph.box[2] * scale + (i < digits.length - 1 ? DIGIT_GAP : 0);
    return { glyph, dx: at };
  });
  return { glyphs, width: dx, scale };
}

export interface Row {
  mark: Mark;
  /** Top of the glyphs; the baseline is y + GLYPH_H. */
  y: number;
  placed: Placed[];
}

export interface Page {
  rows: Row[];
}

export interface Sheet {
  id: string;
  title: string;
  marks: Mark[];
}

export const SHEETS: ReadonlyArray<Sheet> = [
  { id: "numbers-0-10", title: "Trace numbers 0 to 10", marks: Array.from({ length: 11 }, (_, n) => ({ kind: "number", n })) },
  { id: "numbers-1-20", title: "Trace numbers 1 to 20", marks: Array.from({ length: 20 }, (_, i) => ({ kind: "number", n: i + 1 })) },
  { id: "shapes", title: "Trace the shapes", marks: (Object.keys(SHAPES) as ShapeId[]).map((shape) => ({ kind: "shape", shape })) },
];

export const ROWS_PER_PAGE = Math.floor((PAGE_H - 2 * MARGIN - HEADER_H + ROW_GAP) / (GLYPH_H + ROW_GAP));

/**
 * The pages of a sheet: ROWS_PER_PAGE rows a page, each row one solid model then as many dashed copies
 * to trace as fit across the page.
 */
export function layoutSheet(sheet: Sheet): Page[] {
  const pages: Page[] = [];
  sheet.marks.forEach((mark, i) => {
    const r = i % ROWS_PER_PAGE;
    if (r === 0) pages.push({ rows: [] });
    const y = MARGIN + HEADER_H + r * (GLYPH_H + ROW_GAP);
    const { glyphs, width, scale } = markParts(mark);
    const copies = Math.floor((PAGE_W - 2 * MARGIN + GLYPH_GAP) / (width + GLYPH_GAP));
    const placed: Placed[] = [];
    for (let c = 0; c < copies; c++) {
      const x0 = MARGIN + c * (width + GLYPH_GAP);
      for (const g of glyphs) placed.push({ glyph: g.glyph, x: x0 + g.dx, y, scale, model: c === 0 });
    }
    pages[pages.length - 1].rows.push({ mark, y, placed });
  });
  return pages;
}

/** "3 pages" for the menu. */
export function pageCount(sheet: Sheet): number {
  return Math.ceil(sheet.marks.length / ROWS_PER_PAGE);
}
