# Turn classifier (lever 9b) — blind held-out check — code only, no model — 2026-11-08

> **TEST result, code only.** No model was called. This scores `classifyTurn` (`src/lib/kernel/turnKind.ts`
> at `7220ebf`, the tip of `feat/turn-classifier`, PR #205) on the blind held-out set
> `src/lib/eval/turn-kind-heldout.ts`, frozen in its own commit `19314fc` before any scoring and unchanged
> since. Neither the classifier nor any label was changed for this run. The test that produced these
> numbers is `src/lib/eval/turn-kind-heldout.test.ts`; it records and asserts nothing about accuracy.

Method: each message is classified as the student's newest message with an empty history.
`options-problem` and `typed-problem` count as **problem**, `fact-lookup` as **lookup**, `other` as **none**.
Intervals are Wilson 95%. Groups are reported separately: English not ambiguous (176), English marked
ambiguous by the set's author (4; not scored as errors, listed for completeness), non-English (20).

## Headline

- **Severe, problem classified as lookup (the tutor is told to answer, so it gives the answer away): 3 of 59**
  English non-ambiguous problems (5.1%, Wilson [1.7%, 13.9%]), plus 1 of the 4 ambiguous rows (p22). Non-English: 0.
- **Severe, the student's own try classified as problem or lookup: 0.** 0 of 18 English non-ambiguous tries
  (Wilson upper bound 17.6%), 0 of 1 ambiguous try (n58), 0 of 2 non-English tries. 0 of 21 overall (upper 15.5%).
- **Moderate, lookup classified as problem: 0** of 60 English lookups.
- **Unranked, a "none" that is not a try classified as lookup: 2** non-ambiguous (n20, n51) + 1 ambiguous (n57).
  The task's scale does not cover these; each gets the direct-answer note on a question about the session or
  the student's teacher.
- **Mild, a problem or lookup classified as none (no note, the status quo): 22** English non-ambiguous
  (16 problems, 6 lookups) and **14 of 14** non-English problems and lookups.
- English non-ambiguous agreement 149/176 = 84.7% [78.6%, 89.2%]. **Problem precision 40/40 = 100%
  [91.2%, 100%]; problem recall 40/59 = 67.8% [55.1%, 78.3%]** (hard 9/22 = 40.9%). Lookup precision
  54/59 = 91.5% [81.6%, 96.3%], recall 54/60 = 90.0% [79.9%, 95.3%].
- Of the 59 English non-ambiguous messages that got the fact-lookup note, 5 should not have (8.5%,
  [3.7%, 18.4%]): 3 were problems (severe), 2 were session questions (unranked).
- Non-English: every row is `other`. The classifier is English-first by design; that includes the
  Latin-script rows with an explicit equation (x04 "Resuelve 2x + 5 = 17 por favor", x11 "Tatua: 3x - 4 = 11").

## Severe confusions, verbatim

Problem classified as lookup (the fact-lookup note tells the tutor to answer directly):

| id | group | hard | text |
|---|---|---|---|
| p16 | en | yes | "Which word is a noun? A. run B. happy C. table D. quickly" |
| p53 | en | yes | "What year will it be 75 years after 1969?" |
| p54 | en | yes | "How old was Abraham Lincoln when he became president if he was born in 1809 and became president in 1861?" |
| p22 | en, ambiguous | yes | "How many seconds are in a day?" |

The student's own try classified as problem or lookup: none.

Observations, not verified causes: p16 is the only lettered-option item written "A." rather than "A)";
the four "A)" items (p07, p17, p37, p50) were all classified as problems. p53 and p54 are word problems
whose numbers are years, phrased "What year..." / "How old...".

The "attempt" subset of the none rows (used only to split none misfires into severe vs unranked) was
fixed by Claude from each row's text and `why` before the classifier was run on the set: n03 n04 n05
n11 n12 n13 n22 n23 n29 n35 n36 n40 n41 n45 n48 n53 n54 n58 n60 x03 x15. All 21 came out `other`, so
that choice changes no count.

## Tables (as printed by the test)

### English, not ambiguous (n = 176)

| label \ classified | problem | lookup | none | total |
|---|---|---|---|---|
| problem | 40 | 3 | 16 | 59 |
| lookup | 0 | 54 | 6 | 60 |
| none | 0 | 2 | 55 | 57 |
| total | 40 | 59 | 77 | 176 |

| class | precision (Wilson 95%) | recall (Wilson 95%) |
|---|---|---|
| problem | 40/40 = 100.0% [91.2%, 100.0%] | 40/59 = 67.8% [55.1%, 78.3%] |
| lookup | 54/59 = 91.5% [81.6%, 96.3%] | 54/60 = 90.0% [79.9%, 95.3%] |
| none | 55/77 = 71.4% [60.5%, 80.3%] | 55/57 = 96.5% [88.1%, 99.0%] |

Agreement: 149/176 = 84.7% [78.6%, 89.2%]

### English, ambiguous (n = 4)

| label \ classified | problem | lookup | none | total |
|---|---|---|---|---|
| problem | 0 | 1 | 0 | 1 |
| lookup | 0 | 0 | 0 | 0 |
| none | 0 | 1 | 2 | 3 |
| total | 0 | 2 | 2 | 4 |

| class | precision (Wilson 95%) | recall (Wilson 95%) |
|---|---|---|
| problem | 0/0 (undefined) | 0/1 = 0.0% [0.0%, 79.3%] |
| lookup | 0/2 = 0.0% [0.0%, 65.8%] | 0/0 (undefined) |
| none | 2/2 = 100.0% [34.2%, 100.0%] | 2/3 = 66.7% [20.8%, 93.9%] |

Agreement: 2/4 = 50.0% [15.0%, 85.0%]

### Non-English (n = 20)

| label \ classified | problem | lookup | none | total |
|---|---|---|---|---|
| problem | 0 | 0 | 7 | 7 |
| lookup | 0 | 0 | 7 | 7 |
| none | 0 | 0 | 6 | 6 |
| total | 0 | 0 | 20 | 20 |

| class | precision (Wilson 95%) | recall (Wilson 95%) |
|---|---|---|
| problem | 0/0 (undefined) | 0/7 = 0.0% [0.0%, 35.4%] |
| lookup | 0/0 (undefined) | 0/7 = 0.0% [0.0%, 35.4%] |
| none | 6/20 = 30.0% [14.5%, 51.9%] | 6/6 = 100.0% [61.0%, 100.0%] |

Agreement: 6/20 = 30.0% [14.5%, 51.9%]

### English not ambiguous, recall by hard flag

| class | hard | not hard |
|---|---|---|
| problem | 9/22 = 40.9% [23.3%, 61.3%] | 31/37 = 83.8% [68.9%, 92.3%] |
| lookup | 24/28 = 85.7% [68.5%, 94.3%] | 30/32 = 93.8% [79.9%, 98.3%] |
| none | 31/33 = 93.9% [80.4%, 98.3%] | 24/24 = 100.0% [86.2%, 100.0%] |

### Severity counts

| group | severe: problem->lookup | severe: try->problem/lookup | moderate: lookup->problem | mild: ->none | unranked: non-try none->problem/lookup |
|---|---|---|---|---|---|
| English, not ambiguous | 3 | 0 | 0 | 22 | 2 |
| English, ambiguous | 1 | 0 | 0 | 0 | 1 |
| Non-English | 0 | 0 | 0 | 14 | 0 |

### Every misclassified message

| id | group | label | classified (raw kind) | severity | hard | text |
|---|---|---|---|---|---|---|
| p16 | en | problem | lookup (fact-lookup) | severe | yes | "Which word is a noun? A. run B. happy C. table D. quickly" |
| p22 | en, ambiguous | problem | lookup (fact-lookup) | severe | yes | "How many seconds are in a day?" |
| p53 | en | problem | lookup (fact-lookup) | severe | yes | "What year will it be 75 years after 1969?" |
| p54 | en | problem | lookup (fact-lookup) | severe | yes | "How old was Abraham Lincoln when he became president if he was born in 1809 and became president in 1861?" |
| n20 | en | none | lookup (fact-lookup) | unranked | yes | "how many questions are left" |
| n51 | en | none | lookup (fact-lookup) | unranked | yes | "how many tries do i have" |
| n57 | en, ambiguous | none | lookup (fact-lookup) | unranked | yes | "what does my teacher want me to do for this essay" |
| l17 | en | lookup | none (other) | mild | no | "my notes mention the Treaty of Versailles, what was it about" |
| l37 | en | lookup | none (other) | mild | no | "how do vaccines work" |
| l45 | en | lookup | none (other) | mild | yes | "what is pi" |
| l52 | en | lookup | none (other) | mild | yes | "can you help me understand what erosion is" |
| l54 | en | lookup | none (other) | mild | yes | "whats the normal body temperature" |
| l56 | en | lookup | none (other) | mild | yes | "how long did the hundred years war last" |
| p06 | en | problem | none (other) | mild | yes | "how many minutes are in 7 hours" |
| p12 | en | problem | none (other) | mild | no | "i need help with this one. a shirt costs $40 and is on sale for 25% off. what is the sale price" |
| p20 | en | problem | none (other) | mild | yes | "what is the slope of the line through (2,3) and (6,11)" |
| p25 | en | problem | none (other) | mild | no | "If a rectangle has a perimeter of 36 and the length is 10, what's the width" |
| p26 | en | problem | none (other) | mild | no | "The temperature was -4 degrees in the morning and rose 11 degrees. What was the temperature in the afternoon?" |
| p27 | en | problem | none (other) | mild | yes | "this is from my notes page 3: divide 156 by 12" |
| p28 | en | problem | none (other) | mild | no | "whats the mean of 4, 8, 15, 16, 23" |
| p30 | en | problem | none (other) | mild | yes | "How many moles are in 36 grams of water?" |
| p31 | en | problem | none (other) | mild | yes | "my teacher gave us this: 12 is 30% of what number" |
| p40 | en | problem | none (other) | mild | yes | "Jake read 45 pages on Monday. How many pages will he read if he keeps reading that many every day for a week?" |
| p41 | en | problem | none (other) | mild | yes | "If a square has a side of 7 cm what is its area" |
| p43 | en | problem | none (other) | mild | yes | "How many legs do 9 spiders have altogether" |
| p44 | en | problem | none (other) | mild | no | "what is the perimeter of a regular hexagon with side 5" |
| p48 | en | problem | none (other) | mild | no | "help pls 9 - (-3) x 2" |
| p49 | en | problem | none (other) | mild | yes | "What is the GCF of 18 and 24?" |
| p55 | en | problem | none (other) | mild | yes | "can you check what 0.6 x 0.3 is" |
| x01 | non-en (es) | problem | none (other) | mild | no | "cuánto es 3/4 + 1/2" |
| x02 | non-en (es) | lookup | none (other) | mild | no | "qué es la fotosíntesis" |
| x04 | non-en (es) | problem | none (other) | mild | no | "Resuelve 2x + 5 = 17 por favor" |
| x05 | non-en (hi) | lookup | none (other) | mild | no | "भारत की राजधानी क्या है" |
| x06 | non-en (hi) | problem | none (other) | mild | no | "15 का 20% कितना है" |
| x08 | non-en (hi) | lookup | none (other) | mild | no | "प्रकाश संश्लेषण क्या होता है?" |
| x10 | non-en (sw) | lookup | none (other) | mild | yes | "Mlima Kilimanjaro una urefu gani?" |
| x11 | non-en (sw) | problem | none (other) | mild | no | "Tatua: 3x - 4 = 11" |
| x12 | non-en (sw) | problem | none (other) | mild | yes | "Juma ana machungwa 12, anampa Amina 5. Amebaki na mangapi?" |
| x13 | non-en (fr) | problem | none (other) | mild | no | "combien font 7 fois 8" |
| x14 | non-en (fr) | lookup | none (other) | mild | no | "qui a écrit Les Misérables" |
| x16 | non-en (fr) | lookup | none (other) | mild | no | "Quelle est la plus grande planète du système solaire ?" |
| x17 | non-en (ar) | lookup | none (other) | mild | no | "ما هي عاصمة مصر؟" |
| x18 | non-en (ar) | problem | none (other) | mild | yes | "حل المعادلة 2س + 3 = 11" |


## Limits

- **One author, no second labeller.** Every message and every label is one agent's (Claude's); there is no
  agreement figure. 4 rows were marked ambiguous by that author and are reported apart.
- **Synthetic messages, not real students.** The set was written from general knowledge of how grade 3-12
  students type, not sampled from logs. Rates here are rates on this set, not in the app.
- **Not fully blind.** The set's author read the diary entry describing the classifier's rules and example
  shapes before writing it (stated in the set's commit and the diary); a few messages share those shapes
  (l16, n14, n10). It is blind to the classifier's code.
- **Small cells.** 59/60/57 per English class, 20 non-English (6-7 per class), 4 ambiguous. Intervals are wide;
  0 of 18 English tries mis-noted bounds that rate only below 17.6%.
- **Empty history only.** `classifyTurn`'s one history guard (a lookup that repeats the tutor's last question)
  is not exercised; neither are mid-conversation turns.
- **Severity is about which note fires, not about what a model then does.** No model was run, so whether a
  severe misfire actually leaks an answer is not measured here.
- The severity scale is the task's. "Unranked" (a non-try none given a note) is outside it and listed on its own.
