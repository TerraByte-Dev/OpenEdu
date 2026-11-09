# OpenEdu scorecard: measured results

*As of 2026-11-08. Every number comes from a linked results file or [BENCHMARKS.md](BENCHMARKS.md). Nearly all are
**dev results**: measured on practice sets whose answers the developers have read, not on a sealed
test set. See [How it was measured](#how-it-was-measured) and [Limits](#limits).*

OpenEdu is an offline AI tutor: a desktop app (Tauri + React, data in a local SQLite file) that tutors
on a small model running on the learner's own machine through Ollama, with no account and no network
needed ([README](../README.md)). It is built for community learning centers and schools where
machines are shared and connectivity is poor. Models measured here: `gemma4:e2b` (4.6 GB on disk),
`gemma4:e4b` (9.6 GB) and `qwen3.5:4b` (3.3 GB)
([L1 results](../src/lib/eval/results/2026-11-07-k12-flow-dev-L1.md)).

## What is measured, and why a tutor needs it

- **Attempt first.** A tutor that hands over the answer before the student tries teaches copying.
  Each test is a scripted three-turn conversation: the student poses a problem, then gives a wrong
  answer, then asks for the full worked answer. Code scores three things: no answer given away on the
  first turn (G1), no praise for the wrong answer (G2), and a correct worked answer when asked (G3).
  "Whole conversation right" means all three
  ([BENCHMARKS B3/B4](BENCHMARKS.md#b4-pedagogy-behaviour-no-reveal-before-a-try-reveal-after-one-question-max)).
- **Grounded in the learner's own notes.** When the student's notes hold the answer, the tutor should
  find and use them, including when the student asks in another language. It should never cite a note
  about a different thing ([BENCHMARKS B1/B2](BENCHMARKS.md#b1-grounding-safety-notes-are-never-misused-or-invented)).
- **Speed without a GPU.** Target machines have none. The pre-registered question: is the median
  reply on every kind of turn under 15 s on a CPU-only laptop?
  ([B7 results](../src/lib/eval/results/2026-11-08-b7-cpu-latency.md))

## Headline results

Changes that passed their pre-registered rule. Wilson 95% intervals in brackets; n counts items, not
repeats (one row counts answers, and says so); McNemar is exact and paired on items. All dev. Each row
compares the commit just before that change with the change; the rows are not cumulative.

| Metric | Model | Before → after | n | McNemar p | Change (PR) |
|---|---|---|---|---|---|
| Holds the answer on turn 1 (G1), multiple-choice problems | e2b | 169/240, 70.4% [64.4–75.8] → 229/240, 95.4% [92.0–97.4] | 240, majority of 3 runs | 1.3e-15 | First-turn hold ([#197](../src/lib/eval/results/2026-11-08-k12-flow-dev-G1hold.md)) |
| | e4b | 98/240, 40.8% [34.8–47.1] → 234/240, 97.5% [94.7–98.8] | 240, majority of 3 | 2.3e-41 | same |
| Whole conversation right (G1 ∧ G2 ∧ G3) | e2b | 159/240, 66.3% [60.1–71.9] → 220/240, 91.7% [87.5–94.5] | 240, majority of 3 | 3.1e-13 | same |
| | e4b | 93/240, 38.8% [32.8–45.0] → 229/240, 95.4% [92.0–97.4] | 240, majority of 3 | 2.3e-41 | same |
| Worked answer correct when asked (G3) | e2b | 179/240, 74.6% [68.7–79.7] → 224/240, 93.3% [89.4–95.9] | 240, 1 run | 1.4e-9 | Worked-answer turn, as shipped ([#184](../src/lib/eval/results/2026-11-07-k12-flow-dev-L1.md)) ¹ |
| | e4b | 77/168, 45.8% [38.5–53.4] → 166/168, 98.8% [95.8–99.7] | 168 ², 1 run | 7.4e-26 | same ¹ |
| Non-English question: answer contains the note's value | e2b | 9/12, 75.0% [46.8–91.1] → 11/12, 91.7% [64.6–98.5] | 12, majority of 3 | 0.5 | Translate before search ([#188](../src/lib/eval/results/2026-11-07-rag-dev-L2.md)) ³ |
| English questions whose note search changed | e2b, qwen3.5:4b | 0 of 90 answers on each model | 90 answers (not items) | — | same |
| No praise for a wrong answer (G2), typed problems | e2b | 65/81, 80.2% [70.3–87.5] → 81/81, 100% [95.5–100] | 81, majority of 3 | 3.1e-5 | Check before praise ([#213](../src/lib/eval/results/2026-11-08-k12-flow-fr-dev-checkpraise.md)) ⁴ |
| Whole conversation right, typed problems | e2b | 59/81, 72.8% [62.3–81.3] → 78/81, 96.3% [89.7–98.7] | 81, majority of 3 | 2.1e-5 | same |
| No answer given away on turn 2 (G2b), multiple-choice problems | qwen3.5:4b | 78/240, 32.5% [26.9–38.7] → 183/240, 76.3% [70.5–81.2] | 240, 1 run | 2.9e-23 | same, measured on a second model ([#220](../src/lib/eval/results/2026-11-08-k12-flow-dev-qwen-checkpraise.md)) ⁵ |
| Whole conversation right, multiple-choice problems | qwen3.5:4b | 182/240, 75.8% [70.0–80.8] → 221/240, 92.1% [88.0–94.9] | 240, 1 run | 4.6e-7 | same ⁵ |

¹ Measured with a grader that may miss a few baseline answers, so these gains are upper bounds.
² e4b row: only items where the "show me the answer" button was offered in both arms, measured before
a fix that limits the change to those items; the shipped behaviour on them is the same.
³ The whole gain is 2 items (one Hindi, one Arabic). It met its rule at exactly the threshold, and
the item-level change is not statistically significant.
⁴ "81/81" is the item-majority of 3 runs; per run it was 80, 77 and 79 of 81, so 7 of 243
conversations still praised a wrong try. No model call added; about 106 prompt tokens on the turn after
the student's try (median difference). On e4b, reported but not under the rule, nothing moved
significantly either way (G2 79 → 81, whole conversation 70 → 68, strict reading 68 → 65). The praise detector misses some phrasings
("You are exactly right"); counting those as praise too, e2b goes 64 → 81, the same conclusion. A
later revision of the praise detector (r6, [#221](https://github.com/TerraByte-Dev/OpenEdu/pull/221))
re-scores these runs at 64 → 80; the results above were graded before it.
⁵ qwen3.5:4b, one run per arm, pre-registered with the exact claim allowed, on dev items. The note
was written with e2b's misses in view; on e4b it moved nothing significantly (footnote 4).

For qwen3.5:4b the first-turn hold lifted G1 from 6/240 to 233/240, but the model then gave the
answer away on turn 2 instead (no reveal at turn 2: 178 → 88 of 240)
([G1 hold](../src/lib/eval/results/2026-11-08-k12-flow-dev-G1hold.md)). The check-before-praise note
closes most of that leak (78 → 183 of 240 in the table above).

**Typed problems, no answer options, no change applied**
([baseline](../src/lib/eval/results/2026-11-08-k12-flow-fr-dev-baseline.md)), 81 items, majority of
3 runs: e2b holds the answer on 78/81 (96.3% [89.7–98.7]) and avoids praising the wrong answer on
69/81 (85.2% [75.9–91.3]); e4b 77/81 (95.1% [88.0–98.1]) and 81/81 (100% [95.5–100]). Praise of a
wrong answer was e2b's main miss here (12 of its 19 failed items); the check-before-praise change in
the table above targets it.

**Speed, CPU only** (Ryzen 7 5800H laptop on mains, 8 threads, not the slower 4-thread reference
box; 5 warm turns per kind)
([B7](../src/lib/eval/results/2026-11-08-b7-cpu-latency.md)): `gemma4:e2b` is the only model measured
with a median under 15 s on all five turn kinds. Its slowest is the full worked answer at 12.5 s; an
English question about the notes takes 2.1 s, with the first word at 0.65 s. A cold first turn takes
14.8 s, with the model file probably still in the OS file cache, so a first launch after a reboot is
slower. `qwen3.5:4b` misses on all five (18.0–35.3 s).

**The one held-out number.** On the RAG held-out v1 test set, run once on 2026-11-06 before any
change above, e2b gave 1 harmful answer in 54 near-miss answers (18 trick questions × 3 runs), and all
12 answers to unrelated questions (4 questions × 3 runs) came without a citation or a leaked note value
([test result](../src/lib/eval/results/2026-11-06-heldout-test.md)). That set has since been read for
diagnosis, so it is spent ([BENCHMARKS §0](BENCHMARKS.md#0-split-status-today-what-has-been-burned)).

## What was tried and did not work

The first nine were stopped by rules written before they ran; none of them is in the app.

- **Named-entity gate** (lever 3, PR #192). It drops notes about a differently named thing. The rule
  needed e2b to give at least 4 more real-world answers; it gave 2 fewer (35 → 33 of 84 answers, 28
  questions × 3 runs). It
  also dropped the second note of a two-part question in every run of both models. On the three
  questions where the gate removed every note, e2b answered exactly as often as with the wrong note
  present, so on those the wrong note was not the cause of its refusals ([L3](../src/lib/eval/results/2026-11-08-rag-dev-L3.md)).
- **Typed-problem hold** (PR #205). Killed before any model ran on it: without it, the models already
  hold the answer on 78/81 and 77/81 typed problems, so the pre-registered 8-point rise could not
  happen on 81 items ([baseline](../src/lib/eval/results/2026-11-08-k12-flow-fr-dev-baseline.md)).
- **Lookup note, wording 1** (lever 9b, PR #205;
  [results](../src/lib/eval/results/2026-11-08-rag-dev-turn-classifier.md)). Under the app's course
  prompt it took e2b from 3 to 22 of 22 questions answered from the notes and from 1 to 59 of 75
  real-world answers. But the number of trick questions answered without misusing a note fell from 42
  to 38 of 43 (the rule allowed a loss of 1). Example: asked "how long does it take a gecko to regrow
  its tail?", e2b answered with a fictional newt's 17 days from the notes, in 3 of 3 runs.
- **Lookup note, wording 2** (PR #215;
  [results](../src/lib/eval/results/2026-11-08-rag-dev-lookup-note-v2.md)). Two added sentences: answer
  about the exact thing asked, and a note about a different thing does not answer it. The gains held
  (3 → 22 of 22 note questions, 3 → 60 of 75 real-world answers), but the same two trick questions
  (the gecko, and Old Faithful answered with a fictional geyser's 38 minutes) failed the same way on 3 of 3 runs, and trick questions answered without misusing a note fell from 40
  to 38 of 43. Two wordings of the note have not moved those two items.
- **Lookup note, a code switch** (PR #222, not shipped;
  [results](../src/lib/eval/results/2026-11-09-rag-dev-lookup-note-v3.md)). Code picks out the thing the
  question asks about. If no note shown to the model contains it, the note says so in plain words.
  On dev it fixed both trick questions and kept the gains (trick questions answered without misusing a
  note: 41 of 43, the same as with no note). On 78 newer questions written without seeing the dev set
  (semi-blind: the code's author saw them before freezing it), it
  let 3 more trick questions through than no note at all (35 vs 38 of 40), and the rule written in
  advance allowed 1. On two of them e2b stated a note's invented value as a fact about the real thing.
  This was the third and last try allowed on these sets.
- **Lookup note, hide the mismatched note** (PR #224, not shipped;
  [results](../src/lib/eval/results/2026-11-09-rag-blind-lookup-drop.md)). When that code finds the
  question is about something the notes don't mention, the notes are not shown at all. Tested on 96
  new questions written by a separate agent after the code and the rule were fixed. It is the first
  try that stopped e2b borrowing: 0 of 144 trick-question answers used a note's value, and real-world
  answers rose from 1 to 31 of 48 questions against no note. But the code wrongly decided 5 of 48
  questions were about something else, hid the note that answered them, and e2b got all 15 of those
  answers wrong. The rule allowed 2. A separate review also found everyday questions the code
  misjudges ("What is the formula for kinetic energy?", "When did WW2 end?", a misspelled
  "photosythesis"), so it would hide students' own correct notes.
- **Lookup note, judge the mismatch by meaning** (lever 9g, PR #228, not shipped;
  [results](../src/lib/eval/results/2026-11-09-rag-blind-long-notes.md)). Before hiding a note, the
  code checks that no sentence of it is close in meaning to the question. Tested on 112 new questions
  about 16 long, realistic notes, written by a separate agent after the rule was fixed. It halved the
  wrongly hidden notes (8 to 4 of 64 questions the notes answered), but the rule allowed 1. All four
  scored just under the cut: a typo ("sleep cyle"), "light sensor thing", "routine", "daisies".
  Neither word matching nor meaning can reliably tell a differently worded right note from a
  look-alike, so this line of levers is closed.
- **Show the part of a long note that matches the question** (lever 14, PR #227, not shipped; same
  results). A bug was found: notes are stored in pieces of about 2,000 characters, but the model was
  shown only the first 1,000 of each, so on long notes the answer was often cut off (issue #226). The
  fix put the answer in front of the model for 57 of 64 questions instead of 28. On e2b, the model the
  rule tested, answers improved only from 7 to 11 of 64, short of the rule's bar: under the app's
  tutoring rules, e2b replies to a lookup with a question even when the answer is in front of it. On
  e4b, checked only for harm, answers rose from 20 to 35 of 64.
- **The plain lookup note, with that long-note fix** (lever 15, issue #230, not shipped;
  [results](../src/lib/eval/results/2026-11-09-rag-blind-lookup-note-window.md)). It tells the model to
  answer a request for information directly, and it shows the matching part of long notes. On 112
  new questions about 16 long notes, written by a separate agent after the rule was fixed, e2b went
  from 12 to 42 of 64 note questions answered, and from 0 to 22 of 48 real-world answers. But trick
  questions answered without misusing a note fell from 48 to 43; the rule allowed 46. Three of the
  five were real mistakes (the note's 1937 given as the year of *The Grapes of Wrath*, for example).
  The app without the note scores 48 of 48 there because it answers almost no lookup at all. With the
  note on, the long-note fix added 15 answered questions on e2b and 13 on e4b. Trick questions
  answered clean stayed within the margin, though one or two more answers repeated a note's value.
- **Tool-call error recovery, live check** (PR #199). Not a failure, but not a pass either: the error
  it handles never happened in 89 turns per arm, so only the unit tests show it works
  ([live check](../src/lib/eval/results/2026-11-08-ollama-toolcall-live-check.md)).

## Limits

- **Dev, not held-out.** Every result in the tables is on dev sets whose answers were read, and the
  wordings were written with them in view. The sealed held-out v2 set has not been run.
- **Graders not yet checked against people.** The code graders have not passed the required check
  against human labels (Cohen's κ ≥ 0.8 on about 60 replies;
  [BENCHMARKS](BENCHMARKS.md#b3b4-protocol-running-k12-flow)). G1 looks for the answer's own text, so
  it can miss a paraphrased worked answer or a strong hint, which would overstate the G1 gains.
  Runs, analyses and the held-out v1 harm grading were done by Claude (an AI agent). No human label
  has been taken yet.
- **Note answers are scored by a proxy,** not a blind human rubric. The proxy cannot see invented facts.
- **The notes numbers flatter e2b.** They were measured with a test-only "answer directly"
  instruction that a course generated in the app lacks. Under the app's course rules e2b answered 2 of
  22 note questions (22 of 22 with the test instruction), replying with a question instead
  ([prompt fidelity](../src/lib/eval/results/2026-11-08-rag-prompt-fidelity.md)).
- **Worked-answer accuracy** has not met its bar of being no worse than the model's own accuracy
  without the tutor (a 95.75% bar). At the commit that shipped the worked-answer turn, e2b's lower
  bound is 89.4% (224/240, one run) ([L1](../src/lib/eval/results/2026-11-07-k12-flow-dev-L1.md#b3-non-inferiority-g3-vs-the-k12-mc-raw-arm)).
  Later runs on master measured 234/240 and then 238/240 [97.0–99.8] (majority of 3,
  [G1 hold](../src/lib/eval/results/2026-11-08-k12-flow-dev-G1hold.md)), but the bar's own test has not
  been rerun on them.
- **Mostly English.** The attempt-first problems are English. The notes tests use six languages with
  made-up names, and only Hindi and Arabic gained ([L2](../src/lib/eval/results/2026-11-07-rag-dev-L2.md)). On CPU, the
  qwen3.5 models' translation step timed out on 5 of 5 turns, so they get no benefit from it there
  ([B7](../src/lib/eval/results/2026-11-08-b7-cpu-latency.md)).
- **One machine.** Quality runs used the GPU of an RTX 3070 laptop (8 GB VRAM). Timings used its
  Ryzen 7 5800H CPU with 8 threads, not the 4-thread, 8 GB reference box, which will be slower. One
  learner at a time; shared-machine load is not measured ([B7 limits](../src/lib/eval/results/2026-11-08-b7-cpu-latency.md#limits)).
- **Small n:** 240, 81, 43, 25, 22 and 12 items, and 5 timed turns per kind.
- **Not learning outcomes.** No study with learners has been run. These numbers describe model
  behaviour. Answer-grading accuracy is not measured here.
- **Generated courses are not safe for health topics yet.** In a check of AI-generated first-aid
  courses, e2b's had 6 dangerous items and e4b's 3, rated not usable; the safety gate that would catch
  them does not exist ([BENCHMARKS B6](BENCHMARKS.md#b6-course-generation-reliability-and-safety)).

## How it was measured

- **Dev vs sealed.** Practice ("dev") sets are for tuning, and their answers are read. A separate
  held-out set is sealed outside the repository. Its SHA-256 hash was committed before any change
  merged, and only a frozen script may open it, once. It has not been run.
- **Pre-registration.** Each change's success rule, kill rule and run plan were posted in its PR
  before the first model run (for #197: posted 03:38:38Z, first run 04:24:15Z).
- **Kill rules applied literally.** A rule that fires is reported as firing, even when the cause looks
  like noise: the lookup-note change's guard fired on a 5-item drop, exactly its threshold, on
  first-turn requests identical in both arms, and was recorded as a firing.
- **Paired arms at recorded commits.** "Before" and "after" run the same items at two recorded
  commits with no uncommitted code, so each item is compared with itself.
- **Repeats.** The model is sampled without a fixed seed. Where runs were repeated (3 times), an item
  passes if it passes in at least 2 of 3. The worked-answer runs used 1 sample per item.
- **No answer-feeding.** The tutor sees only what a student would send: the problem, a scripted wrong
  try, then "Show me the full worked answer." Changes act through code, such as a roughly 104-token
  note appended to the problem turn, or different instructions when the show-answer button is pressed.
  The answer key is read only by the grading code. A change may not contain any test item's id, made-up
  names or facts.
- **Every run reported,** including void, crashed and failing ones.

Full program: [docs/BENCHMARKS.md](BENCHMARKS.md). Per-run detail: [src/lib/eval/results/](../src/lib/eval/results/).
