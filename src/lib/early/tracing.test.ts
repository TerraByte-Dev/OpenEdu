import { describe, it, expect } from "vitest";
import { GLYPH_H, MARGIN, PAGE_H, PAGE_W, ROWS_PER_PAGE, SHEETS, layoutSheet, pageCount, strokeStart } from "./tracing";

const sheet = (id: string) => SHEETS.find((s) => s.id === id)!;

describe("tracing sheets", () => {
  it("offers numbers 0-10, numbers 1-20 and the shapes, and no letters yet", () => {
    expect(SHEETS.map((s) => s.id)).toEqual(["numbers-0-10", "numbers-1-20", "shapes"]);
    expect(sheet("numbers-0-10").marks.map((m) => (m.kind === "number" ? m.n : -1))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(sheet("numbers-1-20").marks).toHaveLength(20);
    expect(sheet("shapes").marks.map((m) => (m.kind === "shape" ? m.shape : ""))).toEqual(["circle", "square", "triangle", "rectangle", "star", "heart"]);
  });

  it("draws every glyph at least 1.5 inches tall", () => {
    expect(GLYPH_H).toBeGreaterThanOrEqual(150); // hundredths of an inch
    for (const s of SHEETS) for (const page of layoutSheet(s)) for (const row of page.rows) for (const p of row.placed) {
      expect(p.glyph.box[3] * p.scale, `${s.id}`).toBeCloseTo(GLYPH_H, 5);
    }
  });

  it("keeps every glyph inside the page margins of a Letter page", () => {
    for (const s of SHEETS) for (const page of layoutSheet(s)) for (const row of page.rows) for (const p of row.placed) {
      expect(p.x).toBeGreaterThanOrEqual(MARGIN);
      expect(p.x + p.glyph.box[2] * p.scale).toBeLessThanOrEqual(PAGE_W - MARGIN + 1e-9);
      expect(p.y + GLYPH_H).toBeLessThanOrEqual(PAGE_H - MARGIN);
    }
  });

  it("puts one solid model first in each row and at least two copies to trace", () => {
    for (const s of SHEETS) for (const page of layoutSheet(s)) for (const row of page.rows) {
      const models = row.placed.filter((p) => p.model);
      const digits = row.mark.kind === "number" ? String(row.mark.n).length : 1;
      expect(models.length).toBe(digits);
      expect(row.placed.indexOf(models[0])).toBe(0);
      expect(row.placed.length / digits - 1, s.id).toBeGreaterThanOrEqual(2);
    }
  });

  it("splits a sheet into pages of ROWS_PER_PAGE rows", () => {
    expect(ROWS_PER_PAGE).toBe(4);
    expect(SHEETS.map(pageCount)).toEqual([3, 5, 2]);
    expect(layoutSheet(sheet("numbers-0-10")).map((p) => p.rows.length)).toEqual([4, 4, 3]);
  });

  it("starts every stroke with a move, where the start dot goes", () => {
    for (const s of SHEETS) for (const page of layoutSheet(s)) for (const row of page.rows) for (const p of row.placed) {
      for (const stroke of p.glyph.strokes) {
        const [x, y] = strokeStart(stroke);
        const [x0, y0, w, h] = p.glyph.box;
        expect(x).toBeGreaterThanOrEqual(x0 - 1e-9);
        expect(x).toBeLessThanOrEqual(x0 + w + 1e-9);
        expect(y).toBeGreaterThanOrEqual(y0 - 1e-9);
        expect(y).toBeLessThanOrEqual(y0 + h + 1e-9);
      }
    }
    expect(strokeStart("M30,0 L30,100")).toEqual([30, 0]);
    expect(() => strokeStart("L1,2")).toThrow();
  });
});
