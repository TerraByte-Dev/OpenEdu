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

  it.each(["", "   ", "?", "...", "!!", "?!", "🙂", "xyz", "asdf", "asdfgh", "qwrtp", "jjjj", "sdf jkl", "asdf jkl", "lkjh", "  xyz  "])(
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
