# Written-answer grading: synonyms, other names, other units (dev)

2026-11-15. DEV only; prompts were tuned on these sets. Labels by Claude, not blind.
Runner: `src/lib/eval/headless/grade-dev.eval.ts` (the app's path: `settleByCode`, then
`gradeAnswersBatch`, batches of 10, one fixed shuffled order). Ollama local, RTX 3070 laptop.

Why: the round-2 held-out run (frozen `7bf6d83`) failed 3, 3 and 4 of 40 right answers on gemma4:e2b
(bar: 2 or fewer), mostly synonyms ("polliwog" for tadpole), a number in other units, and an ordinal
in words. Those held-out items were not used here.

## Sets

- `synonyms` (`GRADE_DEV_SYNONYMS`, new): 40 questions, 74 right answers (15 synonym, 14 alt-name,
  15 units, 27 form, 3 number-in-words) and 80 wrong (9 partial, 59 same-topic, 7 wrong-unit,
  5 opposite).
- `round2` (`GRADE_DEV_ROUND2`): the 30-question set #317/#318 tuned on, one right and one wrong each.

## Code (settleByCode)

The degree sign reads as "degrees" and ordinals in words become digits. On these sets it newly settles
"zero degrees Celsius" for "0 °C" and "180 degrees" for "180°", and no wrong answer (unit test). Code
settles 4 of 154 answers on `synonyms` and 12 of 60 on `round2`.

## Prompt iterations, gemma4:e2b x3 on `synonyms`

Right failed of 74 / wrong passed of 80, per run.

| Arm | Run 1 | Run 2 | Run 3 | Kept |
|---|---|---|---|---|
| Old wording | 17 / 1 | 19 / 1 | 17 / 1 | |
| 1: "Another name or a synonym … counts, and so does the same amount in different units: convert it and compare." + false for a related thing or part of the answer | 13 / 2 | 14 / 1 | 14 / 1 | no: wrong passed rose ("about 42 miles") |
| 2: as 1, units "when the number is converted correctly ("1 km" for "1000 m"); the same number with another unit does not ("1 mile" for "1 km")" | 15 / 2 | 15 / 1 | 14 / 2 | no: wrong passed rose ("about 42 miles" in every run) |
| 3: as 1, units "only when it converts to the expected amount; the same number in another unit is wrong", and the feedback asks for the conversion | 15 / 0 | 16 / 1 | 16 / 1 | **yes** |

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
