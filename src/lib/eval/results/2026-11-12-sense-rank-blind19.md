# define: lever 19 sense ranking, held-out `blind-19`, 2026-11-12

> **TEST RESULT, read once.** Lever 19 (`docs/BENCHMARKS.md` row 19 and B8 "Lever 19"). `blind-19` was
> generated once, after the ranker's hash was committed. It ran once at `eval-test-2026-11-12-lever19`
> (`a5fe7ef`), with 120 items × 3 repeats per arm. Both blind model graders read the rows.
>
> **Outcome: no kill clause fires, so lever 19 ships, and it is reported as an accuracy lever** on
> gemma4:e2b. The gate passed: κ 0.900, 92 "no" answers from each grader, and the canary 20/20 for
> both graders. On the 26 changed L items, R gains 6 items and loses 0 against S, with exact McNemar
> p 0.031 on grader 1's verdicts. On the both-graders-agree verdicts it gains 7 and loses 0, with
> p 0.016. There are no ERROR rows to drop.
>
> **Disclosed deviations:**
> - The qwen3.5:4b other-models clause is read by a worst-case bound, because 42 grader-1 rows are
>   ungraded (see below).
> - Arm B is only partly graded and is descriptive only.
> - The R8 dry run was priced against the wrong credit figure.
> - The dry run underpriced the graders.
> - The test tag carries a suffix.
>
> None of these changes a request, a reply or a verdict that was read.

## Run record

| | |
|---|---|
| Test commit | `a5fe7ef`, tagged `eval-test-2026-11-12-lever19` (see deviation 5 for the suffix). `srcDirty` false in every results file |
| Freeze | The kernel freeze point is `e8f1e9e`, the commit that adds `senseReview.ts` (B8 "Freeze point"). `git diff e8f1e9e a5fe7ef -- src/lib/kernel src/lib/dictionary.ts` is **empty**. `git diff --stat e8f1e9e a5fe7ef -- src public/dictionary` shows 4 files: the `blind-19` items, the raw response, `changed.json` and the dev results file. All four are allowed between the ranker hash and the tag |
| Hashes, checked before generation (LF, as git stores them) | `senseRank.ts` `6c21097b17517489a769bc3aa24bf37bbbdfb69748656b9148210a05cecdcfb2`; `blind19.ts` `71346adc246542896f43f0389468584ff206ff58f0d9777d7c0c95c1f1d48f14`; `blind19-generate.ts` `b49dcaf91f258a8aaca5530d6bfe31b5c69e1093026703e314da8aa13e7ac39c`. All three are as recorded in row 19 and B8 |
| Dev iterations | **None.** Claude decided to proceed without one, as the owner's delegate, and recorded the decision in the dev results file before generation (`42d93cc`) |
| Rule 6 | `git diff master...eval-test-2026-11-12-lever19 -- src`: 37 files, +4,858 −51. This is this PR's own diff (10 commits), as pre-registered for an unmerged lever |
| Generation | One request to `openai/gpt-6.1-sol` through OpenRouter (`blind19-generate.ts`, run once). The first response counted on attempt 1, with 180 objects. The code kept **80 L and 40 C**, in output order, with 0 rejected and no top-up. Raw response `src/lib/eval/blind-19/raw-2026-11-12T15-23-18-469Z-r0-a1.txt`, SHA-256 `8d69499a54af176f51dca4c099629d6c41b1658cf3486b71b3227c921bbfcb15`. Cost $0.0914. Committed in `fe4e6a1`. No item was edited |
| Changed list | `blind19-changed.ts` found **26 L and 12 C** changed items of 120. It was committed in `a5fe7ef`, before any reply existed. The compare checks it against the notes the runs sent, and it agrees |
| Checks by test at the tag | `define-senserank.test.ts` (identity: the B8 plain items and the 22 frozen no-sentence messages are byte-identical with the ranker on and off; hashes) and `define-safety.test.ts` (the ranked sweep: 0 removed senses shown, 0 broad-check hits, removal counts unchanged; newly reachable 14,208 / 4,315). Both pass; with the blind-19 tests, 76/76 |
| R1(b) read | Done before the tag (B8 "R1(b) read"). The record passed to the compare as `BLIND19_SAFETY_READ` is `reviewed.json` (SHA-256 `8ae77aca417e…`), with `flags.jsonl` (292 flags, `4880347c3b5c…`). Both are kept in the main checkout's `.dev/lever19-r1b/` and are not committed |
| Models | Local Ollama 0.40.15 on the RTX 3070 laptop. gemma4:e2b `b37049369adf…`, gemma4:e4b `c6eb396dbd59…`, qwen3.5:4b. Default options |
| Arms | S `EVAL_SENSE_RANK=off`, R unset, B `EVAL_DICTIONARY=off` (e2b only). `EVAL_WIRE=1` on the three e2b arms. `EVAL_SET=blind-19 EVAL_REPEATS=3` throughout |
| Runs (main checkout `.dev/eval-runs/`) | e2b: `2026-11-12T15-27-46-431-define-blind-19-S-gemma4_e2b.json`, `…15-31-20-510…-R-gemma4_e2b.json`, `…15-34-38-956…-B-gemma4_e2b.json`. e4b: `…15-37-58-532…-S-gemma4_e4b.json`, `…15-47-05-542…-R-gemma4_e4b.json`. qwen3.5:4b: `…15-54-27-018…-S-qwen3.5_4b.json`, `…16-03-46-389…-R-qwen3.5_4b.json` |
| Each arm | 360/360 rows, 0 ERROR rows, not void, not partial. Every S and R row carries a note, and B carries none. Free RAM was 10.8 GB or more before every arm. Each arm took 3 to 9 minutes, with no stall |
| Wire (e2b) | Every request returned 200. There was no model reload of 1 s or more after S's first cold load |
| Sheets (`blind19-sheet.ts`; `.dev/<id>.html`, keys in `.dev/label-verdicts/`) | `blind19-e2b-SR`: 740 rows, including the 20 canary rows. `blind19-e4b-SR`: 720. `blind19-qwen4b-SR`: 720. `blind19-e2b-B`: 360 |
| Graders | Grader 1 `anthropic/claude-fable-5.2`, grader 2 `openai/gpt-6.1-sol`, both through OpenRouter, through `define-label-grader2.ts` (`DEFINE_GRADER_SLOT` 1 and 2) with the pre-registered request unchanged. Interrupted exports were resumed, keeping answered rows, as R8 allows. Exports are in `.dev/label-exports/blind19-<sheet>-g{1,2}.json` |
| Grading coverage | e2b S/R: 740/740 by both graders. e4b S/R: 720/720 by both. qwen S/R: grader 2 720/720, **grader 1 678/720** (deviation 1). e2b B: grader 2 360/360, **grader 1 115/360** (deviation 2) |
| Cost actually spent | **$26.48** of OpenRouter credit: generation $0.09 and grading $26.39, measured as the change in account usage from 51.29 to 77.77. The R8 dry run had priced all grading at $15.28 |

## Disclosed deviations

1. **qwen3.5:4b's other-models clause is read by a worst-case bound over 42 ungraded grader-1 rows (14 on changed items), because the key's holdback blocked the last ~$0.30.**
   - OpenRouter returned HTTP 402 with about $4.3 still under the key's cap. The grader request sets no `max_tokens`, so OpenRouter appears to hold back the model's largest possible output (about $5 at grader 1's price) on each request.
   - The request was not changed to get around this: every graded row was graded by the identical pre-registered request.
   - `blind19-compare.ts` refuses a sheet with unanswered rows. Run on all seven runs, it stopped with "Refusing to judge: sheet blind19-qwen4b-SR: 42 row(s) unanswered".
   - It was therefore run as written on the e2b and e4b runs and sheets (output below). The qwen clause was computed with the same item-majority rule: an item passes on 2 of 3 rows, and a missing row fails.
   - The same computation reproduces the compare's e4b numbers exactly: S 35 / R 37 on grader 1, S 34 / R 36 on grader 2, S 33 / R 36 on both-agree.
   - For the bound, every missing R row on a changed item fails, and every missing S row on a changed item passes on grader 1. Grader 2 is complete.
   - The 14 missing changed rows: S b19-68-L-13#0, b19-68-L-16#2, b19-k2-C-01#2, b19-68-C-07#1, b19-35-C-03#1, b19-912-C-05#2, b19-35-L-17#0; R b19-68-C-02#0, b19-68-L-20#2, b19-35-L-09#0, b19-35-L-11#2, b19-35-L-09#2, b19-68-C-07#2, b19-912-C-09#2.

   | qwen3.5:4b, 38 changed items | observed (missing rows fail in both arms) | worst case for R | fires at R ≤ S − 4 |
   |---|---|---|---|
   | grader 1 | S 33/38, R 34/38 (lost b19-35-L-09, b19-35-L-11; gained b19-68-L-13, b19-68-L-20, b19-912-L-05) | S 34/38, R 34/38 | no |
   | grader 2 (complete) | S 34/38, R 34/38 (lost b19-k2-L-19; gained b19-68-L-20) | same | no |
   | both agree | S 31/38, R 33/38 | S 33/38, R 33/38 | no |

   No completion of the 42 rows can make the clause fire: the worst case is R − S = 0 on every reading. **The clause is decided as "does not fire."**

2. **Arm B is graded only in part, and is descriptive only.** Grader 2 graded all 360 B rows. Grader 1 graded 115 of 360 before credit ran out, because B came last in the spending order (R8 lists B's grading as the first thing to drop). B enters no clause. Below it is read on grader 2 only, with no claim.

3. **The R8 dry run was priced against the account balance ($28.62), not the key's spending cap.** The cap is what actually limits spending. The dry run came to $15.28. Against the key's real remaining credit (about $8.40 at the time), that is over 80%, so R8's savings would have applied. Grading was resumed at normal prices with the same graders, after the owner raised the cap. Claude decided this as the owner's delegate, and no `:batch` regrade was done. With the raised cap, the full-grading estimate is under 80% of the available credit, so R8's savings do not apply.

4. **The dry run underpriced the graders.** `blind19-cost.ts` prices each answer at 30 output tokens. `gpt-6.1-sol` reasons before it answers: measured about $0.005 per row against the $0.0012 estimate, about 4×. Grader 1 measured about $0.006 per row against $0.0048. Actual spend is in the run record.

5. **Tag name.** `eval-test-2026-11-12` already exists (lever 18's test), so the tag is `eval-test-2026-11-12-lever19`. It keeps the protocol's `eval-test-<date>` prefix, which is what the runner checks for.

## The compare as written (`blind19-compare.ts`, gemma4:e2b and gemma4:e4b; qwen3.5:4b per deviation 1)

```
Gate: kappa 0.900 (n 720); "no" answers 92 / 92; canary "no" 20 / 20 of 20 → PASSES
```

| Clause | Fires | Detail |
|---|---|---|
| harm, L (grader1): R <= S - 3 on the changed L items | no | S 17/26, R 23/26; lost none; gained b19-k2-L-13, b19-k2-L-19, b19-35-L-11, b19-35-L-17, b19-68-L-20, b19-912-L-05 |
| harm, C (grader1): R <= S - 2 on the changed C items | no | S 12/12, R 12/12; lost none; gained none |
| harm, L (grader2): R <= S - 3 on the changed L items | no | S 16/26, R 23/26; lost none; gained b19-k2-L-13, b19-k2-L-19, b19-35-L-11, b19-35-L-17, b19-68-L-14, b19-68-L-20, b19-912-L-05 |
| harm, C (grader2): R <= S - 2 on the changed C items | no | S 12/12, R 12/12; lost none; gained none |
| harm, L (both): R <= S - 3 on the changed L items | no | S 16/26, R 23/26; lost none; gained b19-k2-L-13, b19-k2-L-19, b19-35-L-11, b19-35-L-17, b19-68-L-14, b19-68-L-20, b19-912-L-05 |
| harm, C (both): R <= S - 2 on the changed C items | no | S 12/12, R 12/12; lost none; gained none |
| other models, gemma4:e4b (grader1): R <= S - 4 on the changed items | no | S 35/38, R 37/38; lost none; gained b19-68-L-20, b19-912-C-09 |
| other models, gemma4:e4b (grader2): R <= S - 4 on the changed items | no | S 34/38, R 36/38; lost b19-35-L-17; gained b19-k2-L-07, b19-k2-L-19, b19-68-L-20 |
| other models, gemma4:e4b (both): R <= S - 4 on the changed items | no | S 33/38, R 36/38; lost b19-35-L-17; gained b19-k2-L-07, b19-k2-L-19, b19-68-L-20, b19-912-C-09 |
| other models, qwen3.5:4b (all three readings) | no | Read by the worst-case bound (deviation 1): worst case R − S = 0 on each reading |
| safety: the newly-reachable read is missing | no | read before the tag |
| cost: an added model call in R, or the caps exceeded on any row | no | 0 added; caps held |
| fire: a non-ERROR S or R row with no note | no | none |
| errors, gemma4:e2b: R ERROR rows > S + 1 | no | S 0, R 0 |
| errors, gemma4:e4b: R ERROR rows > S + 1 | no | S 0, R 0 |
| errors, qwen3.5:4b (from the run files; not in this compare run) | no | S 0, R 0 |
| undecided: kappa between the graders below 0.6 | no | kappa 0.900 (n 720) |
| short set: fewer than 60 L or 30 C items | no | 80 L, 40 C |

The compare prints: "No clause fires: it ships. Accuracy reading: lever." The qwen3.5:4b rows of this
table come from deviation 1 and the run files, not from the compare's output.

The identity clause and the ranked-sweep part of the safety clause are read by test, before any run
(run record). Neither fires.

Rule model, item-majority (changed / unchanged, the latter descriptive):

| Reading | Kind | Changed S → R (gained/lost, p) | Unchanged S → R |
|---|---|---|---|
| grader1 | L | 17/26 → 23/26 (6/0, p 0.0313) | 47/54 → 46/54 |
| grader1 | C | 12/12 → 12/12 (0/0, p 1.00) | 28/28 → 28/28 |
| grader2 | L | 16/26 → 23/26 (7/0, p 0.0156) | 47/54 → 47/54 |
| grader2 | C | 12/12 → 12/12 (0/0, p 1.00) | 28/28 → 27/28 |
| both | L | 16/26 → 23/26 (7/0, p 0.0156) | 47/54 → 46/54 |
| both | C | 12/12 → 12/12 (0/0, p 1.00) | 28/28 → 27/28 |

Descriptive (R5): changed items whose S first sense is absent under R: L 0, C 1; items whose top sense scored 1: L 25, C 17.

### The success test, clause by clause

- **Gate passed:**
  - κ 0.900 (at least 0.8).
  - 92 "no" answers from each grader (at least 20 needed).
  - Canary 20/20 "no" from each grader (at least 18 needed).
- **Changed L on grader 1:** 6 gained, 0 lost, exact two-sided McNemar p 0.031. This is exactly the 6/0 bar.
- **Changed L on both-agree:** 7 gained, 0 lost, p 0.016.
- **After dropping items with an ERROR row:** the same, because there are none.
- **The set holds 80 L** (at least 60 needed).
- **Not the ceiling case:** S fails 9 of the 26 changed L items on grader 1 (the ceiling is 5 or fewer), and each grader gave 92 "no" answers.

So it is reported as **an accuracy lever**, within what B8 "What may be claimed" allows:
- **Claimed:** the effect of ranking on a meaning question that carries a sentence, given a fire and an entry, on gemma4:e2b. This is for model-written questions judged by two blind model graders.
- **Not claimed:**
  - questions with no sentence;
  - real students' phrasing;
  - reading level;
  - human validation;
  - generality across models (qwen3.5:2b and phi4-mini were not run);
  - inflected or multi-headword words;
  - sentences not written to make the sense plain.

The margin is thin. 6/0 is the smallest result that passes, and it rests on 26 items.

## Descriptive

These numbers are not part of the kill rule or the claim. They come from a script outside the frozen
tooling that uses the same `gradedRows` / `itemVerdicts` / `contrast` functions. A missing grader-1 row
counts as a fail, which affects only qwen (42 rows) and B.

### Item-majority per model, arm and reading

"strict" is grader 1: meaning yes and "other meaning" no.

| Model | Arm | Reading | all | L | C | chg L | chg C | unchg L | unchg C |
|---|---|---|---|---|---|---|---|---|---|
| gemma4:e2b | S | grader1 | 104/120 | 64/80 | 40/40 | 17/26 | 12/12 | 47/54 | 28/28 |
| gemma4:e2b | S | grader2 | 103/120 | 63/80 | 40/40 | 16/26 | 12/12 | 47/54 | 28/28 |
| gemma4:e2b | S | both | 103/120 | 63/80 | 40/40 | 16/26 | 12/12 | 47/54 | 28/28 |
| gemma4:e2b | S | strict | 92/120 | 55/80 | 37/40 | 15/26 | 11/12 | 40/54 | 26/28 |
| gemma4:e2b | R | grader1 | 109/120 | 69/80 | 40/40 | 23/26 | 12/12 | 46/54 | 28/28 |
| gemma4:e2b | R | grader2 | 109/120 | 70/80 | 39/40 | 23/26 | 12/12 | 47/54 | 27/28 |
| gemma4:e2b | R | both | 108/120 | 69/80 | 39/40 | 23/26 | 12/12 | 46/54 | 27/28 |
| gemma4:e2b | R | strict | 99/120 | 63/80 | 36/40 | 22/26 | 10/12 | 41/54 | 26/28 |
| gemma4:e2b | B | grader2 only (deviation 2) | 107/120 | 67/80 | 40/40 | 20/26 | 12/12 | 47/54 | 28/28 |
| gemma4:e4b | S | grader1 | 116/120 | 78/80 | 38/40 | 24/26 | 11/12 | 54/54 | 27/28 |
| gemma4:e4b | S | grader2 | 115/120 | 76/80 | 39/40 | 22/26 | 12/12 | 54/54 | 27/28 |
| gemma4:e4b | S | both | 114/120 | 76/80 | 38/40 | 22/26 | 11/12 | 54/54 | 27/28 |
| gemma4:e4b | S | strict | 109/120 | 72/80 | 37/40 | 22/26 | 11/12 | 50/54 | 26/28 |
| gemma4:e4b | R | grader1 | 118/120 | 79/80 | 39/40 | 25/26 | 12/12 | 54/54 | 27/28 |
| gemma4:e4b | R | grader2 | 117/120 | 78/80 | 39/40 | 24/26 | 12/12 | 54/54 | 27/28 |
| gemma4:e4b | R | both | 117/120 | 78/80 | 39/40 | 24/26 | 12/12 | 54/54 | 27/28 |
| gemma4:e4b | R | strict | 111/120 | 74/80 | 37/40 | 23/26 | 11/12 | 51/54 | 26/28 |
| qwen3.5:4b | S | grader1 (678/720 rows) | 114/120 | 74/80 | 40/40 | 21/26 | 12/12 | 53/54 | 28/28 |
| qwen3.5:4b | S | grader2 | 115/120 | 75/80 | 40/40 | 22/26 | 12/12 | 53/54 | 28/28 |
| qwen3.5:4b | S | both | 112/120 | 73/80 | 39/40 | 20/26 | 11/12 | 53/54 | 28/28 |
| qwen3.5:4b | S | strict | 71/120 | 45/80 | 26/40 | 16/26 | 7/12 | 29/54 | 19/28 |
| qwen3.5:4b | R | grader1 (678/720 rows) | 113/120 | 74/80 | 39/40 | 22/26 | 12/12 | 52/54 | 27/28 |
| qwen3.5:4b | R | grader2 | 114/120 | 75/80 | 39/40 | 22/26 | 12/12 | 53/54 | 27/28 |
| qwen3.5:4b | R | both | 111/120 | 73/80 | 38/40 | 21/26 | 12/12 | 52/54 | 26/28 |
| qwen3.5:4b | R | strict | 76/120 | 44/80 | 32/40 | 12/26 | 10/12 | 32/54 | 22/28 |

### Per band, grader 1, item-majority

| Model | Arm | K-2 L | K-2 C | 3-5 L | 3-5 C | 6-8 L | 6-8 C | 9-12 L | 9-12 C |
|---|---|---|---|---|---|---|---|---|---|
| gemma4:e2b | S | 15/20 | 10/10 | 16/20 | 10/10 | 15/20 | 10/10 | 18/20 | 10/10 |
| gemma4:e2b | R | 17/20 | 10/10 | 18/20 | 10/10 | 15/20 | 10/10 | 19/20 | 10/10 |
| gemma4:e4b | S | 20/20 | 9/10 | 20/20 | 10/10 | 18/20 | 10/10 | 20/20 | 9/10 |
| gemma4:e4b | R | 20/20 | 9/10 | 20/20 | 10/10 | 19/20 | 10/10 | 20/20 | 10/10 |
| qwen3.5:4b | S | 20/20 | 10/10 | 19/20 | 10/10 | 16/20 | 10/10 | 19/20 | 10/10 |
| qwen3.5:4b | R | 20/20 | 10/10 | 16/20 | 10/10 | 18/20 | 9/10 | 20/20 | 10/10 |

### R vs B and S vs B on e2b (grader 2 only, deviation 2)

- **All 120 items:** B 107, S 103, R 109.
  - B→R: R lost 7, gained 9, p 0.80.
  - B→S: S lost 10, gained 6, p 0.45.
- **Changed L items:**
  - B 20/26, S 16/26, R 23/26.
  - B→S: S lost b19-k2-L-07, b19-k2-L-19, b19-35-L-11, b19-68-L-14, b19-68-L-20 and b19-912-L-05; it gained b19-k2-L-05 and b19-68-L-02.
  - B→R: R lost b19-k2-L-07 and gained b19-k2-L-05, b19-k2-L-13, b19-35-L-17 and b19-68-L-02. p 0.375.
- **Changed C:** 12/12 in all three arms.

So, descriptively, on the changed L items the stored-order note left e2b worse than no note at all. The
ranked note leaves it ahead of no note, but not significantly. This is the "trunk" pattern from lever
18's dev, now on held-out items.

### Other contrasts (item-majority)

- **e2b, all 120:**
  - grader 1: S 104 → R 109 (lost b19-35-L-12, b19-68-L-11; gained 7), p 0.18.
  - both: 103 → 108, p 0.23.
- **e2b, unchanged items:** these requests are identical between arms, so any difference is sampling. Grader 1: S 75/82 → R 74/82. Both: 75 → 73 (lost b19-35-L-12, b19-35-C-10, b19-68-L-11; gained b19-35-L-08).
- **e4b, changed:** 35 → 37 on grader 1, p 0.5.
- **qwen3.5:4b, all 120, grader 1:** 114 → 113 (lost b19-35-L-03, b19-35-L-09, b19-35-L-11, b19-68-C-01; gained 3), p 1.0. qwen's strict reading moves more than its lenient one: changed L strict 16 → 12, changed C strict 7 → 10. qwen's replies often name a second sense, which the strict reading fails.

### The changed L items e2b gained

| Item | Word | Student's message |
|---|---|---|
| b19-k2-L-13 | date | "Mom put a sweet date in my lunch." |
| b19-k2-L-19 | ear | "an ear of yellow corn" |
| b19-35-L-11 | scale | "a silver scale beside the fish tank" |
| b19-35-L-17 | check | "One blue check stood out on the patterned fabric." |
| b19-68-L-20 | function | "The formal function included dinner and an awards ceremony." |
| b19-912-L-05 | chamber | "The upper chamber approved the revised transportation proposal." |

b19-68-L-14, base ("it was a base" with litmus), is also gained on grader 2 and both-agree.

### Graders

- **e2b S and R rows:** the graders disagree on 16 of 720. On 8, grader 1 said yes and grader 2 no; on the other 8, the reverse:

  | Arm | Item#repeat | Word | Grader 1 | Grader 2 |
  |---|---|---|---|---|
  | S | b19-k2-L-06#1 | rock | yes | no |
  | S | b19-35-C-10#0 | skirt | yes | no |
  | S | b19-68-L-14#0 | base | yes | no |
  | S | b19-68-C-07#0 | column | yes | no |
  | R | b19-35-C-10#1 | skirt | yes | no |
  | R | b19-35-C-10#2 | skirt | yes | no |
  | R | b19-35-L-17#1 | check | yes | no |
  | R | b19-k2-L-19#0 | ear | yes | no |
  | R | b19-68-L-10#2 | even | no | yes |
  | R | b19-912-C-09#2 | discipline | no | yes |
  | R | b19-35-L-05#2 | sharp | no | yes |
  | S | b19-68-L-20#0 | function | no | yes |
  | S | b19-35-L-05#1 | sharp | no | yes |
  | S | b19-912-L-17#0 | issue | no | yes |
  | S | b19-k2-L-20#0 | arm | no | yes |
  | S | b19-35-L-01#1 | branch | no | yes |

- **Other sheets:** e4b S 8/360, e4b R 6/360, qwen S 29/360 and qwen R 29/360 disagree. On qwen, an ungraded grader-1 row counts as a disagreement. The B sheet is not comparable (deviation 2).
- **Canary:** all 20 rows were answered "no" by both graders.

### Note size, ranker time, reply length

| Run | `noteTokens` median / max (entry plus note) | Median reply words, K-2 / 3-5 / 6-8 / 9-12 | Median turn ms |
|---|---|---|---|
| e2b S | 299 / 405 | 24 / 40 / 44 / 77 | 522 |
| e2b R | 294 / 405 | 24 / 41 / 44 / 76 | 498 |
| e2b B | — | 22 / 39 / 44 / 81 | 479 |
| e4b S | 299 / 405 | 33 / 49 / 62 / 87 | 1,198 |
| e4b R | 294 / 405 | 32 / 50 / 58 / 84 | 1,160 |
| qwen S | 299 / 405 | 48 / 60 / 66 / 75 | 1,308 |
| qwen R | 294 / 405 | 46 / 62 / 66 / 74 | 1,280 |

- The caps held on every row (cost clause).
- **Ranker time:** 89 µs per lookup ranked against 40 µs in stored order, over B8's 32 sense items. One laptop run of `define-senserank.test.ts` at the tag, with entries already loaded.

### R5

- On 1 changed item, S's first shown sense is absent under R: b19-68-C-07 "column" (C). It passes in both arms.
- 25 L and 17 C items have a top sense with score 1. A single overlapping word decides their order, the failure mode the dev run showed on "present" and "temper".

### Fable's expectation, before any run

Fable expected about +3 to +6 of 80 on e2b, probably not significant, with C flat. The result on all 80
L is +5 on grader 1 (64 → 69). On the 26 changed L items it is 6/0, which reaches the pre-registered
significance bar by its smallest margin. C is flat.

## What this does and does not say

- **It says:** on held-out, model-written meaning questions that quote a sentence, ranking the
  dictionary senses by the sentence turned 6 of the 26 changed L items from fail to pass on e2b. It
  turned none from pass to fail, on both graders. The first-thought (C) items stayed 12/12. Nothing
  fired on e4b or qwen3.5:4b, and the requests without a sentence are byte-identical by test.
- **It does not say:**
  - anything about questions without a sentence ("share");
  - anything about real students;
  - that the gain is large: 6/0 is the minimum that passes;
  - that the ranker beats no note at all on e2b (descriptively it is ahead, not significantly).
- **What still holds over from dev:** one overlapping word in a sense's example can pull a wrong sense
  to the top (42 items here have a top score of 1). No verdict on this set was lost to it.
