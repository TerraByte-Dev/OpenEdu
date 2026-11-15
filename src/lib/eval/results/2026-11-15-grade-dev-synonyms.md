# Written-answer grading: synonyms, other names, other units (dev)

2026-11-15. DEV only; prompts were tuned on these sets. Labels by Claude, not blind.
Runner: `src/lib/eval/headless/grade-dev.eval.ts` (the app's path: `settleByCode`, then
`gradeAnswersBatch`, batches of 10, one fixed shuffled order). Ollama local, RTX 3070 laptop.

Why: the round-2 held-out run (frozen `7bf6d83`) failed 3, 3 and 4 of 40 right answers on gemma4:e2b
(bar: 2 or fewer), mostly synonyms ("polliwog" for tadpole), a number in other units, and an ordinal
in words. The failing items were known from that run's report when this work started. None of them is
in these dev sets, but one was used to write code: "the thirteenth" for "13th Amendment", a reported
round-2 failure. The ordinal commit (`aaa0098`) gave it as the case for taking a key's number alone
when the question names the rest of the key, in its code comments, `docs/ARCHITECTURE.md` and commit
message ("Which amendment ended slavery?"), and the dev-set commit (`c2646ed`) put it in the unit tests
as "Which amendment abolished slavery?". The first review fix (`f662b37`) replaced it in the tests,
comments and docs with "the fourth" for "4th planet" on a question about Mars (dev set `s19` has "the
fourth planet from the sun" for Mars); the two commit messages still name it. The rule still settles
that item ("the thirteenth" and "the thirteenth amendment" both settle, by the unchanged rule), so a
held-out set that contains it does not test the ordinal rule on unseen data.

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

## Second review fix: some of the key's words is not the key

A second review found that when the question repeats the key's words, code took the number with any
of them: "60 km" and "60 hours" for "60 km per hour", "60 miles" for "60 miles per hour", "12
centimeters" for "12 square centimeters", "27 meters" for "27 cubic meters", "4 years" for "4 light
years", "3 pounds" for "3 dollars per pound", "2 eggs" for "2 dozen eggs", "3 shoes" for "3 pairs of
shoes" (master left each to the model). "Per second" was held only because "second" read as a
fraction word. The answer's other words, units included, must now be none or all of the key's, in
both the question-names rule and the first-number path, and "second" is no longer a fraction word, so
"343 meters" for "343 meters per second" is held by the rule ("70 beats" for "70 beats per minute"
too). The first-number path had also passed a noun the key lacks ("12 packs" for "12" on "How many
pencils are in 3 packs?"); an added word now settles only when it is what a "how many" question
counts ("9 electrons" for "9"). Each case is a unit test.

Code settles exactly the same answers as before on both sets (4 of 154 on `synonyms`, 12 of 60 on
`round2`; none wrong), and the prompt is unchanged, so before and after differ only by run-to-run
noise. Before is the first review fix (`ba446a5`, the table above); after is this fix.

| Set, model | Before | After |
|---|---|---|
| `synonyms`, e2b x3 | 16 / 1, 15 / 1, 13 / 2 | 12 / 1, 14 / 1, 14 / 1 |
| `synonyms`, e4b x1 | 12 / 1 | 11 / 1 |
| `round2`, e2b x3 | 0 / 0, 0 / 0, 0 / 0 | 0 / 0, 0 / 0, 0 / 0 |
| `round2`, e4b x1 | 1 / 0 ("he ran") | 1 / 0 ("he ran") |

Right failed by kind on `synonyms`, per run:

| Kind | e2b before | e2b after | e4b before | e4b after |
|---|---|---|---|---|
| units (15) | 10, 9, 8 | 8, 8, 9 | 7 | 6 |
| alt-name (14) | 4, 4, 3 | 3, 4, 3 | 4 | 3 |
| synonym (15) | 2, 2, 2 | 1, 2, 2 | 1 | 1 |
| form (27) | 0, 0, 0 | 0, 0, 0 | 0 | 0 |
| number-in-words (3) | 0, 0, 0 | 0, 0, 0 | 0 | 1 ("thirty-seven degrees") |

Wrong passed after: e2b "the cerebrum" (partial) in every run; e4b "37 degrees Fahrenheit" for "about
37 °C" (wrong-unit). The feedback field still asks for no conversion: these runs give no reason to
bring it back.
