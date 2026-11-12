// Counted active minutes for the learning record (#258). Pure: App asks this once a minute and, on
// true, adds one minute to learner_days for the learner's local day (db.ts recordActiveMinute).
//
// A minute counts when the window is visible, someone clicked, typed, scrolled or used the wheel in
// the last 2 minutes, and the screen is a learning screen. Settings, the grown-ups view, the record
// itself and the teacher view are not learning, so time spent there is never counted. This is
// separate from the Home daily goal (daily-goal.ts), which counts every visible minute and is
// unchanged.

export const ACTIVE_INPUT_WINDOW_MS = 120_000;

/** Views where time is never counted as learning. "record" is the record's own view (#258 PR 3). */
export const NOT_LEARNING_VIEWS: ReadonlySet<string> = new Set(["settings", "grownups", "record"]);

/** The input events that mark the learner as present. Listened for on window, in the capture phase. */
export const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "scroll"] as const;

export interface MinuteState {
  visible: boolean;
  /** ms timestamp of the last input event, or null if there has been none. */
  lastInputMs: number | null;
  nowMs: number;
  view: string;
  teacherOpen: boolean;
}

export function isActiveMinute(s: MinuteState): boolean {
  if (!s.visible || s.teacherOpen || NOT_LEARNING_VIEWS.has(s.view)) return false;
  if (s.lastInputMs === null) return false;
  const since = s.nowMs - s.lastInputMs;
  return since >= 0 && since <= ACTIVE_INPUT_WINDOW_MS;
}
