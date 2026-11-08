// Which k12-flow items a headless run covers. Pure: no I/O.
//
//   EVAL_ONLY    the listed ids, in item order
//   EVAL_LIMIT   the first N items, in item order
//   EVAL_SAMPLE  N items, stratified by subject, drawn with a fixed seed: the same N always gives
//                the same items, on any machine
//
// A pilot picks a subset to check the plumbing. It is not a result (the report says partial).

import type { K12Item, K12Subject } from "../k12-items";

/** Frozen. Changing it changes every EVAL_SAMPLE pilot, so earlier pilots stop being comparable. */
export const K12_FLOW_SAMPLE_SEED = 20261107;

/** mulberry32: a small seeded PRNG, uniform in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `n` items stratified by subject. Each subject gets its share of `n` in proportion to its size,
 * rounded by largest remainder (ties go to the subject that comes first in `items`). Inside a
 * subject the items are a seeded shuffle's first k. The result keeps the order of `items`.
 */
export function sampleBySubject<T extends Pick<K12Item, "subject">>(items: readonly T[], n: number, seed = K12_FLOW_SAMPLE_SEED): T[] {
  if (n >= items.length) return [...items];
  const strata = new Map<K12Subject, number[]>();
  items.forEach((it, i) => {
    const s = strata.get(it.subject);
    if (s) s.push(i);
    else strata.set(it.subject, [i]);
  });
  const groups = [...strata.values()];
  const exact = groups.map((g) => (g.length * n) / items.length);
  const take = exact.map(Math.floor);
  let left = n - take.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left === 0) break;
    take[i]++;
    left--;
  }
  const rand = seededRandom(seed);
  const picked: number[] = [];
  groups.forEach((g, gi) => {
    const s = [...g];
    for (let i = s.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [s[i], s[j]] = [s[j], s[i]];
    }
    picked.push(...s.slice(0, take[gi]));
  });
  return picked.sort((a, b) => a - b).map((i) => items[i]);
}

/** The items a run covers. Throws on an EVAL_ONLY id that is not in `items`. */
export function selectK12FlowItems<T extends Pick<K12Item, "id" | "subject">>(
  items: readonly T[],
  o: { only?: string; limit?: number; sample?: number },
): T[] {
  let out = [...items];
  if (o.only) {
    const ids = o.only.split(",").map((s) => s.trim()).filter(Boolean);
    const missing = ids.filter((id) => !items.some((x) => x.id === id));
    if (missing.length) throw new Error(`EVAL_ONLY: not a dev item of this suite: ${missing.join(", ")}`);
    out = out.filter((x) => ids.includes(x.id));
  }
  if (o.sample !== undefined) out = sampleBySubject(out, o.sample);
  if (o.limit !== undefined) out = out.slice(0, o.limit);
  return out;
}
