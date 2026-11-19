import { describe, it, expect, beforeAll, afterAll } from "vitest";

// isNonAnswer over the bundled dictionary and word list as the webview serves them (public/ on disk).
// The near misses are what matters: a real attempt, right or wrong, must never be called a non-answer.

import { isNonAnswer } from "./non-answer";
import { resetDictionaryCache } from "./dictionary";
import { resetWordListCache } from "./wordlist";
import { installAppOrigin } from "./eval/headless/origin";
import {
  GRADE_DEV_SYNONYMS, GRADE_DEV_SIGNS_LETTERS, GRADE_DEV_MISSPELLINGS, GRADE_DEV_NUMBERS, GRADE_DEV_NAMES_TIMES,
  GRADE_DEV_RESTATE, GRADE_DEV_DIRECTION_YEARS, round2AsQuestions,
} from "./eval/grade-dev";

const original = globalThis.fetch;
const FRACTION_Q = "What fraction of the pizza is left if you eat 1 of 4 equal slices?";

describe("isNonAnswer", () => {
  beforeAll(() => { resetDictionaryCache(); resetWordListCache(); installAppOrigin(); });
  afterAll(() => { globalThis.fetch = original; resetDictionaryCache(); resetWordListCache(); });

  it.each(["", "   ", "?", "...", "!!", "?!", "🙂", "xyz", "asdf", "asdfgh", "qwrtp", "jjjj", "sdf jkl", "asdf jkl", "lkjh", "  xyz  ", "zxcv", "asdfff", "qwer"])(
    "%j answers nothing", async (text) => {
      expect(await isNonAnswer(text, "3/4", FRACTION_Q)).toBe(true);
    }, 30_000);

  it.each([
    ["3/4", "3/4"], ["0.75", "3/4"], ["three fourths", "3/4"], ["half", "1/2"], ["5", "5"], ["H2O", "Water"],
    ["5cm", "5 cm"], ["cm", "centimeters"], ["km", "kilometers"], ["x", "x"], ["Xyz", "3/4"], ["DNA", "DNA"],
    ["NaCl", "Salt"], ["idk", "3/4"], ["haf", "1/2"], ["abe", "Abraham Lincoln"], ["qwerty", "3/4"], ["hmm", "3/4"],
    ["numerater", "The numerator"], ["newclius", "The nucleus"], ["fotosinthesis", "Photosynthesis"],
    ["plantfood", "Glucose"], ["xiv", "14"], ["xyz", "x, y and z"], ["xyz abc", "3/4"], ["rythm", "Rhythm"],
    // Sounded-out misspellings of another word (grade-dev.ts): wrong, but real attempts.
    ["omnivour", "Carnivore"], ["nepchune", "Jupiter"], ["bolivea", "Venezuela"], ["herculanium", "Pompeii"], ["larvah", "A caterpillar"],
    ["the denominator", "The denominator"], ["i dont know", "3/4"], ["no", "Yes"], ["ok", "3/4"],
  ])("%j (key %j) is left to the model", async (text, key) => {
    expect(await isNonAnswer(text, key, FRACTION_Q)).toBe(false);
  }, 30_000);

  // A right answer that is not the key, an abbreviation of the key, a name or a word in the course's
  // language: no vowel or a run of consonants is never enough to call one a non-answer. The grading dev
  // sets hold none of these shapes, so they are listed here (review of TerraTutor #245, 2026-11-19).
  it.each([
    // K-2 invented spellings of a right answer other than the key.
    ["shrk", "fish", "Name an animal that lives in the ocean."],
    ["frg", "toad", "Name an animal that can hop."],
    ["brd", "airplane", "Name something that can fly."],
    ["trtl", "snail", "Name a slow animal."],
    ["skwrl", "chipmunk", "Name a small animal with a bushy tail."],
    ["strwbrry", "apple", "Name a red fruit."],
    ["rnd", "circle", "What shape is a wheel?"],
    // Lower-case abbreviations of the key.
    ["jfk", "John F. Kennedy", "Which president said \"Ask not what your country can do for you\"?"],
    ["fdr", "Franklin D. Roosevelt", "Who was president during most of World War II?"],
    ["nyc", "New York City", "Which city has the Statue of Liberty?"],
    ["mph", "miles per hour", "What unit do cars in the United States use for speed?"],
    ["hcl", "hydrochloric acid", "What acid is in your stomach?"],
    ["sql", "Structured Query Language", "What language asks a database for rows?"],
    ["kwh", "kilowatt hours", "What unit is on an electric bill?"],
    // Lower-case names that are a right answer other than the key.
    ["pittsburgh", "Philadelphia", "Name a city in Pennsylvania."],
    ["tchaikovsky", "Beethoven", "Name a famous composer."],
    ["kandinsky", "Picasso", "Name a famous painter."],
    ["dostoevsky", "Tolstoy", "Name a Russian author."],
    // A language course.
    ["tschuss", "Auf Wiedersehen", "How do you say goodbye in German?"],
    ["deutsch", "German", "What language is spoken in Austria?"],
    // A misspelling of the right word when the key is a number.
    ["eigths", "1/8", "Each part of a whole cut into 8 equal parts is one ____."],
  ])("%j (key %j) is left to the model", async (text, key, question) => {
    expect(await isNonAnswer(text, key, question)).toBe(false);
  }, 30_000);

  // Review of the OpenEdu port of TerraTutor #245, 2026-11-19: a sign typed for a key that names it, and real
  // attempts the keyboard-row and repeated-letter rules took for a mash. Each was stored wrong as 'exact'.
  it.each([
    [">", "greater than", "Which sign means greater than?"],
    ["<", "less than", "Which sign means less than?"],
    ["=", "the equal sign", "What goes between 2 + 2 and 4?"],
    ["+", "plus", "What sign do you use to add?"],
    ["-", "minus", "What sign do you use to take away?"],
    ["÷", "division sign", "Which sign means share equally?"],
    ["?", "a question mark", "What goes at the end of an asking sentence?"],
    [".", "a period", "What goes at the end of a telling sentence?"],
    ["!", "an exclamation point", "What goes at the end of a sentence that shows strong feeling?"],
    [",", "a comma", "What goes between the city and the state in an address?"],
    ["$", "dollar sign", "Which sign goes in front of an amount of money?"],
    ["%", "percent sign", "Which sign means out of one hundred?"],
    // Second review, 2026-11-19.
    ["≥", "greater than or equal to", "Which sign means greater than or equal to?"],
    ["≤", "less than or equal to", "Which sign means less than or equal to?"],
    ["≠", "not equal to", "Which sign means not equal to?"],
    ["°", "degrees", "What sign goes after 30 in 30 degrees?"],
    ["#", "sharp", "Which sign raises a note by a half step in music?"],
    ["£", "pound sign", "Which sign goes in front of an amount of British money?"],
    ["€", "euro sign", "Which sign shows money in France?"],
    ["@", "the at sign", "What goes between the name and the website in an email address?"],
    ["()", "parentheses", "What do you put around 2 + 3 to do it first?"],
    ["[ ]", "square brackets", "What marks go around a word you add to a quote?"],
    ["–", "a dash", "What mark goes between 1990 and 2000 in 1990–2000?"],
    ["—", "a dash", "What long mark can show a break in a sentence?"],
    // Review of the OpenEdu port of TerraTutor #251, 2026-11-19: coding and math signs.
    ["{}", "curly braces", "What marks go around the body of a function in JavaScript?"],
    ["||", "the OR operator", "Which operator is true when either side is true?"],
    ["!", "the NOT operator", "Which operator flips true to false?"],
    ["<>", "angle brackets", "What marks go around a tag name in HTML?"],
    ["^", "caret", "What sign shows a power on a calculator, as in 2^3?"],
    ["~", "tilde", "What sign goes over the n in señor?"],
    ["\\", "backslash", "What sign separates folders in a Windows path?"],
    ["√", "square root sign", "What sign do you write before 9 to ask for the number that times itself makes 9?"],
    ["''", "quotation marks", "What marks go around the words someone says?"],
    ["%", "modulo", "Which operator gives the remainder in Python?"],
  ])("sign %j (key %j) is left to the model", async (text, key, question) => {
    expect(await isNonAnswer(text, key, question)).toBe(false);
  }, 30_000);

  it.each([
    // Abbreviations, including of a one-word key.
    ["jfk", "Kennedy", "Which president said \"Ask not what your country can do for you\"?"],
    ["dhs", "Homeland Security", "Which department guards the country's borders?"],
    ["cnn", "a news channel", "Name a TV news channel."],
    ["nbc", "a TV network", "Name a TV network."],
    // K-2 spellings of a right answer.
    ["wtr", "sunlight", "What do plants need to grow?"],
    ["dsk", "a chair", "Name something in a classroom."],
    ["sld", "skis", "What can you ride down a snowy hill?"],
    ["hll", "a mountain", "What is a small mountain called?"],
    ["prty", "a picnic", "Name a fun thing to have on a birthday."],
    ["tre", "a flower", "Name a plant."],
    // Sound words and a stretched word.
    ["grrr", "woof", "What sound does an angry dog make?"],
    ["shhh", "be quiet", "What do you say to ask for quiet?"],
    ["yesss", "no", "Is the sun a planet?"],
    // An alphabet run when the question is about letters.
    ["lmnop", "L", "What letter comes after K?"],
    ["efg", "e", "Which letter comes after d?"],
  ])("%j (key %j) is left to the model", async (text, key, question) => {
    expect(await isNonAnswer(text, key, question)).toBe(false);
  }, 30_000);

  it.each(["xyz", "asdfgh", "qwrtp", "jjjj", "sdf jkl", "zxcv"])("%j still answers nothing when the question is about a word", async (text) => {
    expect(await isNonAnswer(text, "John F. Kennedy", "Which president said \"Ask not what your country can do for you\"?")).toBe(true);
  }, 30_000);

  it("a sign or symbol is an answer when the key is one too", async () => {
    expect(await isNonAnswer(">", ">", "Which sign goes between 3/4 and 1/2?")).toBe(false);
    expect(await isNonAnswer("?", ">", "Which sign goes between 3/4 and 1/2?")).toBe(false);
    expect(await isNonAnswer("?", "Greater than", "Which sign goes between 3/4 and 1/2?")).toBe(true);
  }, 30_000);

  it("no typed answer in the grading dev sets, right or wrong, is called a non-answer", async () => {
    const sets = [
      GRADE_DEV_SYNONYMS, GRADE_DEV_SIGNS_LETTERS, GRADE_DEV_MISSPELLINGS, GRADE_DEV_NUMBERS, GRADE_DEV_NAMES_TIMES,
      GRADE_DEV_RESTATE, GRADE_DEV_DIRECTION_YEARS, round2AsQuestions(),
    ].flat();
    const flagged: string[] = [];
    for (const q of sets) {
      for (const a of q.answers) {
        // eslint-disable-next-line no-await-in-loop
        if (await isNonAnswer(a.text, q.key, q.question)) flagged.push(`${q.id}: ${a.text} (${a.right ? "right" : "wrong"})`);
      }
    }
    expect(sets.length).toBeGreaterThan(100);
    expect(flagged).toEqual([]);
  }, 120_000);

  it("with no dictionary to read, only an empty or sign-only answer is a non-answer", async () => {
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    resetDictionaryCache(); resetWordListCache();
    try {
      expect(await isNonAnswer("xyz", "3/4")).toBe(false);
      expect(await isNonAnswer("", "3/4")).toBe(true);
      expect(await isNonAnswer("??", "3/4")).toBe(true);
    } finally {
      globalThis.fetch = original;
      resetDictionaryCache(); resetWordListCache();
      installAppOrigin();
    }
  });
});
