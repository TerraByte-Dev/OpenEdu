import { describe, it, expect } from "vitest";
import { learningRecord } from "./build";
import { RECORD_COPY } from "./copy";
import { recordDays, recordEventCsv, recordEvents } from "./csv";
import { printHeader } from "./print";
import { monthsToSave, needsSaving, shownDays, shownRecord, snapshotOf, withoutVerbatim } from "./saved";
import { course, emptySource, local, nov, oct, question, quiz, sub, syllabus, utc } from "./test-rows";
import { ownWordsNoneText, rangeOptions } from "./view";
import type { RecordSource } from "./sources";

const OCTOBER = { kind: "month", year: 2026, month: 9 } as const;
const NOVEMBER = { kind: "month", year: 2026, month: 10 } as const;
/** "Today": November, so October has ended. */
const NOW = local(2026, 10, 20);

/** Words only the learner, or a quiz's question/answer pair, wrote: none may be in a saved body. */
const VERBATIM = ["QTEXT-ser", "ANS-es", "KEY-soy", "OWN-WORDS", "NOTE-TITLE", "NOTE-BODY"];

/** Two courses with October activity: Spanish has a mastered skill, a hard one with a missed item and the learner's words. */
function october(): RecordSource {
  const s = emptySource();
  s.captureSince = oct(1);
  s.courses = [course(), course({ id: "m", title: "Fractions", subject: "Math" })];
  s.syllabuses = [syllabus(1, [sub("1.1", "Greetings"), sub("1.2", "Verbs")]), syllabus(1, [sub("1.1", "Halves")], "m")];
  quiz(s, "1.1", 4, 4, { completed_at: oct(4) }, { graded_by: "key" });
  const hard = quiz(s, "1.2", 1, 3, { completed_at: oct(6) }, { graded_by: "key" });
  s.questions.push(question(hard.id, "1.2", 0, {
    question_text: "QTEXT-ser", user_answer: "ANS-es", correct_answer: "KEY-soy", graded_by: "key", self_explanation: "OWN-WORDS",
  }));
  hard.total_questions = 4;
  s.notes = [{ course_id: "c", title: "NOTE-TITLE", content: "NOTE-BODY", created_at: oct(7) }];
  s.lessons = [{ course_id: "c", level: 1, topic: "Greetings", read_at: oct(3) }];
  s.chats = [{ course_id: "c", thread_id: "t", created_at: oct(3) }];
  quiz(s, "1.1", 3, 3, { course_id: "m", completed_at: oct(9) });
  quiz(s, "1.1", 1, 2, { completed_at: nov(3) });
  return s;
}

function saveOctober(s: RecordSource, savedAt = utc(NOW)): void {
  s.savedMonths = [{ ...snapshotOf(s, OCTOBER, NOW)!, saved_at: savedAt }];
}

/** What deleteCourse leaves: none of the course's rows. */
function deleteCourse(s: RecordSource, id: string): void {
  const gone = new Set(s.attempts.filter((a) => a.course_id === id).map((a) => a.id));
  s.courses = s.courses.filter((c) => c.id !== id);
  s.syllabuses = s.syllabuses.filter((x) => x.course_id !== id);
  s.attempts = s.attempts.filter((a) => a.course_id !== id);
  s.questions = s.questions.filter((q) => !gone.has(q.attempt_id));
  s.notes = s.notes.filter((n) => n.course_id !== id);
  s.lessons = s.lessons.filter((l) => l.course_id !== id);
  s.chats = s.chats.filter((c) => c.course_id !== id);
}

describe("saved months (migration 19)", () => {
  it("round-trips: a saved month reads back exactly as the record it was built from", () => {
    const s = october();
    saveOctober(s);
    const built = learningRecord(s, OCTOBER, NOW);
    const shown = shownRecord(s, OCTOBER, NOW);
    expect(shown.saved).toEqual({ at: utc(NOW), examplesGone: false });
    expect({ ...shown, saved: null }).toEqual(built);
    expect(shownDays(s, shown)).toEqual(recordDays(s, built));
    // The fixture really has the things a saved month must keep and re-read.
    expect(built.mastered.map((m) => m.skill)).toEqual(["Greetings", "Halves"]);
    expect(built.hardOnes[0].missed[0]).toEqual({ question: "QTEXT-ser", answered: "ANS-es", key: "KEY-soy" });
    expect(built.ownWords.map((w) => w.text)).toEqual(["NOTE-BODY", "OWN-WORDS"]);
    expect(built.talkAboutIt.explain[0].selfExplanation).toBe("OWN-WORDS");
  });

  it("ignores rows deleted or rewritten later: counts, titles, dates and statuses stay as saved", () => {
    const s = october();
    saveOctober(s);
    const saved = shownRecord(s, OCTOBER, NOW);
    deleteCourse(s, "m");
    s.syllabuses[0].subtopics[0].title = "Regenerated title"; // a regenerated level rewrites the skill's title
    const live = learningRecord(s, OCTOBER, NOW);
    expect(live.mastered.map((m) => m.skill)).toEqual(["Regenerated title"]);
    expect(live.quizzes).toHaveLength(2);

    const shown = shownRecord(s, OCTOBER, NOW);
    expect(shown.mastered).toEqual(saved.mastered);
    expect(shown.mastered.map((m) => m.skill)).toEqual(["Greetings", "Halves"]);
    expect(shown.quizzes).toEqual(saved.quizzes);
    expect(shown.courses.map((c) => c.course)).toEqual(["Spanish I", "Fractions"]);
    expect(shown.days).toBe(saved.days);
    expect(shownDays(s, shown).some((d) => d.course === "Fractions")).toBe(true);
  });

  it("keeps none of the learner's words or the question pairs, reads them live, and drops them with their course", () => {
    const s = october();
    saveOctober(s);
    const body = s.savedMonths[0].body_json;
    for (const text of VERBATIM) expect(body).not.toContain(text);

    const before = shownRecord(s, OCTOBER, NOW);
    expect(before.hardOnes[0].missed).toEqual(learningRecord(s, OCTOBER, NOW).hardOnes[0].missed);
    expect(before.hardOnes[0].missed[0]).toEqual({ question: "QTEXT-ser", answered: "ANS-es", key: "KEY-soy" });
    expect(before.ownWords.map((w) => w.text)).toEqual(["NOTE-BODY", "OWN-WORDS"]);

    deleteCourse(s, "c");
    const after = shownRecord(s, OCTOBER, NOW);
    expect(after.hardOnes.map((h) => [h.skill, h.correct, h.total, h.missed])).toEqual([["Verbs", 1, 4, []]]);
    expect(after.talkAboutIt.explain[0]).toMatchObject({ skill: "Verbs", selfExplanation: null });
    expect(after.ownWords).toEqual([]);
    expect(ownWordsNoneText(after)).toBe(RECORD_COPY.examplesGone);
    expect(ownWordsNoneText(learningRecord(s, OCTOBER, NOW))).toBe(RECORD_COPY.view.ownWordsNone);
    expect(after.mastered.map((m) => [m.course, m.skill])).toEqual([["Spanish I", "Greetings"], ["Fractions", "Halves"]]);
    expect(after.saved).toEqual({ at: utc(NOW), examplesGone: true });
    for (const text of VERBATIM) expect(JSON.stringify(after)).not.toContain(text);

    const header = printHeader(after, NOW, "Learning record");
    expect(header.built).toBe("Saved Nov 20, 2026 from the activity on record then.");
    expect(header.gone).toBe(RECORD_COPY.examplesGone);
    expect(printHeader(before, NOW, "").gone).toBeNull();
  });

  it("never saves the current month or a since-range", () => {
    const s = october();
    expect(snapshotOf(s, NOVEMBER, NOW)).toBeNull();
    expect(snapshotOf(s, { kind: "since", from: "2026-08-01" }, NOW)).toBeNull();
    expect(monthsToSave(s, NOW)).toEqual([OCTOBER]);
    expect(needsSaving(learningRecord(s, NOVEMBER, NOW), NOW)).toBe(false);
    expect(needsSaving(learningRecord(s, OCTOBER, NOW), NOW)).toBe(true);
    // The first moment of December, November has ended.
    expect(monthsToSave(s, local(2026, 11, 1, 0, 0))).toEqual([OCTOBER, NOVEMBER]);
  });

  it("saves each learner's month once: a saved month is never due again", () => {
    const s = october();
    saveOctober(s);
    expect(monthsToSave(s, NOW)).toEqual([]);
    expect(needsSaving(shownRecord(s, OCTOBER, NOW), NOW)).toBe(false);
    expect(monthsToSave(s, local(2026, 11, 5))).toEqual([NOVEMBER]);
  });

  it("labels a past month with no saved copy as built today, and the current month not at all", () => {
    const s = october();
    expect(printHeader(shownRecord(s, OCTOBER, NOW), NOW, "").built).toBe("Built Nov 20, 2026 from the activity still on record.");
    expect(printHeader(shownRecord(s, NOVEMBER, NOW), NOW, "").built).toBeNull();
  });

  it("shows each course's subject as it is set now, and a deleted course's as saved", () => {
    const s = october();
    saveOctober(s);
    s.courses[0].subject = "English/Language Arts";
    deleteCourse(s, "m");
    const shown = shownRecord(s, OCTOBER, NOW);
    expect(shown.courses.map((c) => [c.course, c.subject])).toEqual([["Spanish I", "English/Language Arts"], ["Fractions", "Math"]]);
    expect(shown.timeBySubject.map((g) => [g.subject, g.courses.map((c) => c.course)])).toEqual([
      ["English/Language Arts", ["Spanish I"]], ["Math", ["Fractions"]],
    ]);
    expect(shownDays(s, shown).find((d) => d.course === "Spanish I")?.subject).toBe("English/Language Arts");
  });

  it("keeps a saved month on the range picker after its activity is gone", () => {
    const s = october();
    saveOctober(s);
    deleteCourse(s, "c");
    deleteCourse(s, "m");
    expect(rangeOptions(s, "guided", NOW).map((o) => o.label)).toEqual(["November 2026", "October 2026", "This school year"]);
  });

  it("builds the month from current rows when the saved copy is in a format this version cannot read", () => {
    const s = october();
    saveOctober(s);
    s.savedMonths[0] = { ...s.savedMonths[0], format: 2 };
    expect(shownRecord(s, OCTOBER, NOW).saved).toBeNull();
    s.savedMonths[0] = { ...s.savedMonths[0], format: 1, body_json: "{not json" };
    expect(shownRecord(s, OCTOBER, NOW).saved).toBeNull();
  });

  it("says in the event log of a saved month that its activity rows are read when the file is made", () => {
    const s = october();
    saveOctober(s, oct(31, 23));
    const shown = shownRecord(s, OCTOBER, NOW);
    const csv = recordEventCsv(shown, recordEvents(s, shown), NOW);
    expect(csv).toContain("This month's record was saved 2026-10-31. The activity rows in this log are the ones still on this computer on 2026-11-20");
    const built = learningRecord(s, OCTOBER, NOW);
    expect(recordEventCsv(built, recordEvents(s, built), NOW)).not.toContain("This month's record was saved");
  });

  it("strips verbatim items without touching anything else", () => {
    const r = learningRecord(october(), OCTOBER, NOW);
    const stripped = withoutVerbatim(r);
    expect({ ...stripped, hardOnes: r.hardOnes, talkAboutIt: r.talkAboutIt, ownWords: r.ownWords }).toEqual(r);
    expect(r.hardOnes[0].missed).toHaveLength(2); // the original is not changed
  });
});
