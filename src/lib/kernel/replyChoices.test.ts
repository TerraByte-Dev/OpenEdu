import { describe, it, expect } from "vitest";
import { choicesInReply } from "./replyChoices";

// The rules in replyChoices.ts, case by case. The first reply is the shape gemma4:e2b wrote in assess
// mode instead of calling ask_user.question; the rest are written for this test.

const labels = (text: string) => choicesInReply(text)?.choices.map((c) => c.label) ?? null;

describe("choicesInReply finds choices offered as a trailing list", () => {
  it("reads the assess reply: a numbered list after a question that asks for a pick", () => {
    const reply = [
      "I will check what you know. We are looking at multiplication, division, and fact families.",
      "",
      "Which topic would you like to start with?",
      "",
      "1. Multiplication as Equal Groups",
      "2. Multiplication Facts to 10",
      "3. Division as Sharing",
    ].join("\n");
    expect(choicesInReply(reply)).toEqual({
      question: "Which topic would you like to start with?",
      choices: [
        { label: "Multiplication as Equal Groups", value: "Multiplication as Equal Groups" },
        { label: "Multiplication Facts to 10", value: "Multiplication Facts to 10" },
        { label: "Division as Sharing", value: "Division as Sharing" },
      ],
    });
  });

  it("reads a lettered list under a pick question", () => {
    expect(labels("Try this one.\n\nWhich of these is 6 x 7?\nA) 36\nB) 42\nC) 48")).toEqual(["36", "42", "48"]);
    expect(labels("Pick a topic to practice:\n(a) Arrays\n(b) Fact families")).toBeNull(); // no question mark
    expect(labels("Which topic should we do?\n(a) Arrays\n(b) Fact families")).toEqual(["Arrays", "Fact families"]);
  });

  it("reads a numbered list's pick question when it comes after the list", () => {
    expect(labels("Here are two things we could do.\n\n1. Arrays\n2. Fact families\n\nWhich one do you want to practice?"))
      .toEqual(["Arrays", "Fact families"]);
  });

  it("drops markdown emphasis from labels and question, and allows a loose list and CRLF", () => {
    const reply = "**Which would you like to try first?**\r\n\r\n**1.** **Arrays**\r\n\r\n**2.** *Fact families*\r\n";
    expect(choicesInReply(reply)).toEqual({
      question: "Which would you like to try first?",
      choices: [{ label: "Arrays", value: "Arrays" }, { label: "Fact families", value: "Fact families" }],
    });
  });
});

describe("choicesInReply leaves other lists alone (fails closed)", () => {
  it("gives no buttons for the lists that are not choices", () => {
    for (const reply of [
      "Do you want to know how to find the area?\n1. Measure the length\n2. Measure the width\n3. Multiply them",
      "Want to try these on your own?\n1. 3 x 4\n2. 5 x 6\n3. 7 x 8",
      "Would you like to try some?\n1. 4 + 5 = __\n2. 6 + 2 = __",
      "Here are some nouns:\na. dog\nb. cat\n\nCan you think of another one?",
      "What do you notice about these?\na) 2 x 3 = 6\nb) 3 x 2 = 6",
      "Can you put these in order from smallest to largest?\nA) 7\nB) 3\nC) 5",
      "Which two of these are even numbers?\nA) 2\nB) 3\nC) 4",
      "Which fraction is bigger?\nA) $\\frac{3}{4}$\nB) $\\frac{2}{3}$",
    ]) {
      expect(choicesInReply(reply), reply).toBeNull();
    }
  });

  it("needs which, choose or pick in the question, and none of the words that ask for something else", () => {
    expect(labels("How do we find the area?\n1. Measure the length\n2. Measure the width\n3. Multiply them")).toBeNull();
    expect(labels("Would you like to practice?\n1. Arrays\n2. Fact families")).toBeNull();
    expect(labels("What is 6 x 7?\nA) 36\nB) 42\nC) 48")).toBeNull();
    for (const q of ["Which ones are all even?", "Which of each pair is bigger?", "Which is right, and why?", "Which would you explain first?", "Which do you notice first?", "Which both work?", "Which three of these are odd?"]) {
      expect(labels(`${q}\n1. Arrays\n2. Fact families`), q).toBeNull();
    }
  });

  it("rejects labels with LaTeX, a backslash, a blank or a trailing =", () => {
    expect(labels("Which one?\n1. \\pi\n2. 3.14")).toBeNull();
    expect(labels("Which one?\n1. 4 + 5 = __\n2. 9")).toBeNull();
    expect(labels("Which one?\n1. __ + 5 = 9\n2. 4 + __ = 9")).toBeNull();
    expect(labels("Which one?\n1. 4 + 5 =\n2. 9")).toBeNull();
    expect(labels("Which one?\n1. $x$\n2. y")).toBeNull();
  });

  it("needs a lettered list's question before it", () => {
    expect(labels("A) Arrays\nB) Fact families\n\nWhich one do you want to practice?")).toBeNull();
  });

  it("needs a question next to the list", () => {
    expect(labels("Here are the parts we covered:\n1. Arrays\n2. Fact families")).toBeNull();
    expect(labels("1. Arrays\n2. Fact families")).toBeNull();
    expect(labels("Here are the parts we covered:\nA) Arrays\nB) Fact families")).toBeNull();
  });

  it("needs the list to end the reply", () => {
    expect(labels("Which would you like?\n1. Arrays\n2. Fact families\n\nBoth are useful for division later on.")).toBeNull();
  });

  it("needs 2 to 5 items in order, one marker style", () => {
    expect(labels("Which would you like?\n1. Arrays")).toBeNull();
    expect(labels("Which would you like?\n1. a\n2. b\n3. c\n4. d\n5. e\n6. f")).toBeNull();
    expect(labels("Which would you like?\n1. Arrays\n3. Fact families")).toBeNull();
    expect(labels("Which would you like?\n2. Arrays\n3. Fact families")).toBeNull();
    expect(labels("Which would you like?\n1. Arrays\nB. Fact families")).toBeNull();
  });

  it("ignores items that are questions, sentences, long, or repeated", () => {
    expect(labels("Which can you answer?\n1. What is 6 x 7?\n2. What is 8 x 3?")).toBeNull();
    expect(labels("Which do you want?\n1. Arrays. They show rows\n2. Fact families")).toBeNull();
    expect(labels("Which do you want?\n1. Arrays\n2. A much longer way of working through every single fact family we met in this level")).toBeNull();
    expect(labels("Which do you want?\n1. Arrays\n2. arrays")).toBeNull();
  });

  it("ignores choices written inline, and empty text", () => {
    expect(labels("Would you like to practice facts to 10, or would you like to check arrays first?")).toBeNull();
    expect(labels("")).toBeNull();
    expect(labels("\n\n")).toBeNull();
  });
});
