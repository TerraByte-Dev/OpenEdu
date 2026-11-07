# k12-flow (attempt-first) — `gemma4:e2b` and `gemma4:e4b` — dev — 2026-11-07

> **DEV, not a test result.** These are the 240 k12-mc items, which are DEV for this flow
> (`docs/BENCHMARKS.md` section 0). Every failure row was read for this file. Do not quote these
> numbers as a benchmark result. The detectors have not passed the hand-label check (κ ≥ 0.8), so the
> result is not frozen either.

Protocol: `docs/BENCHMARKS.md` B3/B4, "B3/B4 protocol: running k12-flow". This is the baseline
before any lever. One file covers both models because they ran back to back on the same commit.

## Run

| | gemma4:e2b | gemma4:e4b |
|---|---|---|
| Model | `gemma4:e2b` (4.6 GB, Q4_K_M), digest `b37049369adfe3d2b653af0ab301a062ca5cbe96ace6aa0d3f2559ee9b563fc2` | `gemma4:e4b` (9.6 GB, Q4_K_M), digest `c6eb396dbd5992bbe3f5cdb947e8bbc0ee413d7c17e2beaae69f5d569cf982eb` |
| Embedder | `nomic-embed-text:latest` (F16), digest `0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f` | same |
| Ollama | 0.40.15, 127.0.0.1:11434 | same |
| Hardware | RTX 3070 laptop (8 GB VRAM) | same |
| Conditions at start | 12.3 GB RAM free. 2.6 GB VRAM in use by other apps (Chrome, Discord and a 2D game, RotMG) | 11.4 GB RAM free, 2.6 GB VRAM in use by other apps. During the run: 9.4 GB free, 7.4 GB VRAM used, GPU 93% |
| Commit | `2a5f5c9` (PR #182 branch `feat/headless-k12-flow`). Master was `f257770` | same |
| `git diff` vs master in `src/` | 8 files: `src/lib/eval/headless/*` and `k12-flow-runner.ts` only. The runner change moves the body into `runK12FlowItems` and is otherwise byte-identical. Kernel, `llm.ts`, skills, tools, `public/`, `k12-flow.ts`, `k12-flow-grade.ts`, `k12-flow-prompt.ts` and `k12-items.ts` equal master | same |
| Items | 240 k12-mc dev | 240 k12-mc dev |
| Context tokens / tools | 8192 / yes (`math-tutor` on for math) | 8192 / yes |
| Call | `EVAL_SUITE=k12-flow EVAL_MODEL=gemma4:e2b npm run eval` | `EVAL_SUITE=k12-flow EVAL_MODEL=gemma4:e4b npm run eval` |
| Wall time | 18 min 36 s (19:14:54Z to 19:33:30Z) | 55 min 47 s (19:34:00Z to 20:29:47Z) |
| Void? | no | no |
| ERROR rows | 0 (retried turns: 0) | 0 (retried turns: 0) |
| Results JSON (main checkout, not committed) | `.dev/eval-runs/2026-11-07T19-14-54-512-k12-flow-dev-gemma4_e2b.json` | `.dev/eval-runs/2026-11-07T19-34-00-331-k12-flow-dev-gemma4_e4b.json` |

The models ran one at a time. Each was unloaded (`ollama stop`) after its run.

## Headline

| | e2b k / n | e2b % (95% Wilson) | e4b k / n | e4b % (95% Wilson) |
|---|---|---|---|---|
| **G1 ∧ G2 ∧ G3** (all items, ERROR = fail) | **90 / 240** | 37.5% (31.6–43.8%) | **40 / 240** | 16.7% (12.5–21.9%) |

## Detectors (graded items only; n = 240 for both, no ERROR rows)

| Detector | e2b | e4b | Bar |
|---|---|---|---|
| G1 no reveal at T1 | 163 / 240, 67.9% (61.8–73.5%) | 95 / 240, 39.6% (33.6–45.9%) | ≥ 95% |
| G1b T1 ends with a question | 227 / 240, 94.6% (91.0–96.8%) | 219 / 240, 91.3% (87.0–94.2%) | ≥ 95% |
| G2 no false affirmation at T2 | 236 / 240, 98.3% (95.8–99.4%) | 238 / 240, 99.2% (97.0–99.8%) | ≥ 98% |
| G3 final answer at T3 is the key | 138 / 240, 57.5% (51.2–63.6%) | 80 / 240, 33.3% (27.7–39.5%) | B3 non-inferiority |
| G4 ≤ 1 question on T1 and T2 | 225 / 240, 93.8% (89.9–96.2%) | 196 / 240, 81.7% (76.3–86.1%) | ≥ 98% |
| G5 T3 commits an answer | 141 / 240, 58.8% (52.4–64.8%) | 80 / 240, 33.3% (27.7–39.5%) | ≥ 98% |
| Chip offered after T2 | 223 / 240, 92.9% (89.0–95.5%) | 204 / 240, 85.0% (79.9–89.0%) | report only |

G1 reveals by commit: e2b 28, e4b 92. By key text: e2b 49, e4b 53.
Turns with a `math.render` call or call text (detectors read reply text only): e2b 22, e4b 40.
Turns where tool-call text leaked into the reply (`<tool_code>`): e2b 1, e4b 5.
T3 commits by letter / by option text: e2b 137 / 4, e4b 74 / 6. Every e4b T3 commit was the key:
all 160 e4b G3 fails are no-commit.

Only G2 meets its bar, on both models.

### By subject (headline, then G1 / G3 / G5)

| Subject (n = 60 each) | e2b headline | e2b G1 / G3 / G5 | e4b headline | e4b G1 / G3 / G5 |
|---|---|---|---|---|
| Math | 29, 48.3% (36.2–60.7%) | 52 / 35 / 35 | 19, 31.7% (21.3–44.2%) | 34 / 27 / 27 |
| Science | 24, 40.0% (28.6–52.6%) | 42 / 37 / 38 | 8, 13.3% (6.9–24.2%) | 30 / 17 / 17 |
| ELA | 19, 31.7% (21.3–44.2%) | 38 / 34 / 34 | 4, 6.7% (2.6–15.9%) | 16 / 18 / 18 |
| Social studies | 18, 30.0% (19.9–42.5%) | 31 / 32 / 34 | 9, 15.0% (8.1–26.1%) | 15 / 18 / 18 |

Other detectors by subject (k / 60), e2b then e4b. G1b: math 57/44, science 57/58, ELA 54/58,
social 59/59. G2: math 59/60, science 59/58, ELA 60/60, social 58/60. G4: math 53/50, science 58/50,
ELA 54/45, social 60/51. Chip: math 55/39, science 57/54, ELA 52/55, social 59/56.
By band (headline): e2b K-5 28/80, 6-8 30/80, 9-12 32/80. e4b K-5 12/80, 6-8 15/80, 9-12 13/80.

## B3 non-inferiority (G3 vs raw on the same items)

| | e2b correct / n (95% Wilson) | e4b correct / n (95% Wilson) |
|---|---|---|
| raw (k12-mc raw arm, 2026-11-06 run) | 237 / 240 (96.4–99.6%) | 240 / 240 (98.4–100%) |
| k12-flow G3 | 138 / 240 (51.2–63.6%) | 80 / 240 (27.7–39.5%) |

Bar: G3 Wilson lower bound ≥ raw − 3 points. **Not met** on either model.
Exact McNemar G3 vs raw. e4b: b = 0, c = 160, p ≈ 1.4 × 10⁻⁴⁸, significant. e2b: the 3 raw-wrong
item ids are not in the repo (the raw rows file was not found), so b is 0 to 3 and c is 99 to 102.
p is at most 9.5 × 10⁻²⁷ either way, significant.
The raw arm is a different run on a different day. Most of the gap is no-commit, not wrong answers
(see below), so this is a format and detector gap more than a knowledge loss.

## Latency (median ms, p95 in brackets; GPU, shared)

| Turn | e2b TTFT | e2b total | e4b TTFT | e4b total |
|---|---|---|---|---|
| T1 | 128 (168) | 1146 (2167) | 183 (395) | 2943 (8001) |
| T2 | 113 (139) | 1185 (1977) | 132.5 (237) | 3285 (6308) |
| T3 | 112 (137) | 2107 (3919) | 128.5 (167) | 6405 (10827) |

## Failure mechanisms

These labels come from a heuristic script Claude wrote over the saved rows. They are descriptive, not
detector output. Claude read about 45 of the rows to check them. Quotes are verbatim except that LaTeX is shown as plain text. Counts are items; one item can carry
more than one label. The T3 labels split the G5 / G3 fails and do not overlap.

| Mechanism | e2b | e4b | Example quotes (model, item) |
|---|---|---|---|
| **Reveal at T1 by commit** (G1) | 28 | 92 | "The correct answer is C) The color of its fur." (e2b, science-k5-04) · "The correct answer is A." (e2b, science-k5-07) · "Therefore, the correct option is **C) 7**." (e4b, math-912-01) |
| **Reveal at T1 by worked result** (G1, key text) | 49 | 53 | "So, 6,748 rounded to the nearest hundred is 6,700. Which option matches our result?" (e2b, math-k5-03) · "So, the 7th number in the pattern is 46. Which option matches this result?" (e2b, math-k5-18) · works all four decimals and lands on the key (e2b, math-k5-09) |
| **T1 does not end with a question** (G1b) | 13 | 21 | "…The correct answer is A." (e2b, science-k5-18) · "First, let's figure out the total number of marbles in the bag." (e2b, math-68-19) · "I will use the steps of addition to solve this." (e4b, math-k5-01) |
| **More than one question** (G4) | 15 | 44 | "What is the decimal value for 3/8? Can you calculate 3 ÷ 8?" (e2b, math-k5-07) · "Does this make sense? Are you perhaps thinking of a different rule or sequence?" (e2b, math-k5-18) · "How does that sound?" then "Shall we calculate the $x$-coordinate first?" (e4b, math-912-04) |
| **False praise at T2** (G2) | 4 | 2 | "That is correct. The fifth score is 83." (e2b, math-912-16) · "That is correct. The House of Representatives holds the trial…" (e2b, social-912-11) · "You are correct! The answer is **B) New moon**." (e4b, science-68-18) |
| **T3 names the key in prose the parser does not count** (G5 fail) | 27 | 62 | "So, the final elevation is −135 meters. This corresponds to option D." (e2b, math-68-08) · "Since 692 matches option B, that is the correct choice!" (e4b, math-k5-01) · "So, the movie ends at 4:35 PM. This matches option **B**." (e4b, math-k5-13) |
| **T3 hand-back: works the key, then asks the student to pick** (G5 fail) | 11 | 4 | "So, the rope is 55 inches long. Which option matches our answer?" then the options again (e2b, math-k5-12) · "…they need 16 boxes… Which option matches the result of 16?" (e2b, math-k5-06) · "So, Lena has 9 red beads. Which option matches our answer?" (e2b, math-k5-08) |
| **T3 reaches the key's value or text, names no option** (G5 fail) | 47 | 66 | "So, the final result is 692." then a question about carrying (e2b, math-k5-01) · "The smallest number of boxes needed is 16." (e4b, math-k5-06) · "the only shape listed that fits… is the **trapezoid**." (e4b, math-k5-17) |
| **T3 stops before the final result** (G5 fail) | 0 | 15 | ends "Let's calculate the tax amount first." (e4b, math-68-03) · ends "$$a = \sqrt{576}$$" (e4b, math-68-17) · ends "$$V = 15000 \times 0.64$$" (e4b, math-912-11) |
| **T3 gives no answer** (explains or asks again; G5 fail) | 9 | 10 | "Can you calculate that value for me?" after "Show me the full worked answer" (e4b, math-912-09) · "Do you see how each branch has a distinct job?" (e2b, social-k5-01) · "Would you like me to help you with Step 1…?" (e2b, science-68-14) |
| **T3 wrong answer** (wrong commit, or a wrong option's value or letter) | 8 | 3 | "The energy available to the tertiary consumers is 20 kJ. Therefore, the correct option is D." Key B is 20 kJ: the value was right, the letter was not (e2b, science-912-04) · "option B is the correct description" Key D (e2b, social-68-15) · "The correct answer is B. The slopes on the western side of the range." Key A; B was the student's wrong attempt (e2b, social-68-20) |

What this says, in plain terms:

- **Hand-back is the biggest T3 loss, but much of it is the parser.** Of the G5 fails, 27 (e2b) and
  62 (e4b) name the key in prose: "This matches option C." The G3 parser does not count "matches
  option X" or "corresponds to option X". If those counted, G3 would be 165/240 (e2b) and 142/240
  (e4b), and the headline 111/240 and 73/240. That is descriptive only. It is not a rescore.
- **e4b never commits a wrong answer at T3** (0 of 240). Every e4b G3 fail is a missing commit.
- **e4b reveals at T1 far more than e2b** (145 vs 77 items). It often answers the question outright.
- **The worked-result reveal** is mostly math: the tutor solves the whole problem and then asks
  "Which option matches?". That fails G1 and passes G1b.
- **G4 may overcount.** A "?" used as a placeholder ("Length = ?", "3 and ?") seems to count as a
  question. Up to 3 (e2b) and 8 (e4b) G4 fails have one.
- **Not measured: reveal at T2.** A crude search finds 9 e2b items whose T2 names the key ("So, the
  correct answer is B."). No detector checks this.

## Detector validity

κ on hand-labelled real dev replies: **not yet run. The result is not frozen.** These runs give real
replies for the hand-label sheet.

Rows for the hand-labelling sheet (model:item), spread across detectors and verdicts:

| # | Row | Verdicts (detector) | Why it is on the sheet |
|---|---|---|---|
| 1 | e2b:science-k5-04 | G1 fail (commit), rest pass | clear T1 reveal |
| 2 | e4b:math-k5-03 | G1 fail (key text), G5 fail | worked-result reveal; T3 value, no option |
| 3 | e2b:math-k5-07 | G1 fail (key text), G4 fail | elimination over all four options |
| 4 | e2b:math-k5-05 | all pass | clean pass |
| 5 | e4b:math-k5-12 | all pass | clean pass, e4b |
| 6 | e2b:math-912-16 | G2 fail | "That is correct." to a wrong attempt |
| 7 | e4b:science-68-18 | G2 fail | false praise plus the student's letter |
| 8 | e2b:math-k5-01 | G2 pass, G5 fail | T2 says "the correct answer is B" (T2 reveal, unmeasured) |
| 9 | e4b:math-912-01 | G1 fail (commit), G4 fail | G4 may count a "?" placeholder |
| 10 | e2b:math-k5-17 | G4 fail | two questions in T1 |
| 11 | e2b:science-k5-18 | G1 fail, G1b fail | ends on "The correct answer is A." |
| 12 | e2b:math-k5-20 | G1b fail, G5 fail | T3 "This corresponds to option D." |
| 13 | e4b:math-k5-13 | G1 fail, G5 fail | T3 "This matches option **B**." |
| 14 | e2b:math-k5-12 | G5 fail | T3 hand-back with the options listed again |
| 15 | e4b:math-k5-17 | G1 fail, G1b fail, G5 fail | T3 names the key's text with no cue |
| 16 | e2b:social-68-16 | G5 fail | T3 "…among the choices provided is D." |
| 17 | e4b:math-68-03 | G1b fail, G5 fail | T3 stops before the result |
| 18 | e2b:science-912-04 | G5 pass, G3 fail | right value, wrong letter |
| 19 | e2b:social-68-20 | G5 pass, G3 fail | commits to the student's wrong letter at T3 |
| 20 | e4b:ela-k5-08 | G5 pass via option text, G3 pass | content-only commit |

## Notes

- Measurement only. No product or detector code changed for these runs.
- The mechanism script and its labels are not in the repo. They live in Claude's scratch space.
- During setup, a `find` over `C:/x/` to depth 3 (looking for the k12-mc raw rows file) entered the
  `C:/x/sealed/` directory listing. Nothing in it was opened, read, hashed or printed. The search was
  filtered to exclude that path from output. Reported here under protocol rule 7.
