// Pure analytics for the progress dashboard (slice B3). No model calls — derives trends from data
// already written (quiz_attempts, quiz_questions). `now` is injected so the streak math is testable.

// UTC day key (YYYY-MM-DD) for an ISO timestamp.
export function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

// Consecutive-day activity streak ending today — or yesterday, so the streak doesn't read as broken
// earlier in the day before you've studied. `isoTimestamps` are activity instants (e.g. quiz starts).
export function computeStreak(isoTimestamps: string[], now: Date): number {
  const days = new Set(isoTimestamps.filter(Boolean).map(dayKey));
  if (days.size === 0) return 0;

  const startOfUTCDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const key = (d: Date) => d.toISOString().slice(0, 10);

  let cursor = startOfUTCDay(now);
  if (!days.has(key(cursor))) {
    cursor = new Date(cursor.getTime() - 86_400_000); // allow the streak to anchor on yesterday
    if (!days.has(key(cursor))) return 0;
  }

  let streak = 0;
  while (days.has(key(cursor))) {
    streak++;
    cursor = new Date(cursor.getTime() - 86_400_000);
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
