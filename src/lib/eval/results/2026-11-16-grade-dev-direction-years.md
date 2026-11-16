# Written-answer grading: signs written as words and years said in pairs (dev)

2026-11-16. DEV only: the settlers below were written against this set, so its numbers overstate what a
new set will show. Labels by Claude, not blind. Runner: `src/lib/eval/headless/grade-dev.eval.ts` (the
app's path: `settleByCode`, then `gradeAnswersBatch`, batches of 10, one fixed shuffled order),
`EVAL_GRADE_SET=direction-years`. Ollama local, RTX 3070 laptop. Before = master `f1ba6f1` with only the
set added (`7b9f566`); after = `a779a7c` (this PR). No prompt changed. `823ad05` between them changes one
kind label (x04's "fifteen" is another amount, not a dropped sign); the model never sees kinds.

Why: held-out v8 passed both e2b bars for the first time, and the right answers the model still failed
were two: "$15 overdrawn" for -$15 on every e2b run and on e4b (a negative written as a word, failed on
the third held-out set in a row), and "twelve fifteen" for the year 1215 on two e2b runs. v8 is spent;
none of its questions is in this set.

## Set

`direction-years` (`GRADE_DEV_DIRECTION_YEARS`, new): 22 questions (12 signed amounts, 10 years), 43 right
answers and 23 wrong.

- Right kinds: state-words 16 (a balance, temperature or score whose sign is a word: "$15 overdrawn",
  "owes $12", "15 below zero", "15 points behind", "3 under par"; "$15 in credit", "15 above zero" for a
  positive key), change-words 8 ("a loss of $12", "a drop of $15", "down 8 degrees"), year-pairs 14
  ("twelve fifteen", "eighteen oh five", "twenty oh one"), year-words 1 ("two thousand and one"),
  year-digits 1, number-digits 1, number-words 1, pair-under-choice 1 ("twelve fifteen" on "1215 or
  1512?": right, and left to the model on purpose).
- Wrong kinds: year-other 10 ("twelve fifty" for 1215, "nineteen ninety-six" for 1969, "two thousand"
  for 2001), direction-swapped 9 ("$15 in credit" for -$15, "15 above zero" for -15 °C, "up $15" for a
  drop), sign-dropped 2 ("fifteen" for -15, "twelve dollars" for -$12), amount-other 1, pair-non-year 1
  ("twelve fifteen" for 1215 books).

## Which code verdicts changed

Through `gradeAnswersBatch` with the bundled dictionary and word list, no model, on all eight dev sets.
Only `direction-years` changes, so only it was run. `restate`, `names-times`, `numbers`, `synonyms`,
`round2`, `signs` and `misspell` settle exactly as on master, so their prompts are byte-identical.

- `direction-years`: code settles 42 right answers (was 7: "15 degrees below zero" and the like, which the
  quantity reader already took, and the digits) and no wrong one; it marks nothing wrong, before or
  after. Left to the model: "twelve fifteen" under the choice of 1215 or 1512.
- On held-out v8's own two items, code now accepts "$15 overdrawn" for -$15 and "twelve fifteen" for 1215,
  and still leaves "a balance of positive $15" and "1251" to the model.

## Results

Right failed / wrong passed, per run. No fallbacks. Code never passed a wrong answer and never marked an
answer wrong on any run.

| Set | Model | Right failed before | Right failed after | Wrong passed before | Wrong passed after | Settled by code before / after |
|---|---|---|---|---|---|---|
| direction-years | e2b run 1 | 3 / 43 | 0 / 43 | 4 / 23 | 7 / 23 | 7 / 42 |
| direction-years | e2b run 2 | 3 / 43 | 0 / 43 | 4 / 23 | 5 / 23 | 7 / 42 |
| direction-years | e2b run 3 | 3 / 43 | 0 / 43 | 5 / 23 | 6 / 23 | 7 / 42 |
| direction-years | e4b run 1 | 6 / 43 | 0 / 43 | 4 / 23 | 4 / 23 | 7 / 42 |

e2b before failed the same three on every run: "15 degrees above zero" for 15 °C, "behind by 15" for -15
and "eighteen o five" for 1805. e2b passed "$15 overdrawn" here, unlike on v8. e4b before failed six
signed amounts: "$15 overdrawn", "$12 in debt", "15 points behind", "behind by 15", "a drop of $15", "a drop
of 12".

Wrong passed, all by the model (e2b over 3 runs / e4b over 1):

| Answer | Key | Before | After |
|---|---|---|---|
| "nineteen ninety-six" | 1969 | 3 / 1 | 3 / 1 |
| "fifteen twelve" (under the choice) | 1215 | 3 / 1 | 3 / 1 |
| "twelve fifteen" for a count of books | 1215 | 3 / 1 | 3 / 1 |
| "eighteen fifty" | 1805 | 2 / 1 | 2 / 0 |
| "ten sixteen" | 1066 | 0 / 0 | 3 / 0 |
| "nineteen ninety-eight" | 1989 | 0 / 0 | 3 / 0 |
| "15 below zero" | 15 °C | 1 / 0 | 1 / 1 |
| "twelve dollars" | -$12 | 1 / 0 | 0 / 0 |

## Reading

- The v8 misses are gone on this set: right failed e2b 3, 3, 3 → 0, 0, 0 and e4b 6 → 0, with 35 more right
  answers settled by code and no wrong one.
- Wrong passed rose on e2b (4, 4, 5 → 7, 5, 6) and held on e4b (4 → 4), all by the model, and all but one
  a wrong year said in pairs. The small model does not read a pair reading as a number at all: it passes
  "nineteen ninety-six" for 1969 before and after, and it passes the pair reading of a count. As in the
  earlier rounds, once code settles the right answers the model sees batches that are mostly wrong
  answers and passes a few more of them ("ten sixteen", "nineteen ninety-eight" rose from 0 to 3 on e2b).
- This PR only accepts, so it cannot lower those. Code could mark a different year in pairs wrong on a
  year question ("twelve fifty" for 1215 reads as 1250 for certain), and "15 below zero" for 15 °C; both are
  reject rules, left for their own PR and set.

## What the settlers do

`answer-match.ts`, accept only (null when unsure, never false because of them):

1. `settleDirected` reads a sign written as a word, not only a depth (`DIRECTED_FORMS`): a balance ("$15
   overdrawn", "overdrawn by $15", "$15 in debt", "owes $15", "$15 in the red"; "$15 in credit", "$15 in
   the black"), a temperature ("15 below zero", "15 above zero"), a score ("15 points behind", "behind by
   15", "ahead by 15"; "3 under par" or "3 over par" only on a question that says par) and a change ("a
   loss of $12", "lost $12", "a drop of 8 degrees", "down 12", "a $15 drop"; "a gain of $12", "a rise of
   8", "up 12"). A change form only on a question whose last sentence asks for a change, a profit, a gain
   or a loss; the others never there, so "a drop of 10" is not a temperature and "$15 overdrawn" is not a
   change. Only the key's amount (in the key's unit, or bare where a bare number would be taken) and the
   sign the word means; the other direction, a bare "15" or "$15", a signed amount ("-$15 overdrawn") and
   "about" go to the model. Never on a question that asks for the sign or already says the amount and a
   word of the same direction ("An account is overdrawn by $15"). A positive key is often a size with no
   sign, so a rise or credit word is read for one only on a question that asks no "how much" or "how
   many" and whose last sentence says no fall, debt or depth ("What was its loss?" key $12: "a profit of
   $12" goes to the model).
2. `settleYear`: a key of 1000-2099 in digits (AD or CE allowed) on a question that asks "what year",
   "which year" or "when did/was", said in pairs ("twelve fifteen", "nineteen sixty nine", "eighteen oh
   five", "twenty oh one", "nineteen hundred", "twelve hundred and fifteen") or with thousand ("two
   thousand and one"). Never on a count or a size ("How many", "number of", "population"), a clock time,
   a choice of years, a question that says the key or asks for a form. A key that is the only number on a
   question with no year word ("Columbus reached the Americas in ___") is not read; that is left open.
3. `answerWords` keeps the minus of a negative amount of money ("-$15", "$-15"). It had dropped it, so the
   word match took "$15" and "fifteen" for -$15 (and "-$5" for $5); each now goes to the model.
