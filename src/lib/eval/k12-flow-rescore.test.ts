import { describe, it, expect } from "vitest";
import { commitQuote, countDetectors, rescoreRows, type SavedK12FlowRow } from "./k12-flow-rescore";
import { formatK12FlowT1 } from "./k12-flow";
import { K12_ITEMS } from "./k12-items";

// A real item (math-k5-01, key B: 692), with synthetic replies. The rows are built the way the
// runner saves them, then rescored through the same gradeK12Flow the runner calls.
const item = K12_ITEMS.find((i) => i.id === "math-k5-01")!;
const turns = (t3: string, t2 = "Not quite. What is 407 + 285?") => [
  { user: formatK12FlowT1(item), text: "What do you get when you add the ones?" },
  { user: "I think it's C.", text: t2 },
  { user: "Show me the full worked answer.", text: t3 },
];
const oldGrade = { g1: true, g1Reason: null, g1b: true, g2: true, g3: false, g4: true, questions: { t1: 1, t2: 1 }, g5: false, t3Answer: null, pass: false };

describe("rescoreRows", () => {
  it("re-grades a saved row and lists the verdicts that changed", () => {
    const row: SavedK12FlowRow = { id: item.id, key: item.key, attempted: "C", turns: turns("407 + 285 = 692. This matches option B."), grade: oldGrade };
    const res = rescoreRows([row], K12_ITEMS);
    expect(res.drifted).toEqual([]);
    expect(res.rows[0].next).toMatchObject({ g3: true, g5: true, g2b: true, pass: true });
    expect(res.rows[0].flips.sort()).toEqual(["g3", "g5", "pass"]);
  });

  it("never flips G2b, which the old grade did not have, and leaves ERROR rows ungraded", () => {
    const reveal: SavedK12FlowRow = { id: item.id, key: item.key, attempted: "C", turns: turns("Nothing.", "The correct answer is B."), grade: oldGrade };
    const error: SavedK12FlowRow = { id: item.id, key: item.key, attempted: "C", turns: turns(""), grade: null };
    const res = rescoreRows([reveal, error], K12_ITEMS);
    expect(res.rows[0].next!.g2b).toBe(false);
    expect(res.rows[0].flips).not.toContain("g2b");
    expect(res.rows[1]).toMatchObject({ next: null, flips: [] });
    const counts = countDetectors(res);
    expect(counts.find((c) => c.detector === "g2b")!.old).toBeNull();
    expect(counts.find((c) => c.detector === "pass")!.next.n).toBe(2); // the headline counts ERROR rows
    expect(counts.find((c) => c.detector === "g1")!.next.n).toBe(1);
  });

  it("reports an item whose T1 no longer matches the item set", () => {
    const row: SavedK12FlowRow = { id: item.id, key: item.key, attempted: "C", turns: [{ user: "something else", text: "x" }, ...turns("x").slice(1)], grade: oldGrade };
    expect(rescoreRows([row], K12_ITEMS).drifted).toEqual([item.id]);
  });
});

describe("commitQuote", () => {
  it("finds the line holding the final commit, or a given letter", () => {
    const t3 = "Add the ones: 7 + 5 = 12.\n\nSo the sum is 692. This matches option B.\n\nAny questions?";
    expect(commitQuote(t3, item.options)).toBe("This matches option B.");
    expect(commitQuote("Let's add.", item.options)).toBeNull();
    expect(commitQuote("The correct answer is B. Try another?", item.options, "B")).toBe("The correct answer is B.");
  });
});
