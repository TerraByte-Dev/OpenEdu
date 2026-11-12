import { describe, it, expect } from "vitest";
import { appTitle, bannedWordsIn, RECORD_COPY, RECORD_DISCLAIMER, RECORD_DISCLAIMER_SHORT, RECORD_RULES } from "./copy";
import { learningRecord } from "./build";
import { course, emptySource, local, nov, oct, question, quiz, sub, syllabus } from "./test-rows";

/** Every string anywhere inside a value. */
function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

/** A record with something in nearly every field. */
function fixtureRecord() {
  const s = emptySource();
  s.captureSince = oct(1);
  s.courses = [course({ current_level: 2 }), course({ id: "k", title: "Old maths", current_level: 1.5, subject: null })];
  s.syllabuses = [syllabus(1, [sub("1.1", "Greetings", { mastered: true }), sub("1.2", "Numbers", { mastered: true }), sub("1.3", "Verbs")]), syllabus(2, [sub("2.1", "Food")])];
  quiz(s, "1.1", 3, 3, { completed_at: oct(4) });
  quiz(s, "1.1", 3, 3, { completed_at: nov(4) });
  quiz(s, "1.3", 1, 4, { completed_at: nov(5) }, { self_explanation: "I think it changes" });
  const t = quiz(s, null, 0, 0, { quiz_type: "promotion", level: 1, score: 90, passed: 1, completed_at: nov(6), total_questions: 2 });
  s.questions.push(question(t.id, "1.3", 0, { user_answer: null, graded_by: "unanswered" }));
  s.subtopicEvents = [{ course_id: "c", level: 1, subtopic_id: "1.2", event: "mastered", source: "tutor", correct: null, total: null, attempt_id: null, created_at: nov(7) }];
  s.chats = [{ course_id: "c", thread_id: "t", created_at: nov(8) }];
  s.lessons = [{ course_id: "c", read_at: nov(8) }];
  s.notes = [{ course_id: "c", title: "My list", content: "uno dos", created_at: nov(9) }];
  s.learnerDays = [{ day: "2026-11-09", minutes: 20 }];
  return learningRecord(s, { kind: "month", year: 2026, month: 10 }, local(2026, 10, 20));
}

describe("record copy", () => {
  it("uses no banned word outside the disclaimers: not in the copy, the rules, or a built record", () => {
    const record = fixtureRecord();
    expect(record.mastered.length + record.withoutProof.length + record.hardOnes.length + record.ownWords.length).toBeGreaterThan(3);
    for (const text of [...strings(RECORD_COPY), ...strings(RECORD_RULES), ...strings(record)]) {
      expect(bannedWordsIn(text), text).toEqual([]);
    }
  });

  it("catches the banned words in any case and with endings, and the disclaimer is the only place they appear", () => {
    expect(bannedWordsIn("Officially accredited transcripts")).toEqual(["accredited", "official", "transcript"]);
    expect(bannedWordsIn("Above  grade level")).toEqual(["grade level", "above grade"]);
    expect(bannedWordsIn("Days with learning")).toEqual([]);
    expect(bannedWordsIn(RECORD_DISCLAIMER).length).toBeGreaterThan(0);
    expect(RECORD_DISCLAIMER_SHORT.length).toBeGreaterThan(0);
  });

  it("marks a model-written title that contains a banned word", () => {
    expect(appTitle("Grade level reading")).toBe("Grade level reading (title written by the app)");
    expect(appTitle("Fractions")).toBe("Fractions");
  });

  it("gives every tile and every pill a rule", () => {
    for (const key of Object.keys(RECORD_COPY.pills)) expect(RECORD_RULES.pills[key as keyof typeof RECORD_RULES.pills]).toBeTruthy();
    for (const key of Object.keys(RECORD_RULES.tiles)) expect(RECORD_COPY.tiles[key as keyof typeof RECORD_COPY.tiles]).toBeTruthy();
    for (const rule of [...strings(RECORD_RULES)]) expect(rule.trim().length).toBeGreaterThan(20);
  });

  it("has a pill for every status a skill can have", () => {
    const record = fixtureRecord();
    for (const c of record.courses) for (const k of c.skills) expect(RECORD_COPY.pills[k.status]).toBeTruthy();
    expect(Object.keys(RECORD_COPY.pills)).toEqual(expect.arrayContaining([...Object.keys(record.courses[0].counts), "review_again"]));
  });
});
