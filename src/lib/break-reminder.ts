// When the break reminder shows (its words are in ai-notice.ts). Pure: App calls tickBreakClock once for
// each active minute, the same minute the daily goal counts (daily-goal.ts countsTowardGoal: the window
// is visible, a learner is in, and the screen is not Settings), with the time of that minute.
//
// Continuous activity: active minutes with no gap of BREAK_RESET_MINUTES or more between one and the
// next. A gap that long (the window hidden or minimised, Settings open, the learner away) counts as a
// break, and the count starts again from zero. A shorter gap (a drink, a look at another window) does
// not reset it, and its minutes are not added. The count belongs to one session: it starts at zero when
// a learner comes in, and it is not saved, so it also starts again after a restart.
//
// The reminder shows after BREAK_REMINDER_MINUTES of activity, and again after each further
// BREAK_REMINDER_MINUTES: at 3 hours, 6 hours, 9 hours.

export const BREAK_REMINDER_MINUTES = 180;
export const BREAK_RESET_MINUTES = 30;

export interface BreakClock {
  /** Active minutes in this stretch of continuous activity. */
  minutes: number;
  /** When the last active minute was counted (ms since the epoch), or null before the first. */
  lastAt: number | null;
}

export const NEW_BREAK_CLOCK: BreakClock = { minutes: 0, lastAt: null };

/**
 * One more active minute at `now` (ms). Returns the new clock and, when the reminder is due on this
 * minute, the whole hours of activity it is for (3, 6, …); otherwise null.
 */
export function tickBreakClock(clock: BreakClock, now: number): { clock: BreakClock; remindAfterHours: number | null } {
  const continuing = clock.lastAt !== null && now - clock.lastAt < BREAK_RESET_MINUTES * 60_000;
  const minutes = (continuing ? clock.minutes : 0) + 1;
  return {
    clock: { minutes, lastAt: now },
    remindAfterHours: minutes % BREAK_REMINDER_MINUTES === 0 ? minutes / 60 : null,
  };
}
