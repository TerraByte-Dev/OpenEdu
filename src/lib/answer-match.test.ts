import { describe, it, expect } from "vitest";
import { answerWords, singular, editDistance, keyForms, settleByCode, misspellingCandidates, ordinalToken, oneEditAway, misspeltKeyWords, misspellingNote, prefixAdded, wordsWithin, formsWithin, spellingVariant, type WrittenAnswer, type SpellingLookup } from "./answer-match";
import { GRADE_DEV_NUMBERS, GRADE_DEV_ROUND2, GRADE_DEV_SIGNS_LETTERS, GRADE_DEV_SYNONYMS } from "./eval/grade-dev";

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
    expect(settle(KMH, "60 km per hour", "60 hours per km")).toBeNull();
    expect(settle("How fast does it go?", "60 km/h", "60 h/km")).toBeNull();
    expect(settle("How fast does it go?", "6 ft/s", "6 s/ft")).toBeNull();
    expect(settle(SOUND, "343 meters per second", "343 seconds per meter")).toBeNull();
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
    expect(settle("What is negative 7 plus 3?", "Negative 4", "4")).toBeNull();
    expect(settle("What is negative 8 plus 3?", "Negative 5", "5")).toBeNull();
    expect(settle("What is negative 8 plus 3?", "Negative 5", "five")).toBeNull();
    expect(settle("What is 3 minus 8?", "minus five", "5")).toBeNull();
    expect(settle("What is 3 minus 8?", "minus 5", "5")).toBeNull();
    expect(settle("How far north or south of the equator is the Tropic of Cancer?", "23 degrees north", "23 degrees")).toBeNull();
    expect(settle("Is the jar one third or two thirds full?", "Two thirds", "two")).toBeNull();
    expect(settle("What fraction of the pizza is left, in thirds?", "2 thirds", "2")).toBeNull();
  });
  it("never lets a first number settle past a different noun, am/pm, unit or a choice (the reviewer's cases)", () => {
    expect(settle("How many legs does an insect have?", "6 legs", "6 arms")).toBeNull();
    expect(settle("What time is 15:00 on a 12-hour clock?", "3 PM", "3 am")).toBeNull();
    expect(settle("What time is 15:00 on a 12-hour clock?", "3 PM", "3 a.m.")).toBeNull();
    expect(settle("What time is 15:00 on a 12-hour clock?", "3 p.m.", "3")).toBeNull();
    expect(settle("Is noon 12 AM or 12 PM?", "12 PM", "12")).toBeNull();
    expect(settle("How long is the pause?", "1 second", "1st")).toBeNull();
    expect(settle("How many legs does an insect have?", "6", "6 arms")).toBeNull();
    expect(settle("How many electrons and protons does a fluorine atom have each?", "9 electrons", "9 protons")).toBeNull();
  });
  it("never takes some of the key's words for all of them (the second review's cases)", () => {
    expect(settle(KMH, "60 km per hour", "60 km")).toBeNull();
    expect(settle(KMH, "60 km per hour", "60 hours")).toBeNull();
    expect(settle(MPH, "60 miles per hour", "60 miles")).toBeNull();
    expect(settle(AREA, "12 square centimeters", "12 centimeters")).toBeNull();
    expect(settle(VOLUME, "27 cubic meters", "27 meters")).toBeNull();
    expect(settle(LIGHT_YEARS, "4 light years", "4 years")).toBeNull();
    expect(settle(PER_POUND, "3 dollars per pound", "3 pounds")).toBeNull();
    expect(settle(DOZEN, "2 dozen eggs", "2 eggs")).toBeNull();
    expect(settle(PAIRS, "3 pairs of shoes", "3 shoes")).toBeNull();
  });
  it("needs the rule, not the ordinal reading of second, for per second; and per minute the same", () => {
    expect(settle(SOUND, "343 meters per second", "343 meters")).toBeNull();
    expect(settle(SOUND, "343 meters per second", "343 seconds")).toBeNull();
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
    expect(settle("What is the area of a rectangle 3 cm by 4 cm?", "12 square centimeters", "12 cm")).toBeNull();
    expect(settle("What is the area of a rectangle 3 cm by 4 cm?", "12 square centimeters", "12")).toBe(true);
    expect(settle("How fast does it go?", "60 km/h", "60 km")).toBeNull();
    expect(settle("How fast does it go?", "60 km/h", "sixty kilometers per hour")).toBe(true);
    expect(settle("How long?", "3 cm", "3 m")).toBeNull();
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
      expect(misspellingCandidates(ask(q, key, a))).toEqual([]);
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
