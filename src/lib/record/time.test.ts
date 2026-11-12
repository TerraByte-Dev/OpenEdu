import { describe, it, expect, vi, afterAll } from "vitest";
import {
  attemptSpan, approxMinutes, countedFrom, monthsWithActivity, rangeBounds, rangeLabel, schoolYearStart, sittings, timeSpans,
  QUIZ_MS_PER_QUESTION,
} from "./time";
import { emptySource, local, utc } from "./test-rows";
import type { RecordAttempt } from "./sources";

// Pin a zone west of Greenwich (UTC-6 in November), so the boundary test below fails if anything
// buckets by UTC day, whatever zone the machine running the suite is in.
vi.stubEnv("TZ", "America/Chicago");
afterAll(() => { vi.unstubAllEnvs(); });

const attempt = (over: Partial<RecordAttempt>): RecordAttempt => ({
  id: "a", course_id: "c", quiz_type: "quiz", level: 1, score: 100, total_questions: 5, correct_count: 5,
  time_taken_seconds: null, started_at: utc(local(2026, 10, 3, 10)), completed_at: utc(local(2026, 10, 3, 10, 5)), passed: null, ...over,
});

describe("local-day bucketing", () => {
  it("puts activity in the learner's local month even when its UTC date is in the next or previous month", () => {
    const s = emptySource();
    // Late on Nov 30 locally is Dec 1 in UTC west of Greenwich; early on Dec 1 locally is Nov 30 east of it.
    s.chats = [
      { course_id: "c", thread_id: "t", created_at: utc(local(2026, 10, 30, 23, 30)) },
      { course_id: "c", thread_id: "t", created_at: utc(local(2026, 11, 1, 0, 30)) },
    ];
    expect(local(2026, 10, 30, 23, 30).getTimezoneOffset()).toBe(360); // the pinned zone took effect
    expect(monthsWithActivity(s)).toEqual([{ year: 2026, month: 11 }, { year: 2026, month: 10 }]);
  });

  it("bounds a month at local midnights and labels it", () => {
    const now = local(2026, 11, 2);
    const b = rangeBounds({ kind: "month", year: 2026, month: 10 }, now);
    expect(b.start).toEqual(new Date(2026, 10, 1));
    expect(b.end).toEqual(new Date(2026, 11, 1));
    expect(rangeLabel({ kind: "month", year: 2026, month: 10 }, now)).toEqual({ label: "November 2026", span: "Nov 1 – Nov 30" });
    expect(rangeLabel({ kind: "since", from: "2026-08-01" }, now).label).toBe("Since Aug 1, 2026");
    expect(rangeBounds({ kind: "since", from: "2026-08-01" }, now).end).toEqual(new Date(2026, 11, 3));
  });

  it("starts the school year on the stored day, Aug 1 when unset, in the year that has begun", () => {
    expect(schoolYearStart(null, local(2026, 10, 11))).toBe("2026-08-01");
    expect(schoolYearStart(null, local(2027, 2, 1))).toBe("2026-08-01");
    expect(schoolYearStart("07-01", local(2026, 6, 1))).toBe("2026-07-01");
    expect(schoolYearStart("nonsense", local(2026, 6, 1))).toBe("2025-08-01");
  });

  it("counts time from the first full local day after capture began", () => {
    expect(countedFrom(null)).toBeNull();
    expect(countedFrom(utc(local(2026, 10, 11, 23, 59)))).toEqual(new Date(2026, 10, 12));
    expect(countedFrom(utc(local(2026, 10, 11, 0, 1)))).toEqual(new Date(2026, 10, 12));
  });
});

describe("attempt time", () => {
  it("caps a quiz at 2 minutes a question", () => {
    const left = attemptSpan(attempt({ started_at: utc(local(2026, 10, 3, 10)), completed_at: utc(local(2026, 10, 3, 14)), total_questions: 5 }))!;
    expect(left.end.getTime() - left.start.getTime()).toBe(5 * QUIZ_MS_PER_QUESTION);
    const quick = attemptSpan(attempt({ started_at: utc(local(2026, 10, 3, 10)), completed_at: utc(local(2026, 10, 3, 10, 4)) }))!;
    expect(quick.end.getTime() - quick.start.getTime()).toBe(4 * 60_000);
  });

  it("takes a level test's time back from its finish by the stored time taken", () => {
    const span = attemptSpan(attempt({
      quiz_type: "promotion", started_at: utc(local(2026, 10, 3, 9)), completed_at: utc(local(2026, 10, 3, 10)), time_taken_seconds: 900,
    }))!;
    expect(span.start).toEqual(local(2026, 10, 3, 9, 45));
    expect(span.end).toEqual(local(2026, 10, 3, 10));
  });

  it("has no span for an unfinished attempt; its start counts as an instant only when it has an answer", () => {
    const s = emptySource();
    s.attempts = [attempt({ id: "open", completed_at: null }), attempt({ id: "empty", completed_at: null })];
    s.questions = [{
      id: "q", attempt_id: "open", question_text: "?", question_type: "multiple_choice", correct_answer: "A", user_answer: "A",
      is_correct: 1, explanation: "", subtopic_id: null, self_explanation: null, graded_by: "key",
    }];
    expect(attemptSpan(s.attempts[0])).toBeNull();
    expect(timeSpans(s)).toHaveLength(1);
  });
});

describe("sittings", () => {
  const at = (h: number, m: number) => local(2026, 10, 3, h, m);
  it("joins spans and instants less than 5 minutes apart, and spans overlap rather than add", () => {
    const list = sittings([
      { start: at(10, 0), end: at(10, 10) },  // a quiz
      { start: at(10, 12), end: at(10, 12) }, // a tutor message 2 min later
      { start: at(10, 5), end: at(10, 8) },   // inside the quiz
      { start: at(10, 30), end: at(10, 30) }, // a new sitting
    ]);
    expect(list).toHaveLength(2);
    expect(approxMinutes(list)).toBe(12);
  });
});
