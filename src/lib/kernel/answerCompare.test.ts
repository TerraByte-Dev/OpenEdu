import { describe, it, expect } from "vitest";
import { compareToKey, numbersIn, optionsIn, bareAnswer, unitAfter } from "./answerCompare";

// The code half of the assess-mode answer check (answerCheck.ts calls compareToKey on the student's
// message and on the grader's copy of their answer). Both directions matter equally: "mismatch" on a
// right answer tells a child they are wrong when they are right. Answers here are made up.

const Q = "What is 6 x 8?";

describe("numbers in an answer", () => {
  it("reads digits and number words", () => {
    expect(numbersIn("seventy-two").map((n) => n.value)).toEqual([72]);
    expect(numbersIn("one hundred and five apples").map((n) => n.value)).toEqual([105]);
    expect(numbersIn("negative six").map((n) => n.value)).toEqual([-6]);
    expect(numbersIn("1,250 and 3.75 and -4").map((n) => n.value)).toEqual([1250, 3.75, -4]);
    expect(numbersIn("twelve thousand three hundred").map((n) => n.value)).toEqual([12300]);
  });

  it("does not read a subtraction as a negative number", () => {
    expect(numbersIn("9-4 = 5").map((n) => n.value)).toEqual([9, 4, 5]);
    expect(numbersIn("1 - 5 = -4").map((n) => n.value)).toEqual([1, 5, -4]);
  });

  it("takes cue words off an answer", () => {
    for (const t of ["48", "it's 48", "Is it 48?", "I think it's 48.", "the answer is 48.", "um, 48", "x = 48", "My answer is 48"]) expect(bareAnswer(t), t).toBe("48");
    expect(bareAnswer("B) dolphin")).toBe("B) dolphin");
  });

  // TerraTutor take-back 2026-11-20-1623, item 4 (and 1802's note; ported from TerraTutor #277):
  // a mark straight after a number is part of the answer.
  it("keeps a feet, inch or factorial mark after a number, and takes quotes around the answer off", () => {
    for (const [t, bare] of [
      ["5'", "5'"], ["5\"", "5\""], ["5′", "5'"], ["5″", "5\""], ["5'6\"", "5'6\""], ["5!", "5!"], ["the answer is 48!", "48!"],
      ["5'.", "5'"], ["\"4'\"", "4'"], ["'cat'", "cat"], ["\"cat\"", "cat"], ["'5'", "5"], ["it's \"5\".", "5"], ["Paris!", "Paris"],
      ["48 !", "48"], ["is it 48?!", "48"], ["I said \"it is 48\"", "I said \"it is 48"],
      ["the door's 5'", "the door's 5'"], ["I'm sure it's 5'", "I'm sure it's 5'"], ["5''", "5\""],
      ["'cause it's 5'", "cause it's 5'"], ["'tis 5'", "tis 5'"], ["'twas 5'", "twas 5'"],
    ]) expect(bareAnswer(t), t).toBe(bare);
  });

  it("reads units after a number", () => {
    expect(unitAfter("48 cm", 2)).toBe("centimeter");
    expect(unitAfter("48 centimetres", 2)).toBe("centimeter");
    expect(unitAfter("27 cubic centimeters", 2)).toBe("cubic centimeter");
    expect(unitAfter("27 cm³", 2)).toBe("cubic centimeter");
    expect(unitAfter("9 sq cm", 1)).toBe("square centimeter");
    expect(unitAfter("72 because", 2)).toBeNull();
  });
});

describe("a right answer is a match, in any plain form", () => {
  it.each([
    "48", "forty-eight", "Forty eight", "it's 48", "Is it 48?", "I think it's 48.", "  48  ",
    "6 x 8 = 48", "6 x 8 is 48", "48 cm",
  ])("%j against 48", (answer) => {
    expect(compareToKey("48", answer, { question: Q })).toBe("match");
  });

  it.each([
    ["48 cm", "48 cm"], ["48 cm", "48 centimeters"], ["48 cm", "48"], ["31.4 cm", "31.4"], ["0.5", "0.5"],
    ["-2", "negative two"], ["-2", "-2"], ["-5", "negative 5"], ["-5", "minus 5"], ["negative 5", "-5"], ["300", "three hundred"],
    ["5'", "5'"], ["5'", "5′"], ["5\"", "5″"], ["5!", "5!"], ["5", "'5'"], ["cat", "'cat'"], ["Paris", "Paris!"],
    ["5\"", "5''"], ["1990s", "the 1990's"], ["4", "the 4's"],
  ])(
    "key %j, answer %j", (key, answer) => { expect(compareToKey(key, answer)).toBe("match"); },
  );

  it("words that are the key, once cue words and articles are off", () => {
    expect(compareToKey("carbon dioxide", "Carbon dioxide.")).toBe("match");
    expect(compareToKey("the nucleus", "I think it's the nucleus")).toBe("match");
  });

  it("yes and no", () => {
    expect(compareToKey("yes", "Yes!")).toBe("match");
    expect(compareToKey("false", "false")).toBe("match");
  });
});

describe("a wrong answer is a mismatch only when plain numbers settle it", () => {
  // A lone value is compared as it is, even when the question holds it: "8" is a wrong answer to 6 x 8.
  it.each(["46", "forty-six", "it's 46", "I think it's 46?", "6 x 8 is 46", "6 x 8 is 46 because 6 x 7 is 42", "46 cm", "about 50", "8"])(
    "%j against 48", (answer) => { expect(compareToKey("48", answer, { question: Q })).toBe("mismatch"); },
  );

  it("a sign is read in words too", () => {
    expect(compareToKey("negative 5", "5")).toBe("mismatch");
    // "minus" after a number is the operation.
    expect(numbersIn("10 minus 5").map((n) => n.value)).toEqual([10, 5]);
    expect(numbersIn("minus five").map((n) => n.value)).toEqual([-5]);
  });

  it("yes against no, and another lettered option", () => {
    expect(compareToKey("yes", "no")).toBe("mismatch");
    const options = optionsIn("Which is a mammal?\nA) shark\nB) dolphin\nC) trout");
    expect(compareToKey("B) dolphin", "C", { options })).toBe("mismatch");
    expect(compareToKey("B", "b", { options })).toBe("match");
    expect(compareToKey("B) dolphin", "dolphin", { options })).toBe("match");
  });
});

describe("anything in doubt is undecided, never a mismatch", () => {
  it.each([
    ["48", "6 x 8", "only numbers the question holds"],
    ["48", "6 or 8", "only numbers the question holds, as a choice"],
    ["31.4", "31", "a rounding of the key"],
    ["31.4", "about 31.42", "a closer value that rounds to the key"],
    ["0.5", "1/2", "a fraction"],
    ["0.5", "half", "a word for a part"],
    ["50%", "0.5", "a percent"],
    ["2:30", "two thirty", "a time"],
    ["$1.50", "150 cents", "money"],
    ["48 cm", "0.48 m", "another unit"],
    ["27 cubic centimeters", "27 square centimeters", "another unit, same number"],
    ["48", "48 or 49", "the key among others"],
    ["72", "is it 63 or 72?", "a guess between two, the key last"],
    ["63", "It's 72, not 63", "the key named as what it is not"],
    ["46", "It's not 46", "a not in front of the key"],
    ["72", "62 and 72", "an answer to two questions"],
    ["48", "I got 48 because 6 x 4 is 24 and double that is 48", "working on the way to the key"],
    ["2x", "2", "an algebra key"],
    ["3 n", "3", "an algebra key, spaced"],
    ["2", "2x", "an algebra answer"],
    ["300", "3 hundred", "digits and a scale word"],
    ["50", "5 tens", "place value"],
    ["2000", "2 thousand", "digits and a scale word"],
    ["more than 5", "7", "a comparison key"],
    ["about 30", "28", "an estimate key"],
    ["1000", "1 000", "thousands grouped with a space"],
    ["1000", "1.000", "thousands grouped with a dot"],
    ["63", "6-9", "a range"],
    ["9", "3^2", "a power"],
    ["carbon dioxide", "CO2", "other words"],
    ["3 boxes, 2 left over", "3 boxes", "a key with two parts"],
    // TerraTutor take-back 2026-11-20-1623, item 4 (ported from TerraTutor #277):
    // a mark after the number is another answer, or an excited one.
    ["5\"", "5'", "inches against feet"],
    ["5'", "5\"", "feet against inches"],
    ["5'", "5", "feet against a bare number"],
    ["5", "5'", "a bare number key against feet"],
    ["5", "the door's 5'", "feet after a word's apostrophe"],
    ["5", "5''", "inches typed as two apostrophes"],
    ["5", "5!", "a factorial, or an excited 5"],
    ["48", "48!", "a factorial, or an excited 48"],
    ["5!", "5", "a factorial key against a bare number"],
    ["5!", "120", "a factorial key against its value"],
    // Take-back 2026-11-20-2014 (this repo's port of TerraTutor #277; TerraTutor b46fa67c): an apostrophe that starts an elided word is no quote, so the
    // feet mark after the number stays.
    ["5", "'cause it's 5'", "feet after an elided word"],
    ["5 inches", "'cause it's 5'", "feet after an elided word, against inches"],
    ["5", "'tis 5'", "feet after an elided word, \"'tis\""],
    ["", "48", "no key"],
  ])("key %j, answer %j: %s", (key, answer) => {
    expect(compareToKey(key, answer, { question: Q })).toBe("undecided");
  });

  it("a lone \"one\" is not read as the number", () => {
    expect(compareToKey("1", "the one on the left")).toBe("undecided");
    expect(compareToKey("1", "one")).toBe("match");
  });
});

describe("options in the tutor's message", () => {
  it("reads options on their own lines and in one line", () => {
    expect([...optionsIn("Pick one:\nA) 12\nB) 14\nC) 16")]).toEqual([["A", "12"], ["B", "14"], ["C", "16"]]);
    expect([...optionsIn("Which is bigger? A) 3/4 B) 2/3 C) 1/2")]).toEqual([["A", "3/4"], ["B", "2/3"], ["C", "1/2"]]);
    expect(optionsIn("Plan B is better.").size).toBe(0);
  });
});
