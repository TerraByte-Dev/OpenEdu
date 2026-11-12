import { describe, it, expect } from "vitest";
import { learningRecord } from "./build";
import { course, dec, emptySource, local, nov, oct, question, quiz, sub, syllabus, utc } from "./test-rows";
import type { RecordSource } from "./sources";

const NOVEMBER = { kind: "month", year: 2026, month: 10 } as const;
const OCTOBER = { kind: "month", year: 2026, month: 9 } as const;
const DECEMBER = { kind: "month", year: 2026, month: 11 } as const;
/** "Today" for these tests: November is the current month. */
const NOW = local(2026, 10, 20);

function withCourse(subs = [sub("1.1"), sub("1.2"), sub("1.3")], over = {}): RecordSource {
  const s = emptySource();
  s.courses = [course(over)];
  s.syllabuses = [syllabus(1, subs)];
  return s;
}

describe("mastered this month (A1, T3)", () => {
  it("counts 9 of 10 as mastered with its evidence, and 1 of 1 only as an early sign", () => {
    const s = withCourse();
    quiz(s, "1.1", 9, 10, { completed_at: nov(4) }, { graded_by: "key" });
    quiz(s, "1.2", 1, 1, { completed_at: nov(5) });
    const r = learningRecord(s, NOVEMBER, NOW);
    expect(r.mastered).toEqual([
      expect.objectContaining({ skillId: "1.1", date: nov(4), earlySign: false, evidence: expect.objectContaining({ correct: 9, total: 10, levelTest: false }) }),
      expect.objectContaining({ skillId: "1.2", date: nov(5), earlySign: true }),
    ]);
    expect(r.mastered.filter((m) => !m.earlySign)).toHaveLength(1);
    expect(r.courses[0].counts).toMatchObject({ mastered: 1, early_sign: 1, not_yet: 1 });
  });

  it("judges at the range end: a skill mastered in December is not in November", () => {
    const s = withCourse();
    quiz(s, "1.1", 2, 5, { completed_at: nov(10) });
    quiz(s, "1.1", 5, 5, { completed_at: dec(3) });
    const novRec = learningRecord(s, NOVEMBER, local(2026, 11, 20));
    expect(novRec.mastered).toEqual([]);
    expect(novRec.courses[0].skills[0].status).toBe("learning");
    expect(novRec.learning).toEqual([expect.objectContaining({ skillId: "1.1", correct: 2, total: 5 })]);
    expect(learningRecord(s, DECEMBER, local(2026, 11, 20)).mastered.map((m) => m.skillId)).toEqual(["1.1"]);
  });

  it("splits the evidence by how each answer was marked", () => {
    const s = withCourse();
    const a = quiz(s, "1.1", 3, 3, { completed_at: nov(4) }, { graded_by: "key" });
    s.questions.push(question(a.id, "1.1", 1, { question_type: "short_answer", graded_by: "model" }));
    expect(learningRecord(s, NOVEMBER, NOW).mastered[0].evidence.graders).toMatchObject({ key: 3, model: 1, fallback: 0 });
  });
});

describe("without quiz proof (A2) and the reconciliation line", () => {
  it("lists tutor marks and keyword matches, drops keyword events the replay already proved, and the line adds up", () => {
    const s = withCourse([
      sub("1.1", "Greetings", { mastered: true }),   // quiz-checked
      sub("1.2", "Numbers", { mastered: true }),     // early sign
      sub("1.3", "Colours", { mastered: true }),     // tutor
      sub("1.4", "Food", { mastered: true }),        // keyword
      sub("1.5", "Weather", { mastered: true }),     // flag only (before migration 18)
      sub("1.6", "Family", { mastered: true }),      // grader failed
      sub("1.7", "Time"),                            // not yet
    ]);
    const proved = quiz(s, "1.1", 3, 3, { completed_at: nov(4) });
    quiz(s, "1.2", 1, 1, { completed_at: nov(5) });
    quiz(s, "1.6", 2, 2, { completed_at: nov(6) }, { question_type: "short_answer", graded_by: "fallback" });
    const ev = { course_id: "c", level: 1, source: "keyword" as const, correct: 4, total: 4, attempt_id: null, event: "mastered" as const };
    s.subtopicEvents = [
      { ...ev, subtopic_id: "1.1", attempt_id: proved.id, created_at: nov(4) }, // combined counts on a proved skill: a duplicate
      { ...ev, subtopic_id: "1.3", source: "tutor", correct: null, total: null, created_at: nov(7) },
      { ...ev, subtopic_id: "1.4", created_at: nov(8) },
    ];
    const r = learningRecord(s, NOVEMBER, NOW);
    expect(r.withoutProof.map((w) => [w.skillId, w.reason, w.date])).toEqual([
      ["1.3", "tutor", nov(7)], ["1.4", "keyword", nov(8)], ["1.5", "no_proof", null], ["1.6", "fallback", nov(6)],
    ]);
    expect(r.withoutProof[3].fallbackAnswers).toBe(2);
    const line = r.courses[0].reconciliation!;
    expect(line).toEqual({ shown: 6, checked: 1, early: 1, without: 4 });
    expect(line.checked + line.early + r.withoutProof.length).toBe(line.shown);
    expect(r.courses[0].skills.map((k) => k.status)).toEqual(["mastered", "early_sign", "tutor", "keyword", "no_proof", "no_proof", "not_yet"]);
  });

  it("shows an undated flag only in the current month, and dated rows only in their own month", () => {
    const s = withCourse([sub("1.1", "Greetings", { mastered: true }), sub("1.2", "Numbers", { mastered: true })]);
    s.subtopicEvents = [{ course_id: "c", level: 1, subtopic_id: "1.2", event: "mastered", source: "tutor", correct: null, total: null, attempt_id: null, created_at: oct(7) }];
    const october = learningRecord(s, OCTOBER, NOW);
    expect(october.withoutProof.map((w) => w.skillId)).toEqual(["1.2"]);
    expect(october.courses[0].reconciliation).toBeNull();
    // The current month lists every unproven skill the app shows as mastered, whenever it happened.
    expect(learningRecord(s, NOVEMBER, NOW).withoutProof.map((w) => [w.skillId, w.date])).toEqual([["1.1", null], ["1.2", oct(7)]]);
  });
});

describe("rechecked (A3)", () => {
  it("counts distinct skills, leaves exact repeats out, and calls one slip a slip", () => {
    const s = withCourse([sub("1.1"), sub("1.2"), sub("1.3")]);
    for (const id of ["1.1", "1.2", "1.3"]) quiz(s, id, 3, 3, { completed_at: oct(5) }, { question_text: `Old ${id}` });
    quiz(s, "1.1", 3, 3, { completed_at: nov(4) });
    quiz(s, "1.1", 3, 3, { completed_at: nov(9) });
    quiz(s, "1.2", 9, 10, { completed_at: nov(4) });
    quiz(s, "1.2", 1, 4, { completed_at: nov(9) });
    // 1.3 comes back only as exact repeats (different case and spacing) of its October questions.
    quiz(s, "1.3", 0, 3, { completed_at: nov(4) }, { question_text: "  old 1.3 " });
    const r = learningRecord(s, NOVEMBER, NOW);
    expect(r.rechecked.held.map((x) => x.skillId)).toEqual(["1.1"]);
    expect(r.rechecked.slipped.map((x) => x.skillId)).toEqual(["1.2"]);
    expect(r.courses[0].skills.find((k) => k.skillId === "1.2")!.reviewAgain).toBe(true);
  });

  it("does not count a recheck as held when the grader failed on it", () => {
    const s = withCourse([sub("1.1")]);
    quiz(s, "1.1", 3, 3, { completed_at: oct(5) });
    quiz(s, "1.1", 3, 3, { completed_at: nov(4) }, { question_type: "short_answer", graded_by: "fallback" });
    const r = learningRecord(s, NOVEMBER, NOW);
    expect(r.rechecked).toEqual({ held: [], slipped: [] });
  });
});

describe("levels passed (A4) and the level at range end", () => {
  it("infers a pass from the course having moved on, dated by the latest level test that could have passed", () => {
    const s = withCourse(undefined, { current_level: 3 });
    s.syllabuses.push(syllabus(2, [sub("2.1")]), syllabus(3, [sub("3.1")]));
    s.attempts.push(
      { ...quiz(emptySource(), null, 0, 0), quiz_type: "promotion", level: 1, score: 90, completed_at: nov(2) },
      { ...quiz(emptySource(), null, 0, 0), quiz_type: "promotion", level: 1, score: 70, completed_at: nov(3) }, // later, but cannot have passed
      { ...quiz(emptySource(), null, 0, 0), quiz_type: "promotion", level: 2, score: 60, completed_at: nov(12) },
    );
    const r = learningRecord(s, NOVEMBER, NOW);
    expect(r.levelsPassed.map((p) => [p.level, p.date])).toEqual([[2, null], [1, nov(2)]]);
    expect(r.courses[0]).toMatchObject({ level: 3, levelTitle: "Level 3 title", objectives: ["Objective 3"] });
    // October ended before the level-1 pass.
    expect(learningRecord(s, OCTOBER, NOW).courses[0].level).toBe(1);
    // Seen from December, November is past: level 1 passed in it, but the undated level-2 pass cannot be
    // placed, so the level at its end is not recorded. The undated pass is listed in the current month.
    expect(learningRecord(s, NOVEMBER, local(2026, 11, 20)).courses[0].level).toBeNull();
    expect(learningRecord(s, DECEMBER, local(2026, 11, 20)).levelsPassed.map((p) => p.level)).toEqual([2]);
  });

  it("dates a stored pass from migration 18, and ignores a stored fail with a high score", () => {
    const s = withCourse(undefined, { current_level: 2 });
    s.syllabuses.push(syllabus(2, [sub("2.1")]));
    s.attempts.push(
      { ...quiz(emptySource(), null, 0, 0), quiz_type: "promotion", level: 1, score: 90, passed: 0, completed_at: nov(2) },
      { ...quiz(emptySource(), null, 0, 0), quiz_type: "promotion", level: 1, score: 88, passed: 1, completed_at: nov(5) },
    );
    const r = learningRecord(s, NOVEMBER, local(2026, 11, 2));
    expect(r.levelsPassed).toEqual([expect.objectContaining({ level: 1, date: nov(5) })]);
    expect(r.courses[0].level).toBe(2);
  });

  it("counts an archived course as finished: every level passed", () => {
    const s = withCourse(undefined, { current_level: 6, status: "archived" });
    const r = learningRecord(s, NOVEMBER, NOW);
    expect(r.levelsPassed.map((p) => p.level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.courses[0]).toMatchObject({ status: "archived", level: 6 });
  });
});

describe("courses", () => {
  it("tracks no levels or skills for a legacy course, but counts its activity", () => {
    const s = withCourse(undefined, { current_level: 2.5, title: "Old algebra" });
    quiz(s, "1.1", 5, 5, { level: 2.5, completed_at: nov(4) });
    const r = learningRecord(s, NOVEMBER, NOW);
    expect(r.courses[0]).toMatchObject({ legacy: true, level: null, skills: [], reconciliation: null });
    expect(r.mastered).toEqual([]);
    expect(r.quizzes).toHaveLength(1);
    expect(r.days).toBe(1);
  });

  it("groups by subject, with no subject last, and leaves out courses made after the range", () => {
    const s = emptySource();
    s.courses = [
      course({ id: "x", title: "Zoology", subject: null }),
      course({ id: "y", title: "Algebra", subject: "Math" }),
      course({ id: "z", title: "Art club", subject: "Arts" }),
      course({ id: "w", title: "Later", subject: "Arts", created_at: dec(2) }),
    ];
    expect(learningRecord(s, NOVEMBER, NOW).courses.map((c) => c.course)).toEqual(["Art club", "Algebra", "Zoology"]);
  });
});

describe("hard ones (B3) and unanswered questions", () => {
  it("shows the worst skills with missed items word for word, never an unanswered, model-judged or inconsistent one", () => {
    const s = withCourse([sub("1.1", "Verbs"), sub("1.2", "Nouns")]);
    const a = quiz(s, "1.1", 1, 1, { quiz_type: "promotion", completed_at: nov(4), total_questions: 6 }, { graded_by: "key" });
    s.questions.push(
      question(a.id, "1.1", 0, { question_text: "Conjugate ser", user_answer: "es", correct_answer: "soy", graded_by: "key" }),
      question(a.id, "1.1", 0, { question_text: "Model judged", graded_by: "model", question_type: "short_answer" }),
      question(a.id, "1.1", 0, { question_text: "What is 6 x 7?", correct_answer: "40", explanation: "6 x 7 = 42", user_answer: "41", graded_by: "key" }),
      question(a.id, "1.1", 0, { question_text: "Never reached", user_answer: null, graded_by: "unanswered" }),
      question(a.id, "1.1", 0, { question_text: "Also never reached", user_answer: null, graded_by: "unanswered" }),
    );
    const r = learningRecord(s, NOVEMBER, NOW);
    expect(r.hardOnes).toEqual([expect.objectContaining({ skillId: "1.1", correct: 1, total: 4, missed: [{ question: "Conjugate ser", answered: "es", key: "soy" }] })]);
    expect(r.quizzes[0]).toMatchObject({ unanswered: 2, timedOutUnstored: false, levelTest: true });
    expect(r.talkAboutIt.explain.map((e) => e.skillId)).toEqual(["1.1"]);
  });

  it("takes a timed-out test's score from the attempt, not its rows", () => {
    const s = withCourse();
    quiz(s, "1.1", 2, 2, { quiz_type: "promotion", completed_at: nov(4), total_questions: 10, correct_count: 3, score: 30 });
    expect(learningRecord(s, NOVEMBER, NOW).quizzes[0]).toMatchObject({ correct: 3, total: 10, score: 30, timedOutUnstored: true });
  });
});

describe("work and activity (C)", () => {
  it("shows an abandoned attempt only as started, not finished, and only when it has an answer", () => {
    const s = withCourse();
    quiz(s, "1.1", 1, 2, { completed_at: null, started_at: nov(4) });
    quiz(s, "1.1", 0, 0, { completed_at: null, started_at: nov(5) });
    const r = learningRecord(s, NOVEMBER, NOW);
    expect(r.quizzes).toEqual([]);
    expect(r.startedNotFinished).toBe(1);
    expect(r.days).toBe(1);
    expect(r.courses[0].skills[0].status).toBe("not_yet");
  });

  it("counts lessons, tutor conversations, flashcards and the learner's own words", () => {
    const s = withCourse();
    s.captureSince = oct(1);
    s.lessons = [{ course_id: "c", read_at: nov(2) }, { course_id: "c", read_at: oct(2) }];
    s.chats = [
      { course_id: "c", thread_id: "t1", created_at: nov(2) },
      { course_id: "c", thread_id: "t1", created_at: nov(2, 13) },
      { course_id: "c", thread_id: "t2", created_at: nov(3) },
    ];
    s.flashcards = [
      { course_id: "c", source: "manual", created_at: nov(2), last_reviewed_at: null },
      { course_id: "c", source: "quiz_miss", created_at: nov(2), last_reviewed_at: nov(9) },
    ];
    s.flashcardReviews = [{ course_id: "c", reviewed_at: nov(9) }];
    s.notes = [{ course_id: "c", title: "My verbs", content: "ser, estar", created_at: nov(6) }];
    quiz(s, "1.1", 1, 1, { completed_at: nov(7) }, { self_explanation: "  because it is soy  " });
    const r = learningRecord(s, NOVEMBER, NOW);
    expect(r.activity).toMatchObject({
      lessonsOpened: 1, tutorMessages: 3, tutorConversations: 2, flashcardsMade: 1, flashcardsMadeByApp: 1, flashcardsReviewed: 1, notesStarted: 1,
    });
    expect(r.ownWords.map((w) => [w.kind, w.text, w.skill])).toEqual([["self_explanation", "because it is soy", "Skill 1.1"], ["note", "ser, estar", null]]);
    // Days: Nov 2, 3, 6, 7, 9 (the app-made card's creation does not count).
    expect(r.days).toBe(5);
  });

  it("omits flashcard reviews and notes for a range that ended before capture began", () => {
    const s = withCourse();
    s.captureSince = nov(10);
    expect(learningRecord(s, OCTOBER, NOW).activity).toMatchObject({ flashcardsReviewed: null, notesStarted: null });
  });
});

describe("time across the cut-over (T2)", () => {
  it("keeps approximate and counted time apart, and the cut-over day approximate", () => {
    const s = withCourse();
    s.captureSince = nov(10, 15);
    s.chats = [
      { course_id: "c", thread_id: "t", created_at: nov(10, 16) },
      { course_id: "c", thread_id: "t", created_at: nov(10, 16, 4) },
      { course_id: "c", thread_id: "t", created_at: nov(12, 9) },
    ];
    s.learnerDays = [{ day: "2026-11-10", minutes: 30 }, { day: "2026-11-12", minutes: 25 }, { day: "2026-12-01", minutes: 5 }];
    const r = learningRecord(s, NOVEMBER, NOW);
    expect(r.time).toEqual({ approx: { minutes: 4, sittings: 1 }, counted: { minutes: 25 } });
    expect(learningRecord(s, OCTOBER, NOW).time.counted).toBeNull();
    expect(learningRecord(s, DECEMBER, local(2026, 11, 20)).time).toEqual({ approx: null, counted: { minutes: 5 } });
    expect(r.timeBySubject).toEqual([{ subject: "Foreign language", minutes: 4, courses: [{ courseId: "c", course: "Spanish I", minutes: 4, sittings: 2 }] }]);
  });

  it("is all approximate on a database without capture", () => {
    const s = withCourse();
    quiz(s, "1.1", 1, 3, { started_at: nov(4, 10), completed_at: nov(4, 10, 30) });
    expect(learningRecord(s, NOVEMBER, NOW).time).toEqual({ approx: { minutes: 6, sittings: 1 }, counted: null });
  });
});

describe("the record as data", () => {
  it("round-trips through JSON unchanged", () => {
    const s = withCourse([sub("1.1", "Greetings", { mastered: true }), sub("1.2")]);
    s.captureSince = oct(1);
    quiz(s, "1.1", 3, 3, { completed_at: nov(4) });
    quiz(s, "1.2", 1, 4, { completed_at: nov(5) }, { self_explanation: "hmm" });
    s.learnerDays = [{ day: "2026-11-05", minutes: 12 }];
    const r = learningRecord(s, { kind: "since", from: "2026-08-01" }, NOW);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(r.period).toEqual({ label: "Since Aug 1, 2026", span: "", from: "2026-08-01", to: "2026-11-20" });
    expect(r.builtAt).toBe(utc(NOW));
  });
});
