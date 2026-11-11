import { describe, it, expect } from "vitest";
import {
  PACKS, SKILLS, ITEMS_BY_ID, COLORS, COLOR_HEX, SHAPES, choiceKey, choiceLabel, neighbours, packOf,
} from "./packs";
import { ROUND_SIZE } from "./engine";
import type { ColorId, Item, SkillId } from "./types";

const allItems: Item[] = Object.values(SKILLS).flatMap((s) => s.items);

// WCAG relative luminance and contrast ratio.
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe("every item is internally valid", () => {
  it("has its answer key among its choices, exactly once", () => {
    for (const item of allItems) {
      const keys = item.choices.map(choiceKey);
      expect(keys.filter((k) => k === item.answer), item.id).toHaveLength(1);
    }
  });

  it("offers 2 to 4 different choices", () => {
    for (const item of allItems) {
      expect(item.choices.length, item.id).toBeGreaterThanOrEqual(2);
      expect(item.choices.length, item.id).toBeLessThanOrEqual(4);
      expect(new Set(item.choices.map(choiceKey)).size, item.id).toBe(item.choices.length);
    }
  });

  it("has a stable, unique id under its own skill", () => {
    const ids = allItems.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of allItems) expect(item.id.startsWith(`${item.skillId}/`), item.id).toBe(true);
    for (const [id, skill] of Object.entries(SKILLS)) for (const item of skill.items) expect(item.skillId).toBe(id);
    expect(ITEMS_BY_ID.size).toBe(ids.length);
  });

  it("has a prompt, praise and a teaching retry that never says wrong", () => {
    for (const item of allItems) {
      expect(item.prompt.trim(), item.id).not.toBe("");
      expect(item.praise.trim(), item.id).not.toBe("");
      expect(item.teach.say.trim(), item.id).not.toBe("");
      // The retry teaches: it counts along or shows the right answer.
      expect(item.teach.countAlong || item.teach.example !== null, item.id).toBe(true);
      for (const s of [item.prompt, item.praise, item.teach.say]) expect(s).not.toMatch(/\b(wrong|no|incorrect|bad)\b/i);
    }
  });
});

describe("the counting pack", () => {
  it("counts 1-10 first, then 11-20, numeral to quantity and quantity to numeral for each", () => {
    expect(packOf("counting").skills).toEqual(["count-1-10", "count-11-20"]);
    const numbers = (id: SkillId, kind: "apples" | "numeral") =>
      SKILLS[id].items.flatMap((i) => (i.picture.kind === kind ? [kind === "apples" ? (i.picture as { count: number }).count : (i.picture as { n: number }).n] : []));
    const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
    expect(numbers("count-1-10", "apples")).toEqual(range(1, 10));
    expect(numbers("count-1-10", "numeral")).toEqual(range(1, 10));
    expect(numbers("count-11-20", "apples")).toEqual(range(11, 20));
    expect(numbers("count-11-20", "numeral")).toEqual(range(11, 20));
  });

  it("keys each item to the number in its picture", () => {
    for (const id of ["count-1-10", "count-11-20"] as SkillId[]) {
      for (const item of SKILLS[id].items) {
        if (item.picture.kind === "apples") expect(item.answer).toBe(`n:${item.picture.count}`);
        else if (item.picture.kind === "numeral") expect(item.answer).toBe(`dots:${item.picture.n}`);
        else throw new Error(`${item.id} has no number picture`);
      }
    }
  });

  it("counts together on a wrong tap, saying every number up to the answer", () => {
    const item = ITEMS_BY_ID.get("count-1-10/how-many-4")!;
    expect(item.teach.countAlong).toBe(true);
    expect(item.teach.say).toBe("Let's count them together: 1, 2, 3, 4.");
  });

  it("offers neighbouring numbers inside the range", () => {
    expect(neighbours(1, 1, 10)).toEqual([1, 2, 3]);
    expect(neighbours(5, 1, 10)).toEqual([4, 5, 6]);
    expect(neighbours(10, 1, 10)).toEqual([8, 9, 10]);
    expect(neighbours(20, 10, 20)).toEqual([18, 19, 20]);
    for (const item of SKILLS["count-1-10"].items) {
      for (const c of item.choices) expect((c as { n: number }).n).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("the colors pack", () => {
  it("has the 8 basic colors, one item each, keyed to the color it asks for", () => {
    expect(COLORS).toHaveLength(8);
    expect(SKILLS.colors.items.map((i) => i.answer)).toEqual(COLORS.map((c) => `color:${c}`));
    for (const item of SKILLS.colors.items) expect(item.prompt).toContain(item.answer.slice("color:".length));
  });

  it("offers colors that differ in lightness too, so color blindness does not hide the answer", () => {
    for (const item of SKILLS.colors.items) {
      const hexes = item.choices.map((c) => COLOR_HEX[(c as { color: ColorId }).color]);
      for (let i = 0; i < hexes.length; i++) {
        for (let j = i + 1; j < hexes.length; j++) expect(contrast(hexes[i], hexes[j]), item.id).toBeGreaterThanOrEqual(1.5);
      }
    }
  });

  it("never puts red and green side by side", () => {
    for (const item of SKILLS.colors.items) {
      const keys = item.choices.map(choiceKey);
      expect(keys.includes("color:red") && keys.includes("color:green"), item.id).toBe(false);
    }
  });

  it("shows the color as the example on a wrong tap", () => {
    for (const item of SKILLS.colors.items) {
      expect(item.teach.example).toEqual({ kind: "color", color: item.answer.slice("color:".length) });
    }
  });
});

describe("the shapes pack", () => {
  it("has circle, square, triangle, rectangle, star and heart, one item each", () => {
    expect([...SHAPES]).toEqual(["circle", "square", "triangle", "rectangle", "star", "heart"]);
    expect(SKILLS.shapes.items.map((i) => i.answer)).toEqual(SHAPES.map((s) => `shape:${s}`));
  });

  it("shows the shape as the example on a wrong tap", () => {
    for (const item of SKILLS.shapes.items) {
      expect(item.teach.example).toEqual({ kind: "shape", shape: item.answer.slice("shape:".length) });
    }
  });
});

describe("packs and skills", () => {
  it("lists every skill in exactly one pack, in the pack the skill names", () => {
    const listed = PACKS.flatMap((p) => p.skills);
    expect([...listed].sort()).toEqual(Object.keys(SKILLS).sort());
    for (const p of PACKS) for (const id of p.skills) expect(SKILLS[id].pack).toBe(p.id);
  });

  it("unlocks each skill after the one before it in its pack", () => {
    for (const p of PACKS) {
      p.skills.forEach((id, i) => expect(SKILLS[id].after).toBe(i === 0 ? null : p.skills[i - 1]));
    }
  });

  it("has enough items in every skill for a round with no repeats", () => {
    for (const s of Object.values(SKILLS)) expect(s.items.length, s.id).toBeGreaterThanOrEqual(ROUND_SIZE);
  });

  it("has a grown-up tip and screen-free ideas for every skill", () => {
    for (const s of Object.values(SKILLS)) {
      expect(s.grownUpTip.trim()).not.toBe("");
      expect(s.playTogether.length).toBeGreaterThan(0);
    }
  });

  it("labels choices in words a voice can say", () => {
    expect(choiceLabel({ kind: "numeral", n: 4 })).toBe("4");
    expect(choiceLabel({ kind: "dots", n: 1 })).toBe("1 dot");
    expect(choiceLabel({ kind: "dots", n: 7 })).toBe("7 dots");
    expect(choiceLabel({ kind: "color", color: "red" })).toBe("red");
    expect(choiceLabel({ kind: "shape", shape: "star" })).toBe("star");
  });
});
