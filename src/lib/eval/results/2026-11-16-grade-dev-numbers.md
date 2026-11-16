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
