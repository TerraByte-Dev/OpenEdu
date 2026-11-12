# define: lever 19 sense ranking, DEV on B8's 32 sense items, gemma4:e2b, 2026-11-12

> **DEV RESULT, in-sample, descriptive.** Lever 19 (`docs/BENCHMARKS.md` row 19 and B8 "Lever 19").
> Every one of B8's 184 items is development data for lever 19 (it was designed after lever 18's
> results were read), so nothing here is evidence for the lever and nothing here is pooled with
> `blind-19`. The run checks the pre-registered dev stop rule and looks for harm before the held-out
> set is generated.
>
> **Arm S (`EVAL_SENSE_RANK=off`) passes 28 of 32 sense items and arm R (the ranker) passes 31 of 32
> (lenient, item-majority of 3).** R gains 3 items and loses none. **The dev stop rule (R passes 3 or
> more fewer than S) does not fire.** Of the 3 gains, only 2 have an entry that differs between the
> arms; the third is sampling noise on an identical request.
>
> Both arms are complete: 0 ERROR rows, every row detected and noted, and 0 added model calls.

## Run record

| | |
|---|---|
| Commit | `e8f1e9e` (branch `feat/256-sense-ranking`, the kernel freeze point after R1(b)); `srcDirty` false in every file |
| `senseRank.ts` | unchanged, SHA-256 `6c21097b…cdcfb2` as recorded in row 19. No dev iteration has been made |
| Model | gemma4:e2b through local Ollama, default options, `EVAL_WIRE` not set |
| How the 32 items ran | The 32 sense items are 12 `dev` and 20 `test` items in `define-items.ts`. The runner refuses `EVAL_ONLY` on the test split, and `src/` is frozen, so each arm ran twice: the dev split with `EVAL_ONLY` set to the 12 dev sense items, and the whole test split (120 items, of which 20 are sense items). Both runs used `EVAL_REPEATS=3`. The 100 test plain items rode along. They are not part of the dev rule and are reported only below |
| Runs (main checkout `.dev/eval-runs/`) | S: `2026-11-12T15-12-44-171-define-dev-S-gemma4_e2b.json`, `2026-11-12T15-13-39-874-define-test-S-gemma4_e2b.json`. R: `2026-11-12T15-13-13-644-define-dev-D-gemma4_e2b.json`, `2026-11-12T15-16-51-801-define-test-D-gemma4_e2b.json` (on B8's splits the default file name labels the ranked arm `-D-`) |
| Compare | `define-compare.ts` with `DEFINE_B` = S and `DEFINE_D` = R, once per split. The 32-item tally adds the two splits' `sense` rows |
| Grader | lexical (`define-grade.ts`), the term lists unchanged. The B8 gate missed (κ 0.65), so lexical verdicts are descriptive in any case |

## Result on the 32 sense items

| Reading | S | R | lost (S pass, R fail) | gained (R pass, S fail) |
|---|---|---|---|---|
| lenient | 28/32 | 31/32 | none | sense-k2-03 (fair), sense-k2-07 (trunk), sense-68-02 (sound) |
| strict | 25/32 | 28/32 | sense-k2-05 (duck) | sense-k2-03, sense-k2-07, sense-35-03 (kind), sense-68-02 |

Per split, from `define-compare.ts`:

- **dev (12):** sense S 11/12, R 12/12, gained sense-k2-07, p 1.0. sense-strict is the same.
- **test (20):** sense S 17/20, R 19/20, gained sense-k2-03 and sense-68-02, p 0.5. sense-strict S 14/20, R 16/20, lost sense-k2-05, gained sense-k2-03, sense-35-03 and sense-68-02, p 0.625.

**The dev stop rule** (row 19: "if R passes 3 or more fewer of the 32 than S (lenient, net), the line stops before `blind-19` is generated"): R − S = +3. **It does not fire.**

### Changed and unchanged entries

The ranker changes the shown entry of **12 of the 32** items. This matches the 12 pinned by `define-senserank.test.ts`. Each item's note was the same in all 3 repeats of an arm.

**Changed (12):**
- sense-k2-02 bark
- sense-k2-03 fair
- sense-k2-07 trunk
- sense-k2-08 row
- sense-35-02 spring
- sense-35-04 pitcher
- sense-35-05 present
- sense-35-08 file
- sense-68-03 fine
- sense-68-07 strike
- sense-912-03 temper
- sense-912-07 appreciate

On the changed items, lenient: **S 9/12, R 11/12, gained fair and trunk, lost none**. Strict: S 9/12, R 11/12, with the same two gains. Every other changed item has the same item verdict in both arms.

**Unchanged (20):** these requests are identical between the arms, so any difference is sampling. Lenient: S 19/20, R 20/20, from one flip (sound). Strict: S 16/20, R 17/20: sound and kind gained, duck lost.

### The items that moved, with the replies that explain them

- **sense-k2-03 "fair" (changed; gained, ranker).** "we went on the rides at the fair". In stored order the entry opens with the "free from favoritism" adjective. R puts "a traveling show; having sideshows and rides" first, scoring 1 on "rides".
  - S, 0/3: *"Fair means not unfair. It means being fair. It means following rules."*
  - R, 3/3: *"Fair means a carnival. It is a traveling show. It has rides and games."*
- **sense-k2-07 "trunk" (changed; gained, ranker).** "the elephant lifted water with its trunk". In stored order the snout is not shown at all (it is the 5th noun sense, under the cap of 3). R shows "a long flexible snout as of an elephant" first, scoring 1 on "elephant".
  - S, 0/3: *"Trunk means the body of an animal. It is the main part of the body."*
  - R, 3/3: *"Trunk means a long nose. It is like an elephant's nose."*
- **sense-68-02 "sound" (unchanged entry; gained, noise).** The requests are identical between the arms.
  - S, 0/3: *"means good or correct. It means the plan is safe and works well"*. This is right in substance, but no expect term matches, so it is a lexical miss.
  - R, 3/3: *"means good or sensible … makes good sense"*.
- **sense-35-03 "kind" (unchanged; strict gain, noise).** S #0: *"The word 'kind' means nice."* In R, 2 of 3 replies give "a type" only.
- **sense-k2-05 "duck" (unchanged; strict loss, noise).** Both arms have 1 of 3 replies that say "a bird". R #2 contrasts the senses (*"Duck means a bird … In that sentence, it means to move down fast"*), which fails strict.

### Changed items where the ranker raised a wrong sense (no verdict changed)

Two changed items had a top sense that a single incidental word in the sense's **example** pulled up:

- **sense-35-05 "present".** "every student was present today": the fitting sense is the adjective "being in a place". R puts the speech verb "deliver (a speech, oration, or idea)" first, scoring 1 on "students" in its example.
  - R's replies still give the right meaning in all three repeats: *"means being in a place … every student was there today"*. All three are lexical misses, because the expect list wants "attend / in class / at school / in the room …". So R is 0/3.
  - S is 1/3: its pass says "at school", and its two fails say "now".
  - The item fails in both arms.
- **sense-912-03 "temper".** "she tried to temper her criticism with praise": the fitting sense is the verb "moderate". R puts the noun "a characteristic … state of feeling" first, scoring 1 on "praised" in its example.
  - Every reply in both arms still reads the verb ("make something more moderate").
  - Both arms are 2/3 and pass.

## R5 descriptive counts

- **Items where S's first shown sense is absent under R:** **0** of 32. On every changed item, S's first sense is still shown under R, lower in the list.
- **Items whose top sense has score 1:** **11** of 32, all of them changed items:
  - sense-k2-02, sense-k2-03, sense-k2-07
  - sense-35-02, sense-35-04, sense-35-05, sense-35-08
  - sense-68-03, sense-68-07
  - sense-912-03, sense-912-07

  The 12th changed item, sense-k2-08 "row", scores 2. Its top sense's example is "row the boat across the lake". The other 20 items score 0 and keep stored order.

  Score is the maximum `senseScores` over the headword's senses against `scoringSentence`, computed with the kernel's own functions at `e8f1e9e`.

## Descriptive, outside the 32

- **The note was byte-identical on all 300 plain-item rows of the test split in both arms**, so the plain items sent the same requests.
- One plain item flipped from sampling: lenient, def-k2-08 passed in S and failed in R.
- Note size on the 32 sense items, as `noteTokens` (the entry plus the note): S median 294, max 362; R median 300, max 362. The caps are unchanged.
- Median reply length is the same within a few words per band (test split: K-2 22/22, 3-5 37/37, 6-8 37/38, 9-12 60/58).

## What this does and does not say

- It says the dev stop rule does not fire on e2b. On the 12 items whose entry the ranker changes, R lost nothing and gained the two items the lever was designed around ("trunk", and "fair", a hidden-sense case of the same kind).
- It does not say the ranker helps. All 184 B8 items are in-sample: the designer read "trunk" before building the ranker. n is 12 changed items, and the lexical grader missed a correct reply on "present" and "sound".
- "present" and "temper" show a specific failure mode: one overlapping word in a sense's example sentence, unrelated to the meaning, is enough to put that sense first. Here it changed no verdict, because e2b still read the sentence correctly. Row 19 allows dev iterations (at most 3) that change the scored text, the stemmer or the stopword list. **No iteration was made.** Whether to make one is left to the owner's delegate.
