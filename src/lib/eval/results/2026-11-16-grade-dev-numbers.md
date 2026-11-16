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
quantity each and compares amounts after converting units. Same amount: right. A different amount
beyond the precision either side was written to: wrong (`graded_by` `'exact'`, wrong, feedback "This
does not match the answer key.", and "I think I was right" still offered). Anything it is not sure of
stays null for the model; every such case is listed in the code comment and `docs/ARCHITECTURE.md`.

The choices that keep it conservative, all tuned on this set (DEV, so these numbers overstate a new set):

- Percent against a plain number: "45%" for 9/20 is right only when the question asks for no form;
  "0.45" for a 45% key is always the model's.
- A question that asks for a form (as a percent, decimal or fraction, simplest form, scientific or
  standard notation, rounded, exact, in digits) or for the key's unit ("in kilometers?", "how many
  grams") leaves the right value in another form or unit to the model: "0.45", "75/100", "30 × 10^3",
  "1500 m". A different value is still wrong.
- Rounding: never wrong when one side may be the other rounded ("273 K", "0.13", "0.7"; "5,000" on a
  rounding question). An "about" key is right within 2% and its last digit, wrong past 25%.
- Never wrong: an answer that says "about", a one-letter unit of another kind ("9 m" for 9 m²), another
  temperature scale ("212 °C"), years against days, a bare number that may be the key in another unit,
  a question that asks for the unit, a ratio, a clock time without a.m./p.m. that could be the key.

On the five dev sets, with no word known to be real (`answer-match.test.ts`), code marks no right answer
wrong. Code's decisions against master's (every answer of every set, master's `answer-match.ts` against
this one): `numbers` 49 more right answers settled and 68 wrong answers marked wrong; `synonyms` 13 more
right settled ("3,600 seconds", "about 26 miles", "1 m²", "one year" for about 365 days) and 14 wrong
marked wrong ("60 seconds", "100 grams", "4 meters" for 1 square meter); `round2` 6 wrong marked wrong
("54", "7 square centimeters", "0 degrees Fahrenheit"); `signs` and `misspell` unchanged, so their prompts
are byte-identical to master's.

Right failed / wrong passed / settled by code, per run (local Ollama, RTX 3070 laptop, same runner and
order as the baseline):

| Set | Model | Before (master + set) | After |
|---|---|---|---|
| numbers (92 / 80) | e2b run 1 | 14 / 3 / 38 | 0 / 0 / 155 (68 wrong) |
| numbers (92 / 80) | e2b run 2 | 13 / 3 / 38 | 0 / 0 / 155 (68 wrong) |
| numbers (92 / 80) | e2b run 3 | 14 / 3 / 38 | 0 / 0 / 155 (68 wrong) |
| numbers (92 / 80) | e4b run 1 | 8 / 5 / 38 | 1 / 2 / 155 (68 wrong) |
| synonyms (74 / 80) | e2b x3 | 13 / 1, 14 / 1, 15 / 1 | 7 / 1, 6 / 1, 8 / 1 |
| round2 (30 / 30) | e2b x3 | 0 / 0, 0 / 0, 0 / 0 | 0 / 0, 0 / 0, 0 / 0 |
| signs (60 / 60) | e2b x3 | 1 / 1, 2 / 0, 2 / 0 | 2 / 0, 2 / 0, 2 / 1 |
| misspell (60 / 60) | e2b x3 | 13 / 0, 8 / 1, 9 / 1 | 11 / 0, 11 / 0, 11 / 0 |

"Before" for the other sets is the last recorded master run (results/2026-11-16-grade-dev-misspelling-hint.md).
`signs` and `misspell` send the model the same prompts as master, so their changes are run-to-run noise,
not this change: "fewer than" and "smaller than" (g05) failed every run, "Go" passed once (l03), and the
misspell fails are the misspellings with no note or a two-edit note, as in that file.

- numbers, e2b: the 17 answers code leaves to the model (5 right, 12 wrong: "0.45" as a percent,
  "75/100", "30 × 10^3", "0.13", "0.7", "5,000", "9 m", "1" with "Include the unit", "212 °C", "-7" for a
  17-degree drop, "3:2" and "2:5" for 2:3) were all graded right on every run.
- numbers, e4b: failed "273 K" for 273.15 K (allowed rounding, left to the model), passed "30 × 10^3"
  for scientific notation and "75/100" for simplest form (form calls code leaves to the model).
- synonyms, e2b: the unit answers code now settles no longer reach the model. Still failed: "about 3.3
  feet" for 100 centimeters (s24: an "about" answer against an exact key it does not equal, so code
  leaves it; only an "about" key takes a near amount as right), "pi radians" (s34, not in the table),
  and the alt-name and synonym answers as before. "the cerebrum" passed on every run, as before.
