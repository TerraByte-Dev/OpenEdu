# Written-answer grading: numbers and units (dev baseline)

2026-11-16. DEV only: a numeric/unit settle may be tuned on this set, so later numbers on it overstate
what a new set will show. Labels by Claude, not blind. Runner: `src/lib/eval/headless/grade-dev.eval.ts`
(the app's path: `settleByCode`, then `gradeAnswersBatch`, batches of 10, one fixed shuffled order),
`EVAL_GRADE_SET=numbers`. Ollama local, RTX 3070 laptop. Baseline = master `e8c4236` with only the set
added (`a7caed6`): every prompt is master's.

Why: held-out v5 (results/2026-11-16-grade-dev-misspelling-hint.md) failed the e2b bars on items code
could decide. "4.5%" passed for 45% and "1 gram per milliliter" failed for 1 g/cm³ (e4b too), on every
run.

## Set

`numbers` (`GRADE_DEV_NUMBERS`, new): 40 questions across K-12 math and science (percent, fractions,
decimals, rounding, place value, money, time, metric and customary measures, area, volume, density,
speed, temperature, scientific notation, ratios, negative numbers, years, counts). 92 right answers and
80 wrong. Each question has a `why`: what a teacher accepts there and whether a unit is wanted.

- Right kinds: form 49 (words, commas, a leading + or trailing zero, "about", another clock form),
  unit-name 20 (the unit spelt out or abbreviated another way), units 14 (the same amount in other
  units: 1 g/mL for 1 g/cm³, 8 mL for 8 cm³, about 93 million miles for 1.5 × 10^8 km), equivalent 5
  (fraction, decimal or percent of the same value, where the question asks for no set form), notation 3,
  allowed-rounding 1 (273 K for 273.15 K).
- Wrong kinds: near-number 24, wrong-unit 18 (the right number on a unit that changes the amount),
  place-value 12 ("4.5%" for 45%, "$35.00", "0.00045"), sign 7, inverse 6, other-quantity 5,
  over-rounded 3, not-converted 2 ("0.45" when the question asks for a percent), not-simplest 1,
  not-scientific 1 ("30 × 10^3"), no-unit 1 ("1" when the question asks for the unit).

Code settles 38 answers on master, all right (forms and number words), on every run; it settles no wrong
answer (`answer-match.test.ts` keeps it that way with no word known to be real).

## Results

Right failed / wrong passed, per run. No fallbacks.

| Set | Model | Right failed (of 92) | Wrong passed (of 80) | Settled by code |
|---|---|---|---|---|
| numbers | e2b run 1 | 14 | 3 | 38 |
| numbers | e2b run 2 | 13 | 3 | 38 |
| numbers | e2b run 3 | 14 | 3 | 38 |
| numbers | e4b run 1 | 8 | 5 | 38 |

By kind, summed (e2b over 3 runs / e4b over 1): right units 29 of 42 / 7 of 14; right form 6 of 147 /
1 of 49; right unit-name 3 of 60 / 0 of 20; right equivalent 3 of 15 / 0 of 5; wrong place-value 3 of
36 / 0 of 12; wrong inverse 3 of 18 / 0 of 6; wrong near-number 3 of 72 / 2 of 24; wrong wrong-unit 0
of 54 / 1 of 18; wrong not-converted 0 of 6 / 1 of 2; wrong not-scientific 0 of 3 / 1 of 1.

e2b, failed on every run:
- Right failed: "1 g/mL" and "1000 kg/m³" for 1 g/cm³; "3 g/mL" for 3 g/cm³; "8 mL" for 8 cm³;
  "90,000 cm²" for 9 m²; "0.25 km per minute" for 15 km/h; "300,000 km/s" and "about 186,000 miles per
  second" for 3 × 10^8 m/s; "about 93 million miles" for 1.5 × 10^8 km; "16:15" for 4:15 p.m.; "45%"
  for 9/20; "negative 15 meters" for −15.
- Also right failed: "5 degrees below zero" for −5 °C and "20,000 m" for 20 km (2 of 3), "406 020"
  for 406,020 (1 of 3).
- Wrong passed: "4.5%" for 45% (the v5 miss, reproduced), "0.33 g/cm³" for 3 g/cm³, "2/8" for 1/2.

e4b, one run:
- Right failed: the unit conversions again ("1 g/mL", "3 g/mL", "8 mL", "90,000 cm²", "0.25 km per
  minute", "300,000 km/s", "about 93 million miles"), and "three quarters" for 3/4.
- Wrong passed: "1 kg/mL" for 1 g/cm³, "0.45" for "Write 9/20 as a percent", "30 × 10^3" for 30,000
  in scientific notation, "75 cents" for $1.75, "2/8" for 1/2.

## Reading

- The model's misses are almost all the kind code can decide. 29 of e2b's 41 right fails are the same
  amount in other units: a unit table and arithmetic settle them. "4.5%", "0.33 g/cm³" and "2/8" are a
  different value from the key's, which code can compute.
- Code must stay out of the question-form calls: "0.45" for a percent asked, "30 × 10^3" for scientific
  notation, "75/100" for simplest form. The value matches the key and the answer is still wrong, so a
  settle that compares values only would pass all three. The `why` fields say which questions these are.
- Leave "1" for a density whose unit is asked (n28) and "9 m" for an area (n26) wrong: code needs to see
  the unit is missing or of the wrong dimension, not only that the number matches.

## Code decides numbers and units both ways (`settleQuantity`)

`answer-match.ts` `settleQuantity`, called last from `settleByCode`, reads the key and the answer as one
quantity each and compares amounts after converting units. Same amount: right (on an estimate question,
"Estimate 49 x 21", "roughly", "about how", within 10%). Wrong only on a gross miss (`graded_by`
`'exact'`, wrong, feedback "This does not match the answer key.", and "I think I was right" still
offered): another kind of unit; a factor of about 10, 100 or 1000 (not 100 between two plain numbers or
on a percent question, which is the same number read as a percent; a bare number for a percent key is
read as a part when that is nearer, so "3/4" for 70% is 75%); a.m. for p.m.; the other sign, except on a
question about a fall, drop, decrease, loss, depth, being below, a change or a difference, or one that
asks how much it went down, sank or descended, or how much colder, cooler or lower; or, when the
question gives the numbers and asks for no estimate, a different fraction for a fraction key that does
not say about, or more than 20% apart. Never on precision alone: a measured fact ("3/4" for 7/10 or 70%
of Earth's surface), an estimate, pi or a rounded conversion factor goes to the model. Everything else it is not sure of stays null for the model; the
list is in the code comment and `docs/ARCHITECTURE.md`.

History. The first version (`1bb7318`) marked wrong any different amount beyond the precision either side
was written to. Review found right answers it rejected: measured facts with a precise key ("8,848 m" for
Everest's 8,849 m, "340 m/s" for 343, "300,000 km/s", "385,000 km", "28 days" for 27.3, "21 °C" for
20, "98 °F" for 98.6), estimates ("1,050" on "Estimate 49 x 21"), pi and rounded conversion factors
("12.57" for 12.56, "62.5 miles" for 62.1, "30 m/s" for 29.4), bare counts ("3" on "how many
fourths" for 3/4), the other sign on a drop, loss or depth, and "45" for 0.45. Those are all null or
right now (`answer-match.test.ts` pins them), and the decision was made to reject only gross misses.

The choices that keep it conservative, all tuned on this set (DEV, so these numbers overstate a new set):

- Percent against a plain number: "45%" for 9/20 is right only when the question asks for no form;
  "0.45" for a 45% key is always the model's.
- A question that asks for a form (as a percent, decimal or fraction, simplest form, scientific or
  standard notation, rounded, exact, in digits) or for the key's unit ("in kilometers?", "how many
  grams") leaves the right value in another form or unit to the model: "0.45", "75/100", "30 × 10^3",
  "1500 m".
- Never wrong: an answer that says "about", a one-letter unit of another kind ("9 m" for 9 m²), another
  temperature scale ("212 °C"), years against days, a bare number that may be the key in another unit,
  a question that asks for the unit, a ratio, any clock time other than a.m. for p.m.

On the five dev sets, with no word known to be real (`answer-match.test.ts`), code marks no right answer
wrong. Against the first version, code now leaves 27 wrong answers to the model that it had marked
wrong, all near misses: `numbers` 14 ("0.66" for 0.67, "4,800" for 4,900, "406,200", "365" and "367
days" for 366, "5 °C" for −5 °C after a fall, "15" for −15 below sea level, "$3.05" for $3.50, "3:15
p.m." for 4:15 p.m., "130 minutes" for 150, "30 inches" for 36, "180 °F" for 212 °F, "150 million
miles" for about 1.5 × 10^8 km, "36 years" for 37); `synonyms` 9 ("60 seconds" and "100 minutes" for
an hour, "10 kilometers" for a marathon, "100 °C" for freezing, "90" and "360 degrees" for a straight
angle, "24 hours" for a year, "365 days" and "12 hours" for a day); `round2` 4 ("54" for 7 × 8, "8"
sides for a hexagon, "0 degrees Fahrenheit" for freezing, "73" for 100 − 37). Right answers settled are
unchanged. `signs` and `misspell` are unchanged, so their prompts are byte-identical to master's and
they were not rerun.

Right failed / wrong passed / settled by code, per run (local Ollama, RTX 3070 laptop, same runner and
order as the baseline; each run its own process):

| Set | Model | Before (master + set) | First version (`1bb7318`) | Gross misses only |
|---|---|---|---|---|
| numbers (92 / 80) | e2b run 1 | 14 / 3 / 38 | 0 / 0 / 155 (68 wrong) | 0 / 1 / 141 (54 wrong) |
| numbers (92 / 80) | e2b run 2 | 13 / 3 / 38 | 0 / 0 / 155 (68 wrong) | 0 / 1 / 141 (54 wrong) |
| numbers (92 / 80) | e2b run 3 | 14 / 3 / 38 | 0 / 0 / 155 (68 wrong) | 0 / 1 / 141 (54 wrong) |
| numbers (92 / 80) | e4b run 1 | 8 / 5 / 38 | 1 / 2 / 155 (68 wrong) | 0 / 2 / 141 (54 wrong) |
| synonyms (74 / 80) | e2b x3 | 13 / 1, 14 / 1, 15 / 1 | 7 / 1, 6 / 1, 8 / 1 | 8 / 2, 8 / 1, 8 / 1 (22, 5 wrong) |
| round2 (30 / 30) | e2b x3 | 0 / 0, 0 / 0, 0 / 0 | 0 / 0, 0 / 0, 0 / 0 | 0 / 0, 0 / 0, 0 / 0 (14, 2 wrong) |
| signs (60 / 60) | e2b x3 | 1 / 1, 2 / 0, 2 / 0 | 2 / 0, 2 / 0, 2 / 1 | not rerun (code unchanged) |
| misspell (60 / 60) | e2b x3 | 13 / 0, 8 / 1, 9 / 1 | 11 / 0, 11 / 0, 11 / 0 | not rerun (code unchanged) |

"Before" for the other sets is the last recorded master run (results/2026-11-16-grade-dev-misspelling-hint.md).

- numbers, e2b: the 14 near misses now left to the model were all graded wrong on every run. The one
  wrong pass, on all 3 runs, is "0.45" on "Write 9/20 as a percent" (n01, a form call code leaves to the
  model, as in the first version, where it was graded wrong on every run). This change does not alter
  that call: the other nine answers in its batch of 10 are settled by code in both versions, so the
  model gets the same one-answer prompt. The cause of the flip is not known; it is not this change.
- numbers, e4b: no right answer failed; passed "150 million miles" for about 1.5 × 10^8 km (n36, now
  left to the model) and "75/100" for simplest form (n06, a form call, as before).
- synonyms, e2b: the near misses now left to the model were graded wrong, except that run 1 passed
  "about 42 miles" for about 42 km (s05, an "about" answer code never rejects, in both versions). Still
  failed: "about 3.3 feet" for 100 centimeters (s24), "pi radians" (s34, not in the table), and the
  alt-name and synonym answers as before; "the courts" (s02) failed once. "the cerebrum" passed on
  every run, as before.
- round2, e2b: the 4 near misses now left to the model were graded wrong on every run.

Fourth review. Code still marked wrong a fact given as another fraction ("3/4" for 7/10 or about 7/10 of
Earth's surface, "2/3" for 3/5 of the body), a fraction for a percent key ("3/4" for 70%, "2/3" for
60%), and the minus sign on a fall phrased as "go down", "colder" or "lower" ("-6 °C" for 6 °C). Now a
different fraction is wrong only on the 20% rule's terms (the question gives the numbers, asks for no
estimate, and the key does not say about), a bare number for a percent key is read as a part when that
is nearer before the gross-miss test, and down, colder, cooler, lower, sank/sink/sunk and descend count
as a fall. Each case is pinned null or right through `gradeAnswersBatch`
(`quiz-grade-batch.test.ts`). Code's verdict on every answer of the five dev sets is the same before and
after (compared answer by answer, with no word known to be real), so the prompts the model gets are
unchanged and the runs above were not repeated.

**Fifth change, after the fourth fix's verification.** That verification found more ways to ask for a
decrease ("how much less", "how much shorter", "how much did it slow") where a minus sign was still marked
wrong. A list of decrease words never ends, so a sign flip is now gross only on bare arithmetic
(`signMatters`): the question writes an operation between numbers ("What is 3 - 5?", "negative 7 plus 3")
and does not ask for an amount or a change. Every other sign flip goes to the model. One dev answer moves:
"-273 K" for 0 °C on the Kelvin scale (n33) is now the model's, so the numbers set has 53 wrong answers
marked by code, not 54. The other four sets' verdicts are unchanged. Not rerun; the blind held-out v6
run measures it.
