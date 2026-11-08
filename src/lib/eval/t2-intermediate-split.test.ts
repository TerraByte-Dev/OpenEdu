import { describe, it, expect } from "vitest";
import { K12_FR_ITEMS } from "./k12-flow-fr-items";
import { isIntermediateStepTry } from "./t2-intermediate-split";

// The pre-registered split, pinned. Computed by isIntermediateStepTry from the item data and committed
// before any run of the check-before-praise lever. Changing this list after a run is not allowed.
const INTERMEDIATE_STEP_ITEMS = [
  "fr-math-k5-06", // 15: 125 / 8 = 15 remainder 5, before rounding up to 16 boxes
  "fr-math-k5-14", // $4.05: the notebooks' total, not the $0.95 change
  "fr-math-68-16", // 65 degrees: the third interior angle, not the 115 degree exterior angle
  "fr-math-68-17", // 576: height squared, not the 24 ft height
  "fr-math-912-04", // 3: the vertex's x, not f(3) = -11
  "fr-math-912-12", // 289: the distance squared, not 17
  "fr-science-912-03", // 56%: G + C, not C = 28%
  "fr-science-912-04", // 2,000 kJ: one transfer, not three (20 kJ)
  "fr-science-912-12", // 10: oxygen atoms, not 5 O2 molecules
  "fr-science-912-17", // 400: v squared, not v = 20 m/s
];

describe("the T2 intermediate-step split (k12-flow-fr)", () => {
  it("is the pinned list: 10 of 81 items", () => {
    const split = K12_FR_ITEMS.filter(isIntermediateStepTry).map((x) => x.id);
    expect(split).toEqual(INTERMEDIATE_STEP_ITEMS);
    expect(K12_FR_ITEMS).toHaveLength(81);
  });

  it("leaves out a percent of a raw difference, a different unit, and a given used as an operand", () => {
    const byId = (id: string) => K12_FR_ITEMS.find((x) => x.id === id)!;
    expect(isIntermediateStepTry(byId("fr-math-68-04"))).toBe(false); // 10% vs the raw increase 10
    expect(isIntermediateStepTry(byId("fr-science-912-15"))).toBe(false); // 6.0 A vs 6.0 ohm
    expect(isIntermediateStepTry(byId("fr-science-912-08"))).toBe(false); // 0.20 mol is a given operand
    expect(isIntermediateStepTry(byId("fr-social-912-18"))).toBe(false); // 40 tons is a given operand
  });
});
