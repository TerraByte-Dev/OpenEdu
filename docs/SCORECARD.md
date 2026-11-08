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

¹ Measured with a grader that may miss a few baseline answers, so these gains are upper bounds.
² e4b row: only items where the "show me the answer" button was offered in both arms, measured before
a fix that limits the change to those items; the shipped behaviour on them is the same.
³ The whole gain is 2 items (one Hindi, one Arabic). It met its rule at exactly the threshold, and
the item-level change is not statistically significant.
⁴ No model call added; about 107 prompt tokens on the turn after the student's try. On e4b, reported but
not under the rule, nothing moved significantly (G2 79 → 81). The praise detector misses some phrasings
("You are exactly right"); counting those as praise too, e2b goes 64 → 81, the same conclusion.

For qwen3.5:4b the first-turn hold lifted G1 from 6/240 to 233/240, but the model then gives the
answer away on turn 2 instead (no reveal at turn 2: 178 → 88 of 240)
([G1 hold](../src/lib/eval/results/2026-11-08-k12-flow-dev-G1hold.md)).

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

The first four were killed by rules written before they ran; none of them is in the app.

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
  [results](../src/lib/eval/results/2026-11-08-rag-dev-lookup-note-v2.md)). One added sentence: answer
  about the exact thing asked, and a note about a different thing does not answer it. The gains held
  (3 → 22 of 22 note questions, 3 → 60 of 75 real-world answers), but the same two trick questions
  failed the same way on 3 of 3 runs, and trick questions answered without misusing a note fell from 40
  to 38 of 43. Two wordings of the note have not moved those two items.
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
