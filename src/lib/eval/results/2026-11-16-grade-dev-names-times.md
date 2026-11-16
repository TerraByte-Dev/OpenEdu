# Written-answer grading: clock times in words, surnames and misspelt names (dev)

2026-11-16. DEV only: the settlers below were written against this set, so its numbers overstate what a
new set will show. Labels by Claude, not blind. Runner: `src/lib/eval/headless/grade-dev.eval.ts` (the
app's path: `settleByCode`, then `gradeAnswersBatch`, batches of 10, one fixed shuffled order),
`EVAL_GRADE_SET=names-times` and `numbers`. Ollama local, RTX 3070 laptop. Before = master `4341917`
with only the set added (`9b135cb`); after = `b1f859e` (this PR). No prompt changed.

Why: held-out v6 failed the e2b right-failed bar on model misses only, each the key in another form:
"quarter after eleven" for 11:15, "the sahera desert" for the Sahara Desert, "pompei" for Pompeii,
"fleming" for Alexander Fleming, "conan doyle" for Arthur Conan Doyle. Held-out v6 is spent; none of
its questions is in this set.

## Set

`names-times` (`GRADE_DEV_NAMES_TIMES`, new): 30 questions (10 clock times, 11 people, 9 places and
names), 54 right answers and 59 wrong.

- Right kinds: name-misspelt 16, time-words 14, surname 9, time-half 6, surname-misspelt 4,
  surname-2 3, title-surname 1 ("captain cook"), first-name-under-choice 1 ("marie" on "Marie Curie or
  Pierre Curie?").
- Wrong kinds: rival 16, time-other 12, other-place 7, other-place-misspelt 7, time-half-swapped 7,
  same-surname 5, first-name 4, surname-in-question 1 ("roosevelt" on "Which Roosevelt...?").

## Which code verdicts changed

Through `gradeAnswersBatch` with the bundled dictionary and word list, on all six dev sets. Only two sets
change, so only they were run:

- `names-times`: code settles 48 right answers (was 5) and still marks "5:15 a.m." wrong for 5:15 p.m.
  It settles no wrong answer. Left to the model: "six thirty" for 6:30 a.m. and "twelve o'clock" for
  12:00 p.m. (each question says the other half of the day), "flemming" ("lemming" is one edit away, a
  real word), "Franklin Roosevelt" (the question says Roosevelt), "marie", "captain cook".
- `numbers`: one, n19 "quarter past four in the afternoon" for 4:15 p.m., now settled right.
- `synonyms`, `round2`, `signs`, `misspell`: none, so their prompts are byte-identical to master's.

## Results

Right failed / wrong passed, per run. No fallbacks. Code never passed a wrong answer and never marked a
right one wrong on any run.

| Set | Model | Right failed before | Right failed after | Wrong passed before | Wrong passed after | Settled by code before / after |
|---|---|---|---|---|---|---|
| names-times | e2b run 1 | 19 / 54 | 1 / 54 | 7 / 59 | 7 / 59 | 6 / 49 |
| names-times | e2b run 2 | 22 / 54 | 1 / 54 | 11 / 59 | 8 / 59 | 6 / 49 |
| names-times | e2b run 3 | 20 / 54 | 1 / 54 | 7 / 59 | 8 / 59 | 6 / 49 |
| names-times | e4b run 1 | 5 / 54 | 0 / 54 | 7 / 59 | 7 / 59 | 6 / 49 |
| numbers | e2b run 1 | 0 / 92 | 0 / 92 | 1 / 80 | 0 / 80 | 140 / 141 |
| numbers | e2b run 2 | 0 / 92 | 0 / 92 | 0 / 80 | 0 / 80 | 140 / 141 |
| numbers | e2b run 3 | 0 / 92 | 0 / 92 | 1 / 80 | 0 / 80 | 140 / 141 |
| numbers | e4b run 1 | 1 / 92 | 0 / 92 | 1 / 80 | 0 / 80 | 140 / 141 |

("Settled by code" counts the one code rejection per run on each set: "5:15 a.m." on names-times, the
53 gross misses on numbers.)

e2b before, failed on every run: every name-misspelt answer but "jupeter" (2 of 3), "fleming" for
Alexander Fleming on "Which scientist...", "cook" for James Cook, "darwen", "flemming", "marie",
"quarter past five", "twenty to ten". After: "flemming" on every run, nothing else.

Wrong passed, by the model, after (e2b over 3 runs / e4b over 1): "quarter to eleven" for 11:15 3 / 1,
"half past eleven" 3 / 0, "quarter to five" for 5:15 p.m. 3 / 1, "twenty to twelve" for noon 1 / 1,
"five to three" and "ten past three" for 3:05 p.m. 0 / 1 each; "albert" for Albert Einstein 3 / 0,
"florence" for Florence Nightingale 3 / 1, "alexander" 1 / 0; "curie" on "Marie Curie or Pierre
Curie?" 3 / 1; "roosevelt" on "Which Roosevelt...?" 3 / 0. Before, e2b passed the same wrong times
(and "half past eight", "half past four", "quarter past ten", "Hamilcar") and the same first names,
and never "roosevelt" or "curie": with code settling most of each batch, the model now sees batches of
mostly wrong answers, and passes those two.

## Reading

- The v6 misses are gone on this set: e2b right failed 19-22 → 1, e4b 5 → 0. The one left, "flemming",
  stays the model's because a real word ("lemming") is one edit from it.
- Wrong passed did not move (e2b 7, 11, 7 → 7, 8, 8). Every wrong answer the model passes here is the
  model's own: a different time in words ("quarter to eleven" for 11:15, on every e2b run), a first name
  alone, or a surname the question already says. This PR only accepts, so it cannot fix those. A
  different clock time in words could be marked wrong the way digits already are (a time in words that
  reads as one time and is not the key's); that is a reject rule and is left for its own PR and set.
- `numbers` is unchanged but for n19; its wrong passes before ("0.45" on "Write 9/20 as a percent",
  "150 million miles") are run-to-run noise in which batch the model sees, not this change.

## What the settlers do

`answer-match.ts`, accept only (null when unsure):

1. A clock time in words (`spokenClock`) for a clock-time key: "quarter past/after", "half past", "ten
   to", "eleven fifteen", "three oh five", "four o'clock", "noon", "midnight", with a.m./p.m., "in the
   morning/afternoon/evening" or "at night" only when that is the key's half of the day; with none, only
   when the key has none or the question pins the key's half (it says one half, and it is the key's).
   `isClockKey` also reads an "H:MM" key as a time on a question that asks when or gives a clock time.
2. A surname (`personSurnames`): on a question that asks who or names a person's role, the name's last
   word or, for 3-4 words, its last two. Never under a choice, never a surname the question says.
3. A misspelt name (`misspeltName`): a capitalised key word in neither WordNet nor the word list, an
   answer word in neither, same first and last letters, one slip by ear (two for 7+ letters), and no
   word of the question or key, country, US state, continent or planet as close.
