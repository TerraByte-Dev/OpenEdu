import { describe, it, expect } from "vitest";
import {
  defineHumanVerdicts, selectDefineLabelRows, defineKappaReport, adjudicate, checkDefineVerdicts, unansweredRows,
  DEFINE_LABEL_ROWS, DEFINE_LABEL_NEEDS, type DefineLabelCandidate, type DefineLabelVerdicts, type LabelExport,
} from "./define-label";
import { renderDefineSheet, sheetData, grader2Request } from "./headless/define-script-lib";
import { seededRandom } from "./headless/select";

describe("defineHumanVerdicts", () => {
  it("plain: strict is lenient; sense: strict also needs no other meaning", () => {
    expect(defineHumanVerdicts({ meaning: "yes" }, "plain")).toEqual({ lenient: true, strict: true });
    expect(defineHumanVerdicts({ meaning: "yes", other: "yes" }, "sense")).toEqual({ lenient: true, strict: false });
    expect(defineHumanVerdicts({ meaning: "yes", other: "no" }, "sense")).toEqual({ lenient: true, strict: true });
    expect(defineHumanVerdicts({ meaning: "no" }, "sense")).toEqual({ lenient: false, strict: false });
    expect(defineHumanVerdicts({ meaning: "yes" }, "sense")).toEqual({ lenient: true, strict: null });
    expect(defineHumanVerdicts({}, "plain")).toEqual({ lenient: null, strict: null });
  });
});

/** A made-up pool shaped like the dev split: 52 plain and 12 sense items, two arms, three repeats, with
 *  each row passing the lexical grader at `passRate` (seeded). */
function devPool(passRate: number, seed = 7): DefineLabelCandidate[] {
  const rand = seededRandom(seed);
  const pool: DefineLabelCandidate[] = [];
  for (let i = 0; i < 64; i++) {
    for (const arm of ["B", "D"] as const) {
      for (let repeat = 0; repeat < 3; repeat++) {
        const kind = i < 12 ? "sense" : "plain";
        const lenient = rand() < passRate;
        const strict = kind === "plain" ? lenient : lenient && rand() < 0.8;
        pool.push({ uid: `m|${arm}|i${i}|${repeat}`, model: "m", arm, item: `i${i}`, repeat, kind, band: "K-2", lenient, strict });
      }
    }
  }
  return pool;
}

const meets = (rows: DefineLabelCandidate[]) => DEFINE_LABEL_NEEDS.every((n) => rows.filter(n.test).length >= n.min);

describe("selectDefineLabelRows", () => {
  it("draws 60 rows, one per model, arm and item, meeting every minimum, the same every time", () => {
    const rows = selectDefineLabelRows(devPool(0.75));
    expect(rows).toHaveLength(DEFINE_LABEL_ROWS);
    expect(new Set(rows.map((c) => `${c.model}|${c.arm}|${c.item}`)).size).toBe(60);
    expect(meets(rows)).toBe(true);
    expect(selectDefineLabelRows(devPool(0.75)).map((c) => c.uid)).toEqual(rows.map((c) => c.uid));
  });

  it("meets every minimum at a 90% lexical pass rate, filling the scarcest needs first", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) expect(meets(selectDefineLabelRows(devPool(0.9, seed))), `seed ${seed}`).toBe(true);
  });

  it("takes as many rows as the pool holds for a need it cannot meet", () => {
    const pool = devPool(1).map((c) => ({ ...c, strict: c.lenient })); // no fails and no strict-only fails at all
    const rows = selectDefineLabelRows(pool);
    expect(rows).toHaveLength(60);
    expect(rows.filter((c) => !c.lenient)).toHaveLength(0);
  });
});

const verdicts = (rows: Array<[string, "B" | "D", "plain" | "sense", boolean, boolean]>, over: Partial<DefineLabelVerdicts> = {}): DefineLabelVerdicts => ({
  sheet: "s", grader: "abc+def", adjudication: false, repeats: 3,
  rows: Object.fromEntries(rows.map(([rid, arm, kind, lenient, strict], i) => [rid, { source: "f", model: "m", arm, item: `i${i}`, repeat: 0, kind, band: "K-2", lenient, strict }])),
  ...over,
});
const exp = (grader: string, answers: LabelExport["answers"]): LabelExport => ({ sheet: "s", grader, exportedAt: "", answers });

describe("defineKappaReport", () => {
  it("scores both readings and counts the lexical grader's false passes and fails per arm on agreed rows", () => {
    const v = verdicts([["R1", "B", "plain", true, true], ["R2", "B", "plain", false, false], ["R3", "D", "sense", true, false], ["R4", "D", "sense", true, true]]);
    const a = exp("tate", { R1: { meaning: "yes" }, R2: { meaning: "no" }, R3: { meaning: "yes", other: "yes" }, R4: { meaning: "no", other: "no" } });
    const [lenient, strict] = defineKappaReport(a, exp("g2", a.answers), v);
    expect(lenient.graders.kappa).toBe(1);
    expect(lenient.byArm.D).toEqual({ falsePass: 1, humanFail: 1, falseFail: 0, humanPass: 1 });
    expect(lenient.byArm.B).toEqual({ falsePass: 0, humanFail: 1, falseFail: 0, humanPass: 1 });
    expect(strict.aVsLexical.n).toBe(2); // sense rows only
    expect(strict.byArm.D).toEqual({ falsePass: 1, humanFail: 2, falseFail: 0, humanPass: 0 });
    expect(lenient.meetsBar).toBe(false);
  });

  it("finds the rows an export left unanswered", () => {
    const v = verdicts([["R1", "B", "plain", true, true], ["R2", "D", "sense", true, true]]);
    expect(unansweredRows(exp("g", { R1: { meaning: "yes" }, R2: { meaning: "yes" } }), v)).toEqual(["R2"]);
    expect(unansweredRows(exp("g", { R1: { meaning: "yes" }, R2: { meaning: "yes", other: "no" } }), v)).toEqual([]);
  });

  it("checks the verdicts file: grader commits, repeats, one model per adjudication sheet", () => {
    expect(() => checkDefineVerdicts(verdicts([], { grader: "" }))).toThrow(/grader commits/);
    expect(() => checkDefineVerdicts(verdicts([], { repeats: 0 }))).toThrow(/repeats/);
    const two = verdicts([["R1", "B", "plain", true, true], ["R2", "D", "plain", true, true]], { adjudication: true });
    two.rows.R2.model = "other";
    expect(() => checkDefineVerdicts(two)).toThrow(/one model/);
  });
});

describe("adjudicate", () => {
  const row = (arm: "B" | "D", repeat: number, lenient: boolean) => ({ source: "f", model: "m", arm, item: "x", repeat, kind: "plain" as const, band: "K-2" as const, lenient, strict: lenient });
  const v: DefineLabelVerdicts = {
    sheet: "s", grader: "g", adjudication: true, repeats: 3,
    rows: { R1: row("D", 0, false), R2: row("D", 1, false), R3: row("D", 2, true), R4: row("B", 0, true), R5: row("B", 1, true), R6: row("B", 2, false) },
  };

  it("lets grader 1 decide each row; the lexical verdict stands only where grader 1 gave no label", () => {
    const g1 = exp("tate", { R1: { meaning: "yes" }, R2: { meaning: "yes" }, R3: { meaning: "no" }, R4: { meaning: "yes" }, R5: { meaning: "no" } });
    const g2 = exp("g2", { R1: { meaning: "no" }, R2: { meaning: "no" }, R3: { meaning: "no" }, R4: { meaning: "yes" }, R5: { meaning: "no" }, R6: { meaning: "yes" } });
    const r = adjudicate(g1, g2, v);
    expect(r.items.get("x")).toEqual({ D: true, B: false }); // D: R1, R2 pass; B: R4 pass, R5 fail, R6 lexical fail
    expect(r.rows.filter((x) => !x.adjudicated).map((x) => x.rid)).toEqual(["R6"]);
    // Both agree (sensitivity): D R1, R2 disagree -> lexical fail, R3 agreed fail: 0 of 3.
    expect(r.bothAgree.get("x")).toEqual({ D: false, B: false });
    expect(r.disagreements.map((x) => x.rid)).toEqual(["R1", "R2"]);
  });

  it("uses the run's repeats as the denominator: ERROR, ERROR, pass is 1 of 3, a fail", () => {
    const one: DefineLabelVerdicts = { ...v, rows: { R3: row("D", 2, true), R4: row("B", 0, true), R5: row("B", 1, true), R6: row("B", 2, true) } };
    const all = exp("tate", { R3: { meaning: "yes" }, R4: { meaning: "yes" }, R5: { meaning: "yes" }, R6: { meaning: "yes" } });
    expect(adjudicate(all, all, one).items.get("x")).toEqual({ D: false, B: true });
  });
});

describe("the sheet and grader 2", () => {
  const rows = [{ rid: "R01", word: "zorp", kind: "sense" as const, ask: "what does zorp mean in 'the zorp hummed'", reply: "A zorp is a gadget </script> here." }];
  const html = renderDefineSheet("define-label-gabc+def", rows);

  it("shows the word, message and reply only: no arm, model, verdict or note", () => {
    expect(html).not.toMatch(/"arm"|"model"|lenient|strict|dictionary_entry|tutor_note/);
    expect(sheetData(html)).toMatchObject({ sheet: "define-label-gabc+def", rows });
  });

  it("asks grader 2 the sheet's own questions with a strict yes/no schema, and nothing else about the row", () => {
    const body = grader2Request("some-model", rows[0]) as { model: string; messages: Array<{ content: string }>; response_format: { json_schema: { schema: { required: string[] } } } };
    expect(body.model).toBe("some-model");
    expect(body.response_format.json_schema.schema.required).toEqual(["meaning", "other"]);
    expect(body.messages[1].content).toContain("as it is used in the student's sentence");
    expect(grader2Request("m", { ...rows[0], kind: "plain" }).response_format).toMatchObject({ json_schema: { schema: { required: ["meaning"] } } });
  });
});
