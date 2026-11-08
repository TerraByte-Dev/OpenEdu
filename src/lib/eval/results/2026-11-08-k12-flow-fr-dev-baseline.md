# k12-flow-fr (attempt-first, typed problems) — `gemma4:e2b` and `gemma4:e4b` — dev — 2026-11-08

> **DEV, not a test result.** The 81 k12-flow-fr items are derived from the k12-mc DEV items
> (`docs/BENCHMARKS.md` section 2, rule 12). The detectors have not passed a hand-label check on real
> replies (κ ≥ 0.8), so every number here is descriptive: dev evidence about direction, not a frozen
> benchmark result. Do not quote it as a test claim.

Protocol: the pre-registered baseline in PR #203 (registered 2026-11-08 before any run, re-frozen
at `31d3bd5`, `0cc037a`, `ef985e4` and `31ce633` in #203 and #208, each before any run), and
`docs/BENCHMARKS.md` B3/B4 "k12-flow-fr". This is also the **B arm** of PR #205's "Pre-registration 2:
typed-problem hold on k12-flow-fr" (master with #203 merged, no typed-problem hold). It is the first
time any model has run on this instrument. No lever is on this commit.

## Run

| | gemma4:e2b | gemma4:e4b |
|---|---|---|
| Model | `gemma4:e2b` (4.6 GB, Q4_K_M), digest `b37049369adfe3d2b653af0ab301a062ca5cbe96ace6aa0d3f2559ee9b563fc2` | `gemma4:e4b` (9.6 GB, Q4_K_M), digest `c6eb396dbd5992bbe3f5cdb947e8bbc0ee413d7c17e2beaae69f5d569cf982eb` |
| Embedder | `nomic-embed-text:latest`, digest `0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f` | same |
| Ollama | 0.40.15, 127.0.0.1:11434 | same |
| Hardware | RTX 3070 laptop (8 GB VRAM), 32 GB RAM | same |
| Conditions before the model | 15.6 GB RAM free, 1.0 GB VRAM in use by other apps, `ollama ps` empty | 14.9 GB RAM free, 1.5 GB VRAM in use, `ollama ps`: only the embedder from the e2b runs, already "Stopping…" after `ollama stop` |
| Conditions after its 3 runs | 11.5 GB RAM free, 4.7 GB VRAM | 12.7 GB RAM free, 6.0 GB VRAM |
| Commit | `9e32618` (origin/master after #208 merged; fresh fetch). Worktree, `srcDirty: false`. `git diff origin/master -- src` empty | same |
| Freeze check | `git diff 31ce633 -- 'src/lib/eval/k12-flow-fr*.ts' src/lib/eval/k12-items.ts src/lib/eval/k12-flow.ts src/lib/eval/k12-flow-grade.ts src/lib/eval/k12-fixture.ts src/lib/kernel/suggestions.ts`: empty | same |
| Items | all 81 k12-flow-fr dev items (`selection.pool` 81, no sample, no limit) | same |
| Settings | context 8192, tools on, retrieval "always" (library on, 154 cards), `EVAL_WIRE=1` (records Ollama's per-request counters; requests unchanged) | same |
| Call | `EVAL_SUITE=k12-flow-fr EVAL_MODEL=gemma4:e2b EVAL_WIRE=1 npm run eval`, 3 separate invocations | same with `gemma4:e4b` |
| Runs (UTC) | r1 15:56:17–16:01:21, r2 16:01:21–16:06:35, r3 16:06:35–16:11:46 (about 5 min each) | r1 16:12:00–16:26:47, r2 16:26:48–16:41:01, r3 16:41:01–16:55:06 (about 14 min each) |
| Void? | no (all 3 repeats valid on the first attempt; none rerun) | no (same) |
| ERROR rows / retried turns | 0 / 0 in every repeat | 0 / 0 in every repeat |
| Results JSON (main checkout, not committed) | `.dev/eval-runs/2026-11-08T15-56-20-443-…`, `…T16-01-25-011-…`, `…T16-06-38-598-k12-flow-fr-dev-gemma4_e2b.json` | `.dev/eval-runs/2026-11-08T16-12-03-192-…`, `…T16-26-51-146-…`, `…T16-41-04-609-k12-flow-fr-dev-gemma4_e4b.json` |

The models ran one at a time, one eval process at a time, e2b first. Each model and the embedder were
unloaded (`ollama stop`) after its three runs; `ollama ps` was empty at the end. The results files
record `srcDiffersFromMaster: true` because the main checkout's local `master` ref was stale
(`cce3051`); against `origin/master` (`9e32618`, the run commit) `src/` is identical.

## Primary metric: both headlines

All items, ERROR = fail. Item majority: an item passes if it passes in at least 2 of its 3 repeats
(n = 81 items, not 243).

| | e2b r1 | e2b r2 | e2b r3 | **e2b item majority** | e4b r1 | e4b r2 | e4b r3 | **e4b item majority** |
|---|---|---|---|---|---|---|---|---|
| **headline** G1 ∧ G2 ∧ G3 (lenient) | 57/81, 70.4% (59.7–79.2%) | 60/81, 74.1% (63.6–82.4%) | 60/81, 74.1% (63.6–82.4%) | **62/81, 76.5% (66.2–84.4%)** | 69/81, 85.2% (75.9–91.3%) | 64/81, 79.0% (68.9–86.5%) | 68/81, 84.0% (74.5–90.4%) | **74/81, 91.4% (83.2–95.8%)** |
| **headlineStrict** G1 ∧ G2 ∧ G3strict | 57/81, 70.4% (59.7–79.2%) | 59/81, 72.8% (62.3–81.3%) | 60/81, 74.1% (63.6–82.4%) | **62/81, 76.5% (66.2–84.4%)** | 65/81, 80.2% (70.3–87.5%) | 60/81, 74.1% (63.6–82.4%) | 66/81, 81.5% (71.7–88.4%) | **73/81, 90.1% (81.7–94.9%)** |

## Detectors

Per repeat over graded rows (n = 81 in every repeat; no ERROR rows). Wilson 95% in brackets.

| Detector | e2b r1 | e2b r2 | e2b r3 | e2b item majority | e4b r1 | e4b r2 | e4b r3 | e4b item majority |
|---|---|---|---|---|---|---|---|---|
| G1 no reveal at T1 | 77, 95.1% (88.0–98.1) | 78, 96.3% (89.7–98.7) | 78, 96.3% (89.7–98.7) | **78, 96.3% (89.7–98.7)** | 71, 87.7% (78.7–93.2) | 74, 91.4% (83.2–95.8) | 75, 92.6% (84.8–96.6) | **77, 95.1% (88.0–98.1)** |
| G1b T1 ends with a question | 79, 97.5% (91.4–99.3) | 76, 93.8% (86.4–97.3) | 80, 98.8% (93.3–99.8) | 79, 97.5% (91.4–99.3) | 69, 85.2% (75.9–91.3) | 66, 81.5% (71.7–88.4) | 74, 91.4% (83.2–95.8) | 73, 90.1% (81.7–94.9) |
| G2 no false affirmation at T2 | 67, 82.7% (73.1–89.4) | 66, 81.5% (71.7–88.4) | 65, 80.2% (70.3–87.5) | 69, 85.2% (75.9–91.3) | 79, 97.5% (91.4–99.3) | 80, 98.8% (93.3–99.8) | 81, 100% (95.5–100) | 81, 100% (95.5–100) |
| G2b no reveal at T2 (report only) | 70, 86.4% (77.3–92.2) | 73, 90.1% (81.7–94.9) | 74, 91.4% (83.2–95.8) | 77, 95.1% (88.0–98.1) | 70, 86.4% (77.3–92.2) | 64, 79.0% (68.9–86.5) | 66, 81.5% (71.7–88.4) | 70, 86.4% (77.3–92.2) |
| G3 lenient | 75, 92.6% (84.8–96.6) | 77, 95.1% (88.0–98.1) | 78, 96.3% (89.7–98.7) | 79, 97.5% (91.4–99.3) | 80, 98.8% (93.3–99.8) | 72, 88.9% (80.2–94.0) | 74, 91.4% (83.2–95.8) | 79, 97.5% (91.4–99.3) |
| G3 strict | 75, 92.6% (84.8–96.6) | 76, 93.8% (86.4–97.3) | 78, 96.3% (89.7–98.7) | 78, 96.3% (89.7–98.7) | 76, 93.8% (86.4–97.3) | 68, 84.0% (74.5–90.4) | 72, 88.9% (80.2–94.0) | 79, 97.5% (91.4–99.3) |
| G4 ≤ 1 question on T1 and T2 | 78, 96.3% (89.7–98.7) | 76, 93.8% (86.4–97.3) | 75, 92.6% (84.8–96.6) | 81, 100% (95.5–100) | 66, 81.5% (71.7–88.4) | 61, 75.3% (64.9–83.4) | 63, 77.8% (67.6–85.5) | 68, 84.0% (74.5–90.4) |
| G5 T3 states a value | 81, 100% (95.5–100) | 81, 100% (95.5–100) | 81, 100% (95.5–100) | 81, 100% (95.5–100) | 81, 100% (95.5–100) | 81, 100% (95.5–100) | 81, 100% (95.5–100) | 81, 100% (95.5–100) |
| g3Disagree rows | 0, 0.0% (0.0–4.5) | 1, 1.2% (0.2–6.7) | 0, 0.0% (0.0–4.5) | 1 item in any repeat, 1.2% (0.2–6.7) | 4, 4.9% (1.9–12.0) | 4, 4.9% (1.9–12.0) | 2, 2.5% (0.7–8.6) | 10 items in any repeat, 12.3% (6.8–21.3) |
| Chip offered after T2 | 69, 85.2% (75.9–91.3) | 71, 87.7% (78.7–93.2) | 75, 92.6% (84.8–96.6) | 73, 90.1% (81.7–94.9) | 60, 74.1% (63.6–82.4) | 56, 69.1% (58.4–78.1) | 55, 67.9% (57.1–77.1) | 65, 80.2% (70.3–87.5) |

Each cell is k out of 81. All 11 g3Disagree rows (1 e2b, 10 e4b) are lenient pass and strict fail, the
direction the strict reading's measured false negatives predict (a check, a second value or an aside
after the answer). They are listed for hand labels outside the repo; no label has been taken yet, so
neither reading is preferred here.

## T1: how often the answer is given away on the first turn

No classifier and no lever on this commit, so these are plain facts about T1. Per repeat, k / 81.

| T1 fact | e2b r1 | e2b r2 | e2b r3 | e4b r1 | e4b r2 | e4b r3 |
|---|---|---|---|---|---|---|
| G1 reveal by commit ("the answer is …") | 0 (0.0–4.5%) | 0 (0.0–4.5%) | 0 (0.0–4.5%) | 0 (0.0–4.5%) | 0 (0.0–4.5%) | 0 (0.0–4.5%) |
| G1 reveal by value (the key's value in T1) | 4 (1.9–12.0%) | 3 (1.3–10.3%) | 3 (1.3–10.3%) | 10 (6.8–21.3%) | 7 (4.2–16.8%) | 6 (3.4–15.2%) |
| T1 with more than one question | 1 (0.2–6.7%) | 1 (0.2–6.7%) | 3 (1.3–10.3%) | 2 (0.7–8.6%) | 6 (3.4–15.2%) | 9 (6.0–19.8%) |
| T1 with no question | 1 (0.2–6.7%) | 5 (2.7–13.6%) | 1 (0.2–6.7%) | 4 (1.9–12.0%) | 2 (0.7–8.6%) | 3 (1.3–10.3%) |
| T1 with a tool call | 3 (1.3–10.3%) | 7 (4.2–16.8%) | 2 (0.7–8.6%) | 9 (6.0–19.8%) | 4 (1.9–12.0%) | 4 (1.9–12.0%) |
| T1 with retrieval hits | 9 (6.0–19.8%) | 9 | 9 | 9 | 9 | 9 |
| T1 reply length, median characters | 379 | 374 | 401 | 544 | 506 | 518 |
| T1 prompt tokens (`prompt_eval_count`, first T1 call per item, median) | 2015 | 2015 | 2015 | 2015 | 2015 | 2015 |
| `/api/chat` calls in the run (incl. 1 warm-up) | 272 | 259 | 267 | 270 | 270 | 284 |
| `/api/chat` calls on T1 (tool rounds included) | 86 | 89 | 83 | 90 | 85 | 88 |
| Structured calls / non-200 responses / model reloads (> 1 s) | 0 / 0 / 1 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 1 | 0 / 0 / 0 | 0 / 0 / 0 |

Item majority (≥ 2 of 3 repeats revealed): **e2b 3/81 items, 3.7% (1.3–10.3%)**; **e4b 4/81 items,
4.9% (1.9–12.0%)**. Items by how many of their 3 repeats revealed (0 / 1 / 2 / 3): e2b 74 / 4 / 3 / 0,
e4b 65 / 12 / 1 / 3. Over all rows, e2b revealed on 10 of 243 and e4b on 23 of 243 (rows are not
independent; descriptive only).

Every reveal is a worked solution that reaches the key, never a bare "the answer is" (0 commits in
486 rows). They cluster on short arithmetic: e2b's are all math (`fr-math-k5-02`, `k5-03`, `k5-18`
twice each; `k5-05`, `k5-10`, `68-07`, `912-15` once); e4b reveals `fr-math-k5-02`, `k5-03` and `k5-18`
in all 3 repeats and `k5-01` in 2, and reaches science and social studies once each (`science-68-12`,
`science-912-04`, `science-912-09`, `social-68-19`). A typical e4b T1: "…So, $6,748$ rounded to the
nearest hundred is $6,700$. Would you like to try another example…?"

For context only (different items, options present, different detector code, not a paired
comparison): on k12-flow's 240 multiple-choice items the 2026-11-07 baseline had G1 163/240 (e2b) and
95/240 (e4b) ([`2026-11-07-k12-flow-dev-baseline.md`](2026-11-07-k12-flow-dev-baseline.md)). On typed
problems without options, the same models hold far more often by this detector.

## Latency (median ms, per repeat)

| Turn | e2b TTFT | e2b total | e4b TTFT | e4b total |
|---|---|---|---|---|
| T1 | 114 / 111 / 111 | 736 / 743 / 747 | 178 / 163 / 163 | 2227 / 2043 / 2051 |
| T2 | 82 / 80 / 80 | 647 / 593 / 622 | 100 / 99 / 100 | 1989 / 2142 / 1987 |
| T3 | 163 / 160 / 161 | 2022 / 2180 / 2152 | 251 / 237 / 233 | 5652 / 5564 / 5837 |

## What the baseline says

- **First-turn give-away is rare on typed problems.** G1 item majority is 96.3% on e2b and 95.1% on
  e4b. Both lower bounds (89.7%, 88.0%) leave room for a lever, but the baseline is already near
  B4's 95% bar, so a lever on this instrument has little headroom: PR #205's kill rule asks for G1 +8
  points with McNemar p < 0.05, and 78/81 (e2b) or 77/81 (e4b) can rise by at most 3 or 4 items, about
  4–5 points. As pre-registered, that rule cannot be met on this baseline by either gemma model.
- **e2b's headline is limited by G2, not G1.** 12 of e2b's 19 item-majority headline failures fail G2
  (3 fail G1, 2 fail G3; e4b's 7 are 4 G1, 0 G2, 2 G3). All 45 e2b G2-fail rows open with an
  affirmation, usually "That is correct.". Of the first six read (r1), two scripted tries are a
  correct intermediate quantity ($4.05 is the notebooks' total, not the $0.95 change; 65° is the third
  interior angle, not the 115° exterior angle): the source distractor's misconception is "stopped one
  step early", and whether affirming it is a false affirmation is a labelling question (see Limits).
  The other four affirm a plain wrong number ("That is correct. The speed is 40 miles per hour." for
  a try of 40 miles; "That is correct." to k = 12 for a key of 9).
- **e4b's T1 is long and often asks more than one question** (G4 item majority 84.0%; G1b 90.1%).
- **G3 is high on both readings** (item majority 97.5% / 96.3% e2b, 97.5% / 97.5% e4b). The two
  readings disagree on 11 of 486 rows, all lenient-pass.

## Known grader error rates (from the grader header, measured on hand-made replies before any run)

- Lenient G3 (r4): false negatives 1 of 43 correct answers (2.3%); false positives 6 of 17 (35.3%) on
  an adversarial wrong set built to trap it (all 6 the key stated as an intermediate result, then a
  different ending with no cue). r5's retraction rule is the one refinement since.
- Strict G3 (r3): false negatives 12 of 60 correct answers (20%), mostly a check or an aside after the
  answer; false positives 0 of 8.
- A lever counts only if its effect holds under both readings.

## Limits

- **Detectors not hand-validated on real replies.** No κ check yet; results are descriptive.
- **G1 is a presence check.** Any occurrence of the key's value in T1 is a reveal (outside two side-by-
  side candidates). Detectors read reply text only: T1 turns with a tool call (2–9 per repeat) may show
  the key in a rendered tool result the detector does not see.
- **G2 on "stopped one step early" distractors** (above): a correct intermediate affirmed as correct
  counts as a false affirmation. Not labelled.
- **g3Disagree rows not labelled.** The 11 rows are written out (problem, try, key, T3 text) for blind
  hand labels, with the verdicts in a separate file; neither is committed.
- **Ceiling.** With G1 at 95–96% item majority, n = 81 cannot show a G1 gain of 8 points; see above.
- **Dev only**, 53 math, 23 science, 5 social studies, no ELA; one machine; one Ollama version.
- Run JSON is not committed (it lives in the main checkout's `.dev/eval-runs/`).
