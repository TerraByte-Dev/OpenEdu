// The descriptive split pre-registered with the check-before-praise lever (checkBeforePraise.ts, PR for
// lever 9b): k12-flow-fr items whose scripted T2 try is a correct intermediate step, and the rest.
//
// Some source distractors are "stopped one step early": the try is a value the key's own derivation
// computes on the way to the key ($4.05 is what the notebooks cost, not the $0.95 change). Telling the
// student that value is correct is a false affirmation by G2, but a tutor could fairly call it a
// correct step. G2 is reported on both sides of this split.
//
// Decided by code from the item data alone (the source item's `basis`), written before any lever run;
// the list it gives is pinned in t2-intermediate-split.test.ts. A try is an intermediate step when:
//   - its number equals, by value, a result the basis states before the key's value first appears as a
//     result. A result is a number right after "=" or "->" (at most three words between, as in
//     "-> primary consumers 2,000 kJ"), or the N in "= sqrt(N)", and is not an operand: not followed
//     by an operator or a bracket, or by a word and then an operator ("0.20 mol / 0.500 L");
//   - it is a percent exactly when that result is (10% is not the raw difference 10);
//   - when both carry a unit word that ends the clause, the units are the same (6.0 A is not the
//     series resistance 6.0 ohm).
// If the key's value never appears as a result, every result in the basis counts.

import { K12_ITEMS } from "./k12-items";
import type { K12FrItem } from "./k12-flow-fr-items";

const NUM = String.raw`-?\d[\d,]*(?:\.\d+)?(?:\s+\d+\/\d+|\/\d+)?(?!\.?\d)`;
const RESULT = new RegExp(String.raw`(?:=|->)\s*(?:[A-Za-z]+\s+){0,3}(${NUM})(\s*%)?(?:\s*([A-Za-z]+)(?=\s*(?:[;.,)]|$)))?`, "g");
const ROOT = new RegExp(String.raw`(?:=|->)\s*sqrt\(\s*(${NUM})\s*\)`, "g");
const OPERAND = /^(?:\(|\s*(?:[A-Za-z]+\s*)?(?:[+*/×^]|-(?!>)|x\s*[\d(]))/;
const QUANTITY = new RegExp(String.raw`(${NUM})\s*(%)?\s*([A-Za-z]+)?`);

interface Quantity { at: number; value: number; percent: boolean; unit: string }

const clean = (s: string) => s.replace(/−/g, "-").replace(/→/g, "->").replace(/\$/g, "");

function valueOf(text: string): number {
  const t = text.replace(/,/g, "");
  const mixed = t.match(/^(-?\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = t.match(/^(-?[\d.]+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(t);
}

/** The first number in an option text, with its percent sign and unit word. */
function quantity(text: string): Quantity | null {
  const m = QUANTITY.exec(clean(text));
  return m ? { at: m.index, value: valueOf(m[1]), percent: !!m[2], unit: (m[3] ?? "").toLowerCase() } : null;
}

/** The results a basis states, in order. */
function results(basis: string): Quantity[] {
  const b = clean(basis);
  const out: Quantity[] = [];
  for (const m of b.matchAll(RESULT)) {
    if (OPERAND.test(b.slice(m.index! + m[0].length))) continue;
    out.push({ at: m.index!, value: valueOf(m[1]), percent: !!m[2], unit: (m[3] ?? "").toLowerCase() });
  }
  for (const m of b.matchAll(ROOT)) out.push({ at: m.index!, value: valueOf(m[1]), percent: false, unit: "" });
  return out.sort((x, y) => x.at - y.at);
}

const sameValue = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** True when the item's scripted T2 try is a value the key's derivation reaches before the key. */
export function isIntermediateStepTry(item: Pick<K12FrItem, "source" | "key" | "attempt">): boolean {
  const src = K12_ITEMS.find((x) => x.id === item.source);
  if (!src) throw new Error(`t2-intermediate-split: no k12 item ${item.source}`);
  const tried = quantity(item.attempt);
  const key = quantity(item.key);
  if (!tried || !key) return false;
  const rs = results(src.basis);
  const keyAt = rs.find((r) => sameValue(r.value, key.value) && r.percent === key.percent)?.at ?? Infinity;
  return rs.some(
    (r) => r.at < keyAt && sameValue(r.value, tried.value) && r.percent === tried.percent && (!tried.unit || !r.unit || r.unit === tried.unit),
  );
}
