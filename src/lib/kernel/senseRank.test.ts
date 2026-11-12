import { describe, it, expect } from "vitest";
import { STOPWORDS, contentStems, excludedStems, rankSenses, senseOverlap, senseScores, stem } from "./senseRank";

// Lever 19's ranker (docs/BENCHMARKS.md row 19), on made-up text: nothing here is dictionary text.

const s = (definition: string, example = "") => ({ definition, example });

describe("stem: the fixed rule, in order", () => {
  it.each([
    ["flies", "fly"], ["boxes", "box"], ["wishes", "wish"], ["churches", "church"], ["buzzes", "buz"],
    ["dogs", "dog"], ["glass", "glas"], ["bus", "bus"], ["basis", "basis"],
    ["running", "run"], ["jumped", "jump"], ["hopped", "hop"], ["sing", "sing"], ["red", "red"], ["bed", "bed"],
    ["making", "mak"], ["make", "mak"], ["stones", "ston"], ["stone", "ston"], ["walking", "walk"], ["walks", "walk"],
    ["flew", "flew"], ["fly", "fly"],
  ])("%s -> %s", (word, want) => {
    expect(stem(word)).toBe(want);
  });
  it("matches regular forms of one word, not irregular ones", () => {
    expect(new Set(["swim", "swims", "swimming"].map(stem)).size).toBe(1);
    expect(new Set(["bake", "baked", "bakes", "baking"].map(stem)).size).toBe(1);
    expect(stem("flew")).not.toBe(stem("fly"));
  });
});

describe("contentStems", () => {
  it("lower-cases, splits on non-letters, drops short tokens and stopwords, and stems", () => {
    expect([...contentStems("The Elephant's trunk sprayed water, usually at 3pm!")]).toEqual(["elephant", "trunk", "spray", "water"]);
    expect(contentStems("it is a big one, isn't it? Don't do that.")).toEqual(new Set(["big"]));
  });
  it("leaves out the excluded stems", () => {
    expect(contentStems("the bank of the river banks", excludedStems("bank"))).toEqual(new Set(["river"]));
  });
  it("lists function words and gloss frame words, and none of them is longer than a word", () => {
    for (const w of ["the", "which", "don", "doesn", "usually", "especially", "something", "someone", "person", "act"]) expect(STOPWORDS.has(w), w).toBe(true);
    for (const w of ["water", "river", "money", "animal", "tree"]) expect(STOPWORDS.has(w), w).toBe(false);
    for (const w of STOPWORDS) expect(w).toMatch(/^[a-z]{3,}$/);
  });
});

describe("excludedStems", () => {
  it("covers every word of the typed word and the headword", () => {
    expect(excludedStems("figured out", "figure out")).toEqual(new Set(["figur", "out"]));
  });
});

describe("senseOverlap and rankSenses", () => {
  const senses = [s("a container for liquid"), s("a player who throws the ball", "the pitcher threw a strike"), s("a vessel with a spout for pouring water")];
  const ex = excludedStems("pitcher");

  it("counts distinct sentence stems found in the definition plus the example", () => {
    const sentence = contentStems("pour the water from the pitcher, pouring slowly", ex);
    expect(senseOverlap(sentence, senses[2], ex)).toBe(2); // pour, water
    expect(senseOverlap(sentence, senses[1], ex)).toBe(0);
    expect(senseScores(senses, "the ball was thrown to the player", ex)).toEqual([0, 2, 0]); // player, ball ("thrown" is not "throw")
  });

  it("sorts by score, highest first, ties in stored order, without changing the input", () => {
    const copy = [...senses];
    expect(rankSenses(senses, "pour the water", ex)).toEqual([senses[2], senses[0], senses[1]]);
    expect(rankSenses(senses, "a liquid ball", ex)).toEqual([senses[0], senses[1], senses[2]]); // 1, 1, 0: stored order kept
    expect(rankSenses(senses, "a player poured liquid water", ex)).toEqual([senses[2], senses[0], senses[1]]); // 2, 1, 1
    expect(senses).toEqual(copy);
  });

  it("keeps the stored order when no sense scores, or there is no sentence", () => {
    expect(rankSenses(senses, "nothing here overlaps", ex)).toEqual(senses);
    expect(rankSenses(senses, "", ex)).toEqual(senses);
    expect(rankSenses(senses, "the pitcher", ex)).toEqual(senses); // only the headword: excluded
  });
});
