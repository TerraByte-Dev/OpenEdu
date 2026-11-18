import { describe, it, expect } from "vitest";
import { speakableText, texWords, pickVoice, questionSpeech, resultSpeech, chatCardSpeech, unreadText, CODE_SPOKEN, DRAWING_SPOKEN, MATH_PLACEHOLDER, type VoiceLike } from "./speech";
import { confirmCardQuestion, CONFIRM_CHOICES } from "./plain-language";
import { repeatsQuestion } from "./kernel/askCard";
import type { Grade } from "./grade";
import { persistedReply } from "./kernel/persistedReply";

// speakableText is what ChatTab's speaker button and the K-2 auto-read hand to speechSynthesis
// (useReadAloud.ts), on the reply exactly as saved. Nothing a voice would read as a symbol may survive.
const NO_SYNTAX = /[\\$*_`#{}[\]|~]/;

describe("speakableText: markdown", () => {
  it("drops emphasis, headings and links, keeping the words", () => {
    const text = speakableText("## Adding fractions\nThis is **really** _important_. See [the notes](https://example.com).");
    expect(text).toBe("Adding fractions. This is really important. See the notes.");
  });

  it("reads each list item as its own sentence", () => {
    expect(speakableText("Steps:\n\n1. Find a common denominator\n2. Add the tops\n\n- done")).toBe(
      "Steps: Find a common denominator. Add the tops. done.",
    );
  });

  it("pauses at a line break inside a paragraph", () => {
    expect(speakableText("Step 1: add\nStep 2: carry")).toBe("Step 1: add. Step 2: carry.");
  });

  it("reads a code block as one word and inline code as its text", () => {
    const text = speakableText("Run this:\n\n```python\nprint('hi')\nx = {1: 2}\n```\n\nThen call `print` again.");
    expect(text).toBe(`Run this: ${CODE_SPOKEN}. Then call print again.`);
  });

  it("reads a ```mermaid fence as a drawing, since the chat draws it (gemma4:e2b reply d01, B9 run)", () => {
    const reply = "Here is the flowchart showing how an if/else statement works:\n\n```mermaid\ngraph TD;\n    A[Start] --> B{Condition?};\n    B -- Yes --> C[Execute the 'if' block];\n```\n\nThis flowchart shows the steps of an if/else statement.";
    expect(speakableText(reply)).toBe(`Here is the flowchart showing how an if/else statement works: ${DRAWING_SPOKEN}. This flowchart shows the steps of an if/else statement.`);
  });

  it("reads Mermaid written with no fence as a drawing too, not its source", () => {
    const reply = "Here is the plan:\n\nmermaid\ngraph TD;\n    A[Wake up] --> B[Eat breakfast];\n\nThen we go to school.";
    expect(speakableText(reply)).toBe(`Here is the plan: ${DRAWING_SPOKEN}. Then we go to school.`);
  });

  it("reads quotes and tables as plain sentences", () => {
    expect(speakableText("> Remember this.")).toBe("Remember this.");
    expect(speakableText("| a | b |\n|---|---|\n| 1 | 2 |")).toBe("a, b. 1, 2.");
  });

  it("drops emoji, html and rules", () => {
    expect(speakableText("Great job! 🎉🧩\n\n---\n\n<b>Next</b> one")).toBe("Great job! Next one.");
  });

  it("reads an interrupted reply's marker as words", () => {
    const saved = persistedReply("Fractions have two parts", "stalled")!;
    const text = speakableText(saved);
    expect(text).toMatch(/^Fractions have two parts\. the tutor stopped responding/);
    expect(text).not.toMatch(NO_SYNTAX);
  });

  it("leaves a price as a price", () => {
    expect(speakableText("It costs $5 and that one $10.")).toBe("It costs $5 and that one $10.");
  });

  it("is empty when there is nothing to say", () => {
    expect(speakableText("")).toBe("");
    expect(speakableText("---\n\n🎉")).toBe("");
  });
});

describe("speakableText: math", () => {
  it("reads inline and display math as words, never raw LaTeX", () => {
    const reply = [
      "The area is $A = \\pi r^2$, and the quadratic formula is:",
      "",
      "$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$",
      "",
      "Also \\(3 \\times 4 = 12\\) and \\[\\frac{1}{2}\\].",
    ].join("\n");
    const text = speakableText(reply);
    expect(text).not.toMatch(NO_SYNTAX);
    expect(text).toContain("A equals pi r squared");
    expect(text).toContain("x equals minus b plus or minus the square root of b squared minus 4ac over 2a");
    expect(text).toContain("3 times 4 equals 12");
    expect(text).toContain("1 over 2");
  });

  it("reads bare LaTeX the tutor forgot to fence", () => {
    expect(speakableText("So the answer is \\frac{3}{4} of the pizza.")).toBe("So the answer is 3 over 4 of the pizza.");
  });

  it("never lets a backslash through, whatever the reply holds", () => {
    for (const reply of [
      "A stray \\ backslash and \\unknown command",
      "$\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}$",
      "$\\weird{x}$ and $\\text{speed} = \\dfrac{d}{t}$",
    ]) {
      expect(speakableText(reply), reply).not.toMatch(/\\/);
    }
  });
});

describe("texWords", () => {
  it("reads common school math", () => {
    expect(texWords("x^2 + y^3")).toBe("x squared plus y cubed");
    expect(texWords("2^{10}")).toBe("2 to the power of 10");
    expect(texWords("\\sqrt[3]{27} = 3")).toBe("the cube root of 27 equals 3");
    expect(texWords("a_1 \\leq b")).toBe("a sub 1 is less than or equal to b");
    expect(texWords("90^\\circ")).toBe("90 degrees");
    expect(texWords("\\text{distance} = \\text{rate} \\cdot t")).toBe("distance equals rate times t");
    expect(texWords("\\theta \\neq \\Delta x")).toBe("theta is not equal to delta x");
    expect(texWords("50\\%")).toBe("50 percent");
    expect(texWords("\\left( \\frac{1}{2} \\right)")).toBe("1 over 2");
    expect(texWords("\\ce{2H2 + O2 -> 2H2O}")).toBe("2H2 plus O2 gives 2H2O");
  });

  it("reads a matrix or aligned block as a placeholder", () => {
    expect(texWords("\\begin{aligned} x &= 1 \\\\ y &= 2 \\end{aligned}")).toBe(MATH_PLACEHOLDER);
  });

  it("reads an unknown command as its name", () => {
    expect(texWords("\\sinh x")).toBe("sinh x");
  });
});

describe("pickVoice", () => {
  const v = (lang: string, localService: boolean, def = false, name = lang): VoiceLike & { name: string } => ({ lang, localService, default: def, name });

  it("picks an on-device voice in the UI language over an online one", () => {
    const voices = [v("en-US", false, true, "online"), v("en-US", true, false, "David"), v("en-GB", true, false, "Hazel")];
    expect(pickVoice(voices, "en-US")?.name).toBe("David");
  });

  it("falls back from the exact language to the same language, then to English", () => {
    expect(pickVoice([v("fr-FR", true), v("en-GB", true, false, "Hazel")], "en-US")?.name).toBe("Hazel");
    expect(pickVoice([v("fr-FR", true), v("en-US", true, false, "Zira")], "es-MX")?.name).toBe("Zira");
    expect(pickVoice([v("es-ES", true, false, "Helena"), v("en-US", true)], "es-MX")?.name).toBe("Helena");
  });

  it("prefers the system default within a rank", () => {
    expect(pickVoice([v("en-US", true, false, "David"), v("en-US", true, true, "Zira")], "en-US")?.name).toBe("Zira");
  });

  it("returns null when there is no on-device voice it can use", () => {
    expect(pickVoice([], "en-US")).toBeNull();
    expect(pickVoice([v("en-US", false)], "en-US")).toBeNull();
    expect(pickVoice([v("fr-FR", true)], "en-US")).toBeNull();
  });

  it("accepts underscores and odd case in language tags", () => {
    expect(pickVoice([v("EN_us", true, false, "x")], "en-US")?.name).toBe("x");
  });
});

// A quiz or level-test question's speaker button (components/ReadAloudButton.tsx) hands
// questionSpeech's markdown to useReadAloud, which reads speakableText of it, as here.
describe("questionSpeech: a quiz question read aloud", () => {
  const read = (q: Parameters<typeof questionSpeech>[0]) => speakableText(questionSpeech(q));

  it("reads a multiple-choice question and each choice, in the order shown", () => {
    expect(read({ question_type: "multiple_choice", question_text: "What is 2 + 3?", options: ["4", "5", "six"] }))
      .toBe("What is 2 + 3? The choices are: 4. 5. six.");
  });

  it("reads a choice that looks like markdown as the text shown, not as a list or heading", () => {
    expect(read({ question_type: "multiple_choice", question_text: "Pick one.", options: ["- 3", "1. one", "2) two", "+ 4", "# 5"] }))
      .toBe("Pick one. The choices are: - 3. 1. one. 2) two. + 4. 5.");
  });

  it("reads True and False as the choices of a true/false question", () => {
    expect(read({ question_type: "true_false", question_text: "The sun is a star." }))
      .toBe("The sun is a star. The choices are: True. False.");
  });

  it("reads a fill-in blank as the word blank, never underscores", () => {
    const text = read({ question_type: "fill_in_blank", question_text: "Fill in the blank.", blank_position: "A cat says ___." });
    expect(text).toBe("Fill in the blank. A cat says blank.");
    expect(text).not.toMatch(NO_SYNTAX);
  });

  it("reads the question once when the fill-in sentence is the question", () => {
    expect(read({ question_type: "fill_in_blank", question_text: "2 + 2 = ___", blank_position: "2 + 2 = ___" }))
      .toBe("2 + 2 = blank.");
  });

  it("reads only the question for written answers and matching, never the answer key", () => {
    const q = { question_type: "short_answer", question_text: "Why do leaves fall?", options: null, correct_answer: "autumn" };
    expect(read(q)).toBe("Why do leaves fall?");
    expect(read({ question_type: "drag_to_match", question_text: "Match each animal to its home." }))
      .toBe("Match each animal to its home.");
  });
});

// A results row's speaker button (QuizFullScreen and PromotionTestFullScreen results) hands resultSpeech's
// markdown to useReadAloud, which reads speakableText of it, as here.
describe("resultSpeech: a quiz or level-test results row read aloud", () => {
  const read = (q: Parameters<typeof resultSpeech>[0], grade: Grade | null = 1) => speakableText(resultSpeech(q, grade));

  it("reads a wrong answer's question, the answer, the key and the explanation", () => {
    expect(read({ question_text: "What is 2 + 3?", user_answer: "4", correct_answer: "5", explanation: "Two and three make five.", is_correct: false, graded_by: "key" }))
      .toBe("What is 2 + 3? Your answer: 4. Correct answer: 5. Two and three make five.");
  });

  it("reads a right answer without the answer and key, as the row hides them", () => {
    expect(read({ question_text: "What is 1 + 1?", user_answer: "2", correct_answer: "2", explanation: "One and one make two.", is_correct: true, graded_by: "key" }))
      .toBe("What is 1 + 1? One and one make two.");
  });

  it("reads a fill-in blank as the word blank", () => {
    expect(read({ question_text: "A cat says ___.", user_answer: "woof", correct_answer: "meow", is_correct: false, graded_by: "exact" }))
      .toBe("A cat says blank. Your answer: woof. Correct answer: meow.");
  });

  it("reads a wrong drag-to-match answer and its key as pairs, never JSON or the placeholder key", () => {
    const text = read({
      question_text: "Match each animal to its group.", question_type: "drag_to_match", correct_answer: "See matching_pairs",
      matching_pairs: [{ left: "Frog", right: "Amphibian" }, { left: "Dog", right: "Mammal" }],
      user_answer: JSON.stringify({ Dog: "Amphibian", Frog: "Mammal" }), is_correct: false, graded_by: "key",
    });
    expect(text).toBe("Match each animal to its group. Your answer: Frog goes with Mammal, Dog goes with Amphibian. Correct answer: Frog goes with Amphibian, Dog goes with Mammal.");
  });

  it("never reads out an answer that reads as a safety disclosure", () => {
    const text = read({ question_text: "Why do leaves fall?", user_answer: "i want to kill myself", correct_answer: "autumn", explanation: "Trees drop leaves.", is_correct: false, graded_by: "key" });
    expect(text).toBe("Why do leaves fall?");
    // Nor the rest of a row whose "why" text was one: the row shows the safety notice.
    expect(read({ question_text: "What is 2 + 3?", user_answer: "4", correct_answer: "5", explanation: "Two and three make five.", is_correct: false, graded_by: "key", self_explanation: "I want to kill myself" }))
      .toBe("What is 2 + 3?");
  });

  it("checks the answer with the learner's grade, as the row does (a pregnancy one only with a grade set)", () => {
    const q = { question_text: "What do plants need?", user_answer: "im scared im pregnant", correct_answer: "sunlight", is_correct: false, graded_by: "key" as const };
    expect(read(q, 1)).toBe("What do plants need?");
    expect(read(q, null)).toBe("What do plants need? Your answer: im scared im pregnant. Correct answer: sunlight.");
  });
});

// The chat's question card and Allow / Don't allow card (ChatTab): what their speaker buttons and the K-2
// auto-read hand to useReadAloud, which reads speakableText of it, as here. A card holds the turn open,
// so the reply above it is not saved or read yet; the auto-read says the text streamed before the card
// that was not read yet (unreadText), then the card.
describe("chatCardSpeech: a chat card read aloud", () => {
  const read = (lead: string, question: string, choices: string[]) => speakableText(chatCardSpeech(lead, question, choices));

  it("reads the text before the card, the question and each button, in the order shown", () => {
    expect(read("Nice work on the last one!", "Which is bigger, 1/2 or 1/3?", ["1/2", "1/3"]))
      .toBe("Nice work on the last one! Which is bigger, 1/2 or 1/3? The choices are: 1/2. 1/3.");
  });

  it("reads the question once when the text above already ends on it, as the card shows it", () => {
    const streamed = "Let's check.\n\nWhich is bigger, 1/2 or 1/3?";
    const question = "Which is bigger, 1/2 or 1/3?";
    const shown = repeatsQuestion(streamed, question) ? "" : question;
    expect(read(streamed, shown, ["1/2", "1/3"])).toBe("Let's check. Which is bigger, 1/2 or 1/3? The choices are: 1/2. 1/3.");
  });

  it("reads the Allow / Don't allow card with its two buttons", () => {
    expect(read("", [confirmCardQuestion("flashcard.create"), "Front: What is 2 + 2?"].join("\n\n"), [CONFIRM_CHOICES.yes, CONFIRM_CHOICES.no]))
      .toBe("Your tutor wants to make you a flashcard. Is that okay? Front: What is 2 + 2? The choices are: Yes, go ahead. No, not now.");
  });

  it("reads a button that looks like markdown as the text shown", () => {
    expect(read("", "Pick one.", ["- 3", "1. one"])).toBe("Pick one. The choices are: - 3. 1. one.");
  });
});

describe("unreadText: the saved reply reads on from where the cards left off", () => {
  it("is the rest of the reply after what was read with a card", () => {
    const spoken = "Let's check. Which is bigger, 1/2 or 1/3?";
    const saved = `${spoken}\n\n*You picked: 1/2*\n\nYes! One half is bigger.`;
    expect(speakableText(unreadText(saved, spoken))).toBe("You picked: 1/2. Yes! One half is bigger.");
  });

  it("is the whole reply when nothing was read with a card, or the saved reply changed after it streamed", () => {
    expect(unreadText("All of it.", "")).toBe("All of it.");
    expect(unreadText("Want me to draw it? Here.", "Here is a picture.")).toBe("Want me to draw it? Here.");
  });
});
