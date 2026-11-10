// The daily goal on the learner's Home: minutes a day, chosen once, with today's progress.
// Pure. "Today" is the learner's LOCAL day — a kid studying at 7 pm is still on today, whatever UTC
// says (computeStreak in analytics.ts is UTC-based and separate). Minutes are counted by App while
// a learner's session is on screen and persisted per learner in the plugin store (store.ts).

export const DAILY_GOAL_OPTIONS: ReadonlyArray<number> = [10, 15, 20, 30];
export const DEFAULT_DAILY_GOAL = 15;

/** One learner's active minutes for one local day. A record from another day counts as zero. */
export interface ActiveMinutes {
  day: string;     // local YYYY-MM-DD
  minutes: number;
}

export function localDayKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function minutesToday(rec: ActiveMinutes | null | undefined, now: Date): number {
  if (!rec || rec.day !== localDayKey(now)) return 0;
  return Math.max(0, Math.floor(rec.minutes));
}

/** One more active minute, rolling over to a fresh count when the local day has changed. */
export function tickActiveMinutes(rec: ActiveMinutes | null | undefined, now: Date): ActiveMinutes {
  return { day: localDayKey(now), minutes: minutesToday(rec, now) + 1 };
}

/** A goal from storage, or the default when nothing valid is stored. */
export function normalizeGoal(stored: unknown): number | null {
  return typeof stored === "number" && Number.isFinite(stored) && stored > 0 ? Math.round(stored) : null;
}

export interface GoalProgress {
  pct: number;        // 0..100, capped
  done: boolean;
  remaining: number;  // minutes still to go, 0 when done
}

export function goalProgress(minutes: number, goal: number): GoalProgress {
  const safeGoal = Math.max(1, goal);
  const pct = Math.min(100, Math.round((minutes / safeGoal) * 100));
  return { pct, done: minutes >= safeGoal, remaining: Math.max(0, safeGoal - minutes) };
}

export function goalSentence(minutes: number, goal: number): string {
  const p = goalProgress(minutes, goal);
  if (p.done) return "You've hit today's goal. Nice work!";
  if (minutes === 0) return `${goal} minutes today. Let's go.`;
  return `${minutes} of ${goal} minutes done — ${p.remaining} to go.`;
}

/**
 * Whole-course progress for a card, 0..100. Six levels: each finished level is a sixth, and the
 * current level earns its sixth gradually as topics are learned. A completed course is 100.
 */
export function courseProgressPct(
  course: { current_level: number; status: string },
  masteredInLevel: number,
  totalInLevel: number,
): number {
  if (course.status === "completed" || course.status === "archived") return 100;
  const level = Math.min(6, Math.max(1, Math.floor(course.current_level)));
  const within = totalInLevel > 0 ? Math.min(1, masteredInLevel / totalInLevel) : 0;
  return Math.round(((level - 1 + within) / 6) * 100);
}
