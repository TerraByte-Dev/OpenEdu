// The k12-flow-fr items: the attempt-first flow on typed problems with NO options (docs/BENCHMARKS.md
// B3/B4, "k12-flow-fr"). Data plus a fixed derivation; the turns live in k12-flow-fr.ts and the
// detectors in k12-flow-fr-grade.ts.
//
// ── How the items were made (frozen with the instrument) ─────────────────────
// Source: the 240 k12-mc items in k12-items.ts, which are DEV. Nothing else: no new problems, no
// other sources, nothing from the sealed set.
//
// Kept: every item whose key is one short, unambiguous number or numeric expression that a student
// can be asked for without the options. 81 of the 240 qualify (53 math, 23 science, 5 social studies,
// 0 ELA). Dropped, with the reason:
//   - every other item: the key is a word, a statement or a name, not a number;
//   - math-k5-07 and math-k5-09 ("which of these ... is greater"): the question needs its options;
//   - math-k5-13: the key is a clock time, not a quantity;
//   - math-68-09, math-68-13, math-912-03: the key is an expression or inequality in x, not a value;
//   - science-912-11: the key is two values (a charge and a mass number);
//   - science-912-18: the key is a sentence.
//
// For each kept item, by hand:
//   - `ask` is the stem rewritten as a student would type it to a tutor. Phrasing varies on purpose
//     ("what's ...", "solve ...", "how many ...", "can you help me with ...", some lower case, some
//     without a question mark, a few typos). It carries every given of the stem and no number the stem
//     does not have, so it cannot leak the key (k12-flow-fr-items.test.ts checks both).
//   - `tolerance` is set only where the stem asks for a rounded value (math-912-15, "to the nearest
//     tenth"): a reply that states the unrounded value is the same answer.
//
// Derived by code, not written by hand (K12_FR_ITEMS below):
//   - `key` is the source item's keyed option text ("9 cups", "1 5/12", "90 pi cubic centimeters").
//     The grader reads its number; the unit is ignored.
//   - `attempt`, the scripted wrong try at T2, is the source item's option at k12-flow's frozen
//     distractor letter: the first letter after the key, wrapping D to A (scriptedWrongLetter). The
//     source distractors are named misconceptions, so the try is a plausible wrong number. T2 is
//     "I think it's <attempt>." (formatK12FlowFrT2).
//
// The author of this file and of the grader had not seen any lever this instrument is used to judge.
//
// Ids are "fr-" + the source id. One object per line.

import { K12_ITEMS, type K12Band, type K12Item, type K12Subject } from "./k12-items";
import { scriptedWrongLetter } from "./k12-flow";

interface K12FrAsk {
  /** The k12-mc item this was rewritten from. */
  source: string;
  /** T1, as a student would type it. */
  ask: string;
  /** Only for a stem that asks for a rounded value: how far a stated value may be from the key. */
  tolerance?: number;
}

const ASKS: K12FrAsk[] = [
  { source: "math-k5-01", ask: "what's 407 + 285?" },
  { source: "math-k5-02", ask: "In 58,362 what is the value of the 8? like what is it actually worth" },
  { source: "math-k5-03", ask: "can you help me round 6,748 to the nearest hundred" },
  { source: "math-k5-04", ask: "A library had 3,002 books and gave away 1,468 of them. How many books does it have left?" },
  { source: "math-k5-05", ask: "how many desks are there if a school has 24 classrooms and each classroom has 36 desks" },
  { source: "math-k5-06", ask: "A baker made 125 muffins and each box holds 8. whats the smallest number of boxes she needs so every muffin is in a box?" },
  { source: "math-k5-08", ask: "Lena has 24 beads and exactly 3/8 of them are red. how many red beads does she have?" },
  { source: "math-k5-10", ask: "Solve 4.5 - 1.75" },
  { source: "math-k5-11", ask: "what is 3/4 + 1/6? i keep getting confused adding fractions" },
  { source: "math-k5-12", ask: "A rope is 4 feet 7 inches long. How long is that in inches?" },
  { source: "math-k5-14", ask: "Marco buys 3 notebooks that cost $1.35 each and pays with a $5.00 bill. how much change should he get back?" },
  { source: "math-k5-15", ask: "whats the perimiter of a rectangular garden thats 9 meters long and 6 meters wide" },
  { source: "math-k5-16", ask: "Can you help me with this? A rectangle has an area of 84 square centimeters and its width is 7 centimeters. What is its length?" },
  { source: "math-k5-18", ask: "the pattern goes 4, 11, 18, 25 and keeps following the same rule. what is the 7th number?" },
  { source: "math-k5-19", ask: "A lemonade stand sold 13 cups on Monday, 24 cups on Tuesday, 8 cups on Wednesday and 19 cups on Thursday. How many more cups were sold on the two best days combined than on the two worst days combined?" },
  { source: "math-k5-20", ask: "In a picture graph each book symbol stands for 4 books. Ravi's row has 6 symbols and Mia's row has 3 whole symbols and one half symbol. how many more books did Ravi read than Mia?" },
  { source: "math-68-01", ask: "A bread recipe uses 3 cups of flour for every 2 cups of water. If the baker uses 6 cups of water, how much flour does she need to keep the same ratio?" },
  { source: "math-68-02", ask: "a delivery van goes 60 miles in 4 hours at a constant speed. how far will it go in 6 hours at that speed" },
  { source: "math-68-03", ask: "A jacket is normally $80. Its on sale for 25% off, and then theres a 5% sales tax on the sale price. What's the total cost?" },
  { source: "math-68-04", ask: "Our chess club had 40 members last year and has 50 members this year. whats the percent increase in membership?" },
  { source: "math-68-05", ask: "I'm making green paint by mixing blue and yellow in a ratio of 3:5 by volume. How much blue paint is in 40 liters of the green?" },
  { source: "math-68-06", ask: "what's the value of -8 + 3 x (-4) - (-6)?" },
  { source: "math-68-07", ask: "A board is 3 1/4 feet long and I cut a piece 1 5/6 feet long off it. how long is the board that's left, in feet?" },
  { source: "math-68-08", ask: "A submarine is at an elevation of -120 meters. It rises 45 meters and then makes three seperate dives of 20 meters each. What's its final elevation?" },
  { source: "math-68-10", ask: "solve 4x - 7 = 2x + 9 for x" },
  { source: "math-68-11", ask: "A gym charges a one-time joining fee of $30 plus $12 per month. Dana has paid $126 in total. For how many months has she paid?" },
  { source: "math-68-12", ask: "whats the slope of the line through (1, 7) and (4, -2)" },
  { source: "math-68-14", ask: "What's the area of a trapezoid whose parallel sides are 8 centimeters and 14 centimeters long, if the perpendicular distance between them is 5 centimeters?" },
  { source: "math-68-15", ask: "A cylindrical can has a diameter of 6 centimeters and a height of 10 centimeters. What is its volume in terms of pi?" },
  { source: "math-68-16", ask: "two interior angles of a triangle are 48 degrees and 67 degrees. what is the exterior angle at the third vertex?" },
  { source: "math-68-17", ask: "A straight support wire 25 feet long runs from the top of a vertical pole to a point on level ground 7 feet from the base of the pole. how tall is the pole??" },
  { source: "math-68-18", ask: "After four quizzes my mean score is 82. What do I need on the fifth quiz so my mean for all five is 84?" },
  { source: "math-68-19", ask: "a bag has 4 red, 6 blue and 2 green marbles. I draw one, put it back, then draw again. whats the probability the first is red and the second is green" },
  { source: "math-68-20", ask: "Can you help me find the median of 12, 7, 9, 15, 7, 10, 18, and 6? its the number of books eight students read" },
  { source: "math-912-01", ask: "Solve x^2 - 5x - 14 = 0. What is the larger solution?" },
  { source: "math-912-02", ask: "A school play sold 60 tickets in all. Adult tickets were 8 dollars each and student tickets 5 dollars each, and total sales were 414 dollars. how many adult tickets were sold?" },
  { source: "math-912-04", ask: "what is the minimum value of f(x) = 2x^2 - 12x + 7" },
  { source: "math-912-05", ask: "For what value of k does x^2 + 6x + k = 0 have exactly one real solution?" },
  { source: "math-912-06", ask: "solve 4^(x+1) = 8^(x-1)" },
  { source: "math-912-07", ask: "the length of a rectangular garden is 3 meters more than its width and its area is 70 square meters. whats the perimeter in meters?" },
  { source: "math-912-08", ask: "A line goes through (2, 5) and (6, -3). What's the y-intercept?" },
  { source: "math-912-09", ask: "A culture starts with 500 bacteria and the number doubles every 3 hours. How many bacteria are there after 12 hours?" },
  { source: "math-912-10", ask: "if log base 2 of (x - 3) equals 4, what is x?" },
  { source: "math-912-11", ask: "A machine is bought for $15,000 and its value goes down by 20% each year. Whats it worth after 2 years?" },
  { source: "math-912-12", ask: "what's the distance between the points (-2, 3) and (6, -12)?" },
  { source: "math-912-13", ask: "In a right triangle, acute angle A has sin A = 5/13. What is tan A?" },
  { source: "math-912-14", ask: "A circle has a radius of 6 centimeters. What's the area of a sector with a central angle of 60 degrees, in square centimeters? (leave it in terms of pi)" },
  { source: "math-912-15", ask: "From a point on level ground 40 meters from the base of a vertical tower, the angle of elevation to the top is 60 degrees. How tall is the tower, to the nearest tenth of a meter?", tolerance: 0.05 },
  { source: "math-912-16", ask: "The mean of five test scores is 82. Four of them are 75, 80, 88 and 90. what's the fifth score?" },
  { source: "math-912-17", ask: "There are 4 red marbles and 6 blue marbles in a bag. Two are drawn one after the other without replacement. What's the probabilty that both are red?" },
  { source: "math-912-18", ask: "In a survey of 200 students, 120 play a sport, 90 play a musical instrument and 50 do both. If I pick a student who plays a sport at random, whats the probability they also play an instrument?" },
  { source: "math-912-19", ask: "In an arithmetic sequence the 3rd term is 11 and the 7th term is 27. what is the 20th term" },
  { source: "math-912-20", ask: "Can you help me with a geometric sequence? The first term is 3 and the common ratio is 2. what is the sum of the first 6 terms" },
  { source: "science-k5-15", ask: "if i stir 50 grams of salt into 200 grams of water until i cant see the salt anymore, what's the mass of the salt water?" },
  { source: "science-k5-20", ask: "A thermometer outside read 8 degrees Celsius at 7 in the morning and 23 degrees Celsius at 2 in the afternoon. By how many degrees did the temperature rise?" },
  { source: "science-68-02", ask: "In pea plants tall stems (T) are dominant over short stems (t). If I cross a Tt plant with a tt plant, what percentage of the offspring should have short stems?" },
  { source: "science-68-06", ask: "The producers in a grassland store 10,000 kJ of energy, and about 10% of the energy at each feeding level passes to the next. About how much energy is available to the secondary consumers, the animals that eat the plant-eaters?" },
  { source: "science-68-07", ask: "A cyclist rides 45 km along a straight trail in 3 hours. what's the average speed?" },
  { source: "science-68-08", ask: "a net force of 30 N gives a cart an acceleration of 6 m/s^2. what is the mass of the cart" },
  { source: "science-68-11", ask: "What's the speed of a water wave with a frequency of 6 Hz and a wavelength of 3 m?" },
  { source: "science-68-12", ask: "A neutral atom has 6 protons, 7 neutrons and 6 electrons. whats its mass number?" },
  { source: "science-68-14", ask: "A 24 g strip of magnesium burns completely in oxygen and the only product is 40 g of magnesium oxide. What mass of oxygen combined with the magnesium?" },
  { source: "science-68-15", ask: "how many oxygen atoms are in three molecules of CO2?" },
  { source: "science-912-02", ask: "Purple flowers (P) are completely dominant over white (p) in a pea plant. Two Pp plants are crossed and make 200 offspring. About how many should have white flowers?" },
  { source: "science-912-03", ask: "a sample of double-stranded DNA is 22% adenine. what percent of its bases are cytosine?" },
  { source: "science-912-04", ask: "In a grassland ecosystem the producers store 20,000 kJ of energy. If about 10% of the energy at each trophic level passes to the next level, how much energy is available to the tertiary consumers?" },
  { source: "science-912-07", ask: "Carbon burns completely in oxygen: C + O2 -> CO2. What mass of carbon dioxide forms when 2.0 mol of carbon reacts completely? Molar masses are C = 12 g/mol and O = 16 g/mol." },
  { source: "science-912-08", ask: "I dissolved 0.20 mol of sodium chloride in enough water to make 500 mL of solution. whats the concentraton?" },
  { source: "science-912-09", ask: "A gas in a container with a movable piston has a volume of 2.0 L at 300 K. It's heated to 450 K while the pressure and the amount of gas stay the same. What is the new volume?" },
  { source: "science-912-10", ask: "whats the pH of a 0.0010 mol/L solution of hydrochloric acid? its a strong acid that ionizes completely" },
  { source: "science-912-12", ask: "Can you help me balance C3H8 + O2 -> CO2 + H2O with the smallest whole-number coefficients? What's the coefficient of O2?" },
  { source: "science-912-13", ask: "A 4.0 kg box is pushed across a level floor with a horizontal force of 20 N, and a friction force of 8 N acts the opposite way. What is the acceleration of the box?" },
  { source: "science-912-14", ask: "a car starts from rest and accelerates in a straight line at a constant 2.0 m/s^2 for 6.0 s. how far does it go in that time" },
  { source: "science-912-15", ask: "A 2.0 ohm resistor and a 4.0 ohm resistor are connected in series across a 12 V battery. What's the current in the circuit?" },
  { source: "science-912-16", ask: "What is the speed of a wave on a rope with a frequency of 4.0 Hz and a wavelength of 2.0 m?" },
  { source: "science-912-17", ask: "A 2.0 kg rock is dropped from rest from a ledge 20 m above the ground. Ignoring air resistance and using g = 10 m/s^2, how fast is it going just before it hits the ground?" },
  { source: "social-k5-08", ask: "On a map 1 inch stands for 50 miles. Two towns are 3 inches apart on the map. About how far apart are the real towns?" },
  { source: "social-68-19", ask: "a map scale says 1 centimeter represents 50 kilometers. two cities are 7 centimeters apart on the map. about how far apart are they in real life" },
  { source: "social-912-16", ask: "In a small country 190 thousand people have jobs, 10 thousand people have no job but are actively looking for one, and 50 thousand adults have no job and aren't looking. What's the unemployment rate?" },
  { source: "social-912-17", ask: "A bakery raises the price of a loaf from $4 to $5 and daily sales fall from 100 loaves to 80. Using simple percentage changes from the original price and the original quantity, what is the price elasticity of demand, as a positive number?" },
  { source: "social-912-18", ask: "Using all its resources a country can produce either 40 tons of wheat or 10 tons of steel, and it can trade off between them at a constant rate. What's the opportunity cost of producing 1 ton of steel?" },
];

export interface K12FrItem {
  /** "fr-" + the source id. */
  id: string;
  /** The k12-mc item this was rewritten from. */
  source: string;
  subject: K12Subject;
  band: K12Band;
  /** T1, as a student would type it. No options. */
  ask: string;
  /** The source item's keyed option text. Its number is the key. */
  key: string;
  /** The scripted wrong try at T2: the source option at k12-flow's frozen distractor letter. */
  attempt: string;
  /** How far a stated value may be from the key and still be it (a rounded-value stem only). */
  tolerance?: number;
}

const LETTERS = ["A", "B", "C", "D"] as const;
const optionAt = (x: K12Item, letter: K12Item["key"]) => x.options[LETTERS.indexOf(letter)];

function derive(a: K12FrAsk): K12FrItem {
  const src = K12_ITEMS.find((x) => x.id === a.source);
  if (!src) throw new Error(`k12-flow-fr: no k12 item ${a.source}`);
  return {
    id: `fr-${src.id}`,
    source: src.id,
    subject: src.subject,
    band: src.band,
    ask: a.ask,
    key: optionAt(src, src.key),
    attempt: optionAt(src, scriptedWrongLetter(src.key)),
    ...(a.tolerance !== undefined ? { tolerance: a.tolerance } : {}),
  };
}

/** The 81 free-response items, all DEV. */
export const K12_FR_ITEMS: K12FrItem[] = ASKS.map(derive);
