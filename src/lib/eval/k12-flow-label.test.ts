import { describe, it, expect } from "vitest";
import { cohenKappa, humanVerdicts, kappaReport, selectLabelRows, LABEL_DETECTORS, LABEL_QUESTIONS, type LabelCandidate, type LabelExport, type LabelVerdicts } from "./k12-flow-label";
import type { K12FlowGrade } from "./k12-flow-grade";

const pairs = (n: number, a: boolean, b: boolean): Array<[boolean, boolean]> => Array.from({ length: n }, () => [a, b]);

describe("cohenKappa", () => {
  it("matches the textbook 2x2 example: 20 yes/yes, 5 yes/no, 10 no/yes, 15 no/no is 0.4", () => {
    // po = 35/50 = 0.7; A says yes 25/50, B 30/50; pe = 0.5 * 0.6 + 0.5 * 0.4 = 0.5; kappa = (0.7 - 0.5) / 0.5.
    const k = cohenKappa([...pairs(20, true, true), ...pairs(5, true, false), ...pairs(10, false, true), ...pairs(15, false, false)]);
    expect(k.n).toBe(50);
    expect(k.po).toBeCloseTo(0.7, 10);
    expect(k.pe).toBeCloseTo(0.5, 10);
    expect(k.kappa).toBeCloseTo(0.4, 10);
  });

  it("is 1 for perfect agreement and 0 or below for chance-level agreement", () => {
    expect(cohenKappa([...pairs(3, true, true), ...pairs(2, false, false)]).kappa).toBe(1);
    expect(cohenKappa([...pairs(5, true, true), ...pairs(5, true, false), ...pairs(5, false, true), ...pairs(5, false, false)]).kappa).toBeCloseTo(0, 10);
  });

  it("is undefined when there is nothing to compare or both raters gave one answer only", () => {
    expect(cohenKappa([]).kappa).toBeNull();
    expect(cohenKappa(pairs(10, true, true)).kappa).toBeNull();
  });
});

describe("humanVerdicts", () => {
  it("maps each question back to its detector, with true as a pass", () => {
    const v = humanVerdicts({ t1_reveal: "yes", t1_ends_q: "yes", t1_many_q: "no", t2_affirm: "no", t2_reveal: "yes", t2_many_q: "yes", t3_commits: "yes", t3_right: "no" });
    expect(v).toEqual({ g1: false, g1b: true, g2: true, g2b: false, g3: false, g4: false, g5: true });
  });
  it("leaves a detector null when a needed answer is missing", () => {
    expect(humanVerdicts({ t1_many_q: "no" })).toMatchObject({ g1: null, g4: null });
  });
  it("has a question for every detector", () => {
    const all = Object.fromEntries(LABEL_QUESTIONS.map((q) => [q.id, "no" as const]));
    expect(Object.values(humanVerdicts(all)).every((x) => x !== null)).toBe(true);
    expect(Object.keys(humanVerdicts(all)).sort()).toEqual([...LABEL_DETECTORS].sort());
  });
});

describe("kappaReport", () => {
  // Four rows. Grader A matches the detector on G1 everywhere; grader B flips row R4.
  const det = (g1: boolean) => ({ g1, g1b: true, g2: true, g2b: true, g3: true, g4: true, g5: true });
  const verdicts: LabelVerdicts = {
    sheet: "s",
    rows: { R1: { source: "f", model: "m", arm: "a", item: "i1", fixed: true, detectors: det(true) }, R2: { source: "f", model: "m", arm: "a", item: "i2", fixed: false, detectors: det(true) }, R3: { source: "f", model: "m", arm: "a", item: "i3", fixed: true, detectors: det(false) }, R4: { source: "f", model: "m", arm: "a", item: "i4", fixed: false, detectors: det(false) } },
  };
  const ans = (reveal: boolean) => ({ t1_reveal: reveal ? ("yes" as const) : ("no" as const) });
  const a: LabelExport = { sheet: "s", grader: "A", exportedAt: "", answers: { R1: ans(false), R2: ans(false), R3: ans(true), R4: ans(true) } };
  const b: LabelExport = { sheet: "s", grader: "B", exportedAt: "", answers: { R1: ans(false), R2: ans(false), R3: ans(true), R4: ans(false) } };

  it("computes grader-vs-grader, each grader vs the detector, and agreed rows vs the detector", () => {
    const g1 = kappaReport(a, b, verdicts).find((r) => r.detector === "g1")!;
    expect(g1.aVsDetector.kappa).toBe(1);
    // B vs detector: 3 of 4 agree; B passes 3/4, detector 2/4; pe = 0.75*0.5 + 0.25*0.5 = 0.5; kappa = 0.5.
    expect(g1.bVsDetector.kappa).toBeCloseTo(0.5, 10);
    expect(g1.graders.kappa).toBeCloseTo(0.5, 10);
    expect(g1.agreedVsDetector.n).toBe(3);
    // Questions nobody answered give no pairs.
    expect(kappaReport(a, b, verdicts).find((r) => r.detector === "g5")!.graders.n).toBe(0);
  });

  it("can keep only the fixed or only the drawn rows", () => {
    const fixed = kappaReport(a, b, verdicts, (r) => r.fixed).find((r) => r.detector === "g1")!;
    expect(fixed.graders).toMatchObject({ n: 2, kappa: 1 });
    // Drawn rows R2, R4: A says pass/fail, B says pass/pass; the detector says pass/fail.
    const drawn = kappaReport(a, b, verdicts, (r) => !r.fixed).find((r) => r.detector === "g1")!;
    expect(drawn.aVsDetector).toMatchObject({ n: 2, kappa: 1 });
    expect(drawn.bVsDetector).toMatchObject({ n: 2, po: 0.5 });
  });
});

describe("selectLabelRows", () => {
  const grade = (i: number): K12FlowGrade => ({
    g1: i % 2 === 0, g1Reason: null, g1b: i % 3 !== 0, g2: i % 7 !== 0, g2b: i % 5 !== 0, g3: i % 4 !== 0, g4: i % 6 !== 0,
    questions: { t1: 1, t2: 1 }, g5: i % 4 !== 1, t3Answer: null, pass: false,
  });
  const subjects = ["math", "science", "ela", "social-studies"];
  const pool: LabelCandidate[] = [];
  for (const model of ["m1", "m2"]) {
    for (const arm of ["baseline", "L1"]) {
      for (let i = 0; i < 80; i++) {
        pool.push({ uid: `${model}|${arm}|it${i}`, model, arm, item: `it${i}`, subject: subjects[i % 4], grade: grade(i), proseFlip: arm === "baseline" && i % 9 === 0, placeholderFlip: i === 13 || i === 27 });
      }
    }
  }
  const fixed = ["m1|baseline|it0", "m2|baseline|it1"];

  it("keeps the fixed rows, reaches the total, and is the same every time", () => {
    const a = selectLabelRows(pool, fixed);
    expect(a).toHaveLength(60);
    expect(a.slice(0, 2).map((c) => c.uid)).toEqual(fixed);
    expect(selectLabelRows(pool, fixed).map((c) => c.uid)).toEqual(a.map((c) => c.uid));
    expect(new Set(a.map((c) => `${c.model}|${c.item}`)).size).toBe(60);
  });

  it("meets every minimum", () => {
    const a = selectLabelRows(pool, fixed);
    for (const d of LABEL_DETECTORS) {
      expect(a.filter((c) => !c.grade[d]).length, `${d} fail`).toBeGreaterThanOrEqual(5);
      expect(a.filter((c) => c.grade[d]).length, `${d} pass`).toBeGreaterThanOrEqual(5);
    }
    expect(a.filter((c) => c.proseFlip).length).toBeGreaterThanOrEqual(8);
    expect(a.filter((c) => c.placeholderFlip).length).toBeGreaterThanOrEqual(2);
    for (const s of subjects) expect(a.filter((c) => c.subject === s).length).toBeGreaterThanOrEqual(12);
    for (const m of ["m1", "m2"]) expect(a.filter((c) => c.model === m).length).toBeGreaterThanOrEqual(25);
  });

  it("refuses a fixed row that is not in the pool", () => {
    expect(() => selectLabelRows(pool, ["nope"])).toThrow(/not in the pool/);
  });
});
