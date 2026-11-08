import { describe, it, expect } from "vitest";
import { suggestFollowUps, endsWithQuestion, hasTriedOpenQuestion, offersShowAnswer, showAnswerOfferedAfter, SHOW_ANSWER_MESSAGE, type SuggestionInput } from "./suggestions";
import { persistedReply } from "./persistedReply";
import type { GroundingHit } from "./ground";
import type { Syllabus } from "../../types";

const ANSWER = "Stoichiometry is the bookkeeping of a reaction. The balanced equation gives you the ratio of moles, and every calculation follows from it.";

const hit = (over: Partial<GroundingHit> = {}): GroundingHit => ({
  source: "note",
  title: "Chemistry — Moles",
  text: "A mole is 6.02e23 particles.",
  score: 0.8,
  ref: "doc-1",
  ...over,
});

const syllabus = (subtopics: Array<{ title: string; mastered: boolean }>): Syllabus => ({
  id: "s1",
  course_id: "c1",
  level: 1,
  title: "Level 1",
  description: "",
  learning_objectives: [],
  subtopics: subtopics.map((s, i) => ({ id: `1.${i + 1}`, title: s.title, key_concepts: [], practice_type: "", mastered: s.mastered })),
  assessment_criteria: [],
  estimated_hours: 1,
  generated_at: "",
});

const input = (over: Partial<SuggestionInput> = {}): SuggestionInput => ({
  answer: ANSWER,
  syllabus: null,
  hits: [],
  usedHits: [],
  ...over,
});

describe("endsWithQuestion", () => {
  it("detects a trailing question through markdown and closing punctuation", () => {
    expect(endsWithQuestion("What do you think?")).toBe(true);
    expect(endsWithQuestion("**Is it balanced?**")).toBe(true);
    expect(endsWithQuestion("Try it. (Which one?)")).toBe(true);
    expect(endsWithQuestion("That's the ratio.")).toBe(false);
    expect(endsWithQuestion("")).toBe(false);
  });
});

describe("suggestFollowUps", () => {
  it("never offers more than three", () => {
    const out = suggestFollowUps(input({
      hits: [hit(), hit({ ref: "doc-2", title: "Other" })],
      syllabus: syllabus([{ title: "Limiting reagents", mastered: false }]),
      dueFlashcards: 5,
    }));
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it("offers ways to answer, not new questions, when the tutor asked one", () => {
    const out = suggestFollowUps(input({ answer: `${ANSWER} What do you think the balanced equation is?` }));
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.label)).toEqual(["Give me a hint", "Walk me through it"]);
  });

  // The highest-value chip: they wrote the note, so they half-remember it, and "what did I say about
  // X" is something people actually ask.
  it("surfaces a retrieved note the answer did not use", () => {
    const unused = hit({ ref: "doc-9", title: "Chemistry — Limiting Reagents" });
    const out = suggestFollowUps(input({ hits: [unused], usedHits: [] }));
    expect(out[0].message).toContain("Chemistry — Limiting Reagents");
  });

  it("does not offer a note the answer already drew on", () => {
    const used = hit();
    const out = suggestFollowUps(input({ hits: [used], usedHits: [used] }));
    expect(out.some((s) => s.message.includes(used.title))).toBe(false);
  });

  it("offers more of a reference it actually cited", () => {
    const ref = hit({ source: "library", ref: "lib:pt", title: "Periodic Table" });
    const out = suggestFollowUps(input({ hits: [ref], usedHits: [ref] }));
    expect(out.some((s) => s.message.includes("Periodic Table"))).toBe(true);
  });

  it("offers the next unmastered subtopic and skips mastered ones", () => {
    const out = suggestFollowUps(input({
      syllabus: syllabus([
        { title: "Balancing equations", mastered: true },
        { title: "Limiting reagents", mastered: false },
      ]),
    }));
    expect(out.some((s) => s.message.includes("Limiting reagents"))).toBe(true);
    expect(out.some((s) => s.message.includes("Balancing equations"))).toBe(false);
  });

  it("mentions due flashcards only when some are due", () => {
    expect(suggestFollowUps(input({ dueFlashcards: 3 })).some((s) => s.label === "Review due cards")).toBe(true);
    expect(suggestFollowUps(input({ dueFlashcards: 0 })).some((s) => s.label === "Review due cards")).toBe(false);
  });

  it("always has something useful to fall back on", () => {
    const out = suggestFollowUps(input());
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((s) => s.label === "Worked example")).toBe(true);
  });

  it("stays silent when the student abandoned the turn, or there is nothing to follow up on", () => {
    expect(suggestFollowUps(input({ abandoned: true }))).toEqual([]);
    expect(suggestFollowUps(input({ answer: "Yes." }))).toEqual([]);
  });

  // The bug this pins: "abandoned" and "truncated" were one flag, so every length-capped reply
  // suppressed its own chips — the turns most in need of an obvious next action offered none.
  it("still suggests after a truncated reply, led by Continue", () => {
    const out = suggestFollowUps(input({ truncated: true }));
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].label).toBe("Continue");
  });

  it("keeps Continue even when the fragment ends on a question", () => {
    const out = suggestFollowUps(input({ truncated: true, answer: `${ANSWER} So what is the ratio?` }));
    expect(out.map((s) => s.label)).toContain("Continue");
    expect(out.map((s) => s.label)).toContain("Give me a hint");
  });

  it("keeps labels short enough to sit in one row", () => {
    const out = suggestFollowUps(input({
      hits: [hit({ ref: "doc-9", title: "A Really Very Extremely Long Note Title That Would Wrap" })],
    }));
    for (const s of out) expect(s.label.length).toBeLessThanOrEqual(30);
  });

  // The mode bar was deleted; these chips are what replaced it. If context always wins all three
  // slots, socratic and quiz become unreachable and the bar was removed rather than replaced.
  it("always leaves room for at least one mode chip", () => {
    const out = suggestFollowUps(input({
      hits: [hit({ ref: "d1", title: "Moles" }), hit({ ref: "d2", title: "Ratios" })],
      syllabus: syllabus([{ title: "Limiting reagents", mastered: false }]),
      dueFlashcards: 4,
    }));
    expect(out).toHaveLength(3);
    expect(out.some((s) => s.mode === "socratic" || s.mode === "quiz" || s.label === "Worked example")).toBe(true);
  });

  it("carries the teaching mode on the chips that need one", () => {
    const asked = suggestFollowUps(input({ answer: `${ANSWER} What do you think?` }));
    expect(asked.find((s) => s.label === "Give me a hint")?.mode).toBe("hint");

    const plain = suggestFollowUps(input());
    expect(plain.find((s) => s.label === "Make me figure it out")?.mode).toBe("socratic");
    expect(plain.find((s) => s.label === "Quiz me on this")?.mode).toBe("quiz");
    // "explain" is the neutral default, so a chip that wants it carries no mode at all.
    expect(plain.find((s) => s.label === "Worked example")?.mode).toBeUndefined();
  });

  // The messages were padded once ("I don't know how to start. Can you walk me through it?") and the
  // padding turned out to be semantically active: it announced confusion and instructed a restart, so
  // the tutor circled back over ground already covered. Terse is the feature, not a style preference.
  it("keeps messages short and imperative", () => {
    const everyMessage = [
      ...suggestFollowUps(input()),
      ...suggestFollowUps(input({ truncated: true })),
      ...suggestFollowUps(input({ answer: `${ANSWER} What do you think?` })),
      ...suggestFollowUps(input({ dueFlashcards: 2 })),
      ...suggestFollowUps(input({ hits: [hit({ ref: "d9", title: "Moles" })] })),
      ...suggestFollowUps(input({ syllabus: syllabus([{ title: "Limiting reagents", mastered: false }]) })),
    ];
    expect(everyMessage.length).toBeGreaterThan(5);
    for (const s of everyMessage) {
      expect(s.message.split(/\s+/).length, s.message).toBeLessThanOrEqual(8);
      // No self-reported confusion — that is what invited reassurance instead of progress.
      expect(s.message, s.message).not.toMatch(/i'?m not sure|i don'?t know|i'?m confused|not really/i);
      // No politeness scaffolding wrapping the actual request.
      expect(s.message, s.message).not.toMatch(/^(can you|could you|please|would you)/i);
    }
  });

  it("labels are a truthful preview of what gets sent", () => {
    // Tapping "Give me a hint" should send "Give me a hint" — not a paragraph never shown.
    for (const s of suggestFollowUps(input({ answer: `${ANSWER} What do you think?` }))) {
      expect(s.message.toLowerCase(), s.label).toContain(s.label.toLowerCase().replace(/[^a-z ]/g, ""));
    }
  });

  it("never emits duplicate messages", () => {
    const out = suggestFollowUps(input({
      hits: [hit({ ref: "doc-9", title: "Moles" })],
      syllabus: syllabus([{ title: "Moles", mastered: false }]),
    }));
    expect(new Set(out.map((s) => s.message)).size).toBe(out.length);
  });
});

describe("attempt-gated answer chip", () => {
  const ASKED = "Start with the ones digits. What do you get when you add 7 and 8?";

  const tutor = (content: string) => ({ role: "assistant", content });
  const student = (content: string) => ({ role: "user", content });

  it("counts a reply to the tutor's question as a try", () => {
    expect(hasTriedOpenQuestion([student("What is 47 + 38?"), tutor(ASKED), student("Is it 75?")])).toBe(true);
    expect(hasTriedOpenQuestion([tutor(ASKED), student("15")])).toBe(true);
  });

  it("does not count requests, prefills, or a reply to a statement", () => {
    for (const msg of ["Give me a hint.", "Give me a hint please", "Walk me through it.", "Help me with Decimals.",
      "Explain carrying.", "I don't know", "idk", "   "]) {
      expect(hasTriedOpenQuestion([tutor(ASKED), student(msg)]), msg).toBe(false);
    }
    expect(hasTriedOpenQuestion([tutor("The heart has four chambers."), student("ok")])).toBe(false);
    expect(hasTriedOpenQuestion([student("What is 47 + 38?")])).toBe(false);
  });

  it("does not count a newly typed problem as a try at the tutor's open question", () => {
    // Made-up problems, typed without options (turnKind.ts). Before this rule they counted as a try
    // whenever the tutor's reply before them ended on a question, so the chip was offered for them.
    for (const posed of ["What is 36 × 7?", "Solve 3x - 4 = 11", "A box holds 12 eggs. How many eggs are in 5 boxes?", "48 ÷ 6 = ?"]) {
      expect(hasTriedOpenQuestion([tutor(ASKED), student(posed)]), posed).toBe(false);
      expect(hasTriedOpenQuestion([tutor(ASKED), student("15"), tutor("Not quite. What do 7 and 8 make?"), student(posed)]), posed).toBe(false);
      // A hint asked on the new problem does not reach back past it to the old try.
      expect(hasTriedOpenQuestion([tutor(ASKED), student("15"), tutor("Close. What next?"), student(posed), tutor("What is the first step?"), student("Give me a hint.")]), posed).toBe(false);
      // The student's first answer to the new problem is a try, as before.
      expect(hasTriedOpenQuestion([tutor(ASKED), student(posed), tutor("What is the first step?"), student("252")]), posed).toBe(true);
      // So the chip is not offered under the tutor's reply to the new problem.
      expect(showAnswerOfferedAfter([tutor(ASKED), student("15"), tutor("Not quite. What do 7 and 8 make?"), student(posed), tutor("Good one to try. Where would you start on this problem?")]), posed).toBe(false);
    }
  });

  it("still counts a typed answer as a try, even when it is written as working", () => {
    // A try that shows its working ("7 + 8 = 15"), states a solution ("x = 5") or asks back with a
    // number ("Is it 15?") is not a new problem, so it keeps the old rule.
    for (const tryText of ["7 + 8 = 15", "x = 5", "Is it 15?", "I think it's 15", "15?", "15, because 7 + 8 makes 15"]) {
      expect(hasTriedOpenQuestion([tutor(ASKED), student(tryText)]), tryText).toBe(true);
    }
    // A lookup the student asks is not a new problem either, so it keeps the old rule too.
    expect(hasTriedOpenQuestion([tutor(ASKED), student("What is a ones digit?")])).toBe(true);
  });

  it("does not count a newly posed problem with options as a try at the tutor's open question", () => {
    // Made-up problem. Before this rule, the chip was offered right after a NEW question, because
    // the tutor's reply before it had ended on a question.
    const posed = "A bag has 9 apples and 4 are eaten. How many are left?\nA) 13\nB) 5\nC) 4\nD) 36\nWhich one is right?";
    expect(hasTriedOpenQuestion([tutor(ASKED), student(posed)])).toBe(false);
    expect(hasTriedOpenQuestion([tutor(ASKED), student("15"), tutor("Not quite. What do 7 and 8 make?"), student(posed)])).toBe(false);
    // A hint asked on the new problem does not reach back past it to the old try.
    expect(hasTriedOpenQuestion([tutor(ASKED), student("15"), tutor("Close. What next?"), student(posed), tutor("What happens when apples are eaten?"), student("Give me a hint.")])).toBe(false);
    // The student's first answer to the new problem is a try, as before.
    expect(hasTriedOpenQuestion([tutor(ASKED), student(posed), tutor("What happens when apples are eaten?"), student("I think it's A.")])).toBe(true);
    // A problem posed together with the student's own pick is not a new open question, so the old rule applies.
    expect(hasTriedOpenQuestion([tutor(ASKED), student(`${posed}\nI think it's B.`)])).toBe(true);
    // So the chip is not offered under the tutor's reply to the new problem.
    const history = [tutor(ASKED), student("15"), tutor("Not quite. What do 7 and 8 make?"), student(posed), tutor("Start with the 9 apples. What happens when some are eaten?")];
    expect(showAnswerOfferedAfter(history)).toBe(false);
  });

  it("keeps a try through a hint request, so a hint does not take the answer away", () => {
    expect(hasTriedOpenQuestion([
      tutor(ASKED), student("75"), tutor("Not quite. What do 7 and 8 make?"), student("Give me a hint."),
    ])).toBe(true);
  });

  it("closes the question once the answer was shown or the tutor stopped asking", () => {
    expect(hasTriedOpenQuestion([
      tutor(ASKED), student("75"), tutor("Not quite. What do 7 and 8 make?"),
      student("Show me the full worked answer."),
    ])).toBe(false);
    expect(hasTriedOpenQuestion([
      tutor(ASKED), student("75"), tutor("The answer is 85."), student("Give me a hint."),
    ])).toBe(false);
  });

  it("offers the answer first, but only after a try", () => {
    expect(suggestFollowUps(input({ answer: ASKED })).map((s) => s.label)).not.toContain("Show me the answer");
    const after = suggestFollowUps(input({ answer: ASKED, studentAttempted: true }));
    expect(after.map((s) => s.label)).toEqual(["Show me the answer", "Give me a hint", "Walk me through it"]);
    expect(after[0].message).toBe("Show me the full worked answer.");
    expect(after[0].mode).toBeUndefined(); // explain, never socratic or hint
  });

  it("does not offer the answer when the tutor did not ask anything", () => {
    expect(suggestFollowUps(input({ studentAttempted: true })).map((s) => s.label)).not.toContain("Show me the answer");
  });

  it("keeps Continue ahead of everything on a cut-off reply", () => {
    const out = suggestFollowUps(input({ answer: ASKED, studentAttempted: true, truncated: true }));
    expect(out.map((s) => s.label)).toEqual(["Continue", "Show me the answer", "Give me a hint"]);
  });
});

// The kernel decides the worked-answer turn from the saved conversation (showAnswerOfferedAfter).
// It must say "offered" exactly when ChatTab's chips held "Show me the answer" for that reply.
describe("showAnswerOfferedAfter == the chip ChatTab built", () => {
  const tutor = (content: string) => ({ role: "assistant", content });
  const student = (content: string) => ({ role: "user", content });
  const replies = ["Not quite. What do you get when you add 7 and 8 together?", "Not quite. 7 and 8 make 15, so the answer is 85.", "What is 7 + 8?", "   ", "Not quite. What do you get when you add 7 and 8 together? It is"];
  const befores = [
    [student("What is 47 + 38?")],
    [student("What is 47 + 38?"), tutor("Start with the ones digits. What do you get when you add 7 and 8?"), student("75")],
    [student("What is 47 + 38?"), tutor("Start with the ones digits. Add 7 and 8."), student("75")],
    [tutor("Start with the ones digits. What do you get when you add 7 and 8?"), student("75"), tutor("Not quite. What do 7 and 8 make?"), student("Give me a hint.")],
    [tutor("Start with the ones digits. What do you get when you add 7 and 8?"), student(SHOW_ANSWER_MESSAGE)],
  ];

  it("agrees with suggestFollowUps on every reply, history and stop reason", () => {
    let offered = 0;
    for (const before of befores) for (const text of replies) for (const stopReason of ["complete", "length", "stalled", "aborted", "max_iterations"]) {
      // What ChatTab does: studentAttempted at send, chips from the raw reply, the reply saved by persistedReply.
      const chip = suggestFollowUps(input({
        answer: text,
        abandoned: stopReason === "aborted" || stopReason === "stalled",
        truncated: stopReason === "length",
        studentAttempted: hasTriedOpenQuestion(before),
      })).some((s) => s.message === SHOW_ANSWER_MESSAGE);
      const saved = persistedReply(text, stopReason);
      const history = saved === null ? before : [...before, tutor(saved)];
      expect(showAnswerOfferedAfter(history), JSON.stringify({ before, text, stopReason })).toBe(chip);
      if (chip) offered++;
    }
    expect(offered).toBeGreaterThan(0);
  });

  it("is false when the conversation does not end with a tutor reply", () => {
    expect(showAnswerOfferedAfter([])).toBe(false);
    expect(showAnswerOfferedAfter([student("75")])).toBe(false);
  });

  it("offersShowAnswer is the chip's rule", () => {
    const asked = "Not quite. What do you get when you add 7 and 8 together?";
    expect(offersShowAnswer({ answer: asked, studentAttempted: true })).toBe(true);
    expect(offersShowAnswer({ answer: asked, studentAttempted: false })).toBe(false);
    expect(offersShowAnswer({ answer: asked, studentAttempted: true, abandoned: true })).toBe(false);
    expect(offersShowAnswer({ answer: "What is 7 + 8?", studentAttempted: true })).toBe(false);
  });
});

describe("assess chip is reachable (#146)", () => {
  const all = syllabus([{ title: "Moles", mastered: true }, { title: "Balancing equations", mastered: true }]);

  it("leads the mode chips once every subtopic at the level is mastered", () => {
    const out = suggestFollowUps(input({ syllabus: all }));
    expect(out[0]).toMatchObject({ label: "Check if I've got this", mode: "assess" });
  });

  it("survives a turn with full context", () => {
    const out = suggestFollowUps(input({
      syllabus: all,
      hits: [hit(), hit({ source: "library", title: "Mole concept", ref: "lib-1" })],
      usedHits: [hit({ source: "library", title: "Mole concept", ref: "lib-1" })],
      dueFlashcards: 3,
    }));
    expect(out.map((s) => s.mode)).toContain("assess");
  });

  it("is not offered while subtopics remain, or with no syllabus", () => {
    const partial = syllabus([{ title: "Moles", mastered: true }, { title: "Balancing equations", mastered: false }]);
    expect(suggestFollowUps(input({ syllabus: partial })).map((s) => s.mode)).not.toContain("assess");
    expect(suggestFollowUps(input()).map((s) => s.mode)).not.toContain("assess");
  });
});
