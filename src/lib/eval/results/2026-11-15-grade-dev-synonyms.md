# Written-answer grading: synonyms, other names, other units (dev)

2026-11-15. DEV only; prompts were tuned on these sets. Labels by Claude, not blind.
Runner: `src/lib/eval/headless/grade-dev.eval.ts` (the app's path: `settleByCode`, then
`gradeAnswersBatch`, batches of 10, one fixed shuffled order). Ollama local, RTX 3070 laptop.

Why: the round-2 held-out run (frozen `7bf6d83`) failed 3, 3 and 4 of 40 right answers on gemma4:e2b
(bar: 2 or fewer), mostly synonyms ("polliwog" for tadpole), a number in other units, and an ordinal
in words. The failing items were known from that run's report when this work started. None of them is
in these dev sets, but one was used: the first version of this PR took "the thirteenth" for "13th
Amendment" ("Which amendment abolished slavery?"), a reported round-2 failure, as the example in the
ordinal code's unit tests and docs, and the ordinal rule was written to settle it. The review fix
replaced that example with "the fourth" for "4th planet"; the rule still settles the original item.
So a held-out set that contains that item does not test the ordinal rule on unseen data.

## Sets

- `synonyms` (`GRADE_DEV_SYNONYMS`, new): 40 questions, 74 right answers (15 synonym, 14 alt-name,
  15 units, 27 form, 3 number-in-words) and 80 wrong (9 partial, 59 same-topic, 7 wrong-unit,
  5 opposite).
- `round2` (`GRADE_DEV_ROUND2`): the 30-question set #317/#318 tuned on, one right and one wrong each.

## Code (settleByCode)

The degree sign reads as "degrees" and ordinals in words become digits. On these sets it newly settles
"zero degrees Celsius" for "0 °C" and "180 degrees" for "180°", and no wrong answer (unit test). Code
settles 4 of 154 answers on `synonyms` and 12 of 60 on `round2`. The review fix (below) settles exactly
the same answers on both sets.

## Prompt iterations, gemma4:e2b x3 on `synonyms`

Right failed of 74 / wrong passed of 80, per run.

| Arm | Run 1 | Run 2 | Run 3 | Kept |
|---|---|---|---|---|
| Old wording | 17 / 1 | 19 / 1 | 17 / 1 | |
| 1: "Another name or a synonym … counts, and so does the same amount in different units: convert it and compare." + false for a related thing or part of the answer | 13 / 2 | 14 / 1 | 14 / 1 | no: wrong passed rose ("about 42 miles") |
| 2: as 1, units "when the number is converted correctly ("1 km" for "1000 m"); the same number with another unit does not ("1 mile" for "1 km")" | 15 / 2 | 15 / 1 | 14 / 2 | no: wrong passed rose ("about 42 miles" in every run) |
| 3: as 1, units "only when it converts to the expected amount; the same number in another unit is wrong", and the feedback asks for the conversion | 15 / 0 | 16 / 1 | 16 / 1 | yes, then the feedback part dropped (below) |

Right failed by kind, per run (old wording → arm 3):

| Kind | Old | Arm 3 |
|---|---|---|
| units (15) | 11, 13, 11 | 8, 9, 8 |
| alt-name (14) | 4, 4, 5 | 5, 4, 5 |
| synonym (15) | 2, 1, 1 | 2, 2, 2 |
| form (27) | 0, 1, 0 | 0, 0, 1 |
| number-in-words (3) | 0, 0, 0 | 0, 1, 0 |

Wrong passed: old wording "the cerebrum" for "the brain" (partial) in every run. Arm 3: none, "the
cerebrum", and "37 degrees Fahrenheit" for "about 37 °C" (wrong-unit) once.

The prompt does not help synonyms or other names on e2b; the gain is units only. Still failed by arm 3
in most runs: "a whelp", "a larva", "the courts", "the people of France", "the second/fourth planet
from the sun", "about 26 miles", "about 2.2 pounds", "10,000 square centimeters", "pi radians".

## Regression: `round2` on the final code (arm 3)

| Model | Right failed of 30 | Wrong passed of 30 |
|---|---|---|
| gemma4:e2b, old wording (same code) | 0, 0, 0 | 0, 0, 0 |
| gemma4:e2b, arm 3 | 0, 1 ("pacific"), 0 | 0, 0, 0 |
| gemma4:e4b, arm 3 | 1 ("he ran") | 0 |

## Review fix: code passes no wrong sign, unit or noun; the feedback asks for no conversion

An independent review found wrong answers code settled. On the PR's first version: "4" for "Negative
4" ("What is negative 7 plus 3?"), "5" or "five" for "Negative 5", "5" for "minus five", "23 degrees"
for "23 degrees north" on a north-or-south question, "two" for "Two thirds" on "one third or two
thirds?", and "2nd" for "The second". The PR had also broken right answers that master settled:
"343 m/s" for "343 meters per second", "300,000 km/s", "9.8 m/s squared", "seconds" for "The second".
On master already, the older first-number match passed "6 arms" for "6 legs", "3 am" for "3 PM", "12"
for "12 PM" on "Is noon 12 AM or 12 PM?" and "1st" for "1 second". Each is now a unit test: the wrong
ones settle nothing, the right ones settle.

The fix: "second" is 2nd only before a word that is not a unit; a key word that is a sign, direction,
am/pm or fraction is never left out; the first number settles only when the answer's other words do
not differ from the key's; and a question that offers a choice ("or") needs the key's whole answer.

The feedback field no longer asks the model to convert other units: a wrong conversion in the feedback
would be shown to a child. Dev numbers did not show it helping, so it went.

Before is the PR's first version (`5b35714`, feedback asks for the conversion); after is the review
fix. Code settles the same answers in both, so the difference is the feedback line and run-to-run
noise. Right failed of 74 / wrong passed of 80 on `synonyms`, right failed of 30 / wrong passed of 30
on `round2`.

| Set, model | Before | After |
|---|---|---|
| `synonyms`, e2b x3 | 16 / 1, 15 / 2, 12 / 1 | 16 / 1, 15 / 1, 13 / 2 |
| `synonyms`, e4b x1 | 9 / 1 | 12 / 1 |
| `round2`, e2b x3 | 0 / 0, 0 / 0, 1 / 0 ("pacific") | 0 / 0, 0 / 0, 0 / 0 |
| `round2`, e4b x1 | 0 / 0 | 1 / 0 ("he ran") |

Right failed by kind on `synonyms`, per run:

| Kind | e2b before | e2b after | e4b before | e4b after |
|---|---|---|---|---|
| units (15) | 10, 8, 7 | 10, 9, 8 | 5 | 7 |
| alt-name (14) | 3, 3, 4 | 4, 4, 3 | 3 | 4 |
| synonym (15) | 2, 2, 1 | 2, 2, 2 | 1 | 1 |
| form (27) | 1, 2, 0 | 0, 0, 0 | 0 | 0 |
| number-in-words (3) | 0, 0, 0 | 0, 0, 0 | 0 | 0 |

Wrong passed: e2b before "37 degrees Fahrenheit" for "about 37 °C" (wrong-unit) in runs 1 and 2 and
"the cerebrum" (partial) in runs 2 and 3; after, "the cerebrum" in every run and "raise" for the
opposite of "increase" once. e4b passed "37 degrees Fahrenheit" both times.

On e2b the feedback line makes no difference that three runs can show (43 vs 44 right failed, 4 vs 4
wrong passed). On e4b one run is 3 right answers worse without it (units 5 → 7, alt-name 3 → 4);
one run each cannot tell that from noise.
