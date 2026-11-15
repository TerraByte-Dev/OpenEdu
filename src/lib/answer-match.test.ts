import { describe, it, expect } from "vitest";
import { answerWords, singular, editDistance, keyForms, settleByCode, misspellingCandidates, type WrittenAnswer } from "./answer-match";

const ask = (question: string, expected: string, student: string, type = "short_answer"): WrittenAnswer => ({ question, expected, student, type });
// The dictionary's verdict, for the words these tests use.
const REAL = new Set(["neuron", "photon", "affect", "effect", "zambia", "dessert", "stationery", "proton", "neutron", "gambia"]);
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

describe("settleByCode: never a wrong answer", () => {
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
  it("lists the answer's words one edit off a long key word, for the dictionary", () => {
    expect(misspellingCandidates(ask("q", "Herbivore", "a herbivor"))).toEqual(["herbivor"]);
    expect(misspellingCandidates(ask("q", "Neutron", "neuron"))).toEqual(["neuron"]);
    expect(misspellingCandidates(ask("q", "Blue", "blur"))).toEqual([]);
  });
});

// The 30-question dev set the grader is tuned on (OpenEdu #317's batch measurement; labels by Claude, not
// blind). Code may settle some right answers and must settle none of the wrong ones.
const DEV: Array<[string, string, string, string]> = [
  ["What gas do plants take in from the air to make food?", "Carbon dioxide", "they take in CO2", "oxygen"],
  ["What is the boiling point of water at sea level in Celsius?", "100 degrees Celsius", "a hundred degrees", "50 degrees"],
  ["Name the largest planet in our solar system.", "Jupiter", "it's jupiter", "Saturn is the biggest"],
  ["What do we call an animal that eats only plants?", "Herbivore", "a herbivor", "a carnivore"],
  ["What is 7 times 8?", "56", "fifty-six", "54"],
  ["What is the main job of the heart?", "To pump blood around the body", "it pushes blood through your body", "it helps you breathe air"],
  ["Who wrote the play Romeo and Juliet?", "William Shakespeare", "shakespeare wrote it", "Charles Dickens"],
  ["What is the capital city of France?", "Paris", "paris is the capital", "Lyon"],
  ["What force pulls objects toward the Earth?", "Gravity", "the force of gravity", "magnetism"],
  ["What is the opposite of the word 'ancient'?", "Modern", "new or modern", "old"],
  ["How many sides does a hexagon have?", "6", "six sides", "8"],
  ["What part of a plant takes in water from the soil?", "The roots", "the root system", "the leaves"],
  ["What is the freezing point of water in Fahrenheit?", "32 degrees Fahrenheit", "thirty two F", "0 degrees Fahrenheit"],
  ["What is a noun?", "A word that names a person, place, thing or idea", "a naming word for people places or things", "a word that describes an action"],
  ["Which organ do humans use to breathe?", "The lungs", "our lungs", "the stomach"],
  ["What is half of 50?", "25", "twenty five", "20"],
  ["What do you call the process when water turns into vapor?", "Evaporation", "it evaporates, evaporation", "condensation"],
  ["Which ocean is the largest?", "The Pacific Ocean", "pacific", "the Atlantic"],
  ["What is the past tense of 'run'?", "Ran", "he ran", "runned"],
  ["What is the area of a rectangle 3 cm by 4 cm?", "12 square centimeters", "12 cm squared", "7 square centimeters"],
  ["What do bees collect from flowers to make honey?", "Nectar", "flower nectar", "pollen only, not nectar"],
  ["Who was the first President of the United States?", "George Washington", "washington", "Abraham Lincoln"],
  ["What is the chemical symbol for water?", "H2O", "h two o", "CO2"],
  ["What shape has three sides?", "A triangle", "triangle shape", "a square"],
  ["What do we call a baby frog?", "A tadpole", "tadpoles", "a cub"],
  ["Which continent is Egypt in?", "Africa", "it is in africa", "Asia"],
  ["What is 100 minus 37?", "63", "sixty three", "73"],
  ["Why do we have day and night?", "Because the Earth spins on its axis", "the earth rotates so one side faces the sun", "because the sun goes around the earth every day"],
  ["What is a synonym for 'happy'?", "Joyful", "glad", "angry"],
  ["What is the smallest unit of life?", "The cell", "a cell", "an atom"],
];

describe("settleByCode on the dev set", () => {
  it("settles no wrong answer", () => {
    const passed = DEV.filter(([q, key, , wrong]) => settleByCode(ask(q, key, wrong), () => false) === true);
    expect(passed.map((d) => d[3])).toEqual([]);
  });
  it("settles the four measured failures", () => {
    const settled = new Set(DEV.filter(([q, key, right]) => settleByCode(ask(q, key, right), isWord) === true).map((d) => d[2]));
    for (const a of ["washington", "h two o", "a hundred degrees", "tadpoles"]) expect(settled.has(a)).toBe(true);
  });
});
