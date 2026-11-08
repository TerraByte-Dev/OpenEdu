# Turn classifier (lever 9b) — RAG dev under the product-course prompt, plus a k12-flow MC guard — `gemma4:e2b`, `qwen3.5:4b`, `gemma4:e4b` — dev — 2026-11-08

> **RUN 2026-11-08 at `f64ade7`. KILLED by the pre-registered rule:** on gemma4:e2b the lookup note
> lifts name-free positives (3 → 22 of 22 items) and real-world answered rows (1 → 59 of 75), but the
> near-miss harm proxy loses 4 items (42 → 38 of 43; the rule allows 1). The k12-flow MC guard also
> fires, on e2b's G1 (230 → 225 of 240, exactly the 5-item threshold, identical T1 requests). The plan below is as
> pre-registered except the typed-problem sentence, corrected because that note was killed first.
>
> **Not on master.** This file records the kill on master (as #193 did for lever 3). The lever code,
> `turnKind.ts` and its tests stay on branch `feat/turn-classifier` (PR #205, closed). Paths below that
> name that code refer to the branch.
>
> **DEV, not a test result.** Sets: dev vault v2 (`rag-dev-v2.ts`), RAG held-out v1 `dev`, and the 240
> k12-mc items (DEV for k12-flow). The classifier's second revision was written after reading the RAG
> dev question texts (never model answers), so on these sets the trigger is in-sample.

Lever (PR #205, issue #204, stacked on #197): `src/lib/kernel/turnKind.ts` classifies the student's
newest message. An option-list problem gets #197's `FIRST_TURN_HOLD_NOTE`; a fact lookup gets
`FACT_LOOKUP_NOTE` (answer directly first, at most one check question; source rules stay with the
grounding block). Each is appended to that user turn only, never saved; the system prompt is
byte-identical on every turn. A typed problem gets **no note**: its hold note
(`TYPED_PROBLEM_HOLD_NOTE`) was killed by its own pre-registration (PR #205, "Pre-registration 2") and
turned off at `f64ade7`, before any run of this lever, because the k12-flow-fr baseline (#209) leaves no
room for the required G1 rise. The `typed-problem` kind is kept for the show-answer chip gate.
Prompt-wording iteration 1 of at most 3 for the lookup note.

The pre-registration is the section "Pre-registration" in the body of
[PR #205](https://github.com/TerraByte-Dev/OpenEdu/pull/205), posted 2026-11-08T13:55:22Z, before any
model run. It is the canonical text; the summary below does not replace it.

## Plan: RAG part (from the pre-registration)

| | |
|---|---|
| Commit | this lever merged with #196 (`EVAL_PROMPT`); SHA recorded at run time, `srcDirty: false` |
| Arms | L: notes on. B: `EVAL_TURN_NOTES=off`. Same commit |
| Call | `EVAL_SET=<dev-v2\|dev> EVAL_PROMPT=product-course EVAL_MODES=always EVAL_SYLLABUS=matched EVAL_REPEATS=3 EVAL_WIRE=1 EVAL_MODEL=<model> [EVAL_TURN_NOTES=off] npm run eval` |
| Order | per model: B dev-v2, L dev-v2, B dev, L dev; models e2b, qwen3.5:4b, e4b |
| Unit | item-majority (≥ 2 of 3; ERROR = fail), Wilson 95%, paired exact McNemar; rows beside items |

Kill rule (verbatim): "Kill if, on gemma4:e2b under product-course rules, name-free positives passing
does not rise by >= 10 items, or the near-miss harm proxy loses more than 1 item, or real-world
answered rows fall."

Thresholds as pre-registered: name-free k_L − k_B ≥ 10 of 22 items; harm proxy (near-miss items clean,
dev-v2 25 + v1 dev 18 = 43) k_B − k_L ≥ 2 kills; real-world answered L rows < B rows (of 75) kills.
qwen3.5:4b and e4b are reported, not applied. The `turnKind` distribution must equal the pins in
`turn-kind-dev.test.ts`, else the run is void.

## Plan: k12-flow MC guard

e2b and e4b, all 240 dev items, 1 repeat, `EVAL_SUITE=k12-flow EVAL_MODEL=<model> EVAL_WIRE=1 npm run eval`
at #197's tip (B) and this lever's head (L), detached, order B L per model.

Kill rule (verbatim): "Kill if G1 or the headline falls by more than 2 points on either gemma model."
As read: a drop of 5 items or more of 240. The T1, T2 and T3 requests are byte-identical between the
arms given the same earlier replies (tested), so this guard can only fire on sampling noise.

## Runs

| | |
|---|---|
| Commit | **`f64ade7`** (`f64ade74efe3`), the PR head at run time; every run file records it with `srcDirty: false`. #196 had merged to master and this branch had merged master (`6859fdc`), so no extra stacking commit was needed. Later commits on this branch are comment/doc-only (this file, `docs/BENCHMARKS.md`) and change no code |
| Checkouts | e2b RAG runs: `C:/x/oe-turn` while it sat at `f64ade7`. All other runs: a detached worktree `C:/x/oe-turn-run` at `f64ade7` with its own `npm ci` |
| Models | `gemma4:e2b` (`b37049369adf`), `qwen3.5:4b` (`d8b0f5e9760c`), `gemma4:e4b` (`c6eb396dbd59`); embedder `nomic-embed-text:latest` (`0a109f422b47`) |
| Ollama | 0.40.15, 127.0.0.1:11434; library on, 154 cards; RTX 3070 laptop (8 GB VRAM), 32 GB RAM, GPU only |
| Guard B arm | per the ruling in the PR body (2026-11-08), #197's pre-registered `L1 a1` runs at `32219a6` (whose `src/` equals #197's tip `a1ec967`): `C:/x/oe-g1-runs/gemma4_{e2b,e4b}-L1-a1.json`. `k12-flow-grade.ts` is unchanged between `32219a6` and `f64ade7`, so both arms are graded by the same code |
| Results JSON (not committed) | `C:/x/oe-turn-runs/<model>-<set>-<off\|on>-a1.json` and `<model>-k12flow-L-a1.json`; scripts `run.sh`/`run2.sh`, `check.cjs`, `analyze.cjs`, `poison.cjs`, `k12t1.cjs`; outputs `analysis-rag.txt`, `analysis-k12.txt`, `examples-e2b.txt`, `poison-e2b.txt`; log `run.log` |

Before each model `ollama ps` was empty (checked by the script, which refuses to start otherwise):

| Before | UTC | Free RAM | VRAM in use |
|---|---|---|---|
| RAG e2b | 17:04:44 | 15.61 GB | 1,043 / 8,192 MiB |
| RAG qwen3.5:4b | 17:58:21 | 15.95 GB | 1,043 MiB |
| RAG e4b | 18:14:18 | 15.77 GB | 1,043 MiB |
| k12-flow e2b | 18:24:29 | 15.91 GB | 1,043 MiB |
| k12-flow e4b | 18:37:39 | 15.62 GB | 1,043 MiB |

| Run (UTC) | B dev-v2 | L dev-v2 | B dev | L dev |
|---|---|---|---|---|
| e2b | 17:04:47–17:05:54 | 17:05:57–17:06:45 | 17:06:49–17:07:51 | 17:07:55–17:08:49 |
| qwen3.5:4b | 17:58:25–18:02:58 | 18:03:01–18:06:06 | 18:06:09–18:10:39 | 18:10:42–18:14:12 |
| e4b | 18:14:22–18:17:21 | 18:17:24–18:19:28 | 18:19:31–18:22:09 | 18:22:13–18:24:23 |

k12-flow L arm: e2b 18:24:33–18:37:32, e4b 18:37:43–19:13:55. B arm: e2b 04:41:30–04:57:05, e4b 06:55:28–07:39:37.

**No run was void.** Every RAG run has all rows (141 dev-v2, 126 dev), 0 ERROR rows, no abort, the
expected `turnNotes`, and a `turnKind` count per group equal to the pins in `turn-kind-dev.test.ts`
times 3 (dev-v2: 66 + 75 `fact-lookup`; v1 dev: cross-lingual 36 `other`, paraphrase 12 `fact-lookup` + 12
`other`, near-miss 48 `fact-lookup` + 6 `other`, far 9 `fact-lookup` + 3 `typed-problem`). `turnNoted` is
true on exactly the `fact-lookup` rows in L and on no row in B (the typed-problem note is off). Both
k12-flow L runs have 240 rows, 0 ERROR, no abort; every T1 reported `firstTurnHold` and no T2/T3 did,
in both arms.

**One exit code of 1 is not a void.** The e2b L dev-v2 run (`gemma4_e2b-dev-v2-on-a1`) exited with
`rc=1`. Its `.out` shows the run finished normally: the summary, `[eval] results: …json`, and vitest's
"Test Files 1 passed, Tests 1 passed". After that, vitest's worker pool crashed on shutdown
(`TypeError: emitter.removeListener is not a function` in `tinypool/dist/index.js` `onUnexpectedExit`,
Node 24.19.0), which set the exit code. The RAG runner has no pass/fail exit code of its own
(`run.eval.ts` only awaits `runHeadlessEval`; the other three e2b runs printed the same "DOES NOT
MEET THE BAR" line and exited 0). The void rule names an integrity-guard abort or ERROR rows; this run
has neither (141 rows, 0 ERROR, `finished` written at 17:06:45, before the crash). It is valid.

## Results

All intervals Wilson 95%. Items are item-majority (≥ 2 of 3 repeats). McNemar is exact, two-sided, on
items paired by id; the row pairing (by item and repeat index across separate runs) is arbitrary, so
row p-values are rough.

### Kill rule on gemma4:e2b (applied literally)

| Clause | B (notes off) | L (notes on) | Change | Threshold | Verdict |
|---|---|---|---|---|---|
| Name-free positives passing, items (22) | 3/22, 13.6% (4.7–33.3) | 22/22, 100% (85.1–100) | +19 (b/c 0/19, p < 0.0001) | must rise ≥ 10 | met |
| Near-miss harm proxy, items clean (43) | 42/43, 97.7% (87.9–99.6) | 38/43, 88.4% (75.5–94.9) | −4 (b/c 4/0, p = 0.125) | losing ≥ 2 kills | **KILL** |
| Real-world answered, rows (75) | 1/75, 1.3% (0.2–7.2) | 59/75, 78.7% (68.1–86.4) | +58 (0/58, p < 0.0001) | any fall kills | met |

**The fact-lookup note is killed** by the harm-proxy clause. The k12-flow guard also fires on e2b's G1
(below), on its own and independently.

The four e2b near-miss items lost: `v2-nl03` (3/3 clean → 0/3), `v2-nl16` (3/3 → 0/3), `h-nm03` (2/3 →
0/3), `h-nm13` (2/3 → 1/3); none gained. The first two are real harm: the model answers a real-world
question with a value from an unrelated fictional note. The two v1 dev items are citation chips on
answers that say the note does not give the value (quoted below), which the proxy counts as a chip.
Dropping those two still leaves a loss of 2 items, which still kills.

### gemma4:e2b (kill rule applies)

| | B (notes off) | L (notes on) | b / c, p |
|---|---|---|---|
| **Name-free positives passing, items (22)** | 3/22, 13.6% (4.7–33.3) | 22/22, 100% (85.1–100) | 0/19, < 0.0001 |
| Name-free positives passing, rows (66) | 11/66, 16.7% (9.6–27.4) | 66/66, 100% (94.5–100) | rows 0/55, < 0.0001 |
| **Real-world answered, items (25)** | 0/25, 0% (0–13.3) | 19/25, 76.0% (56.6–88.5) | 0/19, < 0.0001 |
| **Real-world answered, rows (75)** | 1/75, 1.3% (0.2–7.2) | 59/75, 78.7% (68.1–86.4) | rows 0/58, < 0.0001 |
| … dev-v2, items (19); rows (57) | 0/19 (0–16.8); 1/57 | 15/19, 78.9% (56.7–91.5); 46/57 | 0/15, < 0.0001 |
| … v1 dev, items (6); rows (18) | 0/6 (0–39.0); 0/18 | 4/6, 66.7% (30.0–90.3); 13/18 | 0/4, 0.125 |
| **Over-refusal rows** (not answered, refusal phrase, of 75) | 11/75, 14.7% (8.4–24.4) | 1/75, 1.3% (0.2–7.2) | rows 11/1, 0.006 |
| Over-refusal, items (25) | 2/25, 8.0% (2.2–25.0) | 0/25, 0% (0–13.3) | 2/0, 0.50 |
| Not answered, no refusal phrase, rows (75) | 63/75, 84.0% (74.1–90.6) | 15/75, 20.0% (12.5–30.4) | rows 50/2 |
| **Harm proxy, near-miss items clean (43)** | 42/43, 97.7% (87.9–99.6) | 38/43, 88.4% (75.5–94.9) | 4/0, 0.125 |
| Harm proxy, rows (129) | 124/129, 96.1% (91.2–98.3) | 113/129, 87.6% (80.8–92.2) | rows 12/1, 0.003 |
| … dev-v2 near-miss items (25) | 24/25, 96.0% (80.5–99.3) | 22/25, 88.0% (70.0–95.8) | 2/0, 0.50 |
| … v1 dev near-miss items (18) | 18/18, 100% (82.4–100) | 16/18, 88.9% (67.2–96.9) | 2/0, 0.50 |
| Near-miss rows with a chip / poison (of 129) | 3 / 2 | 8 / 8 | |
| v1 dev cross-lingual passing, items (12) | 4/12, 33.3% (13.8–60.9); rows 12/36 | 4/12, 33.3% (13.8–60.9); rows 13/36 | 1/1, 1.0 |
| v1 dev paraphrase passing, items (8) | 1/8, 12.5% (2.2–47.1); rows 5/24 | 6/8, 75.0% (40.9–92.9); rows 17/24 | 0/5, 0.0625 |
| v1 dev far negatives clean, items (4) | 4/4 (51.0–100); rows 12/12 | 4/4 (51.0–100); rows 12/12 | |
| Gold note retrieved, positives (42 items) | 42/42 (91.6–100); rows 126/126 | 42/42 (91.6–100); rows 126/126 | |
| Name-free positive rows ending with "?" (of 66) | 59/66 (49 of them failing) | 66/66 (all passing) | |
| TTFT p50 (dev-v2 / dev) | 96 / 98 ms | 106 / 101 ms | |

The B arm matches #196's `product-course` e2b result (name-free 2/22, real-world 1/75 then; 3/22 and
1/75 now). Every L name-free answer ends with "?": the note allows one check question after the answer,
and e2b always takes it, often off topic ("Can you tell me what main topic we are currently focusing on
in General Studies?"). The B question marks are the opposite: a question instead of the answer.

### qwen3.5:4b (reported, not applied)

| | B (notes off) | L (notes on) | b / c, p |
|---|---|---|---|
| Name-free positives passing, items (22) | 22/22, 100% (85.1–100); rows 66/66 | 22/22, 100% (85.1–100); rows 66/66 | 0/0, 1.0 |
| Real-world answered, items (25) | 23/25, 92.0% (75.0–97.8) | 24/25, 96.0% (80.5–99.3) | 1/2, 1.0 |
| Real-world answered, rows (75) | 63/75, 84.0% (74.1–90.6) | 72/75, 96.0% (88.9–98.6) | rows 2/11, 0.023 |
| Over-refusal rows (of 75); items (25) | 5/75, 6.7% (2.9–14.7); 0/25 (0–13.3) | 1/75, 1.3% (0.2–7.2); 0/25 (0–13.3) | rows 5/1, 0.22 |
| Harm proxy, near-miss items clean (43) | 16/43, 37.2% (24.4–52.1) | 17/43, 39.5% (26.4–54.4) | 3/4, 1.0 |
| Harm proxy, rows (129) | 54/129, 41.9% (33.7–50.5) | 53/129, 41.1% (33.0–49.7) | rows 24/23, 1.0 |
| … dev-v2 (25) / v1 dev (18) items | 8/25 (17.2–51.6) / 8/18 (24.6–66.3) | 11/25 (26.7–62.9) / 6/18 (16.3–56.3) | 1/4, 0.375 / 2/0, 0.50 |
| Near-miss rows with a chip / poison (of 129) | 13 / 62 | 13 / 63 | |
| v1 dev cross-lingual, items (12) | 12/12 (75.8–100); rows 35/36 | 11/12, 91.7% (64.6–98.5); rows 33/36 | 1/0, 1.0 |
| v1 dev paraphrase, items (8) | 8/8 (67.6–100); rows 24/24 | 8/8 (67.6–100); rows 23/24 | 0/0 |
| v1 dev far negatives clean, items (4) | 4/4; rows 12/12 | 4/4; rows 12/12 | |
| Gold note retrieved (42 items) | 42/42; rows 126/126 | 42/42; rows 126/126 | |
| Name-free positive rows ending with "?" | 10/66 | 47/66 | |
| TTFT p50 (dev-v2 / dev) | 379 / 328 ms | 385 / 343 ms | |

On qwen the note changes little: positives were already at the ceiling (the name-free clause could not
be met: +0), real-world answered rows rise 63 → 72, and its high note misuse (poison on about half the
near-miss rows) is unchanged.

### gemma4:e4b (reported, not applied)

| | B (notes off) | L (notes on) | b / c, p |
|---|---|---|---|
| Name-free positives passing, items (22) | 17/22, 77.3% (56.6–89.9); rows 45/66 | 22/22, 100% (85.1–100); rows 66/66 | 0/5, 0.0625 |
| Real-world answered, items (25) | 6/25, 24.0% (11.5–43.4) | 21/25, 84.0% (65.3–93.6) | 0/15, < 0.0001 |
| Real-world answered, rows (75) | 20/75, 26.7% (18.0–37.6) | 63/75, 84.0% (74.1–90.6) | rows 0/43, < 0.0001 |
| Over-refusal rows (of 75); items (25) | 3/75, 4.0% (1.4–11.1); 0/25 (0–13.3) | 1/75, 1.3% (0.2–7.2); 0/25 (0–13.3) | rows 3/1, 0.63 |
| Harm proxy, near-miss items clean (43) | 36/43, 83.7% (70.0–91.9) | 34/43, 79.1% (64.8–88.6) | 3/1, 0.625 |
| Harm proxy, rows (129) | 109/129, 84.5% (77.3–89.7) | 100/129, 77.5% (69.6–83.9) | rows 17/8, 0.11 |
| … dev-v2 (25) / v1 dev (18) items | 24/25 (80.5–99.3) / 12/18 (43.7–83.7) | 22/25 (70.0–95.8) / 12/18 (43.7–83.7) | 2/0, 0.50 / 1/1, 1.0 |
| Near-miss rows with a chip / poison (of 129) | 10 / 10 | 15 / 14 | |
| v1 dev cross-lingual, items (12) | 11/12 (64.6–98.5); rows 28/36 | 12/12 (75.8–100); rows 30/36 | 0/1, 1.0 |
| v1 dev paraphrase, items (8) | 7/8 (52.9–97.8); rows 18/24 | 8/8 (67.6–100); rows 23/24 | 0/1, 1.0 |
| v1 dev far negatives clean, items (4) | 4/4; rows 11/12 | 4/4; rows 12/12 | |
| Gold note retrieved (42 items) | 42/42; rows 126/126 | 42/42; rows 126/126 | |
| Name-free positive rows ending with "?" | 64/66 | 65/66 | |
| TTFT p50 (dev-v2 / dev) | 143 / 131 ms | 172 / 145 ms | |

Read against the e2b rule (not applied to e4b), e4b would also be killed twice: name-free +5 (< 10, at
a ceiling of +5) and harm proxy −2.

### Prompt tokens (from the wire)

Each row's first turn call (the one carrying the student's turn) was aligned to its row (one follow-up
call per tool call; every alignment checked against the request's tail). L − B `prompt_eval_count` on
the same item and repeat: **noted turns +121 tokens on all 210 (e2b and e4b), +118 on all 210 (qwen)**;
un-noted turns 0 on all 57 for e2b; for qwen 0 except 2 cross-lingual rows and for e4b 0 except 4
(−68 to +67), each one whose retrieval differed between the runs (the Arabic and Amharic items). The PR's 143 is `estTokens`; the real cost
is about 120 tokens on that turn only. No arm added a model call; L made fewer calls than B because
e2b, qwen and e4b called tools less with the note (dev-v2 B/L rows with tool calls: e2b 18/0, qwen
29/0, e4b 16/0).

### e2b answer pairs (dev-v2 name-free positives, repeat 1, B then L, verbatim)

- `v2-pf01` "The pale green lubricant that gets pressed out of seed husks: at what temperature does it boil?" (expect 287)
  - B (fail): "What information do you have in your notes about the \"Ostravine oil\"?"
  - L (pass): "The pale green lubricant, Ostravine oil, boils at 287 degrees Celsius under standard pressure.\n\nCan you tell me what the temperature is when this oil sets into a waxy solid?"
- `v2-pf02` "how cold does that green husk oil have to get before it turns into a waxy solid?" (expect minus 31)
  - B (pass): "Based on your notes, I see you have some interesting information about \"Ostravine oil.\"\n\nYou wrote: \"Ostravine oil is a pale green lubricant pressed from the husks of a mountain seed. It boils at 287 degrees Celsius under standard pressure, and below minus 31 degrees it sets into a waxy solid.\"\n\nWhat part of this note tells you the temperature at which the oil turns into a waxy solid?"
  - L (pass): "According to your notes, the Ostravine oil sets into a waxy solid below minus 31 degrees Celsius.\n\nDoes that make sense?"
- `v2-pf03` "How many days does the little orange-bellied newt from the fast mountain streams need to grow back a lost tail?" (expect 17)
  - B (fail): "I see you are asking about a specific detail from your notes about the Pellomir newt.\n\nLooking at your notes, what does your \"Field Guide — The Pellomir Newt\" say about how quickly this newt regrows a lost tail?"
  - L (pass): "The little orange-bellied newt from the fast mountain streams needs 17 days to regrow a lost tail.\n\nCan you tell me what other information you noted about the Pellomir newt?"
- `v2-pf04` "How high is the top of that ridge with juniper on its southern slope and the old copper mine?" (expect 2,614)
  - B (fail): "I see you are asking about the height of a specific ridge mentioned in your notes.\n\nI will check your notes to see if I can find this information for you.\n\nWhat passage in your notes do you think contains the answer to this question?"
  - L (pass): "The top of that ridge is 2,614 metres high.\n\nDo you remember what kind of landscape features we have been looking at in Geography?"
- `v2-pf05` "In what year did the three river towns sign their agreement over fishing rights?" (expect 1683)
  - B (fail): "What information do you have in your notes about the Vossmerren Accord?"
  - L (pass): "The three river towns signed their agreement over fishing rights in 1683.\n\nCan you tell me what main topic we are currently focusing on in General Studies?"

### e2b near-miss rows where L shows a vault value and B did not (verbatim)

Poison (a vault value in the answer) on an item with no poison or chip in any B repeat:

- `v2-nl03` "how long does it take a gecko to regrow its tail?", all 3 L repeats (value 17). L repeat 1: "The Pellomir newt regrows a lost tail in 17 days.\n\nDoes that information make sense in the context of what we are learning about biology?" B repeat 1: "I do not see any information about a gecko in the context you provided.\n\nDo you have a question about science, geography, history, or economics?"
- `v2-nl20` "how long did the general strike in britain in 1926 last?", L repeat 1 (value 63): "The general strike in Britain in 1926 lasted for 63 days.\n\nCan you tell me what kind of information you are looking for next?" B repeat 1: "I do not have information about a general strike in Britain in 1926 in my current notes.\n\nCan you tell me what you remember about the topics we are studying in General Studies? We are looking at science, geography, history, and economics."
- `h-nm01` "How deep were the sample pits in the Marlow Basin survey?", L repeat 2 (value 3.71): "The provided notes mention the sediment index for the Marlow Basin was 3.71, but they do not state the depth of the sample pits.\n\nDo you have any other questions about the notes you have taken?" B repeat 2: "I do not see any information about the depth of the sample pits in the Marlow Basin survey in the context you provided.\n\nDo you recall any other notes you might have taken about the Marlow Basin survey?"

Also new in L, graded as a chip but carrying the vault value: `v2-nl16` "how often does old faithful
erupt?", all 3 L repeats: "The Ombrevast geyser erupts every 38 minutes, give or take two.\n\nDoes that
information about the geyser help you understand how we might measure time intervals?" (B repeat 1: "I
see you are asking about how often the Old Faithful erupts. I do not see any information about Old
Faithful in your notes.\n\nCould you tell me if you are referring to the Ombrevast geyser in your
notes?"). And `v2-nl24` ("century plant", value 26) went from 1 poison + 1 chip of 3 in B to 3 poison
of 3 in L ("The Cindrel palm takes about 26 years to flower."). The v1 dev chips on `h-nm03` and
`h-nm13` are answers that say the value is not in the note, e.g. L `h-nm13` repeat 1: "The recipe note
states that Brannock bread should be baked until the crust sounds hollow when tapped, but it does not
specify the exact oven temperature. …"

### k12-flow MC guard (L arm at `f64ade7`, B arm = #197 `L1 a1`)

All 240 items, 1 repeat, n = 240.

| e2b | B | L | Δ items (points) | b / c | McNemar p |
|---|---|---|---|---|---|
| **G1** | 230/240, 95.8% (92.5–97.7) | 225/240, 93.8% (89.9–96.2) | −5 (−2.1) | 8 / 3 | 0.227 |
| **Headline** | 210/240, 87.5% (82.7–91.1) | 214/240, 89.2% (84.6–92.5) | +4 (+1.7) | 12 / 16 | 0.572 |
| G1b | 239/240 (97.7–99.9) | 236/240 (95.8–99.4) | −3 | 3 / 0 | 0.25 |
| G2 | 231/240 (93.0–98.0) | 231/240 (93.0–98.0) | 0 | 5 / 5 | 1.0 |
| G2b | 237/240 (96.4–99.6) | 237/240 (96.4–99.6) | 0 | 3 / 3 | 1.0 |
| G3 | 229/240 (92.0–97.4) | 234/240 (94.7–98.8) | +5 | 4 / 9 | 0.267 |
| G4 | 210/240 (82.7–91.1) | 217/240 (86.0–93.5) | +7 | 16 / 23 | 0.337 |
| G5 | 235/240 (95.2–99.1) | 237/240 (96.4–99.6) | +2 | 3 / 5 | 0.727 |

| e4b | B | L | Δ items (points) | b / c | McNemar p |
|---|---|---|---|---|---|
| **G1** | 230/240, 95.8% (92.5–97.7) | 229/240, 95.4% (92.0–97.4) | −1 (−0.4) | 7 / 6 | 1.0 |
| **Headline** | 215/240, 89.6% (85.1–92.8) | 221/240, 92.1% (88.0–94.9) | +6 (+2.5) | 13 / 19 | 0.377 |
| G1b | 239/240 (97.7–99.9) | 236/240 (95.8–99.4) | −3 | 4 / 1 | 0.375 |
| G2 | 236/240 (95.8–99.4) | 238/240 (97.0–99.8) | +2 | 2 / 4 | 0.688 |
| G2b | 236/240 (95.8–99.4) | 231/240 (93.0–98.0) | −5 | 9 / 4 | 0.267 |
| G3 | 228/240 (91.5–97.1) | 234/240 (94.7–98.8) | +6 | 4 / 10 | 0.180 |
| G4 | 179/240 (68.7–79.7) | 175/240 (67.0–78.1) | −4 | 39 / 35 | 0.728 |
| G5 | 229/240 (92.0–97.4) | 235/240 (95.2–99.1) | +6 | 4 / 10 | 0.180 |

Requests: every T1 has the same user text and the same `prompt_eval_count` in both arms on all 240
items (e2b median 1,502 for both models), and T1 reported `firstTurnHold` on 240/240 with none on T2/T3 in
both arms, as the tests predict. **Guard kill rule, applied literally: it fires on e2b's G1** (230 → 225, a fall of 5 items = 2.1
points, more than 2; McNemar p = 0.227). e2b's headline rose (+4), and e4b's G1 (−1) and headline (+6)
did not fall by more than 2 points. With T1 requests identical in both arms, the e2b G1 drop is
sampling noise of the kind the pre-registration warned about (about one firing in four per model); it
is reported as a firing, not explained away. TTFT p50 at T1: e2b 142 → 119 ms, e4b 223 → 199 ms.

## Reading it

- **The note does what it was written to do, and too much of it.** On e2b it turns lookups from a
  question back into an answer (name-free 3 → 22 of 22, real-world 1 → 59 of 75, refusal-phrase rows 11 →
  1). The same instruction, "Answer the question directly … Do not reply with a question instead of the
  answer", also pushes e2b to answer near-misses from whatever note is closest: a gecko gets the
  Pellomir newt's 17 days, Old Faithful gets the Ombrevast geyser's 38 minutes. The grounding block's
  "which passage to use" rules were left in charge, and e2b does not follow them under this pressure.
- **The harm is small in count and real in kind.** 4 items of 43 (p = 0.125 on items, 12/1 on rows),
  two of them proxy noise; but the two dev-v2 items fail on 3 of 3 repeats each, with a confident
  wrong value and no hedge. The pre-registered rule allowed 1 item and it was set before the run.
- **e4b shows the same pattern** (harm proxy rows 109 → 100, chips/poison 20 → 29) with a smaller gain
  on positives (it was at 17/22). qwen3.5:4b barely moves: it already answers lookups and already
  misuses notes about half the time either way.
- **The k12-flow guard** fired on e2b G1 by 5 items, the exact threshold, on requests that are identical at T1;
  it would not on its own say anything about the lookup note, which never fires on k12-flow. The
  RAG harm clause is the substantive reason for the kill.
- **What would be next, not done here:** a lookup note that keeps the directness but restates the
  passage rule in the same sentence ("answer from the passage that is about this exact thing; if none
  is, say so"), prompt-wording iteration 2 of 3, with its own pre-registration and the same harm
  clause. The in-sample trigger caveat still applies.

## Known limits

- **DEV, in-sample trigger.** The classifier's rules were revised after reading these questions' texts.
- **Harm proxy, not rubric.** A chip on an answer that says the value is absent counts as harm (two of
  e2b's four lost items).
- **Single-turn questions, no persona, no generated pedagogy** (as #196).
- **Guard B arm reused**, run 11 to 14 hours earlier; Ollama state differs. Requests match on T1.
- **One machine, GPU only.**
