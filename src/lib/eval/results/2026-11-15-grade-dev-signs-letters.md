# Written-answer grading: signs in words, spaced letters, two-edit misspellings (dev)

2026-11-15. DEV only; the code was written against these sets. Labels by Claude, not blind.
Runner: `src/lib/eval/headless/grade-dev.eval.ts` (the app's path: `settleByCode`, then
`gradeAnswersBatch`, batches of 10, one fixed shuffled order), `EVAL_GRADE_SET=signs|synonyms|round2`.
Ollama local, RTX 3070 laptop. Before = master `0b9a730` with only the new set added (`7f0ce22`);
after = this PR's code. No prompt change.

Why: the round-3 held-out run (e2b x3) failed 3, 4 and 3 of 40 right answers (bar: 2 or fewer), all
model misses. The report named three: "omnivour" for "omnivore", "greater than" for ">", and "n a"
for "Na". Those three answers were known when this work started and are used as examples in the unit
tests and code comments ("omnivour" for "Omnivore" on a question written here, not the held-out
one). No held-out question is in the dev set. A held-out set that contains those three items does
not test these rules on unseen data.

## Set

`signs` (`GRADE_DEV_SIGNS_LETTERS`, new): 30 questions, 60 right answers (20 sign, 20 letters,
20 misspelling) and 60 wrong (20 other-sign, 17 other-symbol, 2 other-misspelt, 21 same-topic).

## Code (settleByCode)

On `signs`, code settles 24 answers on master, 3 of them wrong: "CO" for "Co", "Co" for "CO" and "No"
for "NO". Master compares case-blind, so a symbol in another case passed as the key. After: 53, all
right, none wrong. Not settled by code, and left to the model: two names for one sign ("smaller than"
for "Less than", "equals" for "Equal to"), "the same as", "the division sign", "circulatery sistem"
("sistem" is one edit from "sister"), and "carbon diokside" (a consonant changed). Code settles exactly
the same answers as master on `synonyms` (4) and `round2` (12).

## Results

Right failed / wrong passed, per run.

| Set | Model | Before | After |
|---|---|---|---|
| signs (60 / 60) | e2b x3 | 16 / 3, 19 / 3, 19 / 3 | 0 / 0, 0 / 0, 1 / 0 |
| signs (60 / 60) | e4b x1 | 9 / 3 | 0 / 1 |
| synonyms (74 / 80) | e2b x3 | 13 / 0, 15 / 1, 14 / 1 | 13 / 1, 15 / 2, 14 / 1 |
| synonyms (74 / 80) | e4b x1 | 11 / 0 | 11 / 1 |
| round2 (30 / 30) | e2b x3 | 0 / 0, 0 / 0, 0 / 0 | 0 / 0, 0 / 0, 0 / 0 |
| round2 (30 / 30) | e4b x1 | 1 / 0 | 1 / 0 |

`signs`, right failed by kind on e2b (before → after): sign 7, 6, 7 → 0, 0, 1 ("fewer than" for
"Less than", a name for a name, which code leaves to the model); misspelling 4, 6, 5 → 0, 0, 0;
letters 5, 7, 7 → 0, 0, 0.

Wrong passed:
- `signs` before: the three case-blind code passes above, in every run. After: none by code. e4b
  passed "CO" for "Co" once on its own (code now sends it to the model). The model can still pass a
  symbol in the wrong case; code no longer does.
- `synonyms` and `round2`: code settles the same answers before and after, so the differences are the
  model's run-to-run spread. "the cerebrum" for "the brain" (a known partial, round-3 results) passed in
  5 of 6 e2b runs, "raise" for "Decrease" once after, and "37 degrees Fahrenheit" for "About 37 °C" once
  on e4b after.
- `round2` e4b: "he ran" failed before and after, as in round 3.

## Rules that went in, and the cases that shaped them

- A sign and its name: one side has to be the sign itself. Two names go to the model, which also keeps
  "multiplied by" off "The Times".
- Spaced or dotted letters, 1-3 letter keys. Cased as other element symbols ("CO", "C O" for "Co"):
  never. On a symbol or formula question a case-carrying key needs its own case ("co" for "Co" goes to
  the model); elsewhere "no" still settles "No".
- Misspellings, found while checking the rule against the bundled dictionary: it has no names of
  places or people, so master's one-edit rule took "Zambia" for "Gambia" (the unit tests had treated
  "zambia" as a dictionary word) and "slovania" for "Slovenia" (one edit from Slovakia too). Now the
  key word must be in the dictionary and no other dictionary word may be one edit from the answer's
  word, for one edit as well as two. A word the question offers that is as close blocks it too
  ("hypetonic" on "hypertonic or hypotonic?"). Two edits only on a key word of 8 letters or more, only
  vowels or doubled letters ("thermomitur" yes, "termomiter" and "fotosynthesis" no).
