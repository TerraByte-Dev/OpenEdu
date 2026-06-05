// SM-2-lite spaced-repetition scheduler (slice B1). Pure and Tauri-free — `now` is injected so it's
// fully deterministic and unit-tested. db.ts persists the returned schedule onto a flashcard row.
//
// The model is a trimmed SM-2 (Wozniak): an `ease` factor (floor 1.3) scales a growing interval; the
// four-button grade (Again/Hard/Good/Easy) nudges ease and the next interval. "Again" is a lapse —
// the card resets to relearning and comes due immediately. This is intentionally simple and
// transparent; FSRS can later replace it behind the same `review()` signature.

export type FlashcardGrade = "again" | "hard" | "good" | "easy";

// The mutable scheduling state carried on each card.
export interface SrsState {
  ease: number;
  interval_days: number;
  reps: number;
  lapses: number;
}

export interface SrsSchedule extends SrsState {
  due_at: string; // ISO timestamp
}

export const MIN_EASE = 1.3;
export const DEFAULT_EASE = 2.5;
const DAY_MS = 86_400_000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Apply a review grade and return the next schedule. `now` is the review instant.
export function review(state: SrsState, grade: FlashcardGrade, now: Date): SrsSchedule {
  let { ease, interval_days, reps, lapses } = state;

  if (grade === "again") {
    // Lapse: drop ease, reset the streak, relearn now (interval 0 ⇒ due immediately).
    ease = Math.max(MIN_EASE, ease - 0.2);
    reps = 0;
    lapses += 1;
    interval_days = 0;
  } else {
    if (grade === "hard") ease = Math.max(MIN_EASE, ease - 0.15);
    else if (grade === "easy") ease = ease + 0.15;
    // "good" leaves ease unchanged.

    reps += 1;
    if (reps === 1) {
      interval_days = grade === "easy" ? 4 : grade === "hard" ? 1 : 2;
    } else if (reps === 2) {
      interval_days = grade === "hard" ? 3 : 6;
    } else {
      const mult = grade === "hard" ? 1.2 : grade === "easy" ? ease * 1.3 : ease;
      interval_days = Math.round(interval_days * mult);
    }
    interval_days = Math.max(1, interval_days);
  }

  const due = new Date(now.getTime() + interval_days * DAY_MS);
  return { ease: round2(ease), interval_days, reps, lapses, due_at: due.toISOString() };
}

// A fresh card's starting schedule (due immediately so it enters the first review session).
export function initialSchedule(now: Date): SrsSchedule {
  return { ease: DEFAULT_EASE, interval_days: 0, reps: 0, lapses: 0, due_at: now.toISOString() };
}

export function isDue(due_at: string, now: Date): boolean {
  return new Date(due_at).getTime() <= now.getTime();
}
