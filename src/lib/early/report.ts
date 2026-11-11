// The grown-ups view's numbers (#244 PR 2): the week, what the learner knows, the hard ones and the
// monthly learning record. Pure (no DOM, no Tauri, no model), tested in report.test.ts. Every number
// here is counted from early_attempts rows; nothing is estimated except minutes, and the UI says so.

import { ITEMS_BY_ID, SKILLS } from "./packs";
import { MASTERY_STREAK, isUnlocked, parseUtc, skillProgress, type AttemptRow } from "./engine";
import type { SkillId } from "./types";

// ── Time ────────────────────────────────────────────────────────────────────────────────────────────

/** A gap this long or longer with no tap ends a sitting. */
export const SESSION_GAP_MS = 5 * 60_000;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Nov 9": a short local date for the grown-ups view and the record. English, like the rest of the app. */
export function shortDate(d: Date): string {
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

/** "November 2026". */
export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month]} ${year}`;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export interface Sitting {
  start: Date;
  end: Date;
  taps: number;
}

/** Taps grouped into sittings: a new sitting starts after SESSION_GAP_MS with no tap. */
export function sittings(rows: ReadonlyArray<AttemptRow>): Sitting[] {
  const times = rows.map((r) => parseUtc(r.created_at)).sort((a, b) => a.getTime() - b.getTime());
  const out: Sitting[] = [];
  for (const t of times) {
    const last = out[out.length - 1];
    if (last && t.getTime() - last.end.getTime() < SESSION_GAP_MS) {
      last.end = t;
      last.taps++;
    } else {
      out.push({ start: t, end: t, taps: 1 });
    }
  }
  return out;
}

/**
 * Approximate minutes played: the time from the first to the last tap of each sitting, added up and
 * rounded to the nearest minute. Time before a sitting's first tap and after its last is not stored, so
 * this undercounts a little; the UI calls it approximate.
 */
export function approxMinutes(rows: ReadonlyArray<AttemptRow>): number {
  const ms = sittings(rows).reduce((sum, s) => sum + (s.end.getTime() - s.start.getTime()), 0);
  return Math.round(ms / 60_000);
}

/** Different local days with at least one tap. */
export function daysPlayed(rows: ReadonlyArray<AttemptRow>): number {
  return new Set(rows.map((r) => dayKey(parseUtc(r.created_at)))).size;
}

// ── Mastery dates ───────────────────────────────────────────────────────────────────────────────────

/**
 * When each skill was mastered: the time of the first-try answer that completed MASTERY_STREAK in a
 * row, or null. The same replay as engine.ts skillProgress, so a skill has a date exactly when it is
 * mastered there.
 */
export function masteryDates(rows: ReadonlyArray<AttemptRow>): Record<SkillId, Date | null> {
  const out = {} as Record<SkillId, Date | null>;
  const streak = {} as Record<SkillId, number>;
  for (const id of Object.keys(SKILLS) as SkillId[]) { out[id] = null; streak[id] = 0; }
  for (const r of rows) {
    const id = r.skill_id as SkillId;
    if (!(id in streak) || !r.first_try) continue;
    streak[id] = r.correct ? streak[id] + 1 : 0;
    if (streak[id] >= MASTERY_STREAK && out[id] === null) out[id] = parseUtc(r.created_at);
  }
  return out;
}

// ── The week ────────────────────────────────────────────────────────────────────────────────────────

export interface WeekSummary {
  /** Local midnight six days before `now`: the window is today and the six days before it. */
  from: Date;
  daysPlayed: number;
  minutes: number;
  sittings: number;
  /** Skills whose mastery date falls in the window, in pack order. */
  mastered: SkillId[];
}

export function weekSummary(rows: ReadonlyArray<AttemptRow>, now: Date): WeekSummary {
  const from = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
  const inWeek = rows.filter((r) => { const t = parseUtc(r.created_at); return t >= from && t <= now; });
  const dates = masteryDates(rows);
  return {
    from,
    daysPlayed: daysPlayed(inWeek),
    minutes: approxMinutes(inWeek),
    sittings: sittings(inWeek).length,
    mastered: (Object.keys(dates) as SkillId[]).filter((id) => { const d = dates[id]; return d !== null && d >= from && d <= now; }),
  };
}

// ── What the learner knows ──────────────────────────────────────────────────────────────────────────

/** What an item asks for, without its kind: "red", "14", "star". The answer key minus its prefix. */
export function targetOf(key: string): string {
  return key.slice(key.indexOf(":") + 1);
}

// The grown-up word for a skill's targets, and the skill's name in a sentence.
const UNIT: Record<SkillId, string> = { "colors": "colors", "count-1-10": "numbers", "count-11-20": "numbers", "shapes": "shapes" };

/** "Colors", "Counting to 10": the skill's name for grown-ups. */
export function skillTitle(id: SkillId): string {
  const n = SKILLS[id].name;
  return n.charAt(0).toUpperCase() + n.slice(1);
}

export type SkillStatus = "mastered" | "learning" | "not-yet";

export interface SkillReport {
  id: SkillId;
  title: string;
  status: SkillStatus;
  /** 0-100: 100 once mastered, else the share of the skill's targets ever right on the first try. */
  pct: number;
  /** Targets (colors, numbers, shapes) right on the first try at least once, and how many there are. */
  known: number;
  of: number;
  masteredOn: Date | null;
  /** Not open yet: the skill before it in its pack is not mastered. */
  locked: boolean;
  /** One line for the grown-up. */
  detail: string;
}

/** Every skill in pack order with its status, bar and one-line detail. `confusions` adds "mixes up ...". */
export function skillReports(rows: ReadonlyArray<AttemptRow>, confusions: ReadonlyArray<Confusion> = []): SkillReport[] {
  const progress = skillProgress(rows);
  const dates = masteryDates(rows);
  return (Object.keys(SKILLS) as SkillId[]).map((id) => {
    const skill = SKILLS[id];
    const targets = new Set(skill.items.map((i) => targetOf(i.answer)));
    const known = new Set(
      rows.filter((r) => r.skill_id === id && r.first_try && r.correct)
        .map((r) => ITEMS_BY_ID.get(r.item_id))
        .flatMap((item) => (item ? [targetOf(item.answer)] : [])),
    ).size;
    const p = progress[id];
    const status: SkillStatus = p.mastered ? "mastered" : p.attempts > 0 ? "learning" : "not-yet";
    const locked = !isUnlocked(id, progress);
    const unit = UNIT[id];
    let detail: string;
    if (status === "mastered") detail = `Mastered on ${shortDate(dates[id]!)}`;
    else if (status === "learning") {
      detail = `${known} of ${targets.size} ${unit} right on the first try`;
      const c = confusions.find((x) => x.skillId === id);
      if (c) detail += `; mixes up ${c.a} and ${c.b}`;
    } else detail = locked ? `Opens after ${SKILLS[skill.after!].name}` : "Not played yet";
    return {
      id,
      title: skillTitle(id),
      status,
      pct: status === "mastered" ? 100 : Math.round((100 * known) / targets.size),
      known,
      of: targets.size,
      masteredOn: dates[id],
      locked,
      detail,
    };
  });
}

// ── Hard ones ───────────────────────────────────────────────────────────────────────────────────────

/** A pair is shown once it was mixed up on this many wrong first tries... */
export const CONFUSION_MIN = 3;
/** ...within this many days. Older mix-ups have usually been outgrown. */
export const CONFUSION_DAYS = 30;

export interface Confusion {
  skillId: SkillId;
  /** The two targets, in order ("13" before "14", "pink" before "red"). */
  a: string;
  b: string;
  /** Wrong first tries where one was asked and the other tapped, either way round. */
  times: number;
}

function byTarget(x: string, y: string): number {
  const nx = Number(x), ny = Number(y);
  return Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y);
}

/**
 * What the learner mixes up: for each skill, pairs of targets (asked, tapped) on wrong first tries in
 * the last CONFUSION_DAYS days, counted either way round. Only pairs seen CONFUSION_MIN times or more
 * are returned, most frequent first. Rows without a stored choice (before migration 17) are skipped:
 * they say a first try was wrong, not what it was mixed up with.
 */
export function hardOnes(rows: ReadonlyArray<AttemptRow>, now: Date): Confusion[] {
  const since = now.getTime() - CONFUSION_DAYS * 86_400_000;
  const counts = new Map<string, Confusion>();
  for (const r of rows) {
    if (!r.first_try || r.correct || !r.choice) continue;
    const t = parseUtc(r.created_at).getTime();
    if (t < since || t > now.getTime()) continue;
    const item = ITEMS_BY_ID.get(r.item_id);
    if (!item || item.skillId !== r.skill_id) continue;
    const asked = targetOf(item.answer), tapped = targetOf(r.choice);
    if (asked === tapped) continue;
    const [a, b] = [asked, tapped].sort(byTarget);
    const key = `${item.skillId}|${a}|${b}`;
    const c = counts.get(key) ?? { skillId: item.skillId, a, b, times: 0 };
    c.times++;
    counts.set(key, c);
  }
  return [...counts.values()].filter((c) => c.times >= CONFUSION_MIN).sort((x, y) => y.times - x.times);
}

// ── The monthly learning record ─────────────────────────────────────────────────────────────────────

export interface MonthRef {
  year: number;
  /** 0-11. */
  month: number;
}

/** Months (local time) with at least one tap, newest first. */
export function monthsWithAttempts(rows: ReadonlyArray<AttemptRow>): MonthRef[] {
  const seen = new Map<string, MonthRef>();
  for (const r of rows) {
    const d = parseUtc(r.created_at);
    seen.set(`${d.getFullYear()}-${d.getMonth()}`, { year: d.getFullYear(), month: d.getMonth() });
  }
  return [...seen.values()].sort((x, y) => y.year - x.year || y.month - x.month);
}

export interface MonthlyRecord {
  label: string;
  daysPlayed: number;
  minutes: number;
  sittings: number;
  /** Skills mastered during the month, with the day. */
  mastered: Array<{ id: SkillId; title: string; on: Date }>;
  /** Practised during the month and not mastered by its end. */
  inProgress: Array<{ id: SkillId; title: string; detail: string }>;
  /** Mastered before the month began. */
  masteredBefore: Array<{ id: SkillId; title: string; on: Date }>;
}

/** The record for one month, from the rows up to its end. */
export function monthlyRecord(rows: ReadonlyArray<AttemptRow>, ref: MonthRef): MonthlyRecord {
  const start = new Date(ref.year, ref.month, 1);
  const end = new Date(ref.year, ref.month + 1, 1);
  const upToEnd = rows.filter((r) => parseUtc(r.created_at) < end);
  const inMonth = upToEnd.filter((r) => parseUtc(r.created_at) >= start);
  const dates = masteryDates(upToEnd);
  const reports = skillReports(upToEnd);
  const ids = Object.keys(SKILLS) as SkillId[];
  const practised = new Set(inMonth.map((r) => r.skill_id));
  return {
    label: monthLabel(ref.year, ref.month),
    daysPlayed: daysPlayed(inMonth),
    minutes: approxMinutes(inMonth),
    sittings: sittings(inMonth).length,
    mastered: ids.flatMap((id) => { const on = dates[id]; return on && on >= start ? [{ id, title: skillTitle(id), on }] : []; }),
    inProgress: reports
      .filter((r) => r.status === "learning" && practised.has(r.id))
      .map((r) => ({ id: r.id, title: r.title, detail: `${r.known} of ${r.of} ${UNIT[r.id]} right on the first try so far` })),
    masteredBefore: ids.flatMap((id) => { const on = dates[id]; return on && on < start ? [{ id, title: skillTitle(id), on }] : []; }),
  };
}
