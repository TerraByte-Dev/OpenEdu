# k12-flow (attempt-first) — first-turn hold A/B — `gemma4:e2b`, `gemma4:e4b`, `qwen3.5:4b` — dev — 2026-11-08

> **RUN 2026-11-08, all 18 runs valid. The kill rule does not fire on either gemma model.** The plan
> below is as posted before the runs; the run record and results follow it.
>
> **DEV, not a test result.** The 240 k12-mc items are DEV for this flow (`docs/BENCHMARKS.md`
> section 0). The detectors have not passed the hand-label check (κ ≥ 0.8).

Lever (PR #197, issue #195): when the student's newest message poses a problem with a lettered option
list and no try of their own after the options, `TutorEngine.run` appends `FIRST_TURN_HOLD_NOTE`
(`src/lib/kernel/attemptFirst.ts`) to that user message, after the grounding block and the student's
text. No model call is added; the system prompt is byte-identical on every turn. Prompt-wording
iteration 1 of at most 3.

The pre-registration is the section "Pre-registration" in the body of
[PR #197](https://github.com/TerraByte-Dev/OpenEdu/pull/197), posted 2026-11-08T03:38:38Z, before any
model run. It is the canonical text; the summary below does not replace it.

## Plan (from the pre-registration)

| | |
|---|---|
| Baseline arm B | master `cce30513bdd7e23d30e40e36eeb015b1bd7296b6` |
| Lever arm L | `32219a69e92d29876ef3e1e039ea63a62ce9805e` |
| Items | 240 dev, no `EVAL_LIMIT` / `EVAL_SAMPLE` / `EVAL_ONLY` (as the L1 run) |
| Call | `EVAL_SUITE=k12-flow EVAL_MODEL=<model> EVAL_WIRE=1 npm run eval`, from `C:/x/oe-g1` with the arm's commit checked out (detached) |
| Repeats | 3 per arm per model, order B1 L1 B2 L2 B3 L3 per model; models e2b, e4b, qwen3.5:4b |
| Unit of analysis | item-majority (≥ 2 of 3 repeats; an ERROR repeat is a fail), n = 240, Wilson 95%; paired exact McNemar |

Kill rule (verbatim): "Kill if, on either gemma model, G1 does not rise by >= 8 points with McNemar
p < 0.05, or the headline falls, or G3 falls by more than 3 points, or any added model call."

Thresholds as pre-registered: G1 needs k_L − k_B ≥ 20 items, c > b and p < 0.05 on each gemma model;
the headline falls if k_L < k_B; G3 falls by more than 3 points if k_B − k_L ≥ 8 items.

## Runs

Run by Claude, 2026-11-08, first model run started 04:24:15Z (pre-registration posted 03:38:38Z). 18
runs, B1 L1 B2 L2 B3 L3 per model, one model process at a time, e2b then e4b then qwen3.5:4b. Every
run completed on the first attempt: 240 rows, 0 ERROR rows, not void, arm commit as planned,
`srcDirty: false`. No run was excluded or rerun.

| | gemma4:e2b | gemma4:e4b | qwen3.5:4b |
|---|---|---|---|
| Model digest | `b37049369adf…` | `c6eb396dbd59…` | `d8b0f5e9760c…` |
| Embedder | `nomic-embed-text:latest`, `0a109f422b47…` | same | same |
| Library | on, 154 cards | same | same |
| Hardware | RTX 3070 laptop, 8 GB VRAM | same | same |
| ERROR rows / void | 0 in all six / no | 0 / no | 0 / no |

Conditions at each run's start (free RAM from `Win32_OperatingSystem`, VRAM from `nvidia-smi`;
`ollama ps` was empty before each model's first run). From the second run on, VRAM includes the loaded
model. Wall is from the results JSON.

| Model | Run | Commit | Start (UTC) | Wall | Free RAM | VRAM used, GPU util |
|---|---|---|---|---|---|---|
| e2b | B1 | `cce3051` | 04:24 | 17 min 7 s | 11.2 GB | 2.3 GB, 49% |
| e2b | L1 | `32219a6` | 04:41 | 15 min 35 s | 8.0 GB | 6.0 GB, 3% |
| e2b | B2 | `cce3051` | 04:57 | 17 min 23 s | 7.8 GB | 6.0 GB, 4% |
| e2b | L2 | `32219a6` | 05:14 | 15 min 3 s | 8.1 GB | 6.0 GB, 3% |
| e2b | B3 | `cce3051` | 05:29 | 17 min 9 s | 7.9 GB | 6.0 GB, 4% |
| e2b | L3 | `32219a6` | 05:47 | 16 min 10 s | 7.0 GB | 6.0 GB, 6% |
| e4b | B1 | `cce3051` | 06:03 | 51 min 28 s | 11.5 GB | 2.3 GB, 12% |
| e4b | L1 | `32219a6` | 06:55 | 44 min 9 s | 7.9 GB | 7.3 GB, 9% |
| e4b | B2 | `cce3051` | 07:39 | 48 min 36 s | 6.9 GB | 7.3 GB, 5% |
| e4b | L2 | `32219a6` | 08:28 | 43 min 20 s | 6.5 GB | 7.3 GB, 3% |
| e4b | B3 | `cce3051` | 09:11 | 49 min 36 s | 5.9 GB | 7.4 GB, 8% |
| e4b | L3 | `32219a6` | 10:01 | 47 min 22 s | 6.7 GB | 7.3 GB, 4% |
| qwen3.5:4b | B1 | `cce3051` | 10:49 | 82 min 8 s | 10.4 GB | 2.4 GB, 29% |
| qwen3.5:4b | L1 | `32219a6` | 12:11 | 64 min 3 s | 1.9 GB | 6.9 GB, 14% |
| qwen3.5:4b | B2 | `cce3051` | 13:15 | 45 min 23 s | 1.1 GB | 7.0 GB, 18% |
| qwen3.5:4b | L2 | `32219a6` | 14:01 | 34 min 21 s | 7.5 GB | 5.6 GB, 0% |
| qwen3.5:4b | B3 | `cce3051` | 14:35 | 42 min 51 s | 6.4 GB | 5.6 GB, 0% |
| qwen3.5:4b | L3 | `32219a6` | 15:18 | 32 min 26 s | 7.1 GB | 5.6 GB, 0% |

Other desktop apps (a game among them) held 1.0–2.4 GB of VRAM and, during qwen L1/B2, most of the
free RAM. Wall times are therefore not comparable across runs; latency below is descriptive only.

**Deviations from the plan, none affecting what was sent or graded:**
- The baseline arm ran from a second worktree at `cce3051` (its own `npm ci`), not from the same
  worktree checked out detached. The JSON's `commit` is the arm's commit in all 18 runs.
- `EVAL_OUT` pointed at a run folder outside the repo (`C:/x/oe-g1-runs/<model>-<slot>-a1.json`), not
  the main checkout's `.dev/eval-runs/`. The results JSONs are not committed.
- The first e4b start stopped before any run: the pre-model check found `nomic-embed-text` still loaded
  from the e2b runs (`ollama ps` not empty). It was unloaded and e4b started at 06:03:52Z.
- The runner voids a run at 5 ERROR rows (`k12FlowErrorLimit`), the plan at more than 5. No run had any,
  so the difference did not matter.

**Grader.** Rows were graded at run time by `k12-flow-grade.ts`, identical in both arms (the lever
commit does not touch it) and unchanged on master through `d05682c`. All 18 files were rescored
offline with master `d05682c`'s `rescore.ts`: 0 verdicts flipped on any detector.

## Results

### Verdict

**The kill rule does not fire.** On both gemma models every clause passes with a wide margin:

| Clause (item-majority, n = 240) | gemma4:e2b | gemma4:e4b |
|---|---|---|
| G1 up ≥ 20 items, c > b, McNemar p < 0.05 | 169 → 229 (+25.0 pts), b 3, c 63, p 1.3e-15 | 98 → 234 (+56.7 pts), b 0, c 136, p 2.3e-41 |
| Headline does not fall | 159 → 220 (+25.4 pts) | 93 → 229 (+56.7 pts) |
| G3 does not fall by ≥ 8 items | 234 → 238 | 236 → 239 |
| No added model call | 0 structured, 0 excess turn requests in L | 0, 0 |

The hypothesis (G1 up by at least 8 points on each gemma model without hurting G3 or the headline)
holds on dev. qwen3.5:4b, reported outside the rule: G1 6 → 233, headline 0 → 208, G3 194 → 230. Its
headline and G3 rise, so the lever does not hurt that family under rule 10. **But qwen moves its reveal
to T2** (G2b 178 → 88, see below).

Headline figures (item-majority, Wilson 95%):

| Model | Detector | Baseline | Lever | Δ pts | b / c | McNemar p |
|---|---|---|---|---|---|---|
| e2b | headline | 159/240, 66.3% [60.1, 71.9] | 220/240, 91.7% [87.5, 94.5] | +25.4 | 8 / 69 | 3.1e-13 |
| e2b | G1 | 169/240, 70.4% [64.4, 75.8] | 229/240, 95.4% [92.0, 97.4] | +25.0 | 3 / 63 | 1.3e-15 |
| e2b | G2 | 239/240, 99.6% [97.7, 99.9] | 234/240, 97.5% [94.7, 98.8] | −2.1 | 5 / 0 | 0.063 |
| e2b | G3 | 234/240, 97.5% [94.7, 98.8] | 238/240, 99.2% [97.0, 99.8] | +1.7 | 2 / 6 | 0.289 |
| e4b | headline | 93/240, 38.8% [32.8, 45.0] | 229/240, 95.4% [92.0, 97.4] | +56.7 | 0 / 136 | 2.3e-41 |
| e4b | G1 | 98/240, 40.8% [34.8, 47.1] | 234/240, 97.5% [94.7, 98.8] | +56.7 | 0 / 136 | 2.3e-41 |
| e4b | G2 | 239/240, 99.6% [97.7, 99.9] | 239/240, 99.6% [97.7, 99.9] | 0.0 | 1 / 1 | 1.000 |
| e4b | G3 | 236/240, 98.3% [95.8, 99.4] | 239/240, 99.6% [97.7, 99.9] | +1.3 | 0 / 3 | 0.250 |
| qwen3.5:4b | headline | 0/240, 0.0% [0.0, 1.6] | 208/240, 86.7% [81.8, 90.4] | +86.7 | 0 / 208 | 4.9e-63 |
| qwen3.5:4b | G1 | 6/240, 2.5% [1.2, 5.3] | 233/240, 97.1% [94.1, 98.6] | +94.6 | 0 / 227 | 9.3e-69 |
| qwen3.5:4b | G2 | 239/240, 99.6% [97.7, 99.9] | 229/240, 95.4% [92.0, 97.4] | −4.2 | 11 / 1 | 0.006 |
| qwen3.5:4b | G3 | 194/240, 80.8% [75.4, 85.3] | 230/240, 95.8% [92.5, 97.7] | +15.0 | 5 / 41 | 4.4e-8 |

### What else moved (not under the rule)

- **The reveals the lever removes are the explicit commits.** G1-failing rows by reason over the three
  repeats, baseline → lever: e2b commit 76 → 0, content 148 → 37; e4b commit 306 → 0, content 122 → 32;
  qwen3.5:4b commit 603 → 0, content 90 → 36. The remaining lever failures are all the key's text at T1.
- **T1 tool calls nearly vanish** (summed over 3 runs): e2b 38 → 0, e4b 69 → 0, qwen3.5:4b 55 → 1. That
  shrinks the `math.render` blind spot of G1 rather than exploiting it.
- **qwen3.5:4b reveals at T2 instead.** G2b (no reveal at T2, report only) 178 → 88 of 240 (−37.5 pts,
  b 103, c 13, p 1.5e-18). G2 (false affirmation) also falls 239 → 229 (p 0.006). The hold delays
  qwen's reveal by one turn; it does not teach attempt-first. On gemma G2b rises (e2b 235 → 239, e4b
  231 → 236). e2b's G2 dip (239 → 234, p 0.063) is not significant.
- **G4 (at most one question in T1 and T2) falls** on e4b 201 → 190 (−4.6 pts, p 0.207) and qwen3.5:4b
  218 → 188 (−12.5 pts, p 2.9e-4); e2b is flat (226 → 226).
- **G1b (T1 ends with a question) rises** on all three (e2b 228 → 240, e4b 228 → 240, qwen 6 → 209).
  The "Show me the answer" chip is offered more often after T2 (e2b 225 → 238, e4b 212 → 232, qwen 4 →
  48). That follows G1b, not the chip-code change in this PR: in every e2b row of both arms,
  `studentAttempted` is false exactly when T1 did not end on a question, and the chip is never offered
  then. Such rows fall from 57 (baseline, 3 runs) to 5 (lever). The other chip misses (19 baseline, 22
  lever) have `studentAttempted` true. Only e2b was cross-tabulated this way.
- **Trigger check passes.** Lever T1 rows with `firstTurnHold: true`: 720/720 on each model; lever T2/T3
  turns with it: 0/1440 on each; baseline turns with the field set: 0/2160 (field absent at `cce3051`).

### Cost (descriptive; GPU, not CPU)

Prompt tokens on the turn's first request, median baseline → lever: T1 e2b 1399 → 1502 (+103), e4b
1399 → 1502 (+103), qwen 1610.5 → 1709.5 (+99), matching the ~104-token note. T2 and T3 prompts get
*shorter* (e2b −49 / −61.5, e4b −50 / −70, qwen −117 / −166.5) because T1 replies are shorter: median
T1 output tokens e2b 86 → 41, e4b 120.5 → 70.5, qwen 176 → 65. No reloads in any run (no request after
the first with `load_duration` > 1 s). Median T1 total time fell (e2b 799 → 501.5 ms, e4b 2265 → 1420
ms, qwen 3153.5 → 1419 ms); see the per-model tables, and the conditions above for why these are not
CPU figures.

### Known limits

- Detectors are not yet checked against hand labels (κ). G1 now fails only on the key's text; if the
  content check misses paraphrased worked results, the lever's G1 is overstated by that much.
- The hold produces strong hints on some items (the operation to apply, or the definition that settles
  the choice) that G1 does not count as a reveal. Whether those are acceptable attempt-first hints is a
  hand-label question.
- Dev only, in-sample for the wording (iteration 1 of 3). Lettered-option problems only; this says
  nothing about free-text or numeric problems.
- Item-majority over 3 repeats; per-repeat and pooled figures are below and agree in direction.

### Per-model detail

Generated from the 18 results JSONs by the analysis script described in the pre-registration
(item-majority, Wilson, exact McNemar, wire grouping by `ask`). Wire per turn: requests grouped by
consecutive `ask` and matched to turns in order; ask-groups equalled turns (720) in every run, so every
turn has wire figures. "Expected bound" is Σ over turns of `attempts` + `toolCalls.length` + 1 for
`max_iterations`; a lever run exceeding it would be an added call.

#### gemma4:e2b

Runs (the file used per slot is the last valid attempt; every attempt listed):

| Slot | File | Commit | srcDirty | Rows | ERROR | Started (UTC) | Wall |
|---|---|---|---|---|---|---|---|
| B1 | `gemma4_e2b-B1-a1.json` | `cce3051` | false | 240 | 0 | 2026-11-08T04:24:18 | 17 min 7 s |
| B2 | `gemma4_e2b-B2-a1.json` | `cce3051` | false | 240 | 0 | 2026-11-08T04:57:10 | 17 min 23 s |
| B3 | `gemma4_e2b-B3-a1.json` | `cce3051` | false | 240 | 0 | 2026-11-08T05:29:47 | 17 min 9 s |
| L1 | `gemma4_e2b-L1-a1.json` | `32219a6` | false | 240 | 0 | 2026-11-08T04:41:30 | 15 min 35 s |
| L2 | `gemma4_e2b-L2-a1.json` | `32219a6` | false | 240 | 0 | 2026-11-08T05:14:38 | 15 min 3 s |
| L3 | `gemma4_e2b-L3-a1.json` | `32219a6` | false | 240 | 0 | 2026-11-08T05:47:01 | 16 min 10 s |

Model: {"gemma4:e2b":{"name":"gemma4:e2b","digest":"b37049369adfe3d2b653af0ab301a062ca5cbe96ace6aa0d3f2559ee9b563fc2"},"nomic-embed-text":{"name":"nomic-embed-text:latest","digest":"0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f"}}. Library: {"enabled":true,"cards":154}.

Item-majority (≥ 2 of 3 repeats; an ERROR repeat counts as a fail), n = 240 items; paired exact McNemar (b = pass in B only, c = pass in L only):

| Detector | Baseline B | Lever L | Δ points | b | c | McNemar p |
|---|---|---|---|---|---|---|
| headline | 159/240 = 66.3% [60.1, 71.9] | 220/240 = 91.7% [87.5, 94.5] | 25.4 | 8 | 69 | 3.1e-13 |
| G1 | 169/240 = 70.4% [64.4, 75.8] | 229/240 = 95.4% [92.0, 97.4] | 25.0 | 3 | 63 | 1.3e-15 |
| G1b | 228/240 = 95.0% [91.5, 97.1] | 240/240 = 100.0% [98.4, 100.0] | 5.0 | 0 | 12 | 4.9e-4 |
| G2 | 239/240 = 99.6% [97.7, 99.9] | 234/240 = 97.5% [94.7, 98.8] | -2.1 | 5 | 0 | 0.063 |
| G2b | 235/240 = 97.9% [95.2, 99.1] | 239/240 = 99.6% [97.7, 99.9] | 1.7 | 1 | 5 | 0.219 |
| G3 | 234/240 = 97.5% [94.7, 98.8] | 238/240 = 99.2% [97.0, 99.8] | 1.7 | 2 | 6 | 0.289 |
| G4 | 226/240 = 94.2% [90.4, 96.5] | 226/240 = 94.2% [90.4, 96.5] | 0.0 | 14 | 14 | 1.000 |
| G5 | 236/240 = 98.3% [95.8, 99.4] | 240/240 = 100.0% [98.4, 100.0] | 1.7 | 0 | 4 | 0.125 |
| chip offered after T2 | 225/240 = 93.8% [89.9, 96.2] | 238/240 = 99.2% [97.0, 99.8] | 5.4 | 2 | 15 | 0.002 |

Per repeat, k/240 (Wilson 95%):

| Detector | B1 | B2 | B3 | L1 | L2 | L3 | pooled B k/720 | pooled L k/720 |
|---|---|---|---|---|---|---|---|---|
| headline | 154/240 = 64.2% [57.9, 70.0] | 158/240 = 65.8% [59.6, 71.5] | 152/240 = 63.3% [57.1, 69.2] | 210/240 = 87.5% [82.7, 91.1] | 216/240 = 90.0% [85.6, 93.2] | 211/240 = 87.9% [83.2, 91.5] | 464/720 = 64.4% [60.9, 67.9] | 637/720 = 88.5% [85.9, 90.6] |
| G1 | 166/240 = 69.2% [63.1, 74.7] | 167/240 = 69.6% [63.5, 75.1] | 163/240 = 67.9% [61.8, 73.5] | 230/240 = 95.8% [92.5, 97.7] | 226/240 = 94.2% [90.4, 96.5] | 227/240 = 94.6% [91.0, 96.8] | 496/720 = 68.9% [65.4, 72.2] | 683/720 = 94.9% [93.0, 96.2] |
| G1b | 219/240 = 91.3% [87.0, 94.2] | 221/240 = 92.1% [88.0, 94.9] | 223/240 = 92.9% [89.0, 95.5] | 239/240 = 99.6% [97.7, 99.9] | 239/240 = 99.6% [97.7, 99.9] | 237/240 = 98.8% [96.4, 99.6] | 663/720 = 92.1% [89.9, 93.8] | 715/720 = 99.3% [98.4, 99.7] |
| G2 | 232/240 = 96.7% [93.6, 98.3] | 237/240 = 98.8% [96.4, 99.6] | 238/240 = 99.2% [97.0, 99.8] | 231/240 = 96.3% [93.0, 98.0] | 235/240 = 97.9% [95.2, 99.1] | 231/240 = 96.3% [93.0, 98.0] | 707/720 = 98.2% [96.9, 98.9] | 697/720 = 96.8% [95.3, 97.9] |
| G2b | 232/240 = 96.7% [93.6, 98.3] | 233/240 = 97.1% [94.1, 98.6] | 230/240 = 95.8% [92.5, 97.7] | 237/240 = 98.8% [96.4, 99.6] | 237/240 = 98.8% [96.4, 99.6] | 238/240 = 99.2% [97.0, 99.8] | 695/720 = 96.5% [94.9, 97.6] | 712/720 = 98.9% [97.8, 99.4] |
| G3 | 231/240 = 96.3% [93.0, 98.0] | 229/240 = 95.4% [92.0, 97.4] | 230/240 = 95.8% [92.5, 97.7] | 229/240 = 95.4% [92.0, 97.4] | 235/240 = 97.9% [95.2, 99.1] | 233/240 = 97.1% [94.1, 98.6] | 690/720 = 95.8% [94.1, 97.1] | 697/720 = 96.8% [95.3, 97.9] |
| G4 | 220/240 = 91.7% [87.5, 94.5] | 222/240 = 92.5% [88.5, 95.2] | 218/240 = 90.8% [86.5, 93.9] | 210/240 = 87.5% [82.7, 91.1] | 226/240 = 94.2% [90.4, 96.5] | 217/240 = 90.4% [86.0, 93.5] | 660/720 = 91.7% [89.4, 93.5] | 653/720 = 90.7% [88.4, 92.6] |
| G5 | 235/240 = 97.9% [95.2, 99.1] | 232/240 = 96.7% [93.6, 98.3] | 235/240 = 97.9% [95.2, 99.1] | 235/240 = 97.9% [95.2, 99.1] | 238/240 = 99.2% [97.0, 99.8] | 237/240 = 98.8% [96.4, 99.6] | 702/720 = 97.5% [96.1, 98.4] | 710/720 = 98.6% [97.5, 99.2] |
| chip offered after T2 | 210/240 = 87.5% [82.7, 91.1] | 215/240 = 89.6% [85.1, 92.8] | 219/240 = 91.3% [87.0, 94.2] | 229/240 = 95.4% [92.0, 97.4] | 232/240 = 96.7% [93.6, 98.3] | 232/240 = 96.7% [93.6, 98.3] | 644/720 = 89.4% [87.0, 91.5] | 693/720 = 96.3% [94.6, 97.4] |

G1 failure rows by reason, arm B (rows over 3 repeats): commit 76, content 148.
G1 failure rows by reason, arm L (rows over 3 repeats): commit 0, content 37.

Trigger check: lever T1 rows with firstTurnHold true: 720/720 non-ERROR T1 rows; lever T2/T3 turns with true: 0/1440; baseline turns with the field set (not null/undefined): 0/2160.

| Arm/rep | structured requests | turn requests (excl. warm-up) | expected bound Σ(attempts+toolCalls+maxIter) | excess | ask-groups / turns | reloads (loadMs > 1000 after the first request) |
|---|---|---|---|---|---|---|
| B1 | 0 | 756 | 757 | 0 | 720 / 720 | 0 |
| B2 | 0 | 780 | 780 | 0 | 720 / 720 | 0 |
| B3 | 0 | 770 | 771 | 0 | 720 / 720 | 0 |
| L1 | 0 | 745 | 745 | 0 | 720 / 720 | 0 |
| L2 | 0 | 743 | 743 | 0 | 720 / 720 | 0 |
| L3 | 0 | 739 | 739 | 0 | 720 / 720 | 0 |

Added model calls: structured + excess turn requests, summed over the 3 runs: B 0, L 0.

Per turn type, pooled over the 3 runs of each arm (wire figures only where ask-groups align with turns): prompt tokens of the turn's first request (median / mean), prompt tokens summed over the turn's requests (median), output tokens summed over the turn's requests (median), ttftMs and totalMs (median, rows), tool calls (total).

| Turn | Arm | first-request prompt tokens med / mean | Σ prompt tokens med | output tokens med | ttft ms med | total ms med | tool calls |
|---|---|---|---|---|---|---|---|
| T1 | B | 1399 / 1606.7 | 1401 | 86 | 132 | 799 | 38 |
| T1 | L | 1502 / 1709.7 | 1502 | 41 | 142 | 501.5 | 0 |
| T2 | B | 1471.5 / 1651.2 | 1471.5 | 85 | 98 | 804.5 | 18 |
| T2 | L | 1422.5 / 1591.0 | 1423 | 77 | 102 | 713.5 | 11 |
| T3 | B | 1623 / 1806.0 | 1629 | 318 | 198 | 2381.5 | 90 |
| T3 | L | 1561.5 / 1734.4 | 1564 | 328 | 184 | 2534.5 | 56 |

Prompt-token delta T1 (median L − median B, first request): 103

Prompt-token delta T2 (median L − median B, first request): -49

Prompt-token delta T3 (median L − median B, first request): -61.5

Kill-rule clauses: G1 rise ≥ 20 items with c > b and p < 0.05 → does not fire (Δ 60 items, b 3, c 63, p 1.3e-15); headline falls → does not fire (159 → 220); G3 falls > 3 points → does not fire (234 → 238); added model call → does not fire.

#### gemma4:e4b

Runs (the file used per slot is the last valid attempt; every attempt listed):

| Slot | File | Commit | srcDirty | Rows | ERROR | Started (UTC) | Wall |
|---|---|---|---|---|---|---|---|
| B1 | `gemma4_e4b-B1-a1.json` | `cce3051` | false | 240 | 0 | 2026-11-08T06:03:55 | 51 min 28 s |
| B2 | `gemma4_e4b-B2-a1.json` | `cce3051` | false | 240 | 0 | 2026-11-08T07:39:42 | 48 min 36 s |
| B3 | `gemma4_e4b-B3-a1.json` | `cce3051` | false | 240 | 0 | 2026-11-08T09:11:48 | 49 min 36 s |
| L1 | `gemma4_e4b-L1-a1.json` | `32219a6` | false | 240 | 0 | 2026-11-08T06:55:28 | 44 min 9 s |
| L2 | `gemma4_e4b-L2-a1.json` | `32219a6` | false | 240 | 0 | 2026-11-08T08:28:23 | 43 min 20 s |
| L3 | `gemma4_e4b-L3-a1.json` | `32219a6` | false | 240 | 0 | 2026-11-08T10:01:30 | 47 min 22 s |

Model: {"gemma4:e4b":{"name":"gemma4:e4b","digest":"c6eb396dbd5992bbe3f5cdb947e8bbc0ee413d7c17e2beaae69f5d569cf982eb"},"nomic-embed-text":{"name":"nomic-embed-text:latest","digest":"0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f"}}. Library: {"enabled":true,"cards":154}.

Item-majority (≥ 2 of 3 repeats; an ERROR repeat counts as a fail), n = 240 items; paired exact McNemar (b = pass in B only, c = pass in L only):

| Detector | Baseline B | Lever L | Δ points | b | c | McNemar p |
|---|---|---|---|---|---|---|
| headline | 93/240 = 38.8% [32.8, 45.0] | 229/240 = 95.4% [92.0, 97.4] | 56.7 | 0 | 136 | 2.3e-41 |
| G1 | 98/240 = 40.8% [34.8, 47.1] | 234/240 = 97.5% [94.7, 98.8] | 56.7 | 0 | 136 | 2.3e-41 |
| G1b | 228/240 = 95.0% [91.5, 97.1] | 240/240 = 100.0% [98.4, 100.0] | 5.0 | 0 | 12 | 4.9e-4 |
| G2 | 239/240 = 99.6% [97.7, 99.9] | 239/240 = 99.6% [97.7, 99.9] | 0.0 | 1 | 1 | 1.000 |
| G2b | 231/240 = 96.3% [93.0, 98.0] | 236/240 = 98.3% [95.8, 99.4] | 2.1 | 3 | 8 | 0.227 |
| G3 | 236/240 = 98.3% [95.8, 99.4] | 239/240 = 99.6% [97.7, 99.9] | 1.3 | 0 | 3 | 0.250 |
| G4 | 201/240 = 83.8% [78.6, 87.9] | 190/240 = 79.2% [73.6, 83.8] | -4.6 | 37 | 26 | 0.207 |
| G5 | 237/240 = 98.8% [96.4, 99.6] | 239/240 = 99.6% [97.7, 99.9] | 0.8 | 0 | 2 | 0.500 |
| chip offered after T2 | 212/240 = 88.3% [83.7, 91.8] | 232/240 = 96.7% [93.6, 98.3] | 8.3 | 5 | 25 | 3.2e-4 |

Per repeat, k/240 (Wilson 95%):

| Detector | B1 | B2 | B3 | L1 | L2 | L3 | pooled B k/720 | pooled L k/720 |
|---|---|---|---|---|---|---|---|---|
| headline | 90/240 = 37.5% [31.6, 43.8] | 93/240 = 38.8% [32.8, 45.0] | 86/240 = 35.8% [30.0, 42.1] | 215/240 = 89.6% [85.1, 92.8] | 219/240 = 91.3% [87.0, 94.2] | 222/240 = 92.5% [88.5, 95.2] | 269/720 = 37.4% [33.9, 41.0] | 656/720 = 91.1% [88.8, 93.0] |
| G1 | 96/240 = 40.0% [34.0, 46.3] | 102/240 = 42.5% [36.4, 48.8] | 94/240 = 39.2% [33.2, 45.5] | 230/240 = 95.8% [92.5, 97.7] | 228/240 = 95.0% [91.5, 97.1] | 230/240 = 95.8% [92.5, 97.7] | 292/720 = 40.6% [37.0, 44.2] | 688/720 = 95.6% [93.8, 96.8] |
| G1b | 222/240 = 92.5% [88.5, 95.2] | 216/240 = 90.0% [85.6, 93.2] | 219/240 = 91.3% [87.0, 94.2] | 239/240 = 99.6% [97.7, 99.9] | 236/240 = 98.3% [95.8, 99.4] | 239/240 = 99.6% [97.7, 99.9] | 657/720 = 91.3% [89.0, 93.1] | 714/720 = 99.2% [98.2, 99.6] |
| G2 | 238/240 = 99.2% [97.0, 99.8] | 239/240 = 99.6% [97.7, 99.9] | 234/240 = 97.5% [94.7, 98.8] | 236/240 = 98.3% [95.8, 99.4] | 236/240 = 98.3% [95.8, 99.4] | 238/240 = 99.2% [97.0, 99.8] | 711/720 = 98.8% [97.6, 99.3] | 710/720 = 98.6% [97.5, 99.2] |
| G2b | 225/240 = 93.8% [89.9, 96.2] | 227/240 = 94.6% [91.0, 96.8] | 221/240 = 92.1% [88.0, 94.9] | 236/240 = 98.3% [95.8, 99.4] | 227/240 = 94.6% [91.0, 96.8] | 233/240 = 97.1% [94.1, 98.6] | 673/720 = 93.5% [91.4, 95.1] | 696/720 = 96.7% [95.1, 97.7] |
| G3 | 226/240 = 94.2% [90.4, 96.5] | 226/240 = 94.2% [90.4, 96.5] | 220/240 = 91.7% [87.5, 94.5] | 228/240 = 95.0% [91.5, 97.1] | 235/240 = 97.9% [95.2, 99.1] | 232/240 = 96.7% [93.6, 98.3] | 672/720 = 93.3% [91.3, 94.9] | 695/720 = 96.5% [94.9, 97.6] |
| G4 | 180/240 = 75.0% [69.2, 80.1] | 200/240 = 83.3% [78.1, 87.5] | 184/240 = 76.7% [70.9, 81.6] | 179/240 = 74.6% [68.7, 79.7] | 173/240 = 72.1% [66.1, 77.4] | 177/240 = 73.8% [67.8, 78.9] | 564/720 = 78.3% [75.2, 81.2] | 529/720 = 73.5% [70.1, 76.6] |
| G5 | 227/240 = 94.6% [91.0, 96.8] | 227/240 = 94.6% [91.0, 96.8] | 221/240 = 92.1% [88.0, 94.9] | 229/240 = 95.4% [92.0, 97.4] | 235/240 = 97.9% [95.2, 99.1] | 232/240 = 96.7% [93.6, 98.3] | 675/720 = 93.8% [91.7, 95.3] | 696/720 = 96.7% [95.1, 97.7] |
| chip offered after T2 | 193/240 = 80.4% [74.9, 84.9] | 196/240 = 81.7% [76.3, 86.1] | 195/240 = 81.3% [75.8, 85.7] | 211/240 = 87.9% [83.2, 91.5] | 216/240 = 90.0% [85.6, 93.2] | 214/240 = 89.2% [84.6, 92.5] | 584/720 = 81.1% [78.1, 83.8] | 641/720 = 89.0% [86.5, 91.1] |

G1 failure rows by reason, arm B (rows over 3 repeats): commit 306, content 122.
G1 failure rows by reason, arm L (rows over 3 repeats): commit 0, content 32.

Trigger check: lever T1 rows with firstTurnHold true: 720/720 non-ERROR T1 rows; lever T2/T3 turns with true: 0/1440; baseline turns with the field set (not null/undefined): 0/2160.

| Arm/rep | structured requests | turn requests (excl. warm-up) | expected bound Σ(attempts+toolCalls+maxIter) | excess | ask-groups / turns | reloads (loadMs > 1000 after the first request) |
|---|---|---|---|---|---|---|
| B1 | 0 | 778 | 781 | 0 | 720 / 720 | 0 |
| B2 | 0 | 772 | 772 | 0 | 720 / 720 | 0 |
| B3 | 0 | 766 | 769 | 0 | 720 / 720 | 0 |
| L1 | 0 | 771 | 772 | 0 | 720 / 720 | 0 |
| L2 | 0 | 744 | 744 | 0 | 720 / 720 | 0 |
| L3 | 0 | 754 | 754 | 0 | 720 / 720 | 0 |

Added model calls: structured + excess turn requests, summed over the 3 runs: B 0, L 0.

Per turn type, pooled over the 3 runs of each arm (wire figures only where ask-groups align with turns): prompt tokens of the turn's first request (median / mean), prompt tokens summed over the turn's requests (median), output tokens summed over the turn's requests (median), ttftMs and totalMs (median, rows), tool calls (total).

| Turn | Arm | first-request prompt tokens med / mean | Σ prompt tokens med | output tokens med | ttft ms med | total ms med | tool calls |
|---|---|---|---|---|---|---|---|
| T1 | B | 1399 / 1606.7 | 1401 | 120.5 | 206 | 2265 | 69 |
| T1 | L | 1502 / 1709.7 | 1502 | 70.5 | 226 | 1420 | 0 |
| T2 | B | 1508 / 1693.6 | 1508 | 140 | 123 | 2506.5 | 19 |
| T2 | L | 1458 / 1619.1 | 1459 | 117 | 138 | 2134 | 20 |
| T3 | B | 1708 / 1895.0 | 1715.5 | 380.5 | 294.5 | 6813 | 73 |
| T3 | L | 1638 / 1803.4 | 1652 | 395.5 | 283.5 | 7152 | 89 |

Prompt-token delta T1 (median L − median B, first request): 103

Prompt-token delta T2 (median L − median B, first request): -50

Prompt-token delta T3 (median L − median B, first request): -70

Kill-rule clauses: G1 rise ≥ 20 items with c > b and p < 0.05 → does not fire (Δ 136 items, b 0, c 136, p 2.3e-41); headline falls → does not fire (93 → 229); G3 falls > 3 points → does not fire (236 → 239); added model call → does not fire.

#### qwen3.5:4b

Runs (the file used per slot is the last valid attempt; every attempt listed):

| Slot | File | Commit | srcDirty | Rows | ERROR | Started (UTC) | Wall |
|---|---|---|---|---|---|---|---|
| B1 | `qwen3.5_4b-B1-a1.json` | `cce3051` | false | 240 | 0 | 2026-11-08T10:49:16 | 82 min 8 s |
| B2 | `qwen3.5_4b-B2-a1.json` | `cce3051` | false | 240 | 0 | 2026-11-08T13:15:39 | 45 min 23 s |
| B3 | `qwen3.5_4b-B3-a1.json` | `cce3051` | false | 240 | 0 | 2026-11-08T14:35:33 | 42 min 51 s |
| L1 | `qwen3.5_4b-L1-a1.json` | `32219a6` | false | 240 | 0 | 2026-11-08T12:11:30 | 64 min 3 s |
| L2 | `qwen3.5_4b-L2-a1.json` | `32219a6` | false | 240 | 0 | 2026-11-08T14:01:07 | 34 min 21 s |
| L3 | `qwen3.5_4b-L3-a1.json` | `32219a6` | false | 240 | 0 | 2026-11-08T15:18:28 | 32 min 26 s |

Model: {"qwen3.5:4b":{"name":"qwen3.5:4b","digest":"d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04"},"nomic-embed-text":{"name":"nomic-embed-text:latest","digest":"0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f"}}. Library: {"enabled":true,"cards":154}.

Item-majority (≥ 2 of 3 repeats; an ERROR repeat counts as a fail), n = 240 items; paired exact McNemar (b = pass in B only, c = pass in L only):

| Detector | Baseline B | Lever L | Δ points | b | c | McNemar p |
|---|---|---|---|---|---|---|
| headline | 0/240 = 0.0% [0.0, 1.6] | 208/240 = 86.7% [81.8, 90.4] | 86.7 | 0 | 208 | 4.9e-63 |
| G1 | 6/240 = 2.5% [1.2, 5.3] | 233/240 = 97.1% [94.1, 98.6] | 94.6 | 0 | 227 | 9.3e-69 |
| G1b | 6/240 = 2.5% [1.2, 5.3] | 209/240 = 87.1% [82.2, 90.7] | 84.6 | 0 | 203 | 1.6e-61 |
| G2 | 239/240 = 99.6% [97.7, 99.9] | 229/240 = 95.4% [92.0, 97.4] | -4.2 | 11 | 1 | 0.006 |
| G2b | 178/240 = 74.2% [68.3, 79.3] | 88/240 = 36.7% [30.8, 42.9] | -37.5 | 103 | 13 | 1.5e-18 |
| G3 | 194/240 = 80.8% [75.4, 85.3] | 230/240 = 95.8% [92.5, 97.7] | 15.0 | 5 | 41 | 4.4e-8 |
| G4 | 218/240 = 90.8% [86.5, 93.9] | 188/240 = 78.3% [72.7, 83.1] | -12.5 | 48 | 18 | 2.9e-4 |
| G5 | 198/240 = 82.5% [77.2, 86.8] | 231/240 = 96.3% [93.0, 98.0] | 13.8 | 5 | 38 | 2.5e-7 |
| chip offered after T2 | 4/240 = 1.7% [0.6, 4.2] | 48/240 = 20.0% [15.4, 25.5] | 18.3 | 1 | 45 | 1.3e-12 |

Per repeat, k/240 (Wilson 95%):

| Detector | B1 | B2 | B3 | L1 | L2 | L3 | pooled B k/720 | pooled L k/720 |
|---|---|---|---|---|---|---|---|---|
| headline | 2/240 = 0.8% [0.2, 3.0] | 4/240 = 1.7% [0.6, 4.2] | 6/240 = 2.5% [1.2, 5.3] | 182/240 = 75.8% [70.0, 80.8] | 190/240 = 79.2% [73.6, 83.8] | 196/240 = 81.7% [76.3, 86.1] | 12/720 = 1.7% [1.0, 2.9] | 568/720 = 78.9% [75.8, 81.7] |
| G1 | 8/240 = 3.3% [1.7, 6.4] | 9/240 = 3.8% [2.0, 7.0] | 10/240 = 4.2% [2.3, 7.5] | 224/240 = 93.3% [89.4, 95.9] | 225/240 = 93.8% [89.9, 96.2] | 235/240 = 97.9% [95.2, 99.1] | 27/720 = 3.8% [2.6, 5.4] | 684/720 = 95.0% [93.2, 96.4] |
| G1b | 22/240 = 9.2% [6.1, 13.5] | 11/240 = 4.6% [2.6, 8.0] | 20/240 = 8.3% [5.5, 12.5] | 195/240 = 81.3% [75.8, 85.7] | 184/240 = 76.7% [70.9, 81.6] | 197/240 = 82.1% [76.7, 86.4] | 53/720 = 7.4% [5.7, 9.5] | 576/720 = 80.0% [76.9, 82.8] |
| G2 | 233/240 = 97.1% [94.1, 98.6] | 230/240 = 95.8% [92.5, 97.7] | 232/240 = 96.7% [93.6, 98.3] | 218/240 = 90.8% [86.5, 93.9] | 224/240 = 93.3% [89.4, 95.9] | 221/240 = 92.1% [88.0, 94.9] | 695/720 = 96.5% [94.9, 97.6] | 663/720 = 92.1% [89.9, 93.8] |
| G2b | 166/240 = 69.2% [63.1, 74.7] | 171/240 = 71.3% [65.2, 76.6] | 159/240 = 66.3% [60.1, 71.9] | 95/240 = 39.6% [33.6, 45.9] | 97/240 = 40.4% [34.4, 46.7] | 99/240 = 41.3% [35.2, 47.6] | 496/720 = 68.9% [65.4, 72.2] | 291/720 = 40.4% [36.9, 44.0] |
| G3 | 181/240 = 75.4% [69.6, 80.4] | 182/240 = 75.8% [70.0, 80.8] | 180/240 = 75.0% [69.2, 80.1] | 210/240 = 87.5% [82.7, 91.1] | 216/240 = 90.0% [85.6, 93.2] | 214/240 = 89.2% [84.6, 92.5] | 543/720 = 75.4% [72.1, 78.4] | 640/720 = 88.9% [86.4, 91.0] |
| G4 | 196/240 = 81.7% [76.3, 86.1] | 206/240 = 85.8% [80.9, 89.7] | 206/240 = 85.8% [80.9, 89.7] | 161/240 = 67.1% [60.9, 72.7] | 183/240 = 76.3% [70.5, 81.2] | 176/240 = 73.3% [67.4, 78.5] | 608/720 = 84.4% [81.6, 86.9] | 520/720 = 72.2% [68.8, 75.4] |
| G5 | 184/240 = 76.7% [70.9, 81.6] | 183/240 = 76.3% [70.5, 81.2] | 184/240 = 76.7% [70.9, 81.6] | 213/240 = 88.8% [84.1, 92.2] | 216/240 = 90.0% [85.6, 93.2] | 218/240 = 90.8% [86.5, 93.9] | 551/720 = 76.5% [73.3, 79.5] | 647/720 = 89.9% [87.4, 91.9] |
| chip offered after T2 | 17/240 = 7.1% [4.5, 11.0] | 7/240 = 2.9% [1.4, 5.9] | 17/240 = 7.1% [4.5, 11.0] | 61/240 = 25.4% [20.3, 31.3] | 69/240 = 28.7% [23.4, 34.8] | 65/240 = 27.1% [21.9, 33.0] | 41/720 = 5.7% [4.2, 7.6] | 195/720 = 27.1% [24.0, 30.4] |

G1 failure rows by reason, arm B (rows over 3 repeats): commit 603, content 90.
G1 failure rows by reason, arm L (rows over 3 repeats): commit 0, content 36.

Trigger check: lever T1 rows with firstTurnHold true: 720/720 non-ERROR T1 rows; lever T2/T3 turns with true: 0/1440; baseline turns with the field set (not null/undefined): 0/2160.

| Arm/rep | structured requests | turn requests (excl. warm-up) | expected bound Σ(attempts+toolCalls+maxIter) | excess | ask-groups / turns | reloads (loadMs > 1000 after the first request) |
|---|---|---|---|---|---|---|
| B1 | 0 | 772 | 773 | 0 | 720 / 720 | 0 |
| B2 | 0 | 775 | 775 | 0 | 720 / 720 | 0 |
| B3 | 0 | 765 | 766 | 0 | 720 / 720 | 0 |
| L1 | 0 | 747 | 748 | 0 | 720 / 720 | 0 |
| L2 | 0 | 742 | 742 | 0 | 720 / 720 | 0 |
| L3 | 0 | 764 | 764 | 0 | 720 / 720 | 0 |

Added model calls: structured + excess turn requests, summed over the 3 runs: B 0, L 0.

Per turn type, pooled over the 3 runs of each arm (wire figures only where ask-groups align with turns): prompt tokens of the turn's first request (median / mean), prompt tokens summed over the turn's requests (median), output tokens summed over the turn's requests (median), ttftMs and totalMs (median, rows), tool calls (total).

| Turn | Arm | first-request prompt tokens med / mean | Σ prompt tokens med | output tokens med | ttft ms med | total ms med | tool calls |
|---|---|---|---|---|---|---|---|
| T1 | B | 1610.5 / 1827.7 | 1615 | 176 | 429.5 | 3153.5 | 55 |
| T1 | L | 1709.5 / 1926.7 | 1710 | 65 | 458.5 | 1419 | 1 |
| T2 | B | 1775 / 1951.6 | 1800.5 | 210 | 240 | 3448.5 | 80 |
| T2 | L | 1658 / 1834.5 | 1664.5 | 152 | 374 | 2697.5 | 81 |
| T3 | B | 2016 / 2193.6 | 2020.5 | 335.5 | 221.5 | 5340.5 | 18 |
| T3 | L | 1849.5 / 2027.1 | 1852.5 | 293 | 232 | 4657 | 12 |

Prompt-token delta T1 (median L − median B, first request): 99

Prompt-token delta T2 (median L − median B, first request): -117

Prompt-token delta T3 (median L − median B, first request): -166.5

Kill-rule clauses (qwen3.5:4b is not under the rule; shown for reference only): G1 rise ≥ 20 items with c > b and p < 0.05 → does not fire (Δ 227 items, b 0, c 227, p 9.3e-69); headline falls → does not fire (0 → 208); G3 falls > 3 points → does not fire (194 → 230); added model call → does not fire.
