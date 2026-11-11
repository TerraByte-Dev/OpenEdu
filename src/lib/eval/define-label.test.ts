import { describe, it, expect } from "vitest";
import {
  defineHumanVerdicts, selectDefineLabelRows, defineKappaReport, adjudicatedMajority, checkDefineVerdicts,
  DEFINE_LABEL_ROWS, type DefineLabelCandidate, type DefineLabelVerdicts, type LabelExport,
} from "./define-label";
import { renderDefineSheet } from "./headless/define-label-sheet";
import { sheetData, grader2Request } from "./headless/define-label-grader2";

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

// A made-up pool: 64 items, two arms, three repeats, varied verdicts.
const pool: DefineLabelCandidate[] = [];
for (let i = 0; i < 64; i++) {
  for (const arm of ["B", "D"] as const) {
    for (let repeat = 0; repeat < 3; repeat++) {
      const kind = i < 12 ? "sense" : "plain";
      const lenient = (i + repeat) % 4 !== 0;
      const strict = kind === "plain" ? lenient : lenient && i % 3 !== 0;
      pool.push({ uid: `m|${arm}|i${i}|${repeat}`, model: "m", arm, item: `i${i}`, repeat, kind, band: "K-2", lenient, strict });
    }
  }
}

describe("selectDefineLabelRows", () => {
  it("draws 60 rows, one per model, arm and item, meeting every minimum, the same every time", () => {
    const rows = selectDefineLabelRows(pool);
    expect(rows).toHaveLength(DEFINE_LABEL_ROWS);
    expect(new Set(rows.map((c) => `${c.model}|${c.arm}|${c.item}`)).size).toBe(60);
    expect(rows.filter((c) => c.arm === "B").length).toBeGreaterThanOrEqual(25);
    expect(rows.filter((c) => c.arm === "D").length).toBeGreaterThanOrEqual(25);
    expect(rows.filter((c) => c.kind === "sense").length).toBeGreaterThanOrEqual(16);
    expect(rows.filter((c) => !c.lenient).length).toBeGreaterThanOrEqual(12);
    expect(rows.filter((c) => c.lenient).length).toBeGreaterThanOrEqual(12);
    expect(rows.filter((c) => c.kind === "sense" && c.lenient && !c.strict).length).toBeGreaterThanOrEqual(4);
    expect(selectDefineLabelRows(pool).map((c) => c.uid)).toEqual(rows.map((c) => c.uid));
  });
});

const verdicts = (rows: Array<[string, "B" | "D", "plain" | "sense", boolean, boolean]>): DefineLabelVerdicts => ({
  sheet: "s", grader: "abc+def", adjudication: false,
  rows: Object.fromEntries(rows.map(([rid, arm, kind, lenient, strict], i) => [rid, { source: "f", model: "m", arm, item: `i${i}`, repeat: 0, kind, band: "K-2", lenient, strict }])),
});
const exp = (grader: string, answers: LabelExport["answers"]): LabelExport => ({ sheet: "s", grader, exportedAt: "", answers });

describe("defineKappaReport", () => {
  it("scores both readings and counts the lexical grader's false passes and fails per arm on agreed rows", () => {
    const v = verdicts([["R1", "B", "plain", true, true], ["R2", "B", "plain", false, false], ["R3", "D", "sense", true, false], ["R4", "D", "sense", true, true]]);
    const a = exp("tate", { R1: { meaning: "yes" }, R2: { meaning: "no" }, R3: { meaning: "yes", other: "yes" }, R4: { meaning: "no", other: "no" } });
    const [lenient, strict] = defineKappaReport(a, exp("g2", a.answers), v);
    expect(lenient.reading).toBe("lenient");
    expect(lenient.graders.kappa).toBe(1);
    expect(lenient.byArm.D).toEqual({ falsePass: 1, humanFail: 1, falseFail: 0, humanPass: 1 });
    expect(lenient.byArm.B).toEqual({ falsePass: 0, humanFail: 1, falseFail: 0, humanPass: 1 });
    expect(strict.aVsLexical.n).toBe(2); // sense rows only
    expect(strict.byArm.D).toEqual({ falsePass: 1, humanFail: 2, falseFail: 0, humanPass: 0 });
    expect(lenient.meetsBar).toBe(false);
  });

  it("checks the verdicts file", () => {
    expect(() => checkDefineVerdicts({ ...verdicts([]), grader: "" })).toThrow(/grader commits/);
  });
});

describe("adjudicatedMajority", () => {
  it("takes the graders' verdict where they agree and the lexical one where they do not, per item and arm", () => {
    const v: DefineLabelVerdicts = {
      sheet: "s", grader: "g", adjudication: true,
      rows: {
        R1: { source: "f", model: "m", arm: "D", item: "x", repeat: 0, kind: "plain", band: "K-2", lenient: false, strict: false },
        R2: { source: "f", model: "m", arm: "D", item: "x", repeat: 1, kind: "plain", band: "K-2", lenient: false, strict: false },
        R3: { source: "f", model: "m", arm: "D", item: "x", repeat: 2, kind: "plain", band: "K-2", lenient: true, strict: true },
        R4: { source: "f", model: "m", arm: "B", item: "x", repeat: 0, kind: "plain", band: "K-2", lenient: true, strict: true },
      },
    };
    const a = exp("tate", { R1: { meaning: "yes" }, R2: { meaning: "yes" }, R3: { meaning: "no" }, R4: { meaning: "yes" } });
    const b = exp("g2", { R1: { meaning: "yes" }, R2: { meaning: "no" }, R3: { meaning: "no" }, R4: { meaning: "yes" } });
    // D: R1 agreed pass, R2 disagreement -> lexical fail, R3 agreed fail: 1 of 3, so fail.
    expect(adjudicatedMajority(a, b, v).get("x")).toEqual({ B: true, D: false });
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
