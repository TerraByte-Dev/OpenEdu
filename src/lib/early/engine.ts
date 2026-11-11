// The early-learner activity engine (#244): rounds, choice order, what a tap means, mastery, unlock
// order and the home screen's stars. Pure (no DOM, no Tauri, no model), tested in engine.test.ts, and
// called unchanged by src/views/early/. Every random choice comes from a seed, so the same seed gives
// the same round and the same choice order.

import { PACKS, SKILLS, choiceKey } from "./packs";
import type { Choice, Item, Pack, Skill, SkillId } from "./types";

/** Items per round: the dots across the top of the activity screen. */
export const ROUND_SIZE = 5;
/** Correct on the first try this many times in a row, within one skill, masters it. */
export const MASTERY_STREAK = 5;
/** Stars on the home screen's row. */
export const STARS_PER_DAY = 5;

// ── Seeded randomness ───────────────────────────────────────────────────────────────────────────────

/** mulberry32: a small, fast PRNG; plenty for shuffling five cards. */
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

/** A shuffled copy (Fisher-Yates). The input is not touched. */
export function shuffle<T>(list: ReadonlyArray<T>, rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// A stable 32-bit hash of a string, to mix an item id into a seed.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The item's choices in the order the screen shows them for this attempt seed. Same seed, same order. */
export function choiceOrder(item: Item, seed: number): Choice[] {
  return shuffle(item.choices, seededRandom(seed ^ hash(item.id)));
}

// ── Rounds ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The items of one round: `size` items of the skill, shuffled by `seed`, never the same item twice in
 * a row, and never starting on `avoid` (the last item the learner saw in this skill). A skill with at
 * least `size` items gives `size` different items.
 */
export function buildRound(skill: Skill, avoid: string | null, seed: number, size = ROUND_SIZE): Item[] {
  if (skill.items.length === 0) return [];
  const rand = seededRandom(seed);
  const out: Item[] = [];
  let prev = skill.items.length > 1 ? avoid : null; // one item can only repeat
  while (out.length < size) {
    const deck = shuffle(skill.items, rand);
    // Never open on the item just seen; move it to the back when it lands first.
    if (deck.length > 1 && deck[0].id === prev) deck.push(deck.shift()!);
    for (const item of deck) {
      if (out.length >= size) break;
      if (item.id === prev && skill.items.length > 1) continue;
      out.push(item);
      prev = item.id;
    }
  }
  return out;
}

// ── A tap ───────────────────────────────────────────────────────────────────────────────────────────

/** Whether `choice` is the item's answer. The answer key is data on the item. */
export function isAnswer(item: Item, choice: Choice): boolean {
  return choiceKey(choice) === item.answer;
}

export interface NewAttempt {
  skillId: SkillId;
  itemId: string;
  correct: boolean;
  firstTry: boolean;
  /** choiceKey() of the tapped choice, so a wrong first try shows what it was mixed up with (report.ts). */
  choice: string;
}

export type Feedback =
  | { kind: "praise"; say: string }
  /** A wrong tap: teach (count together, or show the example), then let the child try again. */
  | { kind: "teach"; say: string; countAlong: boolean; example: Item["teach"]["example"] };

/**
 * One tap: what to store and what to show. `firstTry` is true for the first tap on an item and false
 * for every tap after a teaching retry; only first tries count toward mastery.
 */
export function tap(item: Item, choice: Choice, firstTry: boolean): { attempt: NewAttempt; feedback: Feedback } {
  const correct = isAnswer(item, choice);
  return {
    attempt: { skillId: item.skillId, itemId: item.id, correct, firstTry, choice: choiceKey(choice) },
    feedback: correct ? { kind: "praise", say: item.praise } : { kind: "teach", ...item.teach },
  };
}

// ── Mastery from the stored attempts ────────────────────────────────────────────────────────────────

/** One early_attempts row as SQLite returns it (migration 16). */
export interface AttemptRow {
  skill_id: string;
  item_id: string;
  correct: number;
  first_try: number;
  created_at: string;
  /** choiceKey() of the tapped choice (migration 17). Null on rows stored before it. */
  choice?: string | null;
}

export interface SkillProgress {
  /** Ever reached MASTERY_STREAK first-try correct answers in a row. Never lost. */
  mastered: boolean;
  /** First-try correct answers in a row, counting back from the latest first try. */
  streak: number;
  /** Every tap stored for the skill, retries included. */
  attempts: number;
}

/**
 * Per-skill mastery from a learner's attempts, oldest first. Only first tries count: a correct first
 * try adds one to the streak, a wrong first try resets it, and the taps after a teaching retry
 * neither add nor reset. Rows for skills this build does not know are ignored.
 */
export function skillProgress(rows: ReadonlyArray<AttemptRow>): Record<SkillId, SkillProgress> {
  const out = {} as Record<SkillId, SkillProgress>;
  for (const id of Object.keys(SKILLS) as SkillId[]) out[id] = { mastered: false, streak: 0, attempts: 0 };
  for (const r of rows) {
    const p = out[r.skill_id as SkillId];
    if (!p) continue;
    p.attempts++;
    if (!r.first_try) continue;
    p.streak = r.correct ? p.streak + 1 : 0;
    if (p.streak >= MASTERY_STREAK) p.mastered = true;
  }
  return out;
}

/** The last item the learner saw in a skill (so the next round does not open on it), or null. */
export function lastItemIn(rows: ReadonlyArray<AttemptRow>, skillId: SkillId): string | null {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].skill_id === skillId) return rows[i].item_id;
  return null;
}

// ── Unlock order ────────────────────────────────────────────────────────────────────────────────────

/** A skill is open once the skill before it in its pack is mastered. The first skill of a pack is open. */
export function isUnlocked(skillId: SkillId, progress: Record<SkillId, SkillProgress>): boolean {
  const after = SKILLS[skillId].after;
  return after === null || progress[after].mastered;
}

/** The skill a pack's tile plays: the first open, unmastered one; the last one once all are mastered. */
export function currentSkill(pack: Pack, progress: Record<SkillId, SkillProgress>): SkillId {
  const open = pack.skills.find((id) => isUnlocked(id, progress) && !progress[id].mastered);
  return open ?? pack.skills[pack.skills.length - 1];
}

export type TileStatus = { kind: "new" } | { kind: "going"; left: number } | { kind: "done" };

/** The line under a pack's tile: not started, "Keep going: N more", or every skill mastered. */
export function tileStatus(pack: Pack, progress: Record<SkillId, SkillProgress>): TileStatus {
  if (pack.skills.every((id) => progress[id].mastered)) return { kind: "done" };
  const p = progress[currentSkill(pack, progress)];
  if (p.attempts === 0) return { kind: "new" };
  return { kind: "going", left: MASTERY_STREAK - p.streak };
}

// ── Home screen ─────────────────────────────────────────────────────────────────────────────────────

// created_at is SQLite's datetime('now'): UTC, "YYYY-MM-DD HH:MM:SS".
export function parseUtc(createdAt: string): Date {
  return new Date(createdAt.replace(" ", "T") + "Z");
}

export function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Stars on the home row: answers right on the first try today (local time), up to STARS_PER_DAY. */
export function starsToday(rows: ReadonlyArray<AttemptRow>, now: Date): number {
  let n = 0;
  for (const r of rows) if (r.first_try && r.correct && sameLocalDay(parseUtc(r.created_at), now)) n++;
  return Math.min(n, STARS_PER_DAY);
}

/** Today's "play with a grown-up" idea: one of the current skills' ideas, the same all day. */
export function playTogetherToday(progress: Record<SkillId, SkillProgress>, now: Date): string {
  const ideas = PACKS.flatMap((p) => SKILLS[currentSkill(p, progress)].playTogether);
  const day = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 86_400_000);
  return ideas[day % ideas.length];
}
