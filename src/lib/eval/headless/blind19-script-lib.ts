// Helpers for blind-19's offline scripts (blind19-sheet.ts, blind19-cost.ts, blind19-compare.ts), in a
// module with no entry point so tests can import them (define-script-lib.ts explains why). Pure except
// the loaders at the bottom.

import { armOf, type Arm, type Blind19Run, type ChangedList } from "../blind19-grade";
import type { Blind19Item } from "../blind19";
import { grader2Request, type SheetData } from "./define-script-lib";
import { graderCost } from "../blind19-grade";
import { fs } from "./node-io";

/** Runs grouped per model by arm. Refuses a file that is not an arm, or two files for one model's arm. */
export function groupRuns(runs: readonly Blind19Run[]): Array<{ model: string; S: Blind19Run; R: Blind19Run; B?: Blind19Run }> {
  const by = new Map<string, Partial<Record<Arm, Blind19Run>>>();
  for (const run of runs) {
    const arm = armOf(run);
    if (!arm) throw new Error(`${run.model}: a file that is neither S, R nor B (dictionary ${run.dictionary}, senseRank ${run.senseRank ?? "unset"}).`);
    const m = by.get(run.model) ?? {};
    if (m[arm]) throw new Error(`${run.model}: two ${arm} files.`);
    m[arm] = run;
    by.set(run.model, m);
  }
  return [...by].map(([model, m]) => {
    if (!m.S || !m.R) throw new Error(`${model}: needs both an S and an R file.`);
    return { model, S: m.S, R: m.R, ...(m.B ? { B: m.B } : {}) };
  });
}

/** "model=in/out,model=in/out": USD per million input and output tokens, per grader model. */
export function parsePrices(s: string): Map<string, { inPerM: number; outPerM: number }> {
  const out = new Map<string, { inPerM: number; outPerM: number }>();
  for (const part of s.split(",").map((x) => x.trim()).filter(Boolean)) {
    const m = /^(.+)=([\d.]+)\/([\d.]+)$/.exec(part);
    if (!m) throw new Error(`BLIND19_PRICE: "${part}" is not model=in/out`);
    out.set(m[1], { inPerM: Number(m[2]), outPerM: Number(m[3]) });
  }
  return out;
}

/** R8's dry run: every grader request of every sheet, built as define-label-grader2.ts sends it, and
 *  priced; `over` is true past 80% of the credit. */
export function dryRun(sheets: readonly SheetData[], prices: ReadonlyMap<string, { inPerM: number; outPerM: number }>, credit: number) {
  const perModel = [...prices].map(([model, price]) => ({ model, ...graderCost(sheets.flatMap((s) => s.rows.map((r) => grader2Request(model, r))), price) }));
  const usd = perModel.reduce((k, m) => k + m.usd, 0);
  return { perModel, usd, credit, over: usd > 0.8 * credit };
}

// ── Loaders ──────────────────────────────────────────────────────────────────

export const BLIND19_ITEMS_FILE = "src/lib/eval/blind-19/items.json";
export const BLIND19_CHANGED_FILE = "src/lib/eval/blind-19/changed.json";

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await (await fs()).readFile(file, "utf8")) as T;
}

/** The kept items of the committed items file. */
export async function loadItems(file = BLIND19_ITEMS_FILE): Promise<Blind19Item[]> {
  const data = await readJson<{ items: Blind19Item[] }>(file);
  if (!Array.isArray(data.items) || !data.items.length) throw new Error(`${file}: no items.`);
  return data.items;
}

export async function loadChanged(file = BLIND19_CHANGED_FILE): Promise<ChangedList> {
  return readJson<ChangedList>(file);
}
