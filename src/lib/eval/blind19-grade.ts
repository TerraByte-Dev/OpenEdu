// blind-19's gate, verdicts and comparison (docs/BENCHMARKS.md B8 "Lever 19" and row 19's kill rule).
// Pure: no I/O, no model. The scripts are headless/blind19-sheet.ts (the graders' sheet and its hidden
// key), define-label-grader2.ts (both graders, unchanged) and headless/blind19-compare.ts (this file's
// verdict, printed). Committed with its tests before blind-19 exists, and not changed after (R2).
//
// Arms, all at one commit: S (EVAL_SENSE_RANK=off, lever 18 as shipped), R (the ranker on), B
// (EVAL_DICTIONARY=off, e2b only, descriptive). Every non-ERROR row goes to both graders, blind; a row's
// verdict is a grader's "meaning" answer. Three readings: grader 1, grader 2, and both-agree (a row
// passes only if both answer yes; a disagreement fails). Item verdict = majority of the run's repeats;
// a missing (ERROR) repeat fails.
//
// The gate (on the rule model's S and R rows): Cohen's kappa between the graders >= 0.8, at least 20
// "no" answers from each, and the canary: 20 S rows of L items shown with another L item's reply (a
// seeded derangement), on which each grader answers "no" at least 18 times. kappa below 0.6: harm is
// undecided, so the lever is not shipped.
//
// The kill rule reads the harm clauses, the other-models clause and the success test on the changed
// subset only (items whose shown entry differs between S and R, from the committed changed list), each
// harm and other-models clause three ways; any reading firing kills.

import { cohenKappa, shuffled, type Kappa, type LabelExport } from "./define-label";
import { addedCalls, type DefineRunRow } from "./define-grade";
import { mcnemarExact } from "./k12-fixture";
import { estTokens } from "../kernel/budget";
import { DICTIONARY_MAX_ENTRY_TOKENS, DICTIONARY_MAX_SENSES, DICTIONARY_SENSES_PER_HEADWORD, DICTIONARY_SENSES_PER_POS } from "../kernel/defineWord";
import { BLIND19_MIN_RUN, type Blind19Item, type Blind19Kind } from "./blind19";
import type { GradeBand } from "../grade";

export type Arm = "S" | "R" | "B";
export type Reading = "grader1" | "grader2" | "both";
export const READINGS: readonly Reading[] = ["grader1", "grader2", "both"];

export const BLIND19_RULE_MODEL = "gemma4:e2b";
export const BLIND19_REPEATS = 3;
export const BLIND19_SHEET_SEED = 20261112;
export const CANARY_ROWS = 20;
export const CANARY_MIN_NO = 18;
export const GATE_KAPPA = 0.8;
export const UNDECIDED_KAPPA = 0.6;
export const GATE_MIN_NO = 20;
/** Net losses on the changed subset that kill (row 19): L 3, C 2 (R4), other models 4. */
export const HARM_L = 3;
export const HARM_C = 2;
export const HARM_OTHER = 4;
/** S failing this many changed L items or fewer: no +5 gain can reach p < 0.05 (6/0): ceiling (R7). */
export const CEILING_S_FAILS = 5;

// ── Inputs ───────────────────────────────────────────────────────────────────

export type Blind19RunRow = DefineRunRow & { noteTokens?: number };

/** A blind-19 results file, as headless/run.ts writes it with EVAL_SET=blind-19. */
export interface Blind19Run {
  suite: string;
  split: string;
  commit: string | null;
  model: string;
  dictionary: "on" | "off";
  senseRank?: "on" | "off";
  repeats: number;
  partial: boolean;
  void?: boolean;
  only?: string | null;
  rows: Blind19RunRow[];
}

export function armOf(run: Pick<Blind19Run, "dictionary" | "senseRank">): Arm | null {
  if (run.dictionary === "off") return run.senseRank === "on" || run.senseRank === undefined ? "B" : null;
  if (run.senseRank === "off") return "S";
  if (run.senseRank === "on") return "R";
  return null;
}

/** The changed list, computed by code from the items and committed before any reply exists. */
export interface ChangedList {
  items: Record<string, {
    /** The shown entry differs between S and R. */
    changed: boolean;
    /** S's first shown sense is not shown under R (descriptive, R5). */
    sFirstAbsentUnderR: boolean;
    /** The ranked top sense's score (0 when there is no sentence) (descriptive, R5). */
    topScore: number;
  }>;
}

// ── The sheet ────────────────────────────────────────────────────────────────

export interface Blind19SheetRow { rid: string; word: string; kind: "sense"; ask: string; reply: string }

export interface Blind19KeyRow {
  model: string;
  arm: Arm;
  item: string;
  repeat: number;
  kind: Blind19Kind;
  band: GradeBand;
  /** A canary row: the item's message with this other L item's reply. Never a verdict. */
  canary: string | null;
}

export interface Blind19Key { sheet: string; repeats: number; rows: Record<string, Blind19KeyRow> }

/**
 * The graders' sheet and its hidden key: every non-ERROR row of the given runs (optionally only some
 * items), each shown as the student's message and the reply only, and with `canary` the 20 canary rows
 * from the rule model's S run. Both kinds are asked as sense items. Shuffled with a fixed seed.
 */
export function buildBlind19Sheet(
  sheet: string,
  runs: ReadonlyArray<{ run: Blind19Run; arm: Arm }>,
  items: readonly Blind19Item[],
  opts: { canary: boolean; onlyItems?: ReadonlySet<string>; seed?: number },
): { rows: Blind19SheetRow[]; key: Blind19Key } {
  const seed = opts.seed ?? BLIND19_SHEET_SEED;
  const byId = new Map(items.map((i) => [i.id, i]));
  type Pending = { k: Omit<Blind19KeyRow, "canary"> & { canary: string | null }; ask: string; reply: string; uid: string };
  const pending: Pending[] = [];
  const asks = new Map<string, string>();
  for (const { run, arm } of runs) {
    for (const r of run.rows) {
      const item = byId.get(r.id);
      if (!item) throw new Error(`${run.model} ${arm}: row ${r.id} is not a blind-19 item`);
      asks.set(r.id, item.ask);
      if (r.error || (opts.onlyItems && !opts.onlyItems.has(r.id))) continue;
      pending.push({ k: { model: run.model, arm, item: r.id, repeat: r.repeat, kind: item.kind, band: item.band, canary: null }, ask: item.ask, reply: r.reply, uid: `${run.model}|${arm}|${r.id}|${r.repeat}` });
    }
  }
  if (opts.canary) {
    const s = runs.filter((x) => x.arm === "S" && x.run.model === BLIND19_RULE_MODEL);
    if (s.length !== 1) throw new Error(`The canary needs exactly one ${BLIND19_RULE_MODEL} S run on the sheet.`);
    const pool = shuffled(s[0].run.rows.filter((r) => !r.error && byId.get(r.id)?.kind === "L").sort((a, b) => (a.id + a.repeat < b.id + b.repeat ? -1 : 1)), seed);
    const picked: Blind19RunRow[] = [];
    for (const r of pool) if (picked.length < CANARY_ROWS && !picked.some((p) => p.id === r.id)) picked.push(r);
    if (picked.length < CANARY_ROWS) throw new Error(`The canary needs ${CANARY_ROWS} S rows of distinct L items; the run has ${picked.length}.`);
    // A cyclic shift over distinct items is a derangement: every row gets another item's reply.
    picked.forEach((r, i) => {
      const from = picked[(i + 1) % picked.length];
      const item = byId.get(r.id)!;
      pending.push({ k: { model: BLIND19_RULE_MODEL, arm: "S", item: r.id, repeat: r.repeat, kind: item.kind, band: item.band, canary: from.id }, ask: item.ask, reply: from.reply, uid: `canary|${r.id}|${from.id}` });
    });
  }
  const order = shuffled([...pending].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)), seed + 1);
  const rows: Blind19SheetRow[] = [];
  const key: Blind19Key = { sheet, repeats: Math.max(...runs.map((x) => x.run.repeats)), rows: {} };
  order.forEach((p, i) => {
    const rid = String(i + 1);
    rows.push({ rid, word: byId.get(p.k.item)!.word, kind: "sense", ask: p.ask, reply: p.reply });
    key.rows[rid] = p.k;
  });
  return { rows, key };
}

// ── Graded rows ──────────────────────────────────────────────────────────────

export interface GradedSheet { key: Blind19Key; g1: LabelExport; g2: LabelExport }

const yes = (e: LabelExport, rid: string): boolean | null => {
  const a = e.answers[rid]?.meaning;
  return a === "yes" ? true : a === "no" ? false : null;
};

export interface GradedRow { model: string; arm: Arm; item: string; repeat: number; kind: Blind19Kind; band: GradeBand; g1: boolean | null; g2: boolean | null }

/** Every graded row of every sheet, split into verdict rows and canary rows. */
export function gradedRows(sheets: readonly GradedSheet[]): { rows: GradedRow[]; canary: GradedRow[] } {
  const rows: GradedRow[] = [];
  const canary: GradedRow[] = [];
  for (const { key, g1, g2 } of sheets) {
    for (const [rid, k] of Object.entries(key.rows)) {
      const r = { model: k.model, arm: k.arm, item: k.item, repeat: k.repeat, kind: k.kind, band: k.band, g1: yes(g1, rid), g2: yes(g2, rid) };
      (k.canary ? canary : rows).push(r);
    }
  }
  return { rows, canary };
}

export function rowVerdict(r: Pick<GradedRow, "g1" | "g2">, reading: Reading): boolean {
  if (reading === "grader1") return r.g1 === true;
  if (reading === "grader2") return r.g2 === true;
  return r.g1 === true && r.g2 === true;
}

/** Item -> pass, the majority of `repeats` rows; a row that is missing (ERROR, or not graded) fails. */
export function itemVerdicts(rows: readonly GradedRow[], model: string, arm: Arm, reading: Reading, itemIds: readonly string[], repeats = BLIND19_REPEATS): Map<string, boolean> {
  const passes = new Map<string, number>(itemIds.map((id) => [id, 0]));
  for (const r of rows) {
    if (r.model !== model || r.arm !== arm || !passes.has(r.item)) continue;
    if (rowVerdict(r, reading)) passes.set(r.item, passes.get(r.item)! + 1);
  }
  return new Map([...passes].map(([id, k]) => [id, k * 2 > repeats]));
}

// ── The gate ─────────────────────────────────────────────────────────────────

export interface Blind19Gate {
  kappa: Kappa;
  no: { g1: number; g2: number };
  canary: { g1: number; g2: number; n: number };
  kappaOk: boolean;
  nosOk: boolean;
  canaryOk: boolean;
  /** kappa below 0.6 (or not estimable): harm undecided, not shipped. */
  undecided: boolean;
  passes: boolean;
}

export function blind19Gate(graded: { rows: readonly GradedRow[]; canary: readonly GradedRow[] }, model = BLIND19_RULE_MODEL): Blind19Gate {
  const sr = graded.rows.filter((r) => r.model === model && (r.arm === "S" || r.arm === "R") && r.g1 !== null && r.g2 !== null);
  const kappa = cohenKappa(sr.map((r) => [r.g1!, r.g2!] as const));
  const no = { g1: sr.filter((r) => r.g1 === false).length, g2: sr.filter((r) => r.g2 === false).length };
  const c = graded.canary.filter((r) => r.model === model);
  const canary = { g1: c.filter((r) => r.g1 === false).length, g2: c.filter((r) => r.g2 === false).length, n: c.length };
  const kappaOk = kappa.kappa !== null && kappa.kappa >= GATE_KAPPA;
  const nosOk = no.g1 >= GATE_MIN_NO && no.g2 >= GATE_MIN_NO;
  const canaryOk = canary.n === CANARY_ROWS && canary.g1 >= CANARY_MIN_NO && canary.g2 >= CANARY_MIN_NO;
  return { kappa, no, canary, kappaOk, nosOk, canaryOk, undecided: kappa.kappa === null || kappa.kappa < UNDECIDED_KAPPA, passes: kappaOk && nosOk && canaryOk };
}

// ── Contrasts ────────────────────────────────────────────────────────────────

export interface Blind19Contrast { n: number; s: number; r: number; gained: string[]; lost: string[]; p: number }

export function contrast(S: ReadonlyMap<string, boolean>, R: ReadonlyMap<string, boolean>, ids: readonly string[]): Blind19Contrast {
  const lost = ids.filter((id) => S.get(id) && !R.get(id));
  const gained = ids.filter((id) => !S.get(id) && R.get(id));
  return { n: ids.length, s: ids.filter((id) => S.get(id)).length, r: ids.filter((id) => R.get(id)).length, gained, lost, p: mcnemarExact(lost.length, gained.length) };
}

/** The success bar: at least 5 more gained than lost and an exact two-sided McNemar p below 0.05. */
export const gainOk = (c: Blind19Contrast): boolean => c.gained.length - c.lost.length >= 5 && c.p < 0.05;

// ── The caps, read back from a shown note ────────────────────────────────────

/** Why a shown note breaks lever 18's caps, or null. Parses the entry block the kernel renders. */
export function capsBroken(note: string): string | null {
  const entry = note.slice(0, note.indexOf("<tutor_note>"));
  const lines = entry.split("\n");
  let total = 0;
  let head = { n: 0, pos: new Map<string, number>() };
  for (const line of lines) {
    if (/^".*" is a form of ".*"\.$/.test(line)) { head = { n: 0, pos: new Map() }; continue; }
    const m = /^\d+\. .*? \((noun|verb|adjective|adverb)\): /.exec(line);
    if (!m) continue;
    total++;
    head.n++;
    head.pos.set(m[1], (head.pos.get(m[1]) ?? 0) + 1);
    if (head.pos.get(m[1])! > DICTIONARY_SENSES_PER_POS) return `more than ${DICTIONARY_SENSES_PER_POS} ${m[1]} senses`;
    if (head.n > DICTIONARY_SENSES_PER_HEADWORD) return `more than ${DICTIONARY_SENSES_PER_HEADWORD} senses on one headword`;
  }
  if (total > DICTIONARY_MAX_SENSES) return `${total} senses`;
  if (total > 1 && estTokens(entry.trimEnd()) > DICTIONARY_MAX_ENTRY_TOKENS) return `${estTokens(entry.trimEnd())} estTokens`;
  return null;
}

// ── Refusals ─────────────────────────────────────────────────────────────────

export interface Blind19Input {
  items: readonly Blind19Item[];
  changed: ChangedList;
  /** Per model, its S and R runs; B is the rule model's descriptive arm. */
  runs: ReadonlyArray<{ model: string; S: Blind19Run; R: Blind19Run; B?: Blind19Run }>;
  sheets: readonly GradedSheet[];
  /** BENCHMARKS R1 (b): the newly-reachable read happened before the test tag. */
  safetyRead: boolean;
}

/** Why the inputs cannot be judged, or []. */
export function blind19Refusals(x: Blind19Input): string[] {
  const why: string[] = [];
  const ids = x.items.map((i) => i.id);
  const kinds = { L: x.items.filter((i) => i.kind === "L").length, C: x.items.filter((i) => i.kind === "C").length };
  if (kinds.L < BLIND19_MIN_RUN.L || kinds.C < BLIND19_MIN_RUN.C) why.push(`the set holds ${kinds.L} L and ${kinds.C} C items: under ${BLIND19_MIN_RUN.L} L or ${BLIND19_MIN_RUN.C} C it is not run (R7)`);
  const missingChanged = ids.filter((id) => !x.changed.items[id]);
  if (missingChanged.length) why.push(`the changed list has no entry for ${missingChanged.length} item(s)`);
  if (!x.runs.some((r) => r.model === BLIND19_RULE_MODEL)) why.push(`no ${BLIND19_RULE_MODEL} runs`);
  const commits = new Set<string | null>();
  for (const m of x.runs) {
    for (const [want, run] of [["S", m.S], ["R", m.R], ["B", m.B]] as const) {
      if (!run) continue;
      const name = `${m.model} ${want}`;
      commits.add(run.commit);
      if (run.suite !== "define" || run.split !== "blind-19") why.push(`${name}: not a blind-19 results file`);
      if (run.model !== m.model) why.push(`${name}: the file is for ${run.model}`);
      if (armOf(run) !== want) why.push(`${name}: the file is arm ${armOf(run) ?? "unknown"}`);
      if (run.partial || run.only || run.void) why.push(`${name}: a partial or void run is not a result`);
      if (run.repeats !== BLIND19_REPEATS) why.push(`${name}: ${run.repeats} repeats, not ${BLIND19_REPEATS}`);
      const per = new Map<string, number>();
      for (const r of run.rows) per.set(r.id, (per.get(r.id) ?? 0) + 1);
      const off = ids.filter((id) => per.get(id) !== run.repeats);
      const extra = [...per.keys()].filter((id) => !ids.includes(id));
      if (off.length || extra.length) why.push(`${name}: rows do not cover every item ${run.repeats} times (${[...off, ...extra].slice(0, 5).join(", ")})`);
    }
    // The changed list must agree with the notes the runs sent.
    const notes = (run: Blind19Run, id: string) => new Set(run.rows.filter((r) => r.id === id && !r.error && r.dictionaryNote).map((r) => r.dictionaryNote));
    const wrong = ids.filter((id) => {
      const [s, r] = [notes(m.S, id), notes(m.R, id)];
      if (!s.size || !r.size || !x.changed.items[id]) return false;
      const differ = s.size !== r.size || [...s].some((n) => !r.has(n));
      return differ !== x.changed.items[id].changed;
    });
    if (wrong.length) why.push(`${m.model}: the changed list disagrees with the notes sent for ${wrong.slice(0, 5).join(", ")}`);
  }
  if (commits.has(null)) why.push("a results file has no commit");
  else if (commits.size > 1) why.push(`the runs are from different commits (${[...commits].join(", ")})`);
  for (const { key, g1, g2 } of x.sheets) {
    if (g1.sheet !== key.sheet || g2.sheet !== key.sheet) why.push(`an export is not for sheet ${key.sheet}`);
    if (!/(^|:)anthropic\//.test(g1.grader)) why.push(`sheet ${key.sheet}: grader 1 (${g1.grader}) is not the Claude grader`);
    if (!/(^|:)openai\//.test(g2.grader)) why.push(`sheet ${key.sheet}: grader 2 (${g2.grader}) is not the OpenAI grader`);
    const open = Object.keys(key.rows).filter((rid) => yes(g1, rid) === null || yes(g2, rid) === null);
    if (open.length) why.push(`sheet ${key.sheet}: ${open.length} row(s) unanswered`);
  }
  // Coverage: the rule model's S and R rows all graded; other models' S and R rows of changed items.
  const graded = gradedRows(x.sheets);
  const have = new Set(graded.rows.map((r) => `${r.model}|${r.arm}|${r.item}|${r.repeat}`));
  for (const m of x.runs) {
    for (const arm of ["S", "R"] as const) {
      const need = m[arm].rows.filter((r) => !r.error && (m.model === BLIND19_RULE_MODEL || x.changed.items[r.id]?.changed));
      const miss = need.filter((r) => !have.has(`${m.model}|${arm}|${r.id}|${r.repeat}`));
      if (miss.length) why.push(`${m.model} ${arm}: ${miss.length} row(s) not on any graded sheet`);
    }
  }
  const canary = graded.canary.filter((r) => r.model === BLIND19_RULE_MODEL).length;
  if (canary !== CANARY_ROWS) why.push(`${canary} canary rows graded, not ${CANARY_ROWS}`);
  return why;
}

// ── The verdict ──────────────────────────────────────────────────────────────

export interface Blind19Clause { clause: string; fires: boolean; detail: string }

export type Blind19Accuracy = "lever" | "ordering-fix" | "ceiling" | "descriptive";

export interface Blind19Verdict {
  gate: Blind19Gate;
  clauses: Blind19Clause[];
  killed: boolean;
  accuracy: Blind19Accuracy;
  /** Rule model, per reading and kind: the changed and unchanged contrasts (unchanged is descriptive). */
  contrasts: Record<Reading, Record<"L" | "C", { changed: Blind19Contrast; unchanged: Blind19Contrast }>>;
  /** Descriptive (R5), per kind: changed items where S's first sense is absent under R, and items whose top sense scored 1. */
  descriptive: Record<"L" | "C", { sFirstAbsentUnderR: number; topScore1: number }>;
}

const fmt = (c: Blind19Contrast) => `S ${c.s}/${c.n}, R ${c.r}/${c.n}; lost ${c.lost.join(", ") || "none"}; gained ${c.gained.join(", ") || "none"}`;

/** Row 19's kill rule and claims, read as written. Call only when blind19Refusals is empty. */
export function judgeBlind19(x: Blind19Input): Blind19Verdict {
  const graded = gradedRows(x.sheets);
  const gate = blind19Gate(graded);
  const idsOf = (kind: Blind19Kind | null, changed: boolean | null) =>
    x.items.filter((i) => (kind === null || i.kind === kind) && (changed === null || x.changed.items[i.id].changed === changed)).map((i) => i.id);
  const v = (model: string, arm: Arm, reading: Reading) => itemVerdicts(graded.rows, model, arm, reading, x.items.map((i) => i.id));
  const rule = x.runs.find((m) => m.model === BLIND19_RULE_MODEL)!;
  const clauses: Blind19Clause[] = [];
  const contrasts = {} as Blind19Verdict["contrasts"];
  for (const reading of READINGS) {
    const S = v(rule.model, "S", reading);
    const R = v(rule.model, "R", reading);
    contrasts[reading] = {
      L: { changed: contrast(S, R, idsOf("L", true)), unchanged: contrast(S, R, idsOf("L", false)) },
      C: { changed: contrast(S, R, idsOf("C", true)), unchanged: contrast(S, R, idsOf("C", false)) },
    };
    const l = contrasts[reading].L.changed;
    const c = contrasts[reading].C.changed;
    clauses.push({ clause: `harm, L (${reading}): R <= S - ${HARM_L} on the changed L items`, fires: l.r <= l.s - HARM_L, detail: fmt(l) });
    clauses.push({ clause: `harm, C (${reading}): R <= S - ${HARM_C} on the changed C items`, fires: c.r <= c.s - HARM_C, detail: fmt(c) });
  }
  for (const m of x.runs.filter((r) => r.model !== BLIND19_RULE_MODEL)) {
    for (const reading of READINGS) {
      const k = contrast(v(m.model, "S", reading), v(m.model, "R", reading), idsOf(null, true));
      clauses.push({ clause: `other models, ${m.model} (${reading}): R <= S - ${HARM_OTHER} on the changed items`, fires: k.r <= k.s - HARM_OTHER, detail: fmt(k) });
    }
  }
  clauses.push({ clause: "safety: the newly-reachable read is missing", fires: !x.safetyRead, detail: x.safetyRead ? "read before the tag" : "no record of the read" });
  const sr = [...x.runs.map((m) => ["S", m.S] as const), ...x.runs.map((m) => ["R", m.R] as const)];
  const added = x.runs.reduce((k, m) => k + m.R.rows.reduce((a, r) => a + addedCalls(r).added, 0), 0);
  const caps = sr.flatMap(([arm, run]) => run.rows.filter((r) => r.dictionaryNote && capsBroken(r.dictionaryNote)).map((r) => `${run.model} ${arm} ${r.id}#${r.repeat}: ${capsBroken(r.dictionaryNote!)}`));
  clauses.push({ clause: "cost: an added model call in R, or the caps exceeded on any row", fires: added > 0 || caps.length > 0, detail: `${added} added; ${caps.join("; ") || "caps held"}` });
  const noNote = sr.flatMap(([arm, run]) => run.rows.filter((r) => !r.error && !r.dictionaryNote).map((r) => `${run.model} ${arm} ${r.id}#${r.repeat}`));
  clauses.push({ clause: "fire: a non-ERROR S or R row with no note", fires: noNote.length > 0, detail: noNote.join(", ") || "none" });
  for (const m of x.runs) {
    const [eS, eR] = [m.S.rows.filter((r) => r.error).length, m.R.rows.filter((r) => r.error).length];
    clauses.push({ clause: `errors, ${m.model}: R ERROR rows > S + 1`, fires: eR > eS + 1, detail: `S ${eS}, R ${eR}` });
  }
  clauses.push({ clause: `undecided: kappa between the graders below ${UNDECIDED_KAPPA}`, fires: gate.undecided, detail: `kappa ${gate.kappa.kappa === null ? "n/a" : gate.kappa.kappa.toFixed(3)} (n ${gate.kappa.n})` });
  const nL = idsOf("L", null).length;
  const nC = idsOf("C", null).length;
  clauses.push({ clause: "short set: fewer than 60 L or 30 C items", fires: nL < BLIND19_MIN_RUN.L || nC < BLIND19_MIN_RUN.C, detail: `${nL} L, ${nC} C` });
  const killed = clauses.some((c) => c.fires);

  // The success test, on the rule model's changed L items.
  const errorItems = new Set([...rule.S.rows, ...rule.R.rows].filter((r) => r.error).map((r) => r.id));
  const changedL = idsOf("L", true);
  const changedLNoErr = changedL.filter((id) => !errorItems.has(id));
  const gains = (["grader1", "both"] as const).every((reading) =>
    gainOk(contrast(v(rule.model, "S", reading), v(rule.model, "R", reading), changedL)) &&
    gainOk(contrast(v(rule.model, "S", reading), v(rule.model, "R", reading), changedLNoErr)));
  const sFails = contrasts.grader1.L.changed.n - contrasts.grader1.L.changed.s;
  const accuracy: Blind19Accuracy =
    !gate.nosOk || sFails <= CEILING_S_FAILS ? "ceiling"
    : !gate.kappaOk || !gate.canaryOk || nL < BLIND19_MIN_RUN.L ? "descriptive"
    : gains ? "lever" : "ordering-fix";

  const descriptive = Object.fromEntries((["L", "C"] as const).map((k) => [k, {
    sFirstAbsentUnderR: idsOf(k, true).filter((id) => x.changed.items[id].sFirstAbsentUnderR).length,
    topScore1: idsOf(k, null).filter((id) => x.changed.items[id].topScore === 1).length,
  }])) as Blind19Verdict["descriptive"];
  return { gate, clauses, killed, accuracy, contrasts, descriptive };
}

// ── Cost dry run (R8) ────────────────────────────────────────────────────────

/** Estimated prompt tokens of grader requests (estTokens of each request body) and the cost at a
 *  price per million input and output tokens, with `outTokens` answered per request. */
export function graderCost(bodies: readonly unknown[], price: { inPerM: number; outPerM: number }, outTokens = 30): { requests: number; inTokens: number; usd: number } {
  const inTokens = bodies.reduce<number>((k, b) => k + estTokens(JSON.stringify(b)), 0);
  const usd = (inTokens * price.inPerM + bodies.length * outTokens * price.outPerM) / 1e6;
  return { requests: bodies.length, inTokens, usd };
}

/** The cost line: over 80% of the credit applies the savings in order (R8). */
export const COST_LIMIT_SHARE = 0.8;
