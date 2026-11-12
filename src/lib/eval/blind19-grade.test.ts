import { describe, it, expect } from "vitest";

// blind-19's gate, verdicts and comparison (blind19-grade.ts) on synthetic runs and grader exports:
// nothing here is a model output. Committed before blind-19 exists (BENCHMARKS.md B8 "Lever 19", R2).

import {
  BLIND19_RULE_MODEL, CANARY_ROWS, armOf, blind19Gate, blind19Refusals, buildBlind19Sheet, capsBroken, gradedRows,
  graderCost, itemVerdicts, judgeBlind19, rowVerdict,
  type Arm, type Blind19Input, type Blind19KeyRow, type Blind19Run, type ChangedList, type GradedSheet,
} from "./blind19-grade";
import type { Blind19Item } from "./blind19";
import type { LabelExport } from "./define-label";
import { DICTIONARY_NOTE } from "../kernel/defineWord";

const BANDS = ["K-2", "3-5", "6-8", "9-12"] as const;
const ITEMS: Blind19Item[] = BANDS.flatMap((band, b) => [
  ...Array.from({ length: 20 }, (_, i) => ({ id: `b19-${b}-L-${i}`, band, kind: "L" as const, word: `wl${b}x${i}`, ask: `what does wl${b}x${i} mean in 'a sentence'`, source: { response: 0, index: 0 } })),
  ...Array.from({ length: 10 }, (_, i) => ({ id: `b19-${b}-C-${i}`, band, kind: "C" as const, word: `wc${b}x${i}`, ask: `what does wc${b}x${i} mean in 'a sentence'`, source: { response: 0, index: 0 } })),
]);
const L = ITEMS.filter((i) => i.kind === "L").map((i) => i.id);
const C = ITEMS.filter((i) => i.kind === "C").map((i) => i.id);
/** Changed: the first 40 L items and the first 10 C items. */
const CHANGED = new Set([...L.slice(0, 40), ...C.slice(0, 10)]);
const changedList = (): ChangedList => ({ items: Object.fromEntries(ITEMS.map((i) => [i.id, { changed: CHANGED.has(i.id), sFirstAbsentUnderR: CHANGED.has(i.id) && i.kind === "L", topScore: CHANGED.has(i.id) ? 2 : 1 }])) });

const note = (tag: string) => `<dictionary_entry source="Open English WordNet">\n1. w (noun): ${tag}\n</dictionary_entry>\n${DICTIONARY_NOTE}`;
const MODELS = [BLIND19_RULE_MODEL, "gemma4:e4b", "qwen3.5:4b"];

function run(model: string, arm: Arm, over: Partial<Blind19Run> = {}): Blind19Run {
  return {
    suite: "define", split: "blind-19", commit: "abc1234", model,
    dictionary: arm === "B" ? "off" : "on", senseRank: arm === "S" ? "off" : "on", repeats: 3, partial: false, void: false, only: null,
    rows: ITEMS.flatMap((it) => [0, 1, 2].map((repeat) => ({
      id: it.id, repeat, error: null, askedWord: it.word,
      dictionaryNote: arm === "B" ? null : note(arm === "R" && CHANGED.has(it.id) ? `ranked ${it.id}` : `stored ${it.id}`),
      attempts: 1, stopReason: "stop", toolCalls: [], toolCallRecovery: null, chatRequests: 1, structuredRequests: 0,
      reply: `${model} ${arm} reply about ${it.word} #${repeat}`, grade: null,
    }))),
    ...over,
  };
}

type Answerer = (grader: 1 | 2, k: Blind19KeyRow) => "yes" | "no";
/** The default world: S fails the first 10 changed L items, R passes everything, both graders agree,
 *  and both catch every canary. */
const WORLD: Answerer = (_g, k) => (k.canary ? "no" : k.arm === "S" && L.slice(0, 10).includes(k.item) ? "no" : "yes");

function input(answer: Answerer = WORLD, tweak: (x: Blind19Input) => void = () => {}): Blind19Input {
  const runs = MODELS.map((model) => ({ model, S: run(model, "S"), R: run(model, "R"), ...(model === BLIND19_RULE_MODEL ? { B: run(model, "B") } : {}) }));
  const sheets: GradedSheet[] = MODELS.map((model, n) => {
    const m = runs[n];
    const { key } = buildBlind19Sheet(`s${n}`, [{ run: m.S, arm: "S" }, { run: m.R, arm: "R" }], ITEMS, { canary: model === BLIND19_RULE_MODEL });
    const exp = (g: 1 | 2): LabelExport => ({
      sheet: key.sheet, grader: g === 1 ? "openrouter:anthropic/claude-fable-5.2" : "openrouter:openai/gpt-6.1-sol", exportedAt: "",
      answers: Object.fromEntries(Object.entries(key.rows).map(([rid, k]) => [rid, { meaning: answer(g, k), other: "no" as const }])),
    });
    return { key, g1: exp(1), g2: exp(2) };
  });
  const x: Blind19Input = { items: ITEMS, changed: changedList(), runs, sheets, safetyRead: true };
  tweak(x);
  return x;
}

describe("the arms", () => {
  it("reads S, R and B from the switches", () => {
    expect(armOf({ dictionary: "on", senseRank: "off" })).toBe("S");
    expect(armOf({ dictionary: "on", senseRank: "on" })).toBe("R");
    expect(armOf({ dictionary: "off", senseRank: "on" })).toBe("B");
    expect(armOf({ dictionary: "on" })).toBeNull();
  });
});

describe("the sheet", () => {
  const S = run(BLIND19_RULE_MODEL, "S");
  S.rows[0] = { ...S.rows[0], error: "boom", reply: "ERROR: boom" };
  const R = run(BLIND19_RULE_MODEL, "R");
  const { rows, key } = buildBlind19Sheet("t", [{ run: S, arm: "S" }, { run: R, arm: "R" }], ITEMS, { canary: true });

  it("holds every non-ERROR row once plus 20 canary rows, and shows only the message and the reply", () => {
    expect(rows).toHaveLength(2 * 360 - 1 + CANARY_ROWS);
    expect(Object.keys(key.rows)).toHaveLength(rows.length);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["ask", "kind", "reply", "rid", "word"]);
    expect(rows.every((r) => r.kind === "sense")).toBe(true);
    expect(rows.some((r) => r.reply.startsWith("ERROR"))).toBe(false);
  });

  it("each canary row is an S row of an L item shown with another L item's reply, every item different", () => {
    const canary = Object.entries(key.rows).filter(([, k]) => k.canary);
    expect(canary).toHaveLength(CANARY_ROWS);
    const items = canary.map(([, k]) => k.item);
    expect(new Set(items).size).toBe(CANARY_ROWS);
    for (const [rid, k] of canary) {
      expect(k.arm).toBe("S");
      expect(k.kind).toBe("L");
      expect(k.canary).not.toBe(k.item);
      expect(L).toContain(k.canary);
      const row = rows.find((r) => r.rid === rid)!;
      expect(row.ask).toBe(ITEMS.find((i) => i.id === k.item)!.ask);
      expect(row.reply).toMatch(new RegExp(`reply about ${ITEMS.find((i) => i.id === k.canary)!.word} `));
    }
    expect(new Set(canary.map(([, k]) => k.canary))).toEqual(new Set(items));
  });

  it("is the same for the same inputs, and is shuffled (arms interleaved)", () => {
    const again = buildBlind19Sheet("t", [{ run: S, arm: "S" }, { run: R, arm: "R" }], ITEMS, { canary: true });
    expect(again.rows).toEqual(rows);
    const arms = Object.values(key.rows).slice(0, 40).map((k) => k.arm);
    expect(new Set(arms).size).toBe(2);
  });

  it("can hold only some items (R8 step 2), and refuses a canary without one rule-model S run", () => {
    const only = buildBlind19Sheet("o", [{ run: run("gemma4:e4b", "S"), arm: "S" }], ITEMS, { canary: false, onlyItems: CHANGED });
    expect(only.rows).toHaveLength(CHANGED.size * 3);
    expect(() => buildBlind19Sheet("x", [{ run: R, arm: "R" }], ITEMS, { canary: true })).toThrow(/canary needs exactly one/);
  });
});

describe("readings and item verdicts", () => {
  it("both-agree passes a row only when both graders say yes; a disagreement fails", () => {
    expect(rowVerdict({ g1: true, g2: true }, "both")).toBe(true);
    expect(rowVerdict({ g1: true, g2: false }, "both")).toBe(false);
    expect(rowVerdict({ g1: false, g2: true }, "both")).toBe(false);
    expect(rowVerdict({ g1: true, g2: false }, "grader1")).toBe(true);
    expect(rowVerdict({ g1: true, g2: false }, "grader2")).toBe(false);
  });

  it("an item passes on a majority of 3; a missing (ERROR) repeat fails", () => {
    const row = (repeat: number, g1: boolean) => ({ model: "m", arm: "S" as const, item: "a", repeat, kind: "L" as const, band: "K-2" as const, g1, g2: g1 });
    expect(itemVerdicts([row(0, true), row(1, true), row(2, false)], "m", "S", "grader1", ["a"]).get("a")).toBe(true);
    expect(itemVerdicts([row(0, true), row(1, false)], "m", "S", "grader1", ["a"]).get("a")).toBe(false);
    expect(itemVerdicts([row(0, true), row(1, true)], "m", "S", "grader1", ["a"]).get("a")).toBe(true);
    expect(itemVerdicts([], "m", "S", "grader1", ["a"]).get("a")).toBe(false);
  });
});

describe("refusals", () => {
  it("accepts complete, consistent inputs", () => {
    expect(blind19Refusals(input())).toEqual([]);
  });

  it.each<[string, (x: Blind19Input) => void, RegExp]>([
    ["different commits", (x) => { x.runs[0].R.commit = "def5678"; }, /different commits/],
    ["no commit", (x) => { x.runs[1].S.commit = null; }, /no commit/],
    ["the wrong arm", (x) => { x.runs[0].S.senseRank = "on"; }, /is arm R/],
    ["a partial run", (x) => { x.runs[0].R.partial = true; }, /partial or void/],
    ["two repeats", (x) => { x.runs[0].S.repeats = 2; }, /2 repeats/],
    ["a missing row", (x) => { x.runs[2].R.rows.pop(); }, /do not cover every item/],
    ["not blind-19", (x) => { x.runs[0].S.split = "test"; }, /not a blind-19 results file/],
    ["a changed list that disagrees with the notes", (x) => { x.changed.items[L[50]].changed = true; }, /disagrees with the notes/],
    ["a changed list missing an item", (x) => { delete x.changed.items[C[39]]; }, /no entry for 1 item/],
    ["an unanswered row", (x) => { delete x.sheets[0].g2.answers["5"]; }, /1 row\(s\) unanswered/],
    ["grader 1 not Claude", (x) => { x.sheets[0].g1.grader = "openrouter:openai/gpt-6.1-sol"; }, /grader 1 .* is not the Claude grader/],
    ["an export for another sheet", (x) => { x.sheets[1].g1.sheet = "zz"; }, /not for sheet s1/],
    ["rows left off the sheets", (x) => { (x.sheets as GradedSheet[]).splice(1, 1); }, /gemma4:e4b S: 150 row\(s\) not on any graded sheet/],
    ["no canary", (x) => { for (const k of Object.values(x.sheets[0].key.rows)) k.canary = null; }, /0 canary rows graded/],
    ["a short set", (x) => { x.items = x.items.filter((i) => !(i.kind === "L" && i.band === "K-2") && i.id !== L[20]); }, /59 L and 40 C items: under 60 L/],
  ])("refuses %s", (_name, tweak, why) => {
    expect(blind19Refusals(input(WORLD, tweak)).join("; ")).toMatch(why);
  });

  it("other models need only their changed items graded (R8 step 2)", () => {
    const x = input();
    const e4b = x.runs[1];
    const { key } = buildBlind19Sheet("s1", [{ run: e4b.S, arm: "S" }, { run: e4b.R, arm: "R" }], ITEMS, { canary: false, onlyItems: CHANGED });
    (x.sheets as GradedSheet[])[1] = { key, g1: { ...x.sheets[1].g1, answers: Object.fromEntries(Object.keys(key.rows).map((r) => [r, { meaning: "yes" }])) }, g2: { ...x.sheets[1].g2, answers: Object.fromEntries(Object.keys(key.rows).map((r) => [r, { meaning: "yes" }])) } };
    expect(blind19Refusals(x)).toEqual([]);
  });
});

describe("the gate", () => {
  it("passes with kappa 1, 30 'no' answers each and every canary caught", () => {
    const g = blind19Gate(gradedRows(input().sheets));
    expect(g).toMatchObject({ kappaOk: true, nosOk: true, canaryOk: true, undecided: false, passes: true, no: { g1: 30, g2: 30 }, canary: { g1: 20, g2: 20, n: 20 } });
  });

  it("misses when a grader passes 3 canary rows (17 of 20 'no')", () => {
    let n = 0;
    const g = blind19Gate(gradedRows(input((gr, k) => (k.canary && gr === 2 && n++ < 3 ? "yes" : WORLD(gr, k))).sheets));
    expect(g.canary).toMatchObject({ g1: 20, g2: 17 });
    expect(g).toMatchObject({ canaryOk: false, passes: false });
  });

  it("is undecided below kappa 0.6", () => {
    // Grader 2 answers "no" on R rows of the first 20 L items as well: they disagree on 60 rows.
    const g = blind19Gate(gradedRows(input((gr, k) => (gr === 2 && k.arm === "R" && L.slice(0, 20).includes(k.item) ? "no" : WORLD(gr, k))).sheets));
    expect(g.kappa.kappa!).toBeLessThan(0.6);
    expect(g.undecided).toBe(true);
  });
});

describe("the verdict", () => {
  it("the default world: nothing fires, R gains 10 of the changed L items, an accuracy lever", () => {
    const v = judgeBlind19(input());
    expect(v.clauses.filter((c) => c.fires)).toEqual([]);
    expect(v.killed).toBe(false);
    expect(v.contrasts.grader1.L.changed).toMatchObject({ n: 40, s: 30, r: 40, lost: [] });
    expect(v.contrasts.grader1.L.changed.gained).toHaveLength(10);
    expect(v.accuracy).toBe("lever");
    expect(v.descriptive).toEqual({ L: { sFirstAbsentUnderR: 40, topScore1: 40 }, C: { sFirstAbsentUnderR: 0, topScore1: 30 } });
  });

  it("harm on the changed L items kills on grader 2 alone (any of three readings)", () => {
    // Grader 2 fails R on 3 changed L items that S passes; grader 1 does not.
    const bad = L.slice(20, 23);
    const v = judgeBlind19(input((gr, k) => (gr === 2 && k.arm === "R" && bad.includes(k.item) ? "no" : WORLD(gr, k))));
    expect(v.clauses.find((c) => c.clause.startsWith("harm, L (grader1)"))!.fires).toBe(false);
    expect(v.clauses.find((c) => c.clause.startsWith("harm, L (grader2)"))!.fires).toBe(false); // +10 -3 = net gain
    // With S passing those 10 items, the 3 losses are net.
    const flat = (gr: 1 | 2, k: Blind19KeyRow) => (k.canary ? "no" : gr === 2 && k.arm === "R" && bad.includes(k.item) ? "no" : k.arm === "S" && C.slice(20, 40).includes(k.item) ? "no" : "yes");
    const v2 = judgeBlind19(input(flat));
    expect(v2.clauses.find((c) => c.clause.startsWith("harm, L (grader1)"))!.fires).toBe(false);
    expect(v2.clauses.find((c) => c.clause.startsWith("harm, L (grader2)"))!.fires).toBe(true);
    expect(v2.clauses.find((c) => c.clause.startsWith("harm, L (both)"))!.fires).toBe(true);
    expect(v2.killed).toBe(true);
  });

  it("harm on the changed C items fires at 2 net, not at 1", () => {
    const loseC = (n: number) => (gr: 1 | 2, k: Blind19KeyRow) => (k.arm === "R" && C.slice(0, n).includes(k.item) ? "no" : WORLD(gr, k));
    expect(judgeBlind19(input(loseC(1))).clauses.filter((c) => c.clause.startsWith("harm, C")).some((c) => c.fires)).toBe(false);
    const v = judgeBlind19(input(loseC(2)));
    expect(v.clauses.filter((c) => c.clause.startsWith("harm, C")).every((c) => c.fires)).toBe(true);
  });

  it("losses on unchanged items are descriptive: they fire nothing", () => {
    const v = judgeBlind19(input((gr, k) => (k.arm === "R" && L.slice(60, 70).includes(k.item) ? "no" : WORLD(gr, k))));
    expect(v.contrasts.grader1.L.unchanged.lost).toHaveLength(10);
    expect(v.clauses.filter((c) => c.clause.startsWith("harm")).some((c) => c.fires)).toBe(false);
  });

  it("another model losing 4 changed items kills; losing them on unchanged items does not", () => {
    const lose = (ids: string[]) => (gr: 1 | 2, k: Blind19KeyRow) => (k.model === "qwen3.5:4b" && k.arm === "R" && ids.includes(k.item) ? "no" : WORLD(gr, k));
    // qwen's S fails L 0-9 too (WORLD), so R must lose 14 of the changed to be 4 net down.
    const v = judgeBlind19(input(lose([...L.slice(10, 24)])));
    expect(v.clauses.find((c) => c.clause.startsWith("other models, qwen3.5:4b (grader1)"))!.fires).toBe(true);
    const u = judgeBlind19(input(lose(L.slice(60, 80))));
    expect(u.clauses.filter((c) => c.clause.startsWith("other models")).some((c) => c.fires)).toBe(false);
  });

  it("a missing safety read, an added call, a broken cap, a row with no note and extra ERROR rows each kill", () => {
    expect(judgeBlind19(input(WORLD, (x) => { x.safetyRead = false; })).killed).toBe(true);
    const added = judgeBlind19(input(WORLD, (x) => { x.runs[0].R.rows[4].structuredRequests = 1; }));
    expect(added.clauses.find((c) => c.clause.startsWith("cost"))!.fires).toBe(true);
    const capped = judgeBlind19(input(WORLD, (x) => {
      x.runs[0].R.rows[4].dictionaryNote = note("a").replace("1. w (noun): a", ["1. w (noun): a", "2. w (noun): b", "3. w (noun): c", "4. w (noun): d"].join("\n"));
    }));
    expect(capped.clauses.find((c) => c.clause.startsWith("cost"))!.detail).toMatch(/more than 3 noun senses/);
    const noNote = judgeBlind19(input(WORLD, (x) => { x.runs[0].S.rows[7].dictionaryNote = null; }));
    expect(noNote.clauses.find((c) => c.clause.startsWith("fire"))!.fires).toBe(true);
    const errors = judgeBlind19(input(WORLD, (x) => { for (const i of [3, 6]) x.runs[1].R.rows[i] = { ...x.runs[1].R.rows[i], error: "x", reply: "ERROR: x" }; }));
    expect(errors.clauses.find((c) => c.clause === "errors, gemma4:e4b: R ERROR rows > S + 1")!.fires).toBe(true);
  });

  it("kappa below 0.6 kills (harm undecided); a canary miss leaves it descriptive", () => {
    const und = judgeBlind19(input((gr, k) => (gr === 2 && k.arm === "R" && L.slice(0, 20).includes(k.item) ? "no" : WORLD(gr, k))));
    expect(und.clauses.find((c) => c.clause.startsWith("undecided"))!.fires).toBe(true);
    expect(und.killed).toBe(true);
    let n = 0;
    const can = judgeBlind19(input((gr, k) => (k.canary && gr === 1 && n++ < 3 ? "yes" : WORLD(gr, k))));
    expect(can.killed).toBe(false);
    expect(can.accuracy).toBe("descriptive");
  });

  it("ceiling when S fails 5 or fewer of the changed L items, or a grader says 'no' fewer than 20 times", () => {
    const five = (_gr: 1 | 2, k: Blind19KeyRow) => (k.canary ? "no" : k.arm === "S" && L.slice(0, 5).includes(k.item) ? "no" : k.arm === "S" && C.slice(20, 40).includes(k.item) ? "no" : "yes");
    expect(judgeBlind19(input(five)).accuracy).toBe("ceiling");
    const few = (_gr: 1 | 2, k: Blind19KeyRow) => (k.canary ? "no" : k.arm === "S" && L.slice(0, 6).includes(k.item) ? "no" : "yes");
    const v = judgeBlind19(input(few));
    expect(v.gate.no).toEqual({ g1: 18, g2: 18 });
    expect(v.accuracy).toBe("ceiling");
  });

  it("no accuracy claim when the gain does not hold on both-agree, or without the ERROR items", () => {
    // Grader 2 fails R on the 10 gained items: grader 1 sees +10, both-agree sees none.
    const v = judgeBlind19(input((gr, k) => (gr === 2 && k.arm === "R" && L.slice(0, 10).includes(k.item) ? "no" : WORLD(gr, k))));
    expect(v.contrasts.grader1.L.changed.gained).toHaveLength(10);
    expect(v.contrasts.both.L.changed.gained).toHaveLength(0);
    expect(v.accuracy).not.toBe("lever");
    // ERROR rows on 5 of the gained items in S: without them +5 at 5/0 is not p < 0.05.
    const e = judgeBlind19(input(WORLD, (x) => {
      for (const id of L.slice(0, 5)) {
        const i = x.runs[0].S.rows.findIndex((r) => r.id === id);
        x.runs[0].S.rows[i] = { ...x.runs[0].S.rows[i], error: "x", reply: "ERROR: x" };
      }
    }));
    expect(e.accuracy).toBe("ordering-fix");
  });
});

describe("caps and cost", () => {
  it("reads the caps back from a shown note", () => {
    expect(capsBroken(note("x"))).toBeNull();
    const many = Array.from({ length: 9 }, (_, i) => `${i + 1}. w (${["noun", "verb", "adjective"][i % 3]}): d`);
    const nine = `<dictionary_entry source="Open English WordNet">\n${many.slice(0, 3).join("\n")}\n"w" is a form of "a".\n${many.slice(3, 6).join("\n")}\n"w" is a form of "b".\n${many.slice(6).join("\n")}\n</dictionary_entry>\n${DICTIONARY_NOTE}`;
    expect(capsBroken(nine)).toBe("9 senses");
    const seven = `<dictionary_entry source="Open English WordNet">\n${Array.from({ length: 7 }, (_, i) => `${i + 1}. w (${["noun", "verb", "adjective", "adverb"][i % 4]}): d`).join("\n")}\n</dictionary_entry>\n${DICTIONARY_NOTE}`;
    expect(capsBroken(seven)).toMatch(/more than 6 senses on one headword/);
    const long = `<dictionary_entry source="Open English WordNet">\n1. w (noun): ${"d".repeat(1500)}\n2. w (verb): d\n</dictionary_entry>\n${DICTIONARY_NOTE}`;
    expect(capsBroken(long)).toMatch(/estTokens/);
  });

  it("prices every request of a sheet", () => {
    const c = graderCost([{ a: "x".repeat(396) }, { a: "y".repeat(396) }], { inPerM: 1, outPerM: 4 }, 30);
    expect(c.requests).toBe(2);
    expect(c.inTokens).toBe(2 * Math.ceil(JSON.stringify({ a: "x".repeat(396) }).length / 4));
    expect(c.usd).toBeCloseTo((c.inTokens * 1 + 2 * 30 * 4) / 1e6, 12);
  });
});
