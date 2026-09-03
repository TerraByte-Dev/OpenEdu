// The pool law, and the measurement that decides whether the base can teach.

import { harvestCard } from "./harvest";
import { runGates, type GateName } from "./gates";
import type { Item, Pool } from "./types";
import { POOL_MIN_CLOSED, SEQUESTERED } from "./types";

export function poolFor(conceptId: string, items: Item[]): Pool {
  const closed = items.filter((i) => i.closedBook);
  const kinds = new Set(closed.map((i) => i.kind)).size;
  return {
    conceptId,
    items,
    closedCount: closed.length,
    kinds,
    // Two kinds minimum: a pool of one checker shape is item-memorisation waiting to happen, and
    // the sequestered pair has to differ in FORM from the eight that were served or the checkpoint
    // measures recall of the drill rather than transfer.
    bearsMastery: closed.length >= POOL_MIN_CLOSED && kinds >= 2,
  };
}

export interface CardResult {
  id: string;
  harvested: number;
  kept: number;
  closed: number;
  kinds: number;
  bearsMastery: boolean;
  byGenerator: Record<string, number>;
  byGate: Partial<Record<GateName, number>>;
}

export function compileCard(id: string, markdown: string, minDistinct?: number): CardResult {
  const harvested = harvestCard(id, markdown, minDistinct);
  const { kept, rejected } = runGates(harvested);
  const pool = poolFor(id, kept);
  const byGenerator: Record<string, number> = {};
  for (const i of kept) byGenerator[i.generator] = (byGenerator[i.generator] ?? 0) + 1;
  const byGate: Partial<Record<GateName, number>> = {};
  for (const r of rejected) byGate[r.gate] = (byGate[r.gate] ?? 0) + 1;
  return {
    id,
    harvested: harvested.length,
    kept: kept.length,
    closed: pool.closedCount,
    kinds: pool.kinds,
    bearsMastery: pool.bearsMastery,
    byGenerator,
    byGate,
  };
}

export interface F0Result {
  cards: number;
  /** F0(b) primary: fraction of cards with a mastery-bearing pool. Bar is 0.40; 0.28 is the cliff. */
  bearingFraction: number;
  /** F0(b) secondary: fraction with at least one usable item. Bar is 0.95. */
  anyFraction: number;
  medianClosed: number;
  meanClosed: number;
  totalItems: number;
  byGenerator: Record<string, number>;
  byGate: Partial<Record<GateName, number>>;
  perCard: CardResult[];
}

/**
 * F0(b) — the falsifier.
 *
 * >= 40% of cards must reach a mastery-bearing pool, and >= 95% must yield at least one item.
 * Below 28% bearing, the card tier is not mastery-bearing and OpenEdu's empty-shelf product is a
 * reader plus a catalog plus spaced review over items the USER writes — smaller, honest, and still
 * unmatched offline. Much better to learn that in week one than in month four.
 */
export function measureF0(
  cards: Array<{ id: string; markdown: string }>,
  minDistinct?: number,
): F0Result {
  const perCard = cards.map((c) => compileCard(c.id, c.markdown, minDistinct));
  const closed = perCard.map((r) => r.closed).sort((a, b) => a - b);
  const byGenerator: Record<string, number> = {};
  const byGate: Partial<Record<GateName, number>> = {};
  for (const r of perCard) {
    for (const [k, v] of Object.entries(r.byGenerator)) byGenerator[k] = (byGenerator[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.byGate)) byGate[k as GateName] = (byGate[k as GateName] ?? 0) + (v ?? 0);
  }
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    cards: perCard.length,
    bearingFraction: round(perCard.filter((r) => r.bearsMastery).length / perCard.length),
    anyFraction: round(perCard.filter((r) => r.kept > 0).length / perCard.length),
    medianClosed: closed[Math.floor(closed.length / 2)] ?? 0,
    meanClosed: round(closed.reduce((a, b) => a + b, 0) / (closed.length || 1)),
    totalItems: perCard.reduce((a, r) => a + r.kept, 0),
    byGenerator,
    byGate,
    perCard,
  };
}

export { POOL_MIN_CLOSED, SEQUESTERED };
