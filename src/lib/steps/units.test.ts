import { describe, it, expect } from "vitest";
import { compileCard } from "./pool";

// The two hand-authored units, imported from the content repo.
const units = import.meta.glob("../../../../openedu-library/units/**/unit.md", {
  eager: true, query: "?raw", import: "default",
}) as Record<string, string>;

describe("P3 — does a purpose-built unit clear the pool law by construction?", () => {
  // F0(b) failed on the CARD tier at 30.5% against a 40% bar, and the whole plan then rested on the
  // claim that a unit written to be harvestable clears the law by construction. If it did not, the
  // content-factory premise was in trouble. This is that test, and it is why the harvest-surface
  // rule in build-units.mjs is a build gate rather than a style note.
  const entries = Object.entries(units).map(([p, md]) => ({
    id: p.replace(/^.*\/units\//, "").replace(/\/unit\.md$/, ""),
    md,
  }));

  it("found the authored units", () => {
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });

  for (const { id, md } of entries) {
    it(`${id} bears mastery`, () => {
      const r = compileCard(id, md, 8);
      // The contrast that matters: the average CARD yields 0 items and 119 of 154 yield nothing at
      // all. A unit built to the rule yields dozens, because every concept section ends in a table
      // or a definition list the compiler can harvest with a guaranteed-correct key.
      expect(r.closed).toBeGreaterThanOrEqual(10);
      expect(r.kinds).toBeGreaterThanOrEqual(2);
      expect(r.bearsMastery).toBe(true);
      // Zero gate rejections: authored-to-spec content should not be tripping V0-V3 at all.
      expect(Object.keys(r.byGate)).toEqual([]);
    });
  }
});
