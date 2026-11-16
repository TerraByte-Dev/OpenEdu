# Written-answer grading: time units, depths in words and titles with a surname (dev)

2026-11-16. DEV only: the settlers below were written against this set, so its numbers overstate what a
new set will show. Labels by Claude, not blind. Runner: `src/lib/eval/headless/grade-dev.eval.ts` (the
app's path: `settleByCode`, then `gradeAnswersBatch`, batches of 10, one fixed shuffled order),
`EVAL_GRADE_SET=restate`. Ollama local, RTX 3070 laptop. Before = master `4b2df36` with only the set
added (`4595542`); after = `389c856` (this PR). No prompt changed.

Why: held-out v7 failed the e2b right-failed bar (4, 5, 5 / 40 against ≤ 2) on model misses only, each
the key restated: "5 decades" for 50 years, "11 meters below the surface" for -11 m and "madame curie"
for Marie Curie on all three runs, plus the arguable "about 2 months" for about 66 days and "a warren"
for a burrow. Held-out v7 is spent; none of its questions is in this set.

## Set

`restate` (`GRADE_DEV_RESTATE`, new): 22 questions (8 lengths of time, 7 depths and heights, 7 people),
42 right answers and 44 wrong.

- Right kinds: time-unit 14, depth-words 10, title-surname 10, depth-signed 3, surname 2, height-words 1,
  month-calendar 1 ("about 2 months" for about 61 days: arguable, and left to the model on purpose),
  title-under-choice 1 ("madame curie" on "Marie Curie or Pierre Curie?").
- Wrong kinds: time-count 8, time-unit-wrong 8, direction-swapped 7, title-other 6, depth-amount 5,
  rival 4, depth-unit 2, same-surname 2, title-same-surname 2 ("mr curie", "monsieur curie" under the
  choice).

The first commit of the set named a learner "Mia", which is a name in the sealed-name lint's v1 vault
list; the question was reworded (`4595542`) and the before runs were taken again on the reworded set.

## Which code verdicts changed

Through `gradeAnswersBatch` with the bundled dictionary and word list, no model, on all seven dev sets.
Only `restate` changes, so only it was run. `names-times`, `numbers`, `synonyms`, `round2`, `signs` and
`misspell` settle exactly as on master, so their prompts are byte-identical.

- `restate`: code settles 36 right answers (was 6) and no wrong one; it marks nothing wrong, before or
  after. Left to the model: "half a century" (not read), "3 centuries" on "How many years had passed"
  (the question asks for years), "about 2 months" (months against days), "madame curie" under the
  choice, and "dr livingstone" / "doctor livingstone" on "Which Scottish missionary and explorer...?"
  (the surname rule does not read that as a question about a person, so neither the surname nor a title
  with it settles there).

## Results

Right failed / wrong passed, per run. No fallbacks. Code never passed a wrong answer and never marked
an answer wrong on any run.

| Set | Model | Right failed before | Right failed after | Wrong passed before | Wrong passed after | Settled by code before / after |
|---|---|---|---|---|---|---|
| restate | e2b run 1 | 9 / 42 | 1 / 42 | 1 / 44 | 3 / 44 | 6 / 36 |
| restate | e2b run 2 | 13 / 42 | 1 / 42 | 0 / 44 | 3 / 44 | 6 / 36 |
| restate | e2b run 3 | 13 / 42 | 4 / 42 | 2 / 44 | 1 / 44 | 6 / 36 |
| restate | e4b run 1 | 9 / 42 | 1 / 42 | 0 / 44 | 2 / 44 | 6 / 36 |

e2b before, failed on every run: "madame curie" (both questions), "10 decades" for 100 years, "35 m
deep", "430 m below sea level", "4 m below the surface", "4 meters under the water", "12 m below ground",
"15 meters below the ground"; on two runs "5 decades", "2 millennia", "a century". e4b before: seven
depths in words, "5 decades", "10 decades" and "dr king".

After, e2b failed "madame curie" under the choice on every run (code leaves it to the model: the
question offers two Curies); on one run also "half a century", "doctor livingstone" and "about 2
months". e4b failed only "about 2 months".

Wrong passed, by the model, after (e2b over 3 runs / e4b over 1): "2 fortnights" for 14 days 3 / 0,
"mr curie" under the choice 2 / 0, "10 centuries" for 100 years 2 / 0, "monsieur curie" 0 / 1, "4
decades" for 50 years 0 / 1. Before, e2b passed "10 decades" for 10 years 2 / 0 and "2 fortnights" 1 /
0. As with the names-and-times set, once code settles most right answers the model sees batches of
mostly wrong ones and passes a few more of them.

## Reading

- The v7 misses are gone on this set: e2b right failed 9-13 → 1-4, e4b 9 → 1. What is left is the model's
  by design: a title under a choice between two people who share the surname, "half a century", the
  arguable "about 2 months", and a question whose wording the surname rule does not read as about a
  person.
- Wrong passed rose a little (e2b 1, 0, 2 → 3, 3, 1; e4b 0 → 2), all by the model, on another count of
  the same unit ("2 fortnights", "10 centuries", "4 decades") or a man's title under the Curie choice.
  This PR only accepts, so it cannot lower those. Code could mark a different amount in these units
  wrong the way it does years and days; that is a reject rule and is left for its own PR and set.

## What the settlers do

`answer-match.ts`, accept only (null when unsure, never false because of them):

1. Decades, centuries, millennia, fortnights and months in the numeric settler's unit table
   (`RESTATE_UNITS`; "a decade" reads as one). Decades, centuries, millennia and months count in years
   and are calendar units, so "5 decades" is 50 years and "1.5 years" is 18 months, but months against
   days or weeks never settle, even on an "about" key. An amount in one of these is never marked wrong
   ("4 decades" for 50 years goes to the model), and a bare number is never read in one, so "5" for 50
   years is judged as before. "Score" is not added: it is a common word and needs its own number rule.
2. A depth or height with its sign written as a direction (`settleDirected`): "N <unit> below / beneath /
   under the surface, sea level, the ground or the water", "N <unit> deep / down / underwater /
   underground" for a negative length key (or a bare negative key on a question that asks for a length),
   "N <unit> above sea level, the ground, the surface or the water" for a positive one. Only with a unit
   of length, no sign of its own and the key's amount; "above" for a negative, a bare "11" or "11 m",
   "11 below" and "11 km below" go to the model. "Below" is read nowhere else.
3. A title in place of the first name (`TITLES`: madame, madam, mme, mr, mrs, ms, miss, dr, doctor, sir,
   dame, lord, lady, saint, st) before the surname, inside the surname rule: so never under a choice,
   never with a surname the question says, never where the surname alone would not be taken. The title
   is noise only; it is never checked against the person ("mr curie" for Marie Curie on a question that
   offers no choice would be taken, as "curie" is).

## After review (3aebca6)

The review of #335 found code accepting the question said back, all null on master: a depth in words on
a question that asks for the sign ("300 m below sea level" for "Use a signed number to represent 300 m
below sea level"), a restatement unit that echoes the question either way ("a decade" for "What is a
decade?", "14 days" for "What word means a period of two weeks?" with key "A fortnight"), and a
gendered title naming the spouse ("mrs roosevelt" for Franklin, "mr curie" for Marie, "mr lincoln" for
"Who was Abraham Lincoln's wife?"). The fix narrows each settler (null, never false):

- `settleDirected`: never on a question that asks for the sign (integer, signed, negative, positive,
  represent, express), nor when the question already says the amount (the answer's or the key's) and a
  word of the same direction (below, beneath, under, deep, down, lower; above, up, high, higher).
- Restatement units: never when the key is the word ("A decade"), the question names one of the units,
  or the question says the answer's amount.
- Titles: "dr", "doctor", "saint" as before; a gendered title only when the question says the same gender
  (she, her, woman, wife, queen, lady, ...; he, his, man, husband, king, ...) and never the other, with a
  quoted title left out of the question. The said-surname guard drops a possessive 's.

Pinned through `gradeAnswersBatch` in `src/lib/quiz-restate.test.ts`.

Code verdicts on all seven dev sets, as before: only `restate` changes. Eight right answers it settled go
to the model: "35 m deep", "35 meters down" (d02: "goes straight down 35 m"), "430 m below sea level" and
"four hundred thirty meters below sea level" (d03: "430 m lower than sea level"), "250 meters above sea
level" (d04: "250 m higher than sea level"), "15 meters below the ground" (d07: "climbs down 15 meters"),
"lord byron" (c03: no "he" or "his") and "lady lovelace" (c04: no "she" or "her"). Code now settles 28
right answers (was 36), still no wrong one, and still marks nothing wrong.

| Set | Model | Right failed | Wrong passed | Settled by code |
|---|---|---|---|---|
| restate | e2b run 1 | 5 / 42 | 3 / 44 | 28 |
| restate | e2b run 2 | 6 / 42 | 2 / 44 | 28 |
| restate | e2b run 3 | 7 / 42 | 1 / 44 | 28 |
| restate | e4b run 1 | 5 / 42 | 3 / 44 | 28 |

No fallbacks; code never passed a wrong answer or marked an answer wrong.

Right failed rose (e2b 1, 1, 4 → 5, 6, 7; e4b 1 → 5), and the rise is the echoed depths: "15 meters below
the ground" on every run of both models, "430 m below sea level" on every e2b run, "35 m deep" on two e2b
runs and e4b. The model accepted "lord byron" and "lady lovelace" on every run. The rest is as before:
"madame curie" under the choice, "half a century", "doctor livingstone", "about 2 months".

Those depth items each say the amount and the direction in the question, so these answers are the
question said back without the sign; the set labels them right, and the model marking them wrong is the
review's point (the sign is the skill). Read the rise as a label question on d02, d03 and d07, not a model
regression. Wrong passed, all by the model: "mr curie" under the choice (2 e2b runs), "10 centuries" (2),
"2 fortnights", "10 decades", "lady babbage", "monsieur curie", "4 decades" (1 each).

## Held-out v8 (blind, run once at 34f6377)

v8 is a fresh blind set laid out like v7: 40 questions, 120 answers, 22 numeric or unit keys, and the same kind
counts. A generator that read no grading code wrote it. It has 0 overlap with v7 and earlier sets, the dev sets
or the grading test strings, and question similarity is 0.66 at most. SHA-256 `d205ca71…31ca9`.

| Run | Right failed | Wrong passed (by code) | Settled by code (accepted / rejected) |
|---|---|---|---|
| e2b 1 | 1/40 | 1/80 (1) | 30 (26 / 4) |
| e2b 2 | 2/40 | 1/80 (1) | 30 (26 / 4) |
| e2b 3 | 2/40 | 1/80 (1) | 30 (26 / 4) |
| e4b 1 (reported) | 1/40 | 1/80 (1) | 30 (26 / 4) |

The bars, per e2b run, are right failed ≤ 2/40 and wrong passed ≤ 1/80. **Both pass, for the first time in this
series.** Two of the runs are exactly at the right-failed bar, and every run is exactly at the wrong-passed bar.

**The one wrong pass was code's, on every run.** Code accepted "about 337 K" for about 373.15 K: the digits are
swapped and the value is 10% low. #332's estimate band let it through, because the band fired on a fact asked with
"about" that gives no numbers to estimate from. Fixed in #336: the band now needs the question to give the
numbers. Code's other decisions were all correct: 25 accepts were right answers and 4 rejects were wrong answers.

**Right answers failed, all by the model:**
- "$15 overdrawn" for -$15, on every e2b run and on e4b. A negative written as a word, the third held-out set in
  a row.
- "twelve fifteen" for the year 1215, on two e2b runs. A year said in pairs of digits.

**Against v7:** e2b right failed went from 4, 5, 5 to 1, 2, 2, partly because code settles 30 answers here
against 23. v8 also has fewer loose approximations than v7, so it is somewhat easier on the right side.
