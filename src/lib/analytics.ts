// Pure analytics for the progress dashboard (slice B3). No model calls — derives trends from data
// already written (quiz_attempts, quiz_questions). `now` is injected so the streak math is testable.

import { localDayKey } from "./daily-goal";

// The learner's LOCAL day (YYYY-MM-DD) of a stored time. SQLite's datetime('now') is UTC with no zone
// ("YYYY-MM-DD HH:MM:SS"), which new Date() would read as local time, so it is read as UTC here.
export function dayKey(stamp: string): string {
  return localDayKey(new Date(stamp.includes("T") ? stamp : stamp.replace(" ", "T") + "Z"));
}

// Consecutive-day activity streak ending today — or yesterday, so the streak doesn't read as broken
// earlier in the day before you've studied. `stamps` are activity times (e.g. quiz starts), SQLite or
// ISO; days are the learner's local days.
export function computeStreak(stamps: string[], now: Date): number {
  const days = new Set(stamps.filter(Boolean).map(dayKey));
  if (days.size === 0) return 0;

  // Local midnight, stepped back by calendar day (not 24 h) so a DST change never skips or repeats one.
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const back = () => cursor.setDate(cursor.getDate() - 1);
  if (!days.has(localDayKey(cursor))) {
    back(); // allow the streak to anchor on yesterday
    if (!days.has(localDayKey(cursor))) return 0;
  }

  let streak = 0;
  while (days.has(localDayKey(cursor))) {
    streak++;
    back();
  }
  return streak;
}

// Percent correct, or null when there's no data yet (so the UI can show "—").
export function accuracyPct(a: { correct: number; total: number }): number | null {
  return a.total > 0 ? Math.round((a.correct / a.total) * 100) : null;
}

// Whole minutes from a seconds total (for the time-on-task tile).
export function minutesFromSeconds(totalSeconds: number): number {
  return Math.round(totalSeconds / 60);
}
