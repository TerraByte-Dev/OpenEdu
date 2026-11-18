import { describe, it, expect } from "vitest";
import { answerWords, singular, editDistance, keyForms, settleByCode, misspellingCandidates, misspeltNameCandidates, slipEdits, ordinalToken, oneEditAway, misspeltKeyWords, misspellingNote, prefixAdded, wordsWithin, formsWithin, spellingVariant, type WrittenAnswer, type SpellingLookup } from "./answer-match";
import { GRADE_DEV_DIRECTION_YEARS, GRADE_DEV_MISSPELLINGS, GRADE_DEV_NAMES_TIMES, GRADE_DEV_NUMBERS, GRADE_DEV_RESTATE, GRADE_DEV_ROUND2, GRADE_DEV_SIGNS_LETTERS, GRADE_DEV_SYNONYMS, round2AsQuestions, type GradeDevQuestion } from "./eval/grade-dev";

const ask = (question: string, expected: string, student: string, type = "short_answer"): WrittenAnswer => ({ question, expected, student, type });
// The dictionary's verdict, for the words these tests use.
const REAL = new Set(["neuron", "photon", "affect", "effect", "zambia", "dessert", "stationery", "proton", "neutron", "gambia", "herbivore", "evaporation", "omnivore", "skeleton", "thermometer", "hypothesis", "accommodation"]);
// The most a dictionary could allow a misspelling: the key's own words are real words and nothing else is.
const keyOnly = (key: string) => { const own = new Set(keyForms(key).flatMap(answerWords)); return (w: string) => own.has(w); };
const isWord = (w: string) => REAL.has(w);
const settle = (q: string, key: string, a: string) => settleByCode(ask(q, key, a), isWord);

describe("answerWords", () => {
  it("drops case, punctuation, a leading filler and article", () => {
    expect(answerWords("It's the Pacific Ocean!")).toEqual(["pacific", "ocean"]);
    expect(answerWords("B) Photosynthesis.")).toEqual(["photosynthesis"]);
  });
  it("turns number words into digits", () => {
    expect(answerWords("a hundred degrees")).toEqual(["100", "degrees"]);
    expect(answerWords("fifty-six")).toEqual(["56"]);
    expect(answerWords("one hundred and five")).toEqual(["105"]);
    expect(answerWords("two thousand three hundred")).toEqual(["2300"]);
    expect(answerWords("thirty two F")).toEqual(["32", "f"]);
    expect(answerWords("nineteen eighty")).toEqual(["19", "80"]);
  });
  it("splits a formula into letters and digits the same way for both sides", () => {
    expect(answerWords("h two o")).toEqual(answerWords("H2O"));
    expect(answerWords("H₂O")).toEqual(answerWords("H2O"));
  });
  it("keeps a minus sign and a decimal point", () => {
    expect(answerWords("-5.5 degrees")).toEqual(["-5.5", "degrees"]);
  });
  it("reads the degree sign as degrees", () => {
    expect(answerWords("100 °C")).toEqual(["100", "degrees", "c"]);
    expect(answerWords("100°C")).toEqual(["100", "degrees", "c"]);
    expect(answerWords("100℃")).toEqual(["100", "degrees", "c"]);
    expect(answerWords("90°")).toEqual(["90", "degrees"]);
  });
  it("turns ordinals in words or digits into one form", () => {
    expect(answerWords("the fourth")).toEqual(["4th"]);
    expect(answerWords("4th planet")).toEqual(["4th", "planet"]);
    expect(answerWords("the first")).toEqual(["1st"]);
    expect(answerWords("twenty-first century")).toEqual(["21st", "century"]);
    expect(answerWords("21st century")).toEqual(["21st", "century"]);
    expect(answerWords("one hundredth")).toEqual(["100th"]);
    expect(answerWords("two hundred and fifth")).toEqual(["205th"]);
    expect(answerWords("2nd")).toEqual(["2nd"]);
  });
  it("reads second as 2nd only before a word that is not a unit", () => {
    expect(answerWords("one second")).toEqual(["1", "second"]);
    expect(answerWords("1 second")).toEqual(["1", "second"]);
    expect(answerWords("the second")).toEqual(["second"]);
    expect(answerWords("a second")).toEqual(["second"]);
    expect(answerWords("343 meters per second")).toEqual(["343", "meters", "per", "second"]);
    expect(answerWords("9.8 meters per second squared")).toEqual(["9.8", "meters", "per", "second", "squared"]);
    expect(answerWords("twenty second")).toEqual(["20", "second"]);
    expect(answerWords("the second planet")).toEqual(["2nd", "planet"]);
    expect(answerWords("the twenty second floor")).toEqual(["22nd", "floor"]);
  });
  it("reads a.m. and p.m. as one word", () => {
    expect(answerWords("3 p.m.")).toEqual(["3", "pm"]);
    expect(answerWords("3 a.m")).toEqual(["3", "am"]);
  });
  it("writes an ordinal's suffix by its number", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinalToken)).toEqual(
      ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]);
  });
});

describe("singular / editDistance", () => {
  it("takes plural endings off", () => {
    expect(singular("tadpoles")).toBe("tadpole");
    expect(singular("berries")).toBe("berry");
    expect(singular("foxes")).toBe("fox");
    expect(singular("glass")).toBe("glass");
    expect(singular("venus")).toBe("venus");
  });
  it("counts a swap of neighbours as one edit", () => {
    expect(editDistance("recieve", "receive")).toBe(1);
    expect(editDistance("herbivor", "herbivore")).toBe(1);
    expect(editDistance("mitosis", "meiosis")).toBe(2);
  });
});

describe("keyForms", () => {
  it("adds the parts of a key in brackets or split by a slash", () => {
    expect(keyForms("Carbon dioxide (CO2)")).toEqual(expect.arrayContaining(["Carbon dioxide", "CO2"]));
    expect(keyForms("H2O / water")).toEqual(expect.arrayContaining(["H2O", "water"]));
  });
});

describe("settleByCode: the measured failures", () => {
  it("accepts a surname when the key is a person's name", () => {
    expect(settle("Who was the first President of the United States?", "George Washington", "washington")).toBe(true);
    expect(settle("Who invented the telephone?", "Alexander Graham Bell", "Bell")).toBe(true);
    expect(settle("Who led the march?", "Martin Luther King Jr.", "king")).toBe(true);
  });
  it("accepts a spelled formula", () => {
    expect(settle("What is the chemical symbol for water?", "H2O", "h two o")).toBe(true);
    expect(settle("What is the formula for table salt?", "NaCl", "na cl")).toBe(true);
  });
  it("accepts a number in words with some or none of the key's units", () => {
    expect(settle("What is the boiling point of water at sea level in Celsius?", "100 degrees Celsius", "a hundred degrees")).toBe(true);
    expect(settle("What is the boiling point of water at sea level in Celsius?", "100 degrees Celsius", "100°C")).toBe(true);
    expect(settle("What is the freezing point of water in Fahrenheit?", "32 degrees Fahrenheit", "thirty two F")).toBe(true);
    expect(settle("What is the area of a rectangle 3 cm by 4 cm?", "12 square centimeters", "12 cm squared")).toBe(true);
    expect(settle("What is 7 times 8?", "56", "fifty-six")).toBe(true);
    expect(settle("What is half of 1?", "0.5", "half")).toBe(true);
  });
  it("accepts a plural", () => {
    expect(settle("What do we call a baby frog?", "A tadpole", "tadpoles")).toBe(true);
  });
  it("accepts a one-edit misspelling of a long word that is not itself a word", () => {
    expect(settle("What do we call an animal that eats only plants?", "Herbivore", "a herbivor")).toBe(true);
    expect(settle("What is the process where water turns into vapor?", "Evaporation", "evaporaton")).toBe(true);
  });
});

const MARS = "Counting out from the Sun, which planet is Mars?";
// The second review's cases: the question repeats the key's words, and the answer keeps only some of them.
const KMH = "How fast was the car going in km per hour?";
const MPH = "How fast was the car going in miles per hour?";
const AREA = "What is the area of the rectangle in square centimeters?";
const VOLUME = "What is the volume of the box in cubic meters?";
const LIGHT_YEARS = "How far away is the nearest star in light years?";
const PER_POUND = "How much do the apples cost in dollars per pound?";
const DOZEN = "How many dozen eggs are in 24 eggs?";
const PAIRS = "How many pairs of shoes does she have?";
const SOUND = "How fast does sound travel in air, in meters per second?";
const HEART = "How fast does a resting heart beat, in beats per minute?";
const PENCILS = "A pack holds 4 pencils. How many pencils are in 3 packs?";
// The third review's cases: the answer has the key's words in another order, which reverses the relation.
const BOYS = "In a class there are 12 boys and 3 girls. How many boys are there per girl?";
const CATS = "How many times as many cats as dogs are there?";
const CUPS = "A cake takes 4 cups of flour and 2 cups of sugar. How many cups of flour are there for each cup of sugar?";
const MARBLES = "What is the ratio of red marbles to blue marbles?";
const SLEEP = "How many hours does the baby sleep each night?";
const CLOCK = "The minute hand points at the 3. How many minutes past the hour is it?";

describe("settleByCode: the degree sign and ordinals", () => {
  it("accepts degrees in words for a key written with the sign", () => {
    expect(settle("What is the boiling point of water at sea level?", "100 °C", "100 degrees C")).toBe(true);
    expect(settle("What is the boiling point of water at sea level?", "100 °C", "a hundred degrees")).toBe(true);
    expect(settle("What is the boiling point of water at sea level?", "100 °C", "100 degrees celsius")).toBe(true);
    expect(settle("How many degrees are in a right angle?", "90°", "ninety degrees")).toBe(true);
    expect(settle("What is the boiling point of water at sea level?", "100 C", "100 degrees C")).toBe(true);
    expect(settle("What is the boiling point of water in Fahrenheit?", "212°F", "212 degrees fahrenheit")).toBe(true);
  });
  it("keeps second the unit of time after per, and the word on its own (the reviewer's cases)", () => {
    expect(settle("How fast does sound travel in air?", "343 meters per second", "343 m/s")).toBe(true);
    expect(settle("How fast does light travel?", "300,000 km per second", "300,000 km/s")).toBe(true);
    expect(settle("How fast does a falling object speed up near Earth?", "9.8 meters per second squared", "9.8 m/s squared")).toBe(true);
    expect(settle("What is the SI base unit of time?", "The second", "seconds")).toBe(true);
    expect(settle("What is the SI base unit of time?", "The second (SI unit of time)", "seconds")).toBe(true);
  });
  it("still accepts the key's number with the words that give it its meaning", () => {
    expect(settle("What is negative 7 plus 3?", "Negative 4", "negative four")).toBe(true);
    expect(settle("What time is 15:00 on a 12-hour clock?", "3 PM", "3 p.m.")).toBe(true);
    expect(settle("Is noon 12 AM or 12 PM?", "12 PM", "12 pm")).toBe(true);
    expect(settle("How many legs does an insect have?", "6 legs", "6")).toBe(true);
    expect(settle("Does water boil at 100 °C or 100 °F at sea level?", "100 °C", "100 degrees C")).toBe(true);
  });
  it("accepts an ordinal in words for the key's digits, and the other way round", () => {
    expect(settle(MARS, "4th planet", "the fourth planet")).toBe(true);
    expect(settle(MARS, "The Fourth Planet", "4th planet")).toBe(true);
    expect(settle("What place did the runner finish in?", "First place", "the first place")).toBe(true);
    expect(settle("In which century did World War II happen?", "The 20th century", "the twentieth century")).toBe(true);
    expect(settle("Which floor is the library on?", "The 22nd floor", "the twenty-second floor")).toBe(true);
  });
  it("takes the key's number alone when its other words are units, or with all of the key's words in order (the reviews' cases)", () => {
    expect(settle(MARS, "4th planet", "the fourth planet")).toBe(true);
    expect(settle(KMH, "60 km per hour", "60")).toBe(true);
    expect(settle(KMH, "60 km per hour", "60 km per hour")).toBe(true);
    expect(settle(KMH, "60 km per hour", "sixty kilometers per hour")).toBe(true);
    expect(settle(KMH, "60 km per hour", "60 km/h")).toBe(true);
    expect(settle(MPH, "60 miles per hour", "60")).toBe(true);
    expect(settle(AREA, "12 square centimeters", "12")).toBe(true);
    expect(settle(VOLUME, "27 cubic meters", "27")).toBe(true);
    expect(settle(LIGHT_YEARS, "4 light years", "four light years")).toBe(true);
    expect(settle(DOZEN, "2 dozen eggs", "two dozen eggs")).toBe(true);
    expect(settle(PAIRS, "3 pairs of shoes", "3 pairs of shoes")).toBe(true);
    expect(settle(SOUND, "343 meters per second", "343")).toBe(true);
    expect(settle(PENCILS, "12", "12 pencils")).toBe(true);
    expect(settle("How many sides does a hexagon have?", "6", "6 sides")).toBe(true);
    expect(settle("How many legs does an insect have?", "6 legs", "6")).toBe(true);
    expect(settle("How many electrons?", "9", "9 electrons")).toBe(true);
    expect(settle(BOYS, "4 boys per girl", "4 boys per girl")).toBe(true);
    expect(settle(CATS, "5 times as many cats as dogs", "five times as many cats as dogs")).toBe(true);
  });
  // The rule that took a number alone when the question repeats the key's other words was removed
  // after it passed a wrong answer in each of three reviews. These right answers now go to the model.
  it("leaves the number alone for a key with words that are not units to the model", () => {
    expect(settle(MARS, "4th planet", "4th")).toBeNull();
    expect(settle(MARS, "4th planet", "the fourth")).toBeNull();
    expect(settle("What place did the runner finish in?", "First place", "the first")).toBeNull();
    expect(settle("In which century did World War II happen?", "The 20th century", "twentieth")).toBeNull();
    expect(settle(LIGHT_YEARS, "4 light years", "4")).toBeNull();
    expect(settle(PER_POUND, "3 dollars per pound", "3")).toBeNull();
    expect(settle(DOZEN, "2 dozen eggs", "2")).toBeNull();
    expect(settle(PAIRS, "3 pairs of shoes", "3")).toBeNull();
    expect(settle(HEART, "70 beats per minute", "70")).toBeNull();
    expect(settle("How many electrons does a fluorine atom have?", "9 electrons", "9")).toBeNull();
    expect(settle("Which day of July is Independence Day in the United States?", "4th of July", "4th")).toBeNull();
  });
});

describe("settleByCode: never a wrong answer", () => {
  it("never takes a plain number for an ordinal, or another ordinal", () => {
    expect(settle("Which place did she finish in?", "30th", "13")).toBeNull();
    expect(settle(MARS, "4th planet", "4")).toBeNull();
    expect(settle(MARS, "4th planet", "the fortieth")).toBeNull();
    expect(settle(MARS, "4th planet", "the fifth planet")).toBeNull();
    expect(settle("What place did the runner finish in?", "Third place", "first")).toBeNull();
    expect(settle("What place did the runner finish in?", "Third place", "first place")).toBeNull();
    expect(settle("Which planet is third from the sun?", "Earth", "third")).toBeNull();
    expect(settle("How long is the pause?", "1 second", "the second")).toBeNull();
    expect(settle("How long is the pause?", "1 second", "1st")).toBeNull();
    expect(settle("What is the SI base unit of time?", "The second", "2nd")).toBeNull();
  });
  it("never takes the key's words in another order (the third review's cases)", () => {
    expect(settle(BOYS, "4 boys per girl", "4 girls per boy")).toBeNull();
    expect(settle(CATS, "5 times as many cats as dogs", "5 times as many dogs as cats")).toBeNull();
    expect(settle(CUPS, "2 cups of flour for each cup of sugar", "2 cups of sugar for each cup of flour")).toBeNull();
    expect(settle(MARBLES, "3 red to blue", "3 blue to red")).toBeNull();
    expect(settle(SLEEP, "9 hours each night", "9 nights each hour")).toBeNull();
    expect(settle(CLOCK, "15 minutes past the hour", "15 hours past the minute")).toBeNull();
    expect(settle(CUPS, "2 cups of flour for each cup of sugar", "cups of flour for each 2 cups of sugar")).toBeNull();
    expect(settle("How fast?", "5 cats per dog", "5 dogs per cat")).toBeNull();
  });
  it("never takes units in another order", () => {
    expect(settle(KMH, "60 km per hour", "60 hours per km")).toBe(false);
    expect(settle("How fast does it go?", "60 km/h", "60 h/km")).toBeNull();
    expect(settle("How fast does it go?", "6 ft/s", "6 s/ft")).toBeNull();
    expect(settle(SOUND, "343 meters per second", "343 seconds per meter")).toBe(false);
  });
  it("never takes the number alone when the question already says it, or offers a choice with vs", () => {
    expect(settle("Which is longer, 10 cm vs 10 m?", "10 m", "10")).toBeNull();
    expect(settle("Which is longer: 10 cm, 10 m?", "10 m", "10")).toBeNull();
    expect(settle("Which is warmer: 30 degrees Celsius, 30 degrees Fahrenheit?", "30 degrees Celsius", "30")).toBeNull();
    expect(settle("Which is warmer: 30 degrees Celsius, 30 degrees Fahrenheit?", "30 degrees Celsius", "30 degrees")).toBeNull();
    expect(settle("Which animal has 8 legs: How many legs?", "8 legs", "8")).toBeNull();
    expect(settle("Which is longer, 10 cm versus 10 m?", "10 m", "10 meters")).toBe(true);
    expect(settle("A spider has 8 legs. How many legs do 8 spiders have?", "64 legs", "64")).toBe(true);
  });
  it("never takes the number alone for a key with words that are not units", () => {
    expect(settle("Counting out from the Sun, where is Mars?", "4th planet", "the fourth")).toBeNull();
    expect(settle(MARS, "4th planet", "the 4th moon")).toBeNull();
    expect(settle("How many branches?", "There are 3 branches of government", "3")).toBeNull();
  });
  it("never takes the number alone when the key has a sign, direction or fraction (the reviewer's cases)", () => {
    expect(settle("What is negative 7 plus 3?", "Negative 4", "4")).toBe(false);
    expect(settle("What is negative 8 plus 3?", "Negative 5", "5")).toBe(false);
    expect(settle("What is negative 8 plus 3?", "Negative 5", "five")).toBe(false);
    expect(settle("What is 3 minus 8?", "minus five", "5")).toBe(false);
    expect(settle("What is 3 minus 8?", "minus 5", "5")).toBe(false);
    expect(settle("How far north or south of the equator is the Tropic of Cancer?", "23 degrees north", "23 degrees")).toBeNull();
    expect(settle("Is the jar one third or two thirds full?", "Two thirds", "two")).toBeNull();
    expect(settle("What fraction of the pizza is left, in thirds?", "2 thirds", "2")).toBeNull();
  });
  it("never lets a first number settle past a different noun, am/pm, unit or a choice (the reviewer's cases)", () => {
    expect(settle("How many legs does an insect have?", "6 legs", "6 arms")).toBeNull();
    expect(settle("What time is 15:00 on a 12-hour clock?", "3 PM", "3 am")).toBe(false);
    expect(settle("What time is 15:00 on a 12-hour clock?", "3 PM", "3 a.m.")).toBe(false);
    expect(settle("What time is 15:00 on a 12-hour clock?", "3 p.m.", "3")).toBeNull();
    expect(settle("Is noon 12 AM or 12 PM?", "12 PM", "12")).toBeNull();
    expect(settle("How long is the pause?", "1 second", "1st")).toBeNull();
    expect(settle("How many legs does an insect have?", "6", "6 arms")).toBeNull();
    expect(settle("How many electrons and protons does a fluorine atom have each?", "9 electrons", "9 protons")).toBeNull();
  });
  it("never takes some of the key's words for all of them (the second review's cases)", () => {
    expect(settle(KMH, "60 km per hour", "60 km")).toBe(false);
    expect(settle(KMH, "60 km per hour", "60 hours")).toBe(false);
    expect(settle(MPH, "60 miles per hour", "60 miles")).toBe(false);
    expect(settle(AREA, "12 square centimeters", "12 centimeters")).toBe(false);
    expect(settle(VOLUME, "27 cubic meters", "27 meters")).toBe(false);
    expect(settle(LIGHT_YEARS, "4 light years", "4 years")).toBeNull();
    expect(settle(PER_POUND, "3 dollars per pound", "3 pounds")).toBeNull();
    expect(settle(DOZEN, "2 dozen eggs", "2 eggs")).toBeNull();
    expect(settle(PAIRS, "3 pairs of shoes", "3 shoes")).toBeNull();
  });
  it("needs the rule, not the ordinal reading of second, for per second; and per minute the same", () => {
    expect(settle(SOUND, "343 meters per second", "343 meters")).toBe(false);
    expect(settle(SOUND, "343 meters per second", "343 seconds")).toBe(false);
    expect(settle(HEART, "70 beats per minute", "70 beats")).toBeNull();
    expect(settle(HEART, "70 beats per minute", "70 minutes")).toBeNull();
  });
  it("never lets the answer add a word the key does not have, other than what the question counts", () => {
    expect(settle(PENCILS, "12", "12 packs")).toBeNull();
    expect(settle(DOZEN, "2", "2 eggs")).toBeNull();
  });
  it("needs the key's whole answer when the question offers a choice", () => {
    expect(settle("Does water boil at 100 °C or 100 °F at sea level?", "100 °C", "100")).toBeNull();
    expect(settle("Does water boil at 100 °C or 100 °F at sea level?", "100 °C", "100 degrees")).toBeNull();
    expect(settle("Who started the New Deal, Theodore Roosevelt or Franklin Roosevelt?", "Franklin Roosevelt", "roosevelt")).toBeNull();
    expect(settle("How many sides does a hexagon have, 6 or 8?", "6", "6 sides")).toBeNull();
  });
  it("never passes a different scale or number for a key with the degree sign", () => {
    expect(settle("What is the boiling point of water at sea level?", "100 °C", "100 degrees F")).toBeNull();
    expect(settle("What is the boiling point of water at sea level?", "100 °C", "100 °F")).toBeNull();
    expect(settle("What is the boiling point of water at sea level?", "100 °C", "90 degrees")).toBeNull();
    expect(settle("How many degrees are in a right angle?", "90°", "90 degrees celsius")).toBeNull();
    expect(settle("How many degrees are in a right angle?", "90°", "180 degrees")).toBeNull();
  });
  it("never accepts on a shared word", () => {
    expect(settle("What carries oxygen in the blood?", "Red blood cells", "red")).toBeNull();
    expect(settle("Which ocean is the largest?", "The Pacific Ocean", "the Atlantic Ocean")).toBeNull();
    expect(settle("What is the main job of the heart?", "To pump blood around the body", "blood")).toBeNull();
  });
  it("never accepts a misspelling that is a real word", () => {
    expect(settle("Which particle has no charge?", "Neutron", "neuron")).toBeNull();
    expect(settle("Which particle has a positive charge?", "Proton", "photon")).toBeNull();
    expect(settle("Which word is the noun?", "Effect", "affect")).toBeNull();
  });
  it("needs the misspelt word looked up: without a dictionary no misspelling is accepted", () => {
    expect(settleByCode(ask("What do we call an animal that eats only plants?", "Herbivore", "herbivor"))).toBeNull();
  });
  it("does not accept a misspelling of a short word", () => {
    expect(settle("What colour is the sky?", "Blue", "blur")).toBeNull();
  });
  it("needs the number and never an extra unit", () => {
    expect(settle("What is the boiling point of water at sea level in Celsius?", "100 degrees Celsius", "50 degrees")).toBeNull();
    expect(settle("What is the boiling point of water at sea level in Celsius?", "100 degrees Celsius", "100 degrees Fahrenheit")).toBeNull();
    expect(settle("What is the freezing point of water in Fahrenheit?", "32 degrees Fahrenheit", "0 degrees Fahrenheit")).toBeNull();
    expect(settle("What is half of 50?", "25", "half")).toBeNull();
    expect(settle("What is 7 times 8?", "56", "not fifty six")).toBeNull();
  });
  it("needs all of the key's units when the answer gives a unit (12 cm is a length, not an area)", () => {
    expect(settle("What is the area of a rectangle 3 cm by 4 cm?", "12 square centimeters", "12 cm")).toBe(false);
    expect(settle("What is the area of a rectangle 3 cm by 4 cm?", "12 square centimeters", "12")).toBe(true);
    expect(settle("How fast does it go?", "60 km/h", "60 km")).toBe(false);
    expect(settle("How fast does it go?", "60 km/h", "sixty kilometers per hour")).toBe(true);
    expect(settle("How long?", "3 cm", "3 m")).toBe(false);
    expect(settle("How many electrons?", "9", "9 electrons")).toBe(true);
    expect(settle("How long?", "3 cm", "3cm")).toBe(true);
  });
  it("takes a word in brackets as another form, not a description in brackets", () => {
    expect(settle("Which planet is closest to the sun?", "Mercury (the planet)", "the planet")).toBeNull();
    expect(settle("Which planet is closest to the sun?", "Mercury (the planet)", "mercury")).toBe(true);
  });
  it("does not split a unit written with a slash", () => {
    expect(keyForms("60 km/h")).toEqual(["60 km/h"]);
  });
  it("does not read a prose key with one number as a number with units", () => {
    expect(settle("How many branches?", "There are 3 branches of government", "3")).toBeNull();
  });
  it("takes a surname only for a person's name, only the last word, only when the question asks who", () => {
    expect(settle("Who was the first President of the United States?", "George Washington", "george")).toBeNull();
    expect(settle("Who was the first President of the United States?", "George Washington", "martha washington")).toBeNull();
    expect(settle("Which city is the capital of the United States?", "Washington D.C.", "dc")).toBeNull();
    expect(settle("What is the capital of the USA?", "Washington DC", "washington")).toBeNull();
    expect(settle("Who ruled the Mediterranean?", "The Roman Empire", "empire")).toBeNull();
  });
  it("does not accept a different formula", () => {
    expect(settle("What is the chemical symbol for water?", "H2O", "h two")).toBeNull();
    expect(settle("What gas do plants take in?", "CO2", "c o")).toBeNull();
  });
});

describe("misspellingCandidates", () => {
  it("lists the answer's words one edit off a long key word, and the words one edit from them, for the dictionary", () => {
    const herb = misspellingCandidates(ask("q", "Herbivore", "a herbivor"));
    expect(herb[0]).toBe("herbivor");
    expect(herb).toContain("herbivar");
    expect(herb).toContain("herbivore");
    expect(misspellingCandidates(ask("q", "Neutron", "neuron"))[0]).toBe("neuron");
    expect(misspellingCandidates(ask("q", "Blue", "blur"))).toEqual([]);
  });
  it("never takes a one-edit misspelling that is one edit from another real word", () => {
    const real = (w: string) => w === "slovakia" || w === "principle";
    expect(settleByCode(ask("Which country has Ljubljana as its capital?", "Slovenia", "slovania"), real)).toBeNull();
    expect(settleByCode(ask("Who runs the school?", "The principal", "principel"), real)).toBeNull();
    expect(settleByCode(ask("Which country has Ljubljana as its capital?", "Slovenia", "slovania"), (w) => w === "slovenia")).toBe(true);
  });
  it("never takes a misspelling of a word the dictionary does not have (names of places and people)", () => {
    // The bundled dictionary has no "gambia" or "zambia", so it cannot tell that "zambia" is a real name.
    const noNames = (w: string) => !["gambia", "zambia", "slovenia", "slovakia"].includes(w);
    expect(settleByCode(ask("Which country lies along the Gambia River?", "The Gambia", "Zambia"), noNames)).toBeNull();
    expect(settleByCode(ask("Which country has Ljubljana as its capital?", "Slovenia", "slovania"), noNames)).toBeNull();
    // A form of the key's own word is not another word: "evaporating" is one edit from "evaporatin".
    const forms = (w: string) => ["evaporation", "evaporating", "evaporations"].includes(w);
    expect(settleByCode(ask("What is water turning into vapor called?", "Evaporation", "evaporatin"), forms)).toBe(true);
  });
});

// The 30-question dev set the grader is tuned on (OpenEdu #317's batch measurement) and the synonyms set
// (2026-11-15); labels by Claude, not blind. Code may settle some right answers and must settle none of
// the wrong ones.
const DEV = GRADE_DEV_ROUND2;

describe("settleByCode on the dev set", () => {
  it("settles no wrong answer", () => {
    const passed = DEV.filter(([q, key, , wrong]) => settleByCode(ask(q, key, wrong), keyOnly(key)) === true);
    expect(passed.map((d) => d[3])).toEqual([]);
  });
  it("settles the four measured failures", () => {
    const settled = new Set(DEV.filter(([q, key, right]) => settleByCode(ask(q, key, right), isWord) === true).map((d) => d[2]));
    for (const a of ["washington", "h two o", "a hundred degrees", "tadpoles"]) expect(settled.has(a)).toBe(true);
  });
  it("settles no wrong answer on the synonyms set", () => {
    const passed = GRADE_DEV_SYNONYMS.flatMap((q) => q.answers.filter((a) => !a.right && settleByCode(ask(q.question, q.key, a.text), keyOnly(q.key)) === true).map((a) => a.text));
    expect(passed).toEqual([]);
  });
});

// Round 4: the round-3 held-out run's three kinds of right answer the model failed, in new questions.
const BLANK_GT = "Which sign goes in the blank to make 7 __ 2 true?";
const BLANK_LT = "Which sign goes in the blank to make 1 __ 5 true?";
const BLANK_EQ = "Which sign goes in the blank: 2 + 2 __ 4?";
describe("settleByCode: a sign and its name", () => {
  it("takes a sign's name for the sign", () => {
    for (const a of ["greater than", "more than", "bigger than", "is greater than", "the greater-than sign", "Greater than."]) {
      expect(settle(BLANK_GT, ">", a)).toBe(true);
    }
    for (const a of ["less than", "smaller than", "is less than"]) expect(settle(BLANK_LT, "<", a)).toBe(true);
    for (const a of ["equals", "equal to", "is equal to", "the equal sign", "equals sign"]) expect(settle(BLANK_EQ, "=", a)).toBe(true);
    expect(settle("Which sign goes in the blank: 3 __ 3 = 9?", "×", "times")).toBe(true);
    expect(settle("Which sign goes in the blank: 8 __ 2 = 4?", "÷", "divided by")).toBe(true);
    expect(settle("Which sign goes in the blank: 8 __ 2 = 6?", "−", "minus")).toBe(true);
    expect(settle("Which sign goes in the blank: 5 __ 5?", "≥", "greater than or equal to")).toBe(true);
  });
  it("never takes the sign for a key that is its name: the question shows the sign", () => {
    const cases: Array<[string, string, string]> = [
      ["What does the sign > mean?", "Greater than", ">"],
      ["What does the symbol < mean?", "less than", "<"],
      ["What does the = sign mean?", "equal to", "="],
      ["What is the name of the sign ÷?", "divided by", "÷"],
      ["What word do we say for the + sign?", "plus", "+"],
      ["What word do we say for the × sign?", "times", "×"],
      ["What does ≠ mean?", "not equal to", "≠"],
      ["What does ≥ mean?", "greater than or equal to", "≥"],
      ["What does the - sign mean in 5 - 2?", "minus", "-"],
    ];
    for (const [q, key, a] of cases) {
      expect(settle(q, key, a)).toBeNull();
      expect(settleByCode(ask(q, key, a), keyOnly(key))).toBeNull();
    }
  });
  it("never takes a sign's name the question already says", () => {
    const cases: Array<[string, string, string]> = [
      ["Which symbol means 'greater than'?", ">", "greater than"],
      ["Which sign means less than?", "<", "less than"],
      ["Which sign means equal to?", "=", "equal to"],
      ["Which sign means is greater than or equal to?", "≥", "greater than or equal to"],
      ["Which symbol do we use for 'divided by'?", "÷", "divided by"],
      ["Which symbol stands for plus?", "+", "plus"],
      // Another name for the same sign is still in the question.
      ["Which sign means more than?", ">", "greater than"],
      // The question shows the sign itself.
      ["Is 7 > 2 or 7 < 2 true? Which sign makes it true?", ">", "greater than"],
      // The question says only a word of a name (the second review's cases).
      ["Which symbol means greater?", ">", "greater than"],
      ["Which sign shows the first number is greater?", ">", "greater than"],
      ["Which sign shows that the first number is bigger?", ">", "bigger than"],
      ["Which symbol do we use when a number is larger?", ">", "larger than"],
      ["Which sign shows 9 is more?", ">", "more than"],
      ["Which sign shows the first number is less?", "<", "less than"],
      ["Which symbol shows the first number is smaller?", "<", "smaller than"],
      ["Which symbol stands for divide?", "÷", "divided by"],
      ["Which symbol means to multiply?", "×", "multiplied by"],
      ["Which symbol means 'multiply'?", "×", "times"],
      // Or what the sign does.
      ["Which sign means to add?", "+", "plus"],
      ["Which sign do we use to take away?", "−", "minus"],
      ["Which sign means the same as?", "=", "equals"],
    ];
    for (const [q, key, a] of cases) {
      expect(settle(q, key, a)).toBeNull();
      expect(settleByCode(ask(q, key, a), keyOnly(key))).toBeNull();
      // With a blank to fill as well, the word still gives the name away.
      expect(settle(`${q} (6 __ 3)`, key, a)).toBeNull();
    }
  });
  it("takes a sign's name only to fill a blank between two numbers", () => {
    expect(settle("Which sign goes between 1/2 and 2/4 to compare them?", "=", "equal to")).toBeNull();
    expect(settle("Which sign compares 9 and 4?", ">", "greater than")).toBeNull();
    expect(settle("Which sign goes in the blank?", ">", "greater than")).toBeNull();
    expect(settle("Which sign compares 0.5 and 0.25 in that order (0.5 __ 0.25)?", ">", "more than")).toBe(true);
    expect(settle("Which sign goes in the blank: 1/2 __ 2/4?", "=", "equal to")).toBe(true);
    expect(settle("Which sign goes in the blank: 12 □ 3 = 4?", "÷", "divided by")).toBe(true);
  });
  it("never takes a sign for a word key that is not about signs", () => {
    expect(settle("Which newspaper did he read?", "The Times", "×")).toBeNull();
    expect(settle("Fill in: all people are created ___.", "equal", "=")).toBeNull();
    expect(settleByCode(ask("Fill in: all people are created ___.", "equal", "="), keyOnly("equal"))).toBeNull();
  });
  it("leaves two names to the model", () => {
    expect(settle("What does the sign = mean?", "Equal to", "equals")).toBeNull();
    expect(settle("What does the sign < mean?", "Less than", "smaller than")).toBeNull();
    expect(settle("Which newspaper did he read?", "The Times", "multiplied by")).toBeNull();
  });
  it("never takes another sign", () => {
    for (const a of ["<", "less than", "smaller than", "greater than or equal to", "greater than or equal", "≥", ">=", "=", "equal to"]) {
      expect(settle(BLANK_GT, ">", a)).toBeNull();
    }
    for (const a of [">", "greater than", "less than or equal to", "≤"]) expect(settle(BLANK_LT, "<", a)).toBeNull();
    for (const a of ["not equal to", "≠", "does not equal", "+"]) expect(settle(BLANK_EQ, "=", a)).toBeNull();
    expect(settle("What does the sign > mean?", "Greater than", "<")).toBeNull();
    expect(settle("What does the sign > mean?", "Greater than", "≥")).toBeNull();
    expect(settle("What does the sign > mean?", "Greater than", "greater than or equal to")).toBeNull();
    expect(settle("Which sign goes in the blank: 3 __ 3 = 9?", "×", "plus")).toBeNull();
    expect(settle("Which sign goes in the blank: 8 __ 2 = 6?", "−", "plus")).toBeNull();
  });
  it("never takes part of a sign's name, or a sign inside a longer key", () => {
    expect(settle(BLANK_GT, ">", "greater")).toBeNull();
    expect(settle(BLANK_GT, ">", "more")).toBeNull();
    expect(settle(BLANK_GT, ">", "greater than 2")).toBeNull();
    expect(settle("Which is true?", "x > 3", "x greater than 3")).toBeNull();
    expect(settle("Which is true?", "7 > 2", "greater than")).toBeNull();
  });
});

describe("settleByCode: a short code in spaced or dotted letters", () => {
  it("takes the letters spaced, dotted or in another case when the case carries nothing", () => {
    for (const a of ["n a", "N.a.", "N A", "NA", "na", "N a"]) expect(settle("What is the chemical symbol for sodium?", "Na", a)).toBe(true);
    expect(settle("What is the chemical symbol for potassium?", "K", "k")).toBe(true);
    expect(settle("What is the chemical symbol for iron?", "Fe", "f e")).toBe(true);
    expect(settle("What is the two-letter postal code for Ohio?", "OH", "o h")).toBe(true);
    expect(settle("What is the two-letter postal code for Ohio?", "OH", "O.H.")).toBe(true);
  });
  it("takes a case-carrying symbol only in the key's case", () => {
    expect(settle("What is the chemical symbol for cobalt?", "Co", "C o")).toBe(true);
    expect(settle("What is the chemical symbol for cobalt?", "Co", "Co.")).toBe(true);
    expect(settle("What is the chemical formula for carbon monoxide?", "CO", "C O")).toBe(true);
    expect(settle("What is the chemical formula for carbon monoxide?", "CO", "C.O.")).toBe(true);
  });
  it("still reads a spelled formula with its counts", () => {
    expect(settle("What is the chemical formula for water?", "H2O", "h 2 o")).toBe(true);
    expect(settle("What is the chemical formula for water?", "H2O", "h two o")).toBe(true);
  });
  it("never takes other letters", () => {
    for (const a of ["K", "k", "n", "N", "Ne", "n e", "Nb", "a n"]) expect(settle("What is the chemical symbol for sodium?", "Na", a)).toBeNull();
  });
  it("never takes letters cased as another symbol", () => {
    for (const a of ["CO", "C O", "C.O."]) expect(settle("What is the chemical symbol for cobalt?", "Co", a)).toBeNull();
    for (const a of ["Co", "C o"]) expect(settle("What is the chemical formula for carbon monoxide?", "CO", a)).toBeNull();
    expect(settle("What is the chemical symbol for nobelium?", "No", "NO")).toBeNull();
    expect(settle("What is the chemical formula for nitric oxide?", "NO", "No")).toBeNull();
    expect(settle("What is the chemical symbol for hafnium?", "Hf", "HF")).toBeNull();
    // A question that is not about symbols still never takes another symbol's case.
    expect(settle("Which metal makes glass blue?", "Co", "CO")).toBeNull();
  });
  it("on a question about symbols, takes no other case of a case-carrying symbol", () => {
    for (const a of ["co", "c o", "cO"]) expect(settle("What is the chemical symbol for cobalt?", "Co", a)).toBeNull();
    for (const a of ["co", "c.o."]) expect(settle("What is the chemical formula for carbon monoxide?", "CO", a)).toBeNull();
    expect(settle("What is the chemical formula for nitric oxide?", "NO", "no")).toBeNull();
  });
  it("leaves a yes-or-no answer as it was, but never in a symbol's case", () => {
    expect(settle("Is a whale a fish?", "No", "no")).toBe(true);
    expect(settle("Is a whale a fish?", "No", "No.")).toBe(true);
    expect(settle("Is a whale a fish?", "No", "NO")).toBeNull();
    expect(settle("Is a whale a mammal?", "Yes", "YES")).toBe(true);
  });
});

const OMNI = "Which word names an animal that eats plants and animals alike?";
describe("settleByCode: a misspelling two edits off", () => {
  it("takes none, even when only vowels or doubled letters differ: the model decides", () => {
    // With the most a dictionary could allow (the key's words real, nothing else), so no other rule
    // blocks them: two edits are never taken.
    const cases: Array<[string, string, string]> = [
      [OMNI, "Omnivore", "omnivour"],
      [OMNI, "Omnivore", "an omnivour"],
      ["What is the frame of bones in the body called?", "Skeleton", "skelitin"],
      ["What tool measures temperature?", "Thermometer", "thurmometor"],
      ["What tool measures temperature?", "Thermometer", "thermomitur"],
      ["What is an educated guess called?", "Hypothesis", "hipothisis"],
      ["Where do travellers stay?", "Accommodation", "acomodation"],
      ["Is a fox a carnivore or an omnivore?", "Omnivore", "omnivour"],
      // Each as close to another dictionary word as to the key (review of #325).
      ["Which hormone raises blood sugar?", "Glucagon", "glucigen"],
      ["Which hormone raises blood sugar?", "Glucagon", "glucogin"],
      ["Which hormone raises blood sugar?", "Glucagon", "glucogan"],
      ["Which hormone raises blood sugar?", "Glucagon", "glycigon"],
      ["How do animals store sugar in the liver and muscles?", "Glycogen", "glycagan"],
      ["Which word means without hope?", "Desperate", "desperity"],
      ["What word means a great difference between two things?", "Disparity", "desperity"],
      ["What word means a great difference between two things?", "Disparity", "disperite"],
      ["What do you use to track days and months?", "Calendar", "cilindar"],
      ["What does a battery provide to a circuit?", "Electricity", "electricuta"],
      ["What part of a picture is closest to the viewer?", "Foreground", "ferrground"],
      ["What process makes food in leaves?", "Photosynthesis", "fotosynthesis"],
      ["What is the air around the Earth called?", "Atmosphere", "atmosfere"],
      ["Which planet is farthest from the Sun?", "Neptune", "naptuni"],
      ["What tool measures temperature?", "Thermometer", "termomiter"],
    ];
    for (const [q, key, a] of cases) {
      expect(settleByCode(ask(q, key, a), keyOnly(key))).toBeNull();
      expect(settle(q, key, a)).toBeNull();
      // A capitalised key word may be a name, so its words are looked up for that rule; none for this one.
      expect(misspellingCandidates(ask(q, key, a)).filter((w) => !misspeltNameCandidates(ask(q, key, a)).includes(w))).toEqual([]);
    }
  });
  it("never takes another answer, misspelt or not", () => {
    for (const a of ["carnivour", "carnivore", "herbivore", "herbivour", "carnivor"]) expect(settleByCode(ask(OMNI, "Omnivore", a), keyOnly("Omnivore"))).toBeNull();
    expect(settle(OMNI, "Omnivore", "carnivour")).toBeNull();
    expect(settleByCode(ask("What do we call an animal with a backbone?", "Vertebrate", "vertebra"), keyOnly("Vertebrate"))).toBeNull();
    expect(settleByCode(ask("What do we call an animal with a backbone?", "Vertebrate", "invertebrate"), keyOnly("Vertebrate"))).toBeNull();
    expect(settleByCode(ask("What do we call a scientist who studies rocks?", "Geologist", "biologist"), keyOnly("Geologist"))).toBeNull();
  });
});

describe("settleByCode: a misspelling one edit off", () => {
  it("never takes the key's word with a negating prefix added or taken off, a contrast affix swapped, or a function word (#328)", () => {
    const cases: Array<[string, string, string]> = [
      ["Living things in an ecosystem are called ___ factors.", "Biotic", "abiotic"],
      ["What are the living parts of an ecosystem called?", "Biotic factors", "abiotic factors"],
      ["What is a person who lacks courage called?", "Coward", "toward"],
      ["Which word means not typical?", "Atypical", "typical"],
      ["What do we call a reaction that gives out heat?", "Endothermic", "exothermic"],
    ];
    for (const [q, key, a] of cases) {
      // The most a dictionary could allow: only the key's own words are real.
      expect(settleByCode(ask(q, key, a), keyOnly(key))).toBeNull();
    }
  });
  it("the app's path: every word the rule asks the dictionary about is in the candidates", () => {
    // gradeAnswersBatch counts a word it did not look up as real; here the dictionary has the key word
    // and no other candidate.
    const item = ask(OMNI, "Omnivore", "omnivor");
    const looked = new Set(misspellingCandidates(item));
    expect(looked.has("omnivor")).toBe(true);
    expect(looked.has("omnivore")).toBe(true);
    expect(looked.size).toBeGreaterThan(200);
    expect(settleByCode(item, (w) => !looked.has(w) || w === "omnivore")).toBe(true);
    // A key word the dictionary does not have takes no misspelling.
    expect(settleByCode(item, (w) => !looked.has(w))).toBeNull();
    // Without the words one edit away, no misspelling is taken.
    expect(settleByCode(item, (w) => w !== "omnivor")).toBeNull();
  });
  it("never takes a word one edit from another real word", () => {
    const real = (w: string) => w === "chlorite";
    expect(settleByCode(ask("Which ion is ClO3-?", "Chlorate", "chlorote"), real)).toBeNull();
    expect(settleByCode(ask("Which ion is ClO3-?", "Chlorate", "chlorote"), keyOnly("Chlorate"))).toBe(true);
  });
  it("never takes a misspelling as close to another word the question offers", () => {
    const Q = "Is sea water hypertonic or hypotonic to a cell?";
    expect(settleByCode(ask(Q, "Hypertonic", "hypetonic"), keyOnly("Hypertonic"))).toBeNull();
    expect(settleByCode(ask(Q, "Hypertonic", "hipertonic"), keyOnly("Hypertonic"))).toBe(true);
    expect(settleByCode(ask("Is a fox a carnivore or an omnivore?", "Omnivore", "omnivor"), keyOnly("Omnivore"))).toBe(true);
  });
  it("oneEditAway lists drops, additions, changes and swaps", () => {
    const n = oneEditAway("cat");
    for (const w of ["at", "ct", "ca", "cart", "bat", "cot", "act", "cta"]) expect(n).toContain(w);
    expect(n).not.toContain("cat");
  });
});

describe("settleByCode on the round-4 dev set", () => {
  it("settles no wrong answer, even with no word known to be real", () => {
    const passed = GRADE_DEV_SIGNS_LETTERS.flatMap((q) => q.answers.filter((a) => !a.right && settleByCode(ask(q.question, q.key, a.text), keyOnly(q.key)) === true).map((a) => `${q.id} ${a.text}`));
    expect(passed).toEqual([]);
  });
});

// Round 6: numbers and units (GRADE_DEV_NUMBERS). Code must not pass a wrong number, unit or sign.
describe("settleByCode on the numbers dev set", () => {
  it("settles no wrong answer, even with no word known to be real", () => {
    const passed = GRADE_DEV_NUMBERS.flatMap((q) => q.answers.filter((a) => !a.right && settleByCode(ask(q.question, q.key, a.text), keyOnly(q.key)) === true).map((a) => `${q.id} ${a.text}`));
    expect(passed).toEqual([]);
  });
  it("says for every question what a teacher accepts", () => {
    expect(GRADE_DEV_NUMBERS.filter((q) => !q.why).map((q) => q.id)).toEqual([]);
  });
});

// Code decides a number and unit both ways (settleQuantity). Rejecting is the dangerous direction: on
// every dev set, code marks no right answer wrong.
const ALL_SETS = { directionYears: GRADE_DEV_DIRECTION_YEARS, restate: GRADE_DEV_RESTATE, namesTimes: GRADE_DEV_NAMES_TIMES, numbers: GRADE_DEV_NUMBERS, synonyms: GRADE_DEV_SYNONYMS, signs: GRADE_DEV_SIGNS_LETTERS, misspell: GRADE_DEV_MISSPELLINGS, round2: round2AsQuestions() };
const verdicts = (set: GradeDevQuestion[], dict: (key: string) => (w: string) => boolean) =>
  set.flatMap((q) => q.answers.map((a) => ({ id: q.id, text: a.text, right: a.right, got: settleByCode(ask(q.question, q.key, a.text), dict(q.key)) })));

describe("settleByCode: numbers and units, both ways", () => {
  it("marks no right answer wrong on any dev set, with or without the dictionary", () => {
    for (const set of Object.values(ALL_SETS)) {
      for (const dict of [keyOnly, () => isWord]) {
        expect(verdicts(set, dict).filter((v) => v.right && v.got === false).map((v) => `${v.id} ${v.text}`)).toEqual([]);
      }
    }
  });
  it("settles most of the numbers set and passes none of its wrong answers", () => {
    const v = verdicts(GRADE_DEV_NUMBERS, keyOnly);
    // 88: "quarter past four in the afternoon" (n19), a clock time in words.
    expect(v.filter((x) => x.right && x.got === true)).toHaveLength(88);
    // 53: "-273 K" (n33) is a sign flip on a conversion question, now left to the model.
    expect(v.filter((x) => !x.right && x.got === false)).toHaveLength(53);
    expect(v.filter((x) => !x.right && x.got === true)).toEqual([]);
  });
  it("marks wrong what the model passed on the numbers set and held-out v5", () => {
    expect(settle("Write 9/20 as a percent.", "45%", "4.5%")).toBe(false);
    expect(settle("A block has a mass of 60 g and a volume of 20 cm³. What is its density?", "3 g/cm³", "0.33 g/cm³")).toBe(false);
    expect(settle("What is 1/4 + 1/4?", "1/2", "2/8")).toBe(false);
    expect(settle("What is the density of pure water? Include the unit.", "1 g/cm³", "1 kg/mL")).toBe(false);
    expect(settle("You pay with a $5 bill for something that costs $3.25. How much change do you get?", "$1.75", "75 cents")).toBe(false);
    expect(settle("A movie starts at 2:45 p.m. and lasts 1 hour 30 minutes. What time does it end?", "4:15 p.m.", "4:15 a.m.")).toBe(false);
  });
  it("marks right the same amount in other units, which the model failed", () => {
    expect(settle("What is the density of pure water?", "1 g/cm³", "1 gram per milliliter")).toBe(true);
    expect(settle("What is the density of pure water?", "1 g/cm³", "1000 kg/m³")).toBe(true);
    expect(settle("What is the volume of a cube with edges 2 cm long?", "8 cm³", "8 mL")).toBe(true);
    expect(settle("A square has sides 3 meters long. What is its area? Include the unit.", "9 m²", "90,000 cm²")).toBe(true);
    expect(settle("A cyclist rides 30 km in 2 hours. What is the cyclist's average speed?", "15 km/h", "0.25 km per minute")).toBe(true);
    expect(settle("About how fast does light travel in a vacuum?", "About 3 × 10^8 m/s", "about 186,000 miles per second")).toBe(true);
    expect(settle("About how far is the Sun from the Earth?", "About 1.5 × 10^8 km", "about 93 million miles")).toBe(true);
    expect(settle("A movie starts at 2:45 p.m. and lasts 1 hour 30 minutes. What time does it end?", "4:15 p.m.", "16:15")).toBe(true);
    expect(settle("Of the 20 students in a class, 9 walk to school. What part of the class walks to school?", "9/20", "45%")).toBe(true);
    expect(settle("A diver is 15 meters below sea level. Write the elevation as a number of meters.", "−15", "negative 15 meters")).toBe(true);
    expect(settle("How long is one hour?", "60 minutes", "1 hour")).toBe(true);
    expect(settle("How long does the film last?", "2.5 hours", "2 hours 30 minutes")).toBe(true);
    expect(settle("How tall is the shelf?", "66 inches", "5 feet 6 inches")).toBe(true);
    expect(settle("Write 30,000 in scientific notation.", "3 × 10^4", "3.0 × 10⁴")).toBe(true);
    expect(settle("Write 30,000 in scientific notation.", "3 × 10^4", "3e4")).toBe(true);
  });
  it("leaves the question's form to the model: the right value written another way than it asks", () => {
    expect(settle("Write 9/20 as a percent.", "45%", "0.45")).toBeNull();
    expect(settle("Write 0.75 as a fraction in simplest form.", "3/4", "75/100")).toBeNull();
    expect(settle("Write 30,000 in scientific notation.", "3 × 10^4", "30 × 10^3")).toBeNull();
    expect(settle("What fraction of the pie is left?", "3/4", "0.75")).toBeNull();
    expect(settle("A path is 1,500 meters long. How long is it in kilometers?", "1.5 km", "1500 m")).toBeNull();
    expect(settle("How many inches are in 3 feet?", "36 inches", "3 feet")).toBeNull();
    // A different value is wrong whatever the form.
    expect(settle("Write 30,000 in scientific notation.", "3 × 10^4", "3 × 10^3")).toBe(false);
    expect(settle("Write 0.75 as a fraction in simplest form.", "3/4", "4/3")).toBe(false);
  });
  it("never marks wrong what may be the key rounded, or the key what may be it rounded", () => {
    expect(settle("What is 0 °C on the Kelvin scale?", "273.15 K", "273 K")).toBeNull();
    expect(settle("Write 1/8 as an exact decimal.", "0.125", "0.13")).toBeNull();
    expect(settle("Round 4,872 to the nearest hundred.", "4,900", "5,000")).toBeNull();
    expect(settle("Write 2/3 as a decimal rounded to the nearest hundredth.", "0.67", "0.7")).toBeNull();
    expect(settle("What is pi to two decimal places?", "3.14", "3.14159")).toBeNull();
    expect(settle("What is one third as a decimal?", "1/3", "0.33")).toBeNull();
    expect(settle("How long is a foot?", "1 foot", "30 cm")).toBeNull();
    expect(settle("How long is a mile?", "1 mile", "1.6 km")).toBeNull();
    expect(settle("How much does one liter of water weigh?", "1 kilogram", "2.2 pounds")).toBeNull();
    // A slip of one place is the model's ("0.66" for 0.67, "4,800" for 4,900); a gross miss on numbers the question gives is wrong ("20" for 25).
    expect(settle("Write 2/3 as a decimal rounded to the nearest hundredth.", "0.67", "0.66")).toBeNull();
    expect(settle("Round 4,872 to the nearest hundred.", "4,900", "4,800")).toBeNull();
    expect(settle("What is half of 50?", "25", "20")).toBe(false);
  });
  it("never marks wrong an answer that says about, two numbers, a range or an expression", () => {
    expect(settle("What is 20% of 50?", "10", "about 12")).toBeNull();
    expect(settle("What is 20% of 50?", "10", "8 or 10")).toBeNull();
    expect(settle("What is 20% of 50?", "10", "8-12")).toBeNull();
    expect(settle("What is 20% of 50?", "10", "50 x 0.2")).toBeNull();
    expect(settle("What is 20% of 50?", "10", "1,5")).toBeNull();
    expect(settle("What is 20% of 50?", "10", "10 apples")).toBeNull();
    expect(settle("What is 20% of 50?", "10", "406 020")).toBeNull();
  });
  it("never marks wrong a unit it may have misread, a scale it does not convert, or years against days", () => {
    expect(settle("A square has sides 3 meters long. What is its area?", "9 m²", "9 m")).toBeNull();
    expect(settle("How long is the break?", "60 minutes", "60 m")).toBeNull();
    expect(settle("Water boils at 100 °C. What is that in degrees Fahrenheit?", "212 °F", "212 °C")).toBeNull();
    expect(settle("At what temperature does water freeze?", "0 °C", "32 degrees")).toBeNull();
    expect(settle("At what temperature does water freeze?", "0 °C", "32 degrees Fahrenheit")).toBeNull();
    expect(settle("How long does the Earth take to go once around the Sun?", "About 365 days", "one year")).toBe(true);
    expect(settle("How long does the Earth take to go once around the Sun?", "365 days", "one year")).toBeNull();
    expect(settle("How many days are in a leap year?", "366 days", "1 year")).toBeNull();
    // Still wrong in the same units: "8 cm²" is an area, the key a volume.
    expect(settle("What is the volume of a cube with edges 2 cm long?", "8 cm³", "8 cm²")).toBe(false);
  });
  it("never marks wrong a bare number that may be the key in another unit, or when the question wants the unit", () => {
    expect(settle("A jug holds 4 cups of 250 mL. How much water does it hold?", "1 L", "1000")).toBeNull();
    expect(settle("How much does one liter of water weigh?", "1 kilogram", "2.2")).toBeNull();
    expect(settle("What is 50% as a fraction?", "50%", "0.5")).toBeNull();
    expect(settle("What is the density of pure water? Include the unit.", "1 g/cm³", "1")).toBeNull();
    expect(settle("What is the density of pure water? Include the unit.", "1 g/cm³", "2")).toBeNull();
    expect(settle("At what temperature does water freeze?", "0 °C", "32")).toBeNull();
    expect(settle("How many minutes are in 2.5 hours?", "150 minutes", "250")).toBe(false);
    expect(settle("You pay with a $5 bill for something that costs $3.25. How much change do you get?", "$1.75", "2.75")).toBe(false);
  });
  it("never marks wrong a comma and point the other way round, a clock with no a.m. or p.m., or a ratio", () => {
    expect(settle("How many meters are in a kilometer?", "1,000", "1.000")).toBeNull();
    expect(settle("What time does it end?", "4:15 p.m.", "4:15")).toBeNull();
    expect(settle("What time does it end?", "4:15 p.m.", "3:15")).toBeNull();
    expect(settle("What is the ratio of red to blue?", "2:3", "3:2")).toBeNull();
    expect(settle("What is the ratio of red to blue?", "2:30", "1:15")).toBeNull();
  });
  it("gives a bare key the unit the question asks for, and no other", () => {
    expect(settle("A diver is 15 meters below sea level. Write the elevation as a number of meters.", "−15", "-15 km")).toBe(false);
    expect(settle("How many days are in a leap year?", "366", "366 days")).toBe(true);
    expect(settle("How many days are in a leap year?", "366", "367 days")).toBeNull();
    expect(settle("How many hours is 120 minutes?", "2", "120 minutes")).toBeNull();
    expect(settle("A rope 3 meters long is cut into pieces 0.5 meters long. How many pieces are there?", "6", "6 meters")).toBeNull();
    expect(settle("What is -7 + 10?", "3", "3 meters")).toBeNull();
  });
  // Code rejects only a gross miss: another kind of unit, a factor of about 10, 100 or 1000, a.m. for p.m.,
  // a sign flip, or, on the numbers the question gives, a different fraction or more than 20% off. The
  // third review's cases are all right answers, or close enough that the model decides.
  it("never marks wrong a measured fact given to another precision (the third review's cases)", () => {
    expect(settle("How tall is Mount Everest?", "8,849 m", "8,848 m")).toBeNull();
    expect(settle("How tall is Mount Everest?", "8,849 m", "8,850 meters")).toBeNull();
    expect(settle("How tall is Mount Everest?", "8,849 m", "29,029 ft")).toBeNull();
    expect(settle("How fast does sound travel in air?", "343 m/s", "340 m/s")).toBeNull();
    expect(settle("How fast does light travel?", "299,792 km/s", "300,000 km/s")).toBeNull();
    expect(settle("How far is the Moon from the Earth?", "384,400 km", "385,000 km")).toBeNull();
    expect(settle("How many days does the Moon take to go around the Earth?", "27.3 days", "28 days")).toBeNull();
    expect(settle("What is room temperature in Celsius?", "20 °C", "21 °C")).toBeNull();
    expect(settle("What is normal body temperature in Fahrenheit?", "98.6 °F", "98 °F")).toBeNull();
    expect(settle("How fast does sound travel in air at 20 °C?", "343 m/s", "340 m/s")).toBeNull();
  });
  it("takes a near amount on an estimate question, and never marks one wrong on precision", () => {
    expect(settle("Estimate 49 x 21.", "1,000", "1,050")).toBe(true);
    expect(settle("Estimate 49 x 21.", "1,000", "1,029")).toBe(true);
    // No numbers to estimate from: a fact asked roughly keeps the key's own rounding, so the model decides
    // (held-out v8: the 10% band took "about 337 K" for about 373.15 K, digits swapped).
    expect(settle("Roughly how many seconds are in a day?", "86,400", "90,000")).toBeNull();
    expect(settle("About what temperature in kelvin does water boil at sea level?", "about 373.15 K", "about 337 K")).not.toBe(true);
    expect(settle("About what temperature in kelvin does water boil at sea level?", "about 373.15 K", "about 373 K")).toBe(true);
    expect(settle("Around how many people fit on the bus if each row holds 4 and there are 12 rows?", "50", "48")).toBe(true);
    expect(settle("Estimate 49 x 21.", "1,000", "1,200")).toBeNull();
    // A factor of 10 is still wrong.
    expect(settle("Estimate 49 x 21.", "1,000", "100")).toBe(false);
  });
  it("never marks wrong pi or a conversion factor rounded another way", () => {
    expect(settle("What is the area of a circle with a radius of 2 cm?", "12.56 cm²", "12.57 cm²")).toBeNull();
    expect(settle("What is the circumference of a circle with a diameter of 10 cm?", "31.4 cm", "31.42 cm")).toBeNull();
    expect(settle("What is pi to two decimal places?", "3.14", "3.1416")).toBeNull();
    expect(settle("How many miles is 100 km?", "62.1 miles", "62.5 miles")).toBeNull();
    expect(settle("A ball is dropped and falls for 3 seconds. How fast is it going?", "29.4 m/s", "30 m/s")).toBeNull();
  });
  it("reads a bare number in the unit the question counts, right when equal and the model's otherwise", () => {
    expect(settle("How many fourths are in three quarters?", "3/4", "3")).toBe(true);
    expect(settle("How many tenths are in 0.7?", "0.7", "7")).toBe(true);
    expect(settle("How many hundreds are in 300?", "300", "3")).toBe(true);
    expect(settle("How many fourths are in three quarters?", "3/4", "4")).toBeNull();
    // "What fraction" asks for a fraction, so a count is the model's.
    expect(settle("What fraction of the pizza is left, in thirds?", "2 thirds", "2")).toBeNull();
  });
  it("never marks wrong the other sign on a fall, a loss or a depth", () => {
    expect(settle("The temperature falls by 6 °C. What is the change in temperature?", "6 °C", "-6 °C")).toBeNull();
    expect(settle("A diver is 15 m below sea level. How deep is the diver?", "15 m", "-15 m")).toBeNull();
    expect(settle("A diver is 15 meters below sea level. Write the elevation as a number of meters.", "−15", "15")).toBeNull();
    // The older number match read "-$5" as 5, and so took "$15" for -$15 too. A minus before a dollar
    // sign is a sign now, so either way the model decides.
    expect(settle("Sam had $20 and lost $5 of it. How much money did Sam lose?", "$5", "-$5")).toBeNull();
    expect(settle("A bank account holds $40 and a bill of $55 is paid from it. What is the balance?", "-$15", "$15")).toBeNull();
    expect(settle("A bank account holds $40 and a bill of $55 is paid from it. What is the balance?", "-$15", "fifteen")).toBeNull();
    expect(settle("A bank account holds $40 and a bill of $55 is paid from it. What is the balance?", "-$15", "-15")).toBe(true);
    expect(settle("A bank account holds $40 and a bill of $55 is paid from it. What is the balance?", "$-15", "-$15")).toBe(true);
    // A sign flip on plain arithmetic is wrong.
    expect(settle("What is -7 + 10?", "3", "-3")).toBe(false);
    // Not bare arithmetic, so the sign flip is the model's (signMatters).
    expect(settle("What is 0 °C on the Kelvin scale?", "273.15 K", "-273 K")).toBeNull();
  });
  it("never marks wrong a percent read as a decimal, or a decimal as a percent", () => {
    expect(settle("What part of the class walks to school?", "0.45", "45")).toBeNull();
    expect(settle("What is the probability of heads on a fair coin?", "0.5", "50")).toBeNull();
    expect(settle("What percent of the class walks to school?", "45", "0.45")).toBeNull();
    // A factor of 10 is not a percent reading.
    expect(settle("What part of the class walks to school?", "0.45", "4.5")).toBe(false);
  });
  it("marks wrong only a.m. for p.m. on a clock time", () => {
    expect(settle("A movie starts at 2:45 p.m. and lasts 1 hour 30 minutes. What time does it end?", "4:15 p.m.", "4:15 a.m.")).toBe(false);
    expect(settle("A movie starts at 2:45 p.m. and lasts 1 hour 30 minutes. What time does it end?", "4:15 p.m.", "3:15 p.m.")).toBeNull();
  });
  it("leaves a near miss on a fact to the model, and marks a gross one wrong", () => {
    expect(settle("About how far is the Sun from the Earth?", "About 1.5 × 10^8 km", "150 million miles")).toBeNull();
    expect(settle("About how far is the Sun from the Earth?", "About 1.5 × 10^8 km", "1.5 × 10^8 m")).toBe(false);
    expect(settle("How many degrees are in a right angle?", "90°", "180 degrees")).toBeNull();
    // A fact given as another fraction, or as a fraction of a percent key, is the model's (the fourth
    // review's cases are in quiz-grade-batch.test.ts); a different fraction worked out from the
    // question's numbers, or a factor of 10, is still wrong.
    expect(settle("A pizza has 10 slices and 7 are eaten. What fraction is eaten?", "7/10", "3/4")).toBe(false);
    expect(settle("A pizza has 10 slices and 7 are eaten. What fraction is eaten?", "about 7/10", "3/4")).toBeNull();
    expect(settle("How much of Earth's surface is covered by water?", "70%", "0.07")).toBe(false);
    expect(settle("How much of Earth's surface is covered by water?", "70%", "7")).toBe(false);
    expect(settle("The temperature was 10 °C in the afternoon and 4 °C at night. How much did it go down?", "6 °C", "-60 °C")).toBe(false);
    // A sign flip is gross only on bare arithmetic (signMatters); elsewhere either sign may be meant.
    expect(settle("What is 3 - 5?", "-2", "2")).toBe(false);
    expect(settle("What is 4 × -3?", "-12", "12")).toBe(false);
    expect(settle("Compute -2 - 3.", "-5", "5")).toBe(false);
    // Held-out v6: the word match dropped the exponent's minus, so "3.8 × 10^4" matched 3.8 × 10^-4.
    for (const a of ["3.8 × 10^4", "3.8 x 10^4", "3.8 × 10⁴"]) {
      expect(settle("Write 0.00038 in scientific notation.", "3.8 × 10^-4", a), a).not.toBe(true);
    }
    for (const a of ["3.8 × 10^-4", "3.8 x 10^-4", "3.8 × 10⁻⁴", "3.8 * 10^-4"]) {
      expect(settle("Write 0.00038 in scientific notation.", "3.8 × 10^-4", a), a).toBe(true);
    }
    expect(settle("5 minus 9", "-4", "4")).toBe(false);
    expect(settle("What is 1/4 - 3/4?", "-1/2", "1/2")).toBe(false);
    expect(settle("How much less is 3 than 10?", "7", "-7")).toBeNull();
    expect(settle("What is the temperature at night if it is -4 °C?", "-4 °C", "4 °C")).toBeNull();
  });
  it("marks wrong a different kind of quantity, each with its own unit", () => {
    expect(settle("A price rises from $40 to $50. By what percent did it increase?", "25%", "$10")).toBe(false);
    expect(settle("How far did they walk?", "20 km", "20 minutes")).toBe(false);
  });
});

// Round 5: a note for the model when the answer may be the key misspelt. Code never decides here.
// A small stand-in dictionary: the real words these tests need, and the synonyms it lists.
const WORDS = ["skeleton", "glucagon", "glycogen", "biologist", "geologist", "history", "mystery", "verb", "herb",
  "orbit", "sorbet", "aluminum", "aluminium", "hypertonic", "hypotonic", "geologists", "membrane", "cell"];
const dict = (words: string[] = WORDS, synonyms: Record<string, string[]> = { aluminium: ["aluminum", "al"] }, listed: string[] = []): SpellingLookup => ({
  isWord: (w) => words.includes(w),
  listed: (w) => listed.includes(w),
  synonyms: (w) => synonyms[w] ?? [],
  wordsNear: (w, edits) => wordsWithin(words, w, edits),
});
const note = (q: string, key: string, a: string, d = dict()) => misspellingNote(ask(q, key, a), d);
const BONES = "What is the frame of bones that holds up the body called?";

// Round 7: held-out v6's model misses, in new questions (GRADE_DEV_NAMES_TIMES): a clock time in words, a
// surname on a question that names a role or a surname of two words, and a misspelt place or person.
// The words these tests treat as real, as the bundled dictionary and word list have them.
const NAMES_REAL = new Set(["fleming", "einstein", "nightingale", "cook", "newton", "curie", "bell", "graham", "alexander", "young", "army", "continental", "gobi", "alps", "niger", "desert", "dessert"]);
const nameWord = (w: string) => NAMES_REAL.has(w);
const named = (q: string, key: string, a: string) => settleByCode(ask(q, key, a), nameWord, nameWord);
// The most any lookup could allow a name: no word is real, in the dictionary or the word list.
const noWords = () => false;

describe("settleByCode: a clock time in words", () => {
  const CLASS = "A science class begins at 10:50 and lasts 25 minutes. When does it end?";
  const WALK = "A girl leaves home at 3:10 p.m. and walks for 20 minutes. What time does she get to the park?";
  it("accepts the key's time in words", () => {
    for (const a of ["quarter past eleven", "quarter after eleven", "a quarter past 11", "eleven fifteen", "fifteen minutes past eleven", "at quarter past eleven"]) {
      expect(named(CLASS, "11:15", a)).toBe(true);
    }
    expect(named("What time does the shop open?", "9:45", "a quarter to ten")).toBe(true);
    expect(named("What time does the shop open?", "3:05", "three oh five")).toBe(true);
    expect(named("What time does the shop open?", "3:05", "five past three")).toBe(true);
    expect(named("What time does the shop open?", "4:00", "four o'clock")).toBe(true);
    expect(named("What time does the shop open?", "12:30", "half past twelve")).toBe(true);
    expect(named("What time is lunch?", "12:00 p.m.", "noon")).toBe(true);
    expect(named("What time is lunch?", "12:00 p.m.", "twelve noon")).toBe(true);
    expect(named("What time does the day start?", "12:00 a.m.", "midnight")).toBe(true);
    expect(named("What time does the day end?", "11:45 p.m.", "quarter to midnight")).toBe(true);
    expect(named("When does the flight land?", "15:30", "fifteen thirty")).toBe(true);
  });
  it("takes the half of the day only when it is the key's", () => {
    expect(named(WALK, "3:30 p.m.", "half past three in the afternoon")).toBe(true);
    expect(named(WALK, "3:30 p.m.", "half past three p.m.")).toBe(true);
    expect(named("What time does the film start?", "9:40 p.m.", "nine forty at night")).toBe(true);
    expect(named("What time does the film start?", "5:15 p.m.", "five fifteen in the evening")).toBe(true);
    expect(named("What time does the bus come?", "9:45 a.m.", "quarter to ten in the morning")).toBe(true);
    expect(named("What time does the bus come?", "4:00 p.m.", "four in the afternoon")).toBe(true);
    // The other half of the day: never accepted, and never marked wrong in words; the model decides.
    expect(named(WALK, "3:30 p.m.", "half past three in the morning")).toBeNull();
    expect(named("What time does the bus come?", "9:45 a.m.", "nine forty-five p.m.")).toBeNull();
    expect(named("What time does the film start?", "9:40 p.m.", "nine forty in the morning")).toBeNull();
    expect(named("What time is lunch?", "12:00 p.m.", "midnight")).toBeNull();
    // A half that cannot be told: "twelve in the morning", "two at night".
    expect(named("What time does the bus come?", "12:00 a.m.", "twelve in the morning")).toBeNull();
    expect(named("What time does the bus come?", "2:00 a.m.", "two at night")).toBeNull();
    // A half the key does not give.
    expect(named(CLASS, "11:15", "quarter past eleven at night")).toBeNull();
  });
  it("takes no half of the day only when the key has none or the question pins it", () => {
    expect(named(WALK, "3:30 p.m.", "half past three")).toBe(true);
    expect(named(WALK, "3:30 p.m.", "3:30")).toBe(true);
    expect(named("What time does the bus come?", "3:30 p.m.", "half past three")).toBeNull();
    expect(named("What time does the bus come?", "3:30 p.m.", "3:30")).toBeNull();
    // The question says the other half: "8:30 p.m." then a time the next morning.
    expect(named("Sam goes to bed at 8:30 p.m. and sleeps for 10 hours. What time does he wake up?", "6:30 a.m.", "six thirty")).toBeNull();
    expect(named("Lunch starts at 11:40 a.m. and lasts 30 minutes. When does it end?", "12:10 p.m.", "ten past twelve")).toBeNull();
  });
  it("never takes another time", () => {
    for (const a of ["quarter to eleven", "half past eleven", "eleven fifty", "quarter past ten", "about quarter past eleven", "eleven", "fifteen past", "half to eleven"]) {
      expect(named(CLASS, "11:15", a)).toBeNull();
    }
    expect(named("What time does the bus come?", "3:05 p.m.", "five to three")).toBeNull();
    expect(named("What is the ratio of boys to girls?", "11:15", "quarter past eleven")).toBeNull();
    // A key that is no clock time on a question about no time.
    expect(named("What is the score?", "11:15", "quarter past eleven")).toBeNull();
  });
  it("still marks wrong a.m. for p.m. in digits", () => {
    expect(named("A swimming lesson starts at 4:35 in the afternoon and lasts 40 minutes. When does it end?", "5:15 p.m.", "5:15 a.m.")).toBe(false);
  });
});

describe("settleByCode: a surname", () => {
  it("takes the surname on a question that names a person's role, not only one that asks who", () => {
    expect(named("Which scientist noticed that a mould killed bacteria?", "Alexander Fleming", "fleming")).toBe(true);
    expect(named("Which naturalist wrote On the Origin of Species?", "Charles Darwin", "darwin")).toBe(true);
    expect(named("Which nurse was called the Lady with the Lamp?", "Florence Nightingale", "nightingale")).toBe(true);
    expect(named("Which explorer charted the east coast of Australia in 1770?", "James Cook", "cook")).toBe(true);
    expect(named("Name the author of Pride and Prejudice.", "Jane Austen", "austen")).toBe(true);
    expect(named("Which English physicist described universal gravitation?", "Isaac Newton", "newton")).toBe(true);
    expect(named("Which 19th-century scientist wrote about natural selection?", "Charles Darwin", "darwin")).toBe(true);
  });
  it("takes the last two words of a three- or four-word name", () => {
    expect(named("Which writer invented the detective who lives at 221B Baker Street?", "Arthur Conan Doyle", "conan doyle")).toBe(true);
    expect(named("Which writer invented the detective who lives at 221B Baker Street?", "Arthur Conan Doyle", "doyle")).toBe(true);
    expect(named("Who was granted the first patent for the telephone?", "Alexander Graham Bell", "graham bell")).toBe(true);
    expect(named("Who was granted the first patent for the telephone?", "Alexander Graham Bell", "bell")).toBe(true);
    expect(named("Who led the march?", "Martin Luther King Jr.", "luther king")).toBe(true);
  });
  it("takes a misspelt surname", () => {
    expect(named("Which naturalist wrote On the Origin of Species?", "Charles Darwin", "darwen")).toBe(true);
    expect(named("Who wrote Pride and Prejudice?", "Jane Austen", "jane austin")).toBe(true);
    expect(named("Which physicist explained that mass and energy are linked?", "Albert Einstein", "einstien")).toBe(true);
    expect(named("Which scientist noticed that a mould killed bacteria?", "Alexander Fleming", "flemming")).toBe(true);
  });
  it("never takes a first name, a middle name alone, another person or a role that is an everyday word", () => {
    expect(named("Which writer invented Sherlock Holmes?", "Arthur Conan Doyle", "arthur")).toBeNull();
    expect(named("Which writer invented Sherlock Holmes?", "Arthur Conan Doyle", "conan")).toBeNull();
    expect(named("Which writer invented Sherlock Holmes?", "Arthur Conan Doyle", "arthur conan")).toBeNull();
    expect(named("Which writer invented Sherlock Holmes?", "Arthur Conan Doyle", "sherlock holmes")).toBeNull();
    expect(named("Which scientist noticed that a mould killed bacteria?", "Alexander Fleming", "Ian Fleming")).toBeNull();
    expect(named("Which naturalist wrote On the Origin of Species?", "Charles Darwin", "Erasmus Darwin")).toBeNull();
    expect(named("Which president issued the Emancipation Proclamation?", "Abraham Lincoln", "Mary Todd Lincoln")).toBeNull();
    expect(named("Which composer wrote the Brandenburg Concertos?", "Johann Sebastian Bach", "Carl Philipp Emanuel Bach")).toBeNull();
    expect(named("Which general idea drove settlers west?", "Manifest Destiny", "destiny")).toBeNull();
    expect(named("Which man-made lake lies behind the Hoover Dam?", "Lake Mead", "mead")).toBeNull();
    expect(named("Which city is the capital of the United States?", "Washington D.C.", "dc")).toBeNull();
  });
  it("never takes the surname the question says, or one under a choice", () => {
    expect(named("Which Roosevelt was president for most of World War II?", "Franklin D. Roosevelt", "roosevelt")).toBeNull();
    expect(named("Which Roosevelt was president for most of World War II?", "Franklin D. Roosevelt", "Theodore Roosevelt")).toBeNull();
    expect(named("Who won two Nobel Prizes, Marie Curie or Pierre Curie?", "Marie Curie", "curie")).toBeNull();
    expect(named("Which composer was a son of Johann Sebastian Bach?", "Carl Philipp Emanuel Bach", "bach")).toBeNull();
    expect(named("Which composer was a son of Johann Sebastian Bach?", "Carl Philipp Emanuel Bach", "emanuel bach")).toBeNull();
  });
});

describe("settleByCode: a misspelt name", () => {
  it("takes a place or person's name misspelt by ear", () => {
    expect(named("Which great desert stretches across North Africa?", "The Sahara", "the sahera")).toBe(true);
    expect(named("Which great desert stretches across North Africa?", "The Sahara Desert", "the sahera desert")).toBe(true);
    expect(named("Which great desert stretches across North Africa?", "The Sahara", "sahra")).toBe(true);
    expect(named("Which Roman town near Naples was buried in ash?", "Pompeii", "pompei")).toBe(true);
    expect(named("Which Roman town near Naples was buried in ash?", "Pompeii", "pompii")).toBe(true);
    expect(named("Which mountain range lies between France and Spain?", "The Pyrenees", "the pyranees")).toBe(true);
    expect(named("Which mountain range lies between France and Spain?", "The Pyrenees", "pyrennees")).toBe(true);
    expect(named("Which South American country has Caracas as its capital?", "Venezuela", "venezuala")).toBe(true);
    expect(named("Which king of Babylon wrote an early law code?", "Hammurabi", "hamurabi")).toBe(true);
    expect(named("Which Carthaginian general crossed the Alps?", "Hannibal", "hannibel")).toBe(true);
    expect(named("Which planet has the Great Red Spot?", "Jupiter", "jupeter")).toBe(true);
    expect(named("Which European country has Ljubljana as its capital?", "Slovenia", "solvenia")).toBe(true);
    expect(named("Which country has Vienna as its capital?", "Austria", "austrea")).toBe(true);
  });
  it("never takes another place, a consonant changed, an end letter changed, or a misspelling as close to another name", () => {
    // Another country, state, continent or planet as close.
    expect(named("Which European country has Ljubljana as its capital?", "Slovenia", "slovinia")).toBeNull();
    expect(named("Which European country has Ljubljana as its capital?", "Slovenia", "slovania")).toBeNull();
    expect(named("Which European country has Ljubljana as its capital?", "Slovenia", "Slovakia")).toBeNull();
    expect(named("Which European country has Ljubljana as its capital?", "Slovenia", "slovakea")).toBeNull();
    expect(named("Which country lies along the Gambia River?", "The Gambia", "Zambia")).toBeNull();
    expect(named("Which country has Vienna as its capital?", "Austria", "australia")).toBeNull();
    expect(named("Which country has Abuja as its capital?", "Nigeria", "niger")).toBeNull();
    expect(named("Which country has Abuja as its capital?", "Nigeria", "nigerea")).toBeNull();
    expect(named("Which state has Atlanta as its capital?", "Georgia", "george")).toBeNull();
    expect(named("Which country has Georgetown as its capital?", "Guyana", "guiana")).toBeNull();
    // A word of the question as close: the question offers it.
    expect(named("Did Hannibal or Hamilcar cross the Alps?", "Hannibal", "hamilcal")).toBeNull();
    expect(named("Did the Zorvani or the Zorvena build the temple?", "The Zorvena", "zorvana")).toBeNull();
    expect(named("Which people built the temple?", "The Zorvena", "zorvana")).toBe(true);
    // The name of another place, misspelt.
    expect(named("Which Roman town near Naples was buried in ash?", "Pompeii", "herculanium")).toBeNull();
    expect(named("Which great desert stretches across North Africa?", "The Sahara", "the kalahary")).toBeNull();
    expect(named("Which planet has the Great Red Spot?", "Jupiter", "nepchune")).toBeNull();
    // An end letter changed: "pompey" is Pompey the Great.
    expect(named("Which Roman town near Naples was buried in ash?", "Pompeii", "pompey")).toBeNull();
    expect(named("Which great desert stretches across North Africa?", "The Sahara", "the sahare")).toBeNull();
    expect(named("Which great desert stretches across North Africa?", "The Sahara", "zahara")).toBeNull();
    // Too short to tell: "Mali" and "Bali".
    expect(named("Which country is Timbuktu in?", "Mali", "malli")).toBeNull();
    // The rest of the answer must be the key's: "dessert" is another word.
    expect(named("Which great desert stretches across North Africa?", "The Sahara Desert", "the sahera dessert")).toBeNull();
  });
  it("never takes a name when a lookup is missing or the word is real", () => {
    // Without the word list, no misspelt name.
    expect(settleByCode(ask("Which Roman town near Naples was buried in ash?", "Pompeii", "pompei"), noWords)).toBeNull();
    // A key word the word list has is a word, not a name.
    expect(settleByCode(ask("What do we call a scientist who studies stars?", "Astronomer", "astronamer"), noWords, (w) => w === "astronomer")).toBeNull();
    // An answer word the word list has is a real word.
    expect(settleByCode(ask("Which Roman town near Naples was buried in ash?", "Pompeii", "pompei"), noWords, (w) => w === "pompei")).toBeNull();
  });
  it("counts only slips of spelling by ear", () => {
    expect(slipEdits("sahara", "sahera")).toBe(1);
    expect(slipEdits("pompeii", "pompei")).toBe(1);
    expect(slipEdits("hannibal", "hanibal")).toBe(1);
    expect(slipEdits("slovenia", "solvenia")).toBe(1);
    expect(slipEdits("nigeria", "niger")).toBe(2);
    expect(slipEdits("slovenia", "slovakia")).toBeGreaterThan(2);
    expect(slipEdits("austria", "australia")).toBeGreaterThan(2);
    expect(slipEdits("gambia", "zambia")).toBeGreaterThan(2);
  });
});

describe("settleByCode on the names and times dev set", () => {
  const lookups: Array<[string, (key: string) => (w: string) => boolean, (w: string) => boolean]> = [
    ["no word real", () => noWords, noWords],
    ["the dictionary's words", () => nameWord, nameWord],
    ["the key's words real", keyOnly, noWords],
  ];
  it.each(lookups)("settles no wrong answer, with %s", (_, isWord, listed) => {
    const passed = GRADE_DEV_NAMES_TIMES.flatMap((q) => q.answers
      .filter((a) => !a.right && settleByCode(ask(q.question, q.key, a.text), isWord(q.key), listed) === true)
      .map((a) => `${q.id} ${a.text}`));
    expect(passed).toEqual([]);
  });
  it("settles held-out v6's kinds of miss, rewritten", () => {
    const settled = GRADE_DEV_NAMES_TIMES.flatMap((q) => q.answers.filter((a) => a.right && named(q.question, q.key, a.text) === true).map((a) => a.text));
    for (const a of ["quarter past eleven", "the sahera", "pompei", "fleming", "conan doyle"]) expect(settled).toContain(a);
  });
});

// Round 8: held-out v7's model misses, in new questions (GRADE_DEV_RESTATE): a length of time in other
// units, a depth written with "below", and a title in place of a first name. Accept only.
describe("settleByCode: a length of time in decades, centuries, millennia, fortnights or months", () => {
  const PARK = "A park opened in 1974. How old was it in 2024?";
  it("accepts the key's amount in another unit of time", () => {
    expect(named(PARK, "50 years", "5 decades")).toBe(true);
    expect(named(PARK, "50 years", "five decades")).toBe(true);
    expect(named("How long ago was the cathedral finished?", "300 years", "3 centuries")).toBe(true);
    expect(named("How long was the pot buried?", "2,000 years", "2 millennia")).toBe(true);
    expect(named("How long can she keep the book?", "14 days", "a fortnight")).toBe(true);
    expect(named("How long can she keep the book?", "14 days", "one fortnight")).toBe(true);
    expect(named("How long between two counts?", "10 years", "a decade")).toBe(true);
    expect(named("How old was the school?", "100 years", "a century")).toBe(true);
    expect(named("How old was the school?", "100 years", "10 decades")).toBe(true);
    expect(named("How long did the work take?", "18 months", "1.5 years")).toBe(true);
    expect(named("How long did the work take?", "18 months", "one and a half years")).toBe(true);
    expect(named("How long did the work take?", "1.5 years", "18 months")).toBe(true);
    expect(named("How long did the war last?", "1 century", "100 years")).toBe(true);
  });
  it("never marks an answer wrong because of these units: another count or unit goes to the model", () => {
    expect(named(PARK, "50 years", "4 decades")).toBeNull();
    expect(named(PARK, "50 years", "5 centuries")).toBeNull();
    expect(named("How old was the school?", "100 years", "a millennium")).toBeNull();
    expect(named("How long between two counts?", "10 years", "10 decades")).toBeNull();
    expect(named("How long can she keep the book?", "14 days", "2 fortnights")).toBeNull();
    expect(named("How long did the work take?", "18 months", "18 years")).toBeNull();
    expect(named("How long did the work take?", "18 months", "15 months")).toBeNull();
    expect(named("How many decades are in 50 years?", "5 decades", "50 decades")).toBeNull();
    // The units it already had still decide both ways, and a bare number is not read in decades.
    expect(named(PARK, "50 years", "5")).toBe(false);
    expect(named(PARK, "50 years", "500 years")).toBe(false);
  });
  it("keeps the calendar caution: a month is no set number of days or weeks", () => {
    expect(named("About how long was the trip?", "About 61 days", "about 2 months")).toBeNull();
    expect(named("How long was the trip?", "61 days", "2 months")).toBeNull();
    expect(named("How long can she keep the book?", "14 days", "a month")).toBeNull();
    expect(named("How long is a month?", "4 weeks", "1 month")).toBeNull();
    expect(named("How long is the course?", "1 year", "52 weeks")).toBeNull();
  });
  it("leaves the unit the question asks for to the model", () => {
    expect(named("How many years old was the park in 2024?", "50 years", "5 decades")).toBeNull();
  });
});

describe("settleByCode: a depth or height in words", () => {
  const DIVER = "A diver is 20 meters below the surface of a lake and swims up 9 meters. Where is she now?";
  it("accepts the key's depth with below, deep or down, and leaves a height with above to the model", () => {
    for (const a of ["11 meters below the surface", "11 m below sea level", "eleven metres below the surface of the lake", "11 m deep", "11 meters down", "11 m underwater", "1100 cm below the surface", "11 meters below the water"]) {
      expect(named(DIVER, "-11 m", a), a).toBe(true);
    }
    expect(named("What is the elevation of the bottom of the well?", "−12 m", "12 m below ground level")).toBe(true);
    expect(named("What is the village's elevation?", "250 m", "250 meters above sea level")).toBeNull(); // a positive key carries no direction (see settleDirected)
    expect(named("Write her position as a number of meters, with the mouth at 0.", "-15", "15 meters below the ground")).toBe(true);
  });
  it("never takes the other direction, another amount or unit, no unit, or a bare amount", () => {
    for (const a of ["11 meters above the surface", "11 km below the surface", "110 m below the surface", "11 below the surface", "11 m", "11", "11 seconds below the surface", "-11 m below the surface", "11 m below", "12 m below the surface"]) {
      expect(named(DIVER, "-11 m", a), a).toBeNull();
    }
    expect(named("What is the village's elevation?", "250 m", "250 m below sea level")).toBeNull();
    expect(named("How deep is the pool?", "3 m", "3 m deep")).toBeNull();
    expect(named("What is the temperature?", "-5 °C", "5 degrees below the surface")).toBeNull();
    expect(named("What number is 11 less than 0?", "-11", "11 m below the surface")).toBeNull();
  });
});

describe("settleByCode: a title and the surname", () => {
  const NOBEL = "Which scientist was the first woman to win a Nobel Prize?";
  it("accepts a title in place of the first name where the surname alone is accepted", () => {
    for (const a of ["madame curie", "Madame Curie", "mme curie", "Mme. Curie", "madam curie", "dr curie"]) expect(named(NOBEL, "Marie Curie", a), a).toBe(true);
    expect(named("Which civil rights leader gave the 'I Have a Dream' speech?", "Martin Luther King Jr.", "dr king")).toBe(true);
    expect(named("Which civil rights leader gave the 'I Have a Dream' speech?", "Martin Luther King Jr.", "Dr. Luther King")).toBe(true);
    expect(named("Who wrote 'She Walks in Beauty' and died in Greece in his thirties?", "George Gordon Byron", "lord byron")).toBe(true);
    expect(named("Which suffragette leader founded the WSPU with her daughters?", "Emmeline Pankhurst", "Mrs. Pankhurst")).toBe(true);
    expect(named("Which explorer was found by Stanley in 1871?", "David Livingstone", "doctor livingstone")).toBe(true);
    // Only where the surname alone is taken: "missionary" names no role the surname rule knows.
    expect(named("Which missionary was found by Stanley in 1871?", "David Livingstone", "doctor livingstone")).toBeNull();
  });
  it("never takes a title with another surname, under a choice, with a surname the question says, or on a question about no person", () => {
    expect(named(NOBEL, "Marie Curie", "madame pasteur")).toBeNull();
    expect(named(NOBEL, "Marie Curie", "Pierre Curie")).toBeNull();
    expect(named(NOBEL, "Marie Curie", "madame")).toBeNull();
    expect(named(NOBEL, "Marie Curie", "madame marie")).toBeNull();
    expect(named("Which scientist won two Nobel Prizes, Marie Curie or Pierre Curie?", "Marie Curie", "madame curie")).toBeNull();
    expect(named("Which scientist won two Nobel Prizes, Marie Curie or Pierre Curie?", "Marie Curie", "mr curie")).toBeNull();
    expect(named("Which Curie won two Nobel Prizes?", "Marie Curie", "madame curie")).toBeNull();
    expect(named("Which explorer was found by Stanley in 1871?", "David Livingstone", "dr stanley")).toBeNull();
    expect(named("Which mathematician wrote a program for Babbage's engine?", "Ada Lovelace", "lady babbage")).toBeNull();
    expect(named("What city is the capital of Minnesota?", "Saint Paul", "st paul")).toBeNull();
  });
  it("takes a misspelt surname after a title, as it does alone", () => {
    expect(named("Which naturalist wrote On the Origin of Species after his voyage?", "Charles Darwin", "mr darwen")).toBe(true);
    expect(misspeltNameCandidates(ask("Which naturalist wrote On the Origin of Species?", "Charles Darwin", "mr darwen"))).toEqual(expect.arrayContaining(["darwen", "darwin"]));
  });
});

describe("settleByCode on the restatements dev set", () => {
  const lookups: Array<[string, (key: string) => (w: string) => boolean, (w: string) => boolean]> = [
    ["no word real", () => noWords, noWords],
    ["the dictionary's words", () => nameWord, nameWord],
    ["the key's words real", keyOnly, noWords],
  ];
  it.each(lookups)("settles no wrong answer and marks no answer wrong, with %s", (_, isWord, listed) => {
    const settled = GRADE_DEV_RESTATE.flatMap((q) => q.answers
      .map((a) => ({ a, got: settleByCode(ask(q.question, q.key, a.text), isWord(q.key), listed) }))
      .filter(({ a, got }) => (!a.right && got === true) || got === false)
      .map(({ a, got }) => `${q.id} ${a.text} ${got}`));
    expect(settled).toEqual([]);
  });
  it("settles held-out v7's kinds of miss, rewritten", () => {
    const settled = GRADE_DEV_RESTATE.flatMap((q) => q.answers.filter((a) => a.right && named(q.question, q.key, a.text) === true).map((a) => a.text));
    for (const a of ["5 decades", "11 meters below the surface", "madame curie", "a fortnight", "4 meters under the water", "dr king"]) expect(settled).toContain(a);
  });
});

// Round 11: held-out v8's model misses, in new questions (GRADE_DEV_DIRECTION_YEARS): a negative written
// as a word ("$15 overdrawn" for -$15) and a year said in pairs ("twelve fifteen" for 1215). Accept only.
describe("settleByCode: a sign written as a word", () => {
  const BILL = "A bank account holds $40. Its owner pays a bill of $55 from it. What is the account balance now?";
  const NIGHT = "At dawn the temperature was 4 °C. By midnight it had dropped 19 degrees. What was the temperature at midnight?";
  const SHARE = "A share was worth $52 on Monday and $37 on Friday. What was the change in its price over the week?";
  it("accepts a balance, temperature or score whose sign is a word that means the key's sign", () => {
    for (const a of ["$15 overdrawn", "overdrawn by $15", "overdrawn $15", "15 dollars overdrawn", "$15 in debt", "in debt by $15", "owes $15", "$15 in the red", "15 overdrawn", "It's $15 overdrawn."]) {
      expect(named(BILL, "-$15", a), a).toBe(true);
    }
    expect(named(BILL, "-15", "$15 overdrawn")).toBe(true);
    for (const a of ["15 below zero", "15 degrees below zero", "fifteen below zero", "15 °C below zero"]) expect(named(NIGHT, "-15 °C", a), a).toBe(true);
    const LEADER = "A team has 48 points and the leading team has 63. Taking the leader's score as 0, what is the team's score?";
    for (const a of ["15 points behind", "behind by 15", "15 behind", "fifteen points behind"]) expect(named(LEADER, "-15", a), a).toBe(true);
    expect(named(LEADER, "-15 points", "15 points behind")).toBe(true);
    expect(named("A golfer took 69 strokes on a course where par is 72. What is the golfer's score relative to par?", "-3", "3 under par")).toBe(true);
  });
  it("accepts a change whose sign is a word, on a question that asks for a change", () => {
    for (const a of ["a drop of $15", "down $15", "down by $15", "dropped $15", "fell $15", "a fall of $15", "a decrease of $15", "a $15 drop", "went down $15"]) {
      expect(named(SHARE, "-$15", a), a).toBe(true);
    }
    const STAND = "A lemonade stand spent $30 on supplies and took in $18 in sales. What was its profit?";
    for (const a of ["a loss of $12", "lost $12", "a $12 loss", "$12 loss"]) expect(named(STAND, "-$12", a), a).toBe(true);
    const COOLING = "At noon it was 21 °C and by evening it was 13 °C. What was the change in temperature?";
    expect(named(COOLING, "-8 °C", "a drop of 8 degrees")).toBe(true);
    expect(named(COOLING, "-8 °C", "down 8")).toBe(true);
  });
  it("leaves the mirror for a positive key to the model: a positive key is an unsigned size", () => {
    const PAID = "A savings account held $5. Its owner then paid in $10. What is the balance now?";
    for (const a of ["$15 in credit", "in credit by $15", "$15 in the black"]) expect(named(PAID, "$15", a), a).toBeNull();
    // A debt said in any sentence: the same words fit "Sam is $40 in debt. He pays back $25.", still owed.
    for (const a of ["$15 in credit", "in credit by $15"]) {
      expect(named("A bank account was $10 overdrawn. Its owner then paid in $25. What is the balance now?", "$15", a), a).toBeNull();
    }
    expect(named("Before sunrise it was -6 °C. By noon the temperature had risen 21 degrees. What was the temperature at noon?", "15 °C", "15 above zero")).toBeNull();
    expect(named("A team has 63 points and the next team has 48. Taking the second team's score as 0, what is the leader's score?", "15", "15 points ahead")).toBeNull();
    expect(named("A plant was 12 cm tall last week and is 17 cm tall now. What was the change in its height?", "5 cm", "an increase of 5 cm")).toBeNull();
    expect(named("A stand spent $18 and took in $30. What was its profit?", "$12", "a profit of $12")).toBeNull();
    expect(named("A stand spent $18 and took in $30. What was its profit?", "$12", "up $12")).toBeNull();
  });
  it("never takes a rise for an unsigned key, whatever the question says or doesn't say (the verifier's cases)", () => {
    const cases: Array<[string, string, string]> = [
      ["Leo's score went from 40 to 25. What was the change in his score?", "15", "a gain of 15"],
      ["A plane's altitude went from 4000 m to 2500 m. What was the change in altitude?", "1500 m", "an increase of 1500 m"],
      ["The class had 30 students and now has 25. What was the change in class size?", "5", "an increase of 5"],
      ["The temperature cooled from 25 °C to 10 °C. What was the change in temperature?", "15 °C", "rose 15 °C"],
      ["A stock's price plunged from $40 to $25. What was the change in price?", "$15", "went up $15"],
      ["The water level sank from 40 cm to 25 cm. What was the change in the water level?", "15 cm", "rose 15 cm"],
      ["The town's population shrank from 415 to 400. What was the change in population?", "15", "an increase of 15"],
      ["The price of a game dipped from $40 to $25. What was the price change?", "$15", "a gain of $15"],
    ];
    for (const [q, k, a] of cases) expect(named(q, k, a), a).not.toBe(true);
  });
  it("never takes the other direction, another amount, a bare amount, or a sign of its own", () => {
    for (const a of ["$15 in credit", "in credit by $15", "$16 overdrawn", "$1.50 overdrawn", "$15", "15", "fifteen", "-$15 overdrawn", "about $15 overdrawn", "15 points ahead", "15 above zero"]) {
      expect(named(BILL, "-$15", a), a).not.toBe(true);
    }
    for (const a of ["15 above zero", "15 degrees above zero", "fifteen"]) expect(named(NIGHT, "-15 °C", a), a).not.toBe(true);
    for (const a of ["up $15", "a rise of $15", "a gain of $15", "a drop of $51"]) expect(named(SHARE, "-$15", a), a).not.toBe(true);
    expect(named("A golfer took 69 strokes on a course where par is 72. What is the golfer's score relative to par?", "-3", "3 over par")).not.toBe(true);
  });
  it("reads a change only on a question that asks for one, and a balance or temperature only where it does not", () => {
    // "A drop of 10" is how far something fell, not where it is.
    expect(named("It was 5 °C and fell 15 degrees by night. What was the temperature at night?", "-10 °C", "a drop of 10")).toBeNull();
    expect(named(BILL, "-$15", "lost $15")).toBeNull();
    expect(named(SHARE, "-$15", "$15 overdrawn")).toBeNull();
    expect(named(SHARE, "-$15", "$15 in debt")).toBeNull();
  });
  it("never reads a positive key's size as a rise or a credit", () => {
    expect(named("A stand spent $30 and took in $18. What was its loss?", "$12", "a profit of $12")).toBeNull();
    expect(named("A stand spent $30 and took in $18. What was its loss?", "$12", "a gain of $12")).toBeNull();
    expect(named("It was 5 °C at noon and -10 °C at night. How many degrees did the temperature fall?", "15 °C", "15 above zero")).toBeNull();
    expect(named("It was 5 °C at noon and -10 °C at night. How many degrees did the temperature fall?", "15 °C", "up 15")).toBeNull();
    expect(named("A customer paid $40 of a $55 bill. How much does the customer still owe?", "$15", "$15 in credit")).toBeNull();
    expect(named("A share fell from $52 to $37. What was the change in its price, as a drop?", "$15", "up $15")).toBeNull();
  });
  it("never on a question that asks for the sign or already says the amount and the direction", () => {
    expect(named("Write an integer for a balance that is $15 overdrawn.", "-15", "$15 overdrawn")).toBeNull();
    expect(named("An account is overdrawn by $15. What is its balance?", "-$15", "$15 overdrawn")).toBeNull();
    expect(named("A team is behind by 15 points. Taking the leader's score as 0, what is its score?", "-15", "15 points behind")).toBeNull();
    expect(named("A share lost $15 this week. What was the change in its price?", "-$15", "lost $15")).toBeNull();
    // Par: only on a question about golf.
    expect(named("A team scored 3 fewer goals than its rival. What is the difference in goals?", "-3", "3 under par")).toBeNull();
  });
  it("reads no other words as a sign", () => {
    expect(named("What is the temperature?", "-15 °C", "15 cold")).toBeNull();
    expect(named(BILL, "-$15", "$15 short")).toBeNull();
    expect(named(BILL, "-$15", "$15 owed")).toBeNull();
    expect(named(NIGHT, "-15 °C", "15 kg below zero")).toBeNull();
  });
});

describe("settleByCode: a year said in pairs", () => {
  const MAGNA = "In which year was the Magna Carta sealed?";
  it("accepts a year key said in pairs or in words, on a question that asks for a year", () => {
    for (const a of ["twelve fifteen", "Twelve-fifteen", "in twelve fifteen", "the year twelve fifteen", "twelve fifteen AD", "It was twelve fifteen.", "twelve hundred and fifteen", "twelve hundred fifteen", "one thousand two hundred fifteen"]) {
      expect(named(MAGNA, "1215", a), a).toBe(true);
    }
    const MOON = "In what year did astronauts first walk on the Moon?";
    expect(named(MOON, "1969", "nineteen sixty-nine")).toBe(true);
    expect(named(MOON, "1969", "nineteen sixty nine")).toBe(true);
    expect(named("When was the Battle of Trafalgar fought?", "1805", "eighteen oh five")).toBe(true);
    expect(named("When was the Battle of Trafalgar fought?", "1805", "eighteen o five")).toBe(true);
    const CENTURY = "In what year did the 21st century begin?";
    for (const a of ["two thousand and one", "two thousand one", "twenty oh one"]) expect(named(CENTURY, "2001", a), a).toBe(true);
    expect(named("In which year did Columbus first reach the Americas?", "1492", "fourteen ninety-two")).toBe(true);
    expect(named("When was the Battle of Hastings fought?", "1066", "ten sixty-six")).toBe(true);
    expect(named("When was the Battle of Hastings fought?", "1066 AD", "ten sixty six")).toBe(true);
    expect(named("When was the Battle of Hastings fought?", "1066 A.D.", "ten sixty six")).toBe(true);
    expect(named("In what year did the century begin?", "1900", "nineteen hundred")).toBe(true);
    expect(named("What year did the decade begin?", "2020", "twenty twenty")).toBe(true);
    expect(named("What year did the millennium begin?", "2000", "two thousand")).toBe(true);
  });
  it("never takes another year, and never marks one wrong", () => {
    for (const a of ["twelve fifty", "fifteen twelve", "twelve five", "twelve", "twelve fifteen BC", "twelve fifteen pm", "quarter past twelve", "twelve oh fifteen", "twelve fifteen sixteen"]) {
      expect(named(MAGNA, "1215", a), a).toBeNull();
    }
    expect(named("In what year did astronauts first walk on the Moon?", "1969", "nineteen ninety-six")).toBeNull();
    expect(named("In what year did the 21st century begin?", "2001", "two thousand")).toBeNull();
    expect(named("When was the Battle of Trafalgar fought?", "1805", "eighteen fifty")).toBeNull();
  });
  it("never on a count, a clock time, a choice of years, or a question that says the key", () => {
    expect(named("A school library has 800 fiction books and 415 other books. How many books does it have?", "1215", "twelve fifteen")).toBeNull();
    expect(named("What is 800 + 415?", "1215", "twelve fifteen")).toBeNull();
    expect(named("At what time does the bell ring, in 24-hour time?", "1215", "twelve fifteen")).toBeNull();
    expect(named("When does the bell ring? Give the time.", "1215", "twelve fifteen")).toBeNull();
    expect(named("Was the Magna Carta sealed in 1215 or 1512?", "1215", "twelve fifteen")).toBeNull();
    expect(named("The Magna Carta was sealed in 1215. In which year was it sealed?", "1215", "twelve fifteen")).toBeNull();
    expect(named("In which year was it? Write it in words.", "1215", "twelve fifteen")).toBeNull();
    expect(named("Name the charter sealed at Runnymede.", "1215", "twelve fifteen")).toBeNull();
    // Not a year.
    expect(named(MAGNA, "3215", "thirty two fifteen")).toBeNull();
    expect(named(MAGNA, "1215 people", "twelve fifteen")).toBeNull();
  });
});

describe("settleByCode on the direction-and-years dev set", () => {
  const lookups: Array<[string, (key: string) => (w: string) => boolean, (w: string) => boolean]> = [
    ["no word real", () => noWords, noWords],
    ["the dictionary's words", () => nameWord, nameWord],
    ["the key's words real", keyOnly, noWords],
  ];
  it.each(lookups)("settles no wrong answer and marks no answer wrong, with %s", (_, isWord, listed) => {
    const settled = GRADE_DEV_DIRECTION_YEARS.flatMap((q) => q.answers
      .map((a) => ({ a, got: settleByCode(ask(q.question, q.key, a.text), isWord(q.key), listed) }))
      .filter(({ a, got }) => (!a.right && got === true) || got === false)
      .map(({ a, got }) => `${q.id} ${a.text} ${got}`));
    expect(settled).toEqual([]);
  });
  it("settles held-out v8's kinds of miss, rewritten, and leaves the pair under a choice to the model", () => {
    const settled = GRADE_DEV_DIRECTION_YEARS.flatMap((q) => q.answers.filter((a) => a.right && named(q.question, q.key, a.text) === true).map((a) => `${q.id} ${a.text}`));
    for (const a of ["x01 $15 overdrawn", "x07 a loss of $12", "y01 twelve fifteen", "y03 eighteen oh five", "y04 twenty oh one"]) expect(settled).toContain(a);
    // x10's credit is after "overdrawn": a positive key is never read as a credit after a debt.
    for (const a of ["y09 twelve fifteen", "x10 $15 in credit", "x10 in credit by $15"]) expect(settled).not.toContain(a);
    expect(settled).toHaveLength(38);
  });
});

describe("misspeltKeyWords", () => {
  it("pairs each misspelt word with the key's word, one or two edits, when every other word is the key's", () => {
    expect(misspeltKeyWords(ask(BONES, "The skeleton", "skelitin"))).toEqual([{ answer: "skelitin", key: "skeleton", edits: 2 }]);
    expect(misspeltKeyWords(ask("q", "The cell membrane", "the cell membrain"))).toEqual([{ answer: "membrain", key: "membrane", edits: 2 }]);
    expect(misspeltKeyWords(ask("q", "A verb", "a virb"))).toEqual([{ answer: "virb", key: "verb", edits: 1 }]);
  });
  it("is empty for the key itself, another number of words, three edits, a number, or a key word too short", () => {
    expect(misspeltKeyWords(ask(BONES, "Skeleton", "skeletons"))).toEqual([]);
    expect(misspeltKeyWords(ask("q", "The cell membrane", "membrain"))).toEqual([]);
    expect(misspeltKeyWords(ask("q", "Conduction", "convecshun"))).toEqual([]);
    expect(misspeltKeyWords(ask("q", "56", "58"))).toEqual([]);
    expect(misspeltKeyWords(ask("q", "Cat", "cot"))).toEqual([]); // one edit: 4 letters or more
    expect(misspeltKeyWords(ask("q", "Honey", "hunny"))).toEqual([]); // two edits: 7 letters or more
  });
});

describe("misspellingNote", () => {
  it("notes a misspelling no other real word is as close to", () => {
    expect(note(BONES, "The skeleton", "skelitin")).toBe('"skelitin" may be a misspelling of "skeleton"');
    expect(note("What part of speech names an action?", "A verb", "a virb")).toBe('"virb" may be a misspelling of "verb"');
  });
  it("is null when another real word is as close (two edits from glucagon and from glycogen)", () => {
    expect(note("Which hormone raises blood sugar?", "Glucagon", "glucogan")).toBeNull();
    expect(note("Which hormone raises blood sugar?", "Glucagon", "glucogan", dict(["glucagon"]))).toBe('"glucogan" may be a misspelling of "glucagon"');
  });
  it("is null when another real word is nearer (one edit from mystery, two from history)", () => {
    expect(note("What is the study of the past?", "History", "mistery")).toBeNull();
    expect(note("What is the path a planet follows?", "An orbit", "orbet")).toBeNull(); // sorbet
  });
  it("is null for a real word, unless the dictionary lists it as another spelling of the key's word", () => {
    expect(note("What do we call a scientist who studies living things?", "Biologist", "geologist")).toBeNull();
    expect(note("What part of speech names an action?", "A verb", "a herb")).toBeNull();
    expect(note("Which metal makes soda cans?", "Aluminum", "aluminium")).toBe('"aluminium" may be a misspelling of "aluminum"');
    expect(note("Which metal makes soda cans?", "Aluminum", "aluminium", dict(WORDS, {}))).toBeNull();
  });
  it("is null for a word of the English word list that WordNet lacks: chalcogens for Halogens", () => {
    const words = ["halogens", "carnivore"];
    expect(note("Which group of elements includes chlorine?", "Halogens", "chalcogens", dict(words))).toBe('"chalcogens" may be a misspelling of "halogens"');
    expect(note("Which group of elements includes chlorine?", "Halogens", "chalcogens", dict(words, {}, ["chalcogens"]))).toBeNull();
    expect(note("Which group of elements includes chlorine?", "Halogens", "chalcogens", dict(words, {}, ["chalcogen"]))).toBeNull();
    expect(note("What do we call an animal that eats meat?", "Carnivore", "granivore", dict(words, {}, ["granivore"]))).toBeNull();
  });
  it("is null for a real word the dictionary lists as a synonym that is not a spelling swap of the key's word", () => {
    const words = ["bacteria", "bacterium", "earlier", "earliest", "quick", "quickly", "area", "arena"];
    const syn = { bacterium: ["bacteria"], earlier: ["earliest"], quick: ["quickly"], arena: ["area"] };
    expect(note("Which germs can make you ill?", "Bacteria", "bacterium", dict(words, syn))).toBeNull();
    expect(note("Who came first?", "The earliest", "the earlier", dict(words, syn))).toBeNull();
    expect(note("How did the hare run?", "Quickly", "quick", dict(words, syn))).toBeNull();
    expect(note("What do we call the space inside a flat shape?", "Area", "arena", dict(words, syn))).toBeNull();
  });
  it("checks the question's words before a real word: a word the question offers gets no note", () => {
    const words = ["color", "colour", "farther", "further"];
    const syn = { colour: ["color"], further: ["farther"] };
    expect(note("How do you spell the word for red or blue?", "Color", "colour", dict(words, syn))).toBe('"colour" may be a misspelling of "color"');
    expect(note("Is it colour or color in American English?", "Color", "colour", dict(words, syn))).toBeNull();
    expect(note("Which is about distance you can measure: farther or further?", "Farther", "further", dict(words, syn))).toBeNull();
  });
  it("is null when the key's word is not in the dictionary (names of places and people)", () => {
    expect(note("Which country has Ljubljana as its capital?", "Slovenia", "slovinia")).toBeNull();
  });
  it("is null when a word the question offers is as close", () => {
    expect(note("Is sea water hypertonic or hypotonic to a cell?", "Hypotonic", "hypotonik", dict(["hypotonic"]))).toBe('"hypotonik" may be a misspelling of "hypotonic"');
    // "hypetonic" is one edit from both; the dictionary here does not have hypotonic, the question does.
    expect(note("Is sea water hypertonic or hypotonic to a cell?", "Hypertonic", "hypetonic", dict(["hypertonic"]))).toBeNull();
  });
  it("names a form of the key's own word as no rival", () => {
    expect(note("Who studies rocks?", "Geologist", "geolagest", dict(["geologist", "geologists"]))).toBe('"geolagest" may be a misspelling of "geologist"');
  });
});

describe("prefixAdded", () => {
  it("is true for the key's word with letters added at the front, and for a negating prefix on it one edit off", () => {
    for (const p of ["un", "in", "im", "il", "ir", "a", "an", "de", "non", "dis", "anti", "counter", "mis"]) expect(prefixAdded(`${p}skeleton`, "skeleton")).toBe(true);
    expect(prefixAdded("unextincts", "extinct")).toBe(true);
    expect(prefixAdded("atipical", "typical")).toBe(true);
  });
  it("is false for a misspelling, and for a prefix the key's word starts with too", () => {
    expect(prefixAdded("skelitin", "skeleton")).toBe(false);
    expect(prefixAdded("antanim", "antonym")).toBe(false);
    expect(prefixAdded("imigrating", "immigrating")).toBe(false);
    expect(prefixAdded("extinct", "extinct")).toBe(false);
  });
});

describe("misspellingNote: prefixes and function words", () => {
  it("is null for the key's word with a prefix added, though no dictionary word is near", () => {
    expect(note("What do we call a kind of animal with no living members left?", "Extinct", "unextinct", dict(["extinct"]))).toBeNull();
    expect(note("What word describes animals that are active during the day?", "Diurnal", "undiurnal", dict(["diurnal"]))).toBeNull();
  });
  it("is null for a function word, and for a misspelling as close to one as to the key's word", () => {
    expect(note("What do you do to a knot to open it?", "Untie", "until", dict(["untie"]))).toBeNull();
    expect(note("What word means all of something?", "Whole", "whose", dict(["whole"]))).toBeNull();
    expect(note("What is it like outside today?", "The weather", "wheather", dict(["weather"]))).toBeNull(); // whether
  });
});

describe("spellingVariant", () => {
  it("is true for one British/American spelling swap", () => {
    for (const [a, b] of [["colour", "color"], ["organisation", "organization"], ["analyse", "analyze"], ["centre", "center"],
      ["anaemia", "anemia"], ["oestrogen", "estrogen"], ["sulphur", "sulfur"], ["travelled", "traveled"], ["aluminium", "aluminum"]]) {
      expect(spellingVariant(a, b)).toBe(true);
      expect(spellingVariant(b, a)).toBe(true);
    }
  });
  it("is false for other forms and related words, and for the word itself", () => {
    for (const [a, b] of [["bacterium", "bacteria"], ["alga", "algae"], ["earlier", "earliest"], ["quick", "quickly"],
      ["heavier", "heavily"], ["clear", "clearly"], ["awful", "awfully"], ["arena", "area"], ["arc", "arch"], ["live", "alive"],
      ["lone", "alone"], ["rise", "arise"], ["factual", "actual"], ["further", "farther"], ["larva", "larvae"], ["color", "color"]]) {
      expect(spellingVariant(a, b)).toBe(false);
      expect(spellingVariant(b, a)).toBe(false);
    }
  });
});

describe("wordsWithin", () => {
  it("lists the words at most that many edits away, not the word itself", () => {
    expect(wordsWithin(["glucagon", "glycogen", "gluten", "glucogan"], "glucogan", 2)).toEqual(["glucagon", "glycogen"]);
    expect(wordsWithin(["glucagon", "glycogen"], "glucogan", 1)).toEqual([]);
  });
});

describe("formsWithin", () => {
  it("lists the regular forms of the words that are that close: -ing, -ed, -s, the e dropped", () => {
    expect(formsWithin(["attach", "attack", "skeleton"], "attatching", 2).sort()).toEqual(["attaching", "attacking"]);
    expect(formsWithin(["inhale", "exhale"], "enhaled", 1).sort()).toEqual(["exhaled", "inhaled"]);
    expect(formsWithin(["skeleton"], "skelitin", 2)).toEqual([]);
  });
});

// TerraTutor #200 (audit 5 #9): "3 feet" on "Convert 3 feet to inches" was the same length as the key, so code marked it
// right. Only the question's own amount given back is left to the model; real equivalents stay right.
describe("a conversion answered with the amount it gives", () => {
  it("is never accepted by code", () => {
    expect(settle("Convert 3 feet to inches.", "36 inches", "3 feet")).toBeNull();
    expect(settle("Convert 2 kilograms into grams.", "2000 grams", "2 kilograms")).toBeNull();
    expect(settle("Change 4 meters to centimeters.", "400 cm", "4 m")).toBeNull();
    expect(settle("Convert 5 liters to milliliters.", "5000 mL", "5 L")).toBeNull();
    expect(settle("Convert 72 inches to feet.", "6 feet", "72 inches")).toBeNull();
    expect(settle("How many dollars is 250 cents?", "$2.50", "250 cents")).toBeNull();
    expect(settle("Sam has $3. How many cents is that?", "300 cents", "$3")).toBeNull();
    expect(settle("3 feet = ___ inches", "36 inches", "3 feet")).toBeNull();
    expect(settle("Convert three feet to inches.", "36 inches", "three feet")).toBeNull();
  });
  it("still accepts the converted amount and other real equivalents", () => {
    expect(settle("Convert 3 feet to inches.", "36 inches", "36 in")).toBe(true);
    expect(settle("Convert 3 feet to inches.", "36 inches", "1 yard")).toBe(true);
    expect(settle("How many dollars is 250 cents?", "$2.50", "2.50 dollars")).toBe(true);
    expect(settle("How long is one hour?", "60 minutes", "1 hour")).toBe(true);
    expect(settle("A rope is 2 meters long. How long is the rope?", "200 cm", "2 m")).toBe(true);
    expect(settle("A shelf is 66 inches tall. How tall is it in feet and inches?", "5 feet 6 inches", "5 feet 6 inches")).toBe(true);
  });
  it("still marks a gross miss wrong", () => {
    expect(settle("Convert 3 feet to inches.", "36 inches", "3.6 inches")).toBe(false);
  });
  // The question only has to name the key's unit and the answer's amount, so a real equivalent that is
  // also another given amount goes to the model too. Precision first: a model call, never a wrong mark.
  it("leaves a real equivalent that the question also gives to the model", () => {
    expect(settle("Ben has 200 cm of ribbon. Ann has 2 m of ribbon. How much ribbon does Ann have?", "2 m", "200 cm")).toBeNull();
  });
});
