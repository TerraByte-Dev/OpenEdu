// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import QuestionRenderer from "./quiz/QuestionRenderer";
import testScreen from "../views/PromotionTestFullScreen.tsx?raw";
import quizScreen from "../views/QuizFullScreen.tsx?raw";

// The real QuestionRenderer on an answered question, as the level test (marksAtFinish) and the study quiz
// show it. A level test marks nothing before Finish, so "Stop the test" (no score, no wait) cannot be used
// after seeing a run go badly (level-test.ts STOP_TEST).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const base = {
  question_text: "Which animal builds a nest?", options: ["A) bird", "B) rock"], correct_answer: "A) bird",
  difficulty_level: 1, explanation: "Birds build nests.", subtopic_id: "1.1", matching_pairs: null, blank_position: null,
};

function show(question: Record<string, unknown>, marksAtFinish: boolean): string {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(QuestionRenderer, {
      question: { ...base, ...question } as Parameters<typeof QuestionRenderer>[0]["question"],
      onAnswer: () => {}, disabled: true, grade: null, marksAtFinish,
    }));
  });
  return host.textContent ?? "";
}

describe("an answered question in a level test", () => {
  it("shows a wrong choice as recorded, with no mark, key or explanation", () => {
    const text = show({ question_type: "multiple_choice", user_answer: "B) rock", is_correct: false }, true);
    expect(text).toContain("Answer recorded");
    expect(text).toContain("Your answer: B) rock");
    expect(text).toContain("It will be graded when you finish.");
    expect(text).not.toMatch(/Correct|Incorrect|✓|✗|Birds build nests/);
  });

  it("shows a right true/false the same way", () => {
    const text = show({ question_type: "true_false", options: null, correct_answer: "True", user_answer: "True", is_correct: true }, true);
    expect(text).toContain("Answer recorded");
    expect(text).not.toMatch(/Correct|✓/);
  });

  it("shows a matching answer as its pairs, unmarked", () => {
    const text = show({
      question_type: "drag_to_match", options: null, correct_answer: "", is_correct: false,
      matching_pairs: [{ left: "bird", right: "nest" }, { left: "bee", right: "hive" }],
      user_answer: JSON.stringify({ bird: "hive", bee: "nest" }),
    }, true);
    expect(text).toContain("Your answer: bird → hive, bee → nest");
    expect(text).not.toMatch(/✓|✗|matches/);
  });
});

describe("an answered question in a study quiz", () => {
  it("still shows the mark and the correct answer at once", () => {
    const text = show({ question_type: "multiple_choice", user_answer: "B) rock", is_correct: false }, false);
    expect(text).toContain("✗ Incorrect");
    expect(text).toContain("Correct answer: A) bird");
  });
});

describe("which screen holds the marks", () => {
  it("the level test passes marksAtFinish and the study quiz does not", () => {
    expect(testScreen.replace(/\r\n?/g, "\n")).toMatch(/<QuestionRenderer[^>]*\n\s+marksAtFinish\n\s+\/>/);
    expect(quizScreen).not.toContain("marksAtFinish");
  });
});
