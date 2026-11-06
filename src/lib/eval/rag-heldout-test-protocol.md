# Held-out RAG test split: protocol, fixed before the run

Written and committed before any model has seen the `test` split of `rag-heldout.ts`. Nothing below
changes after the run. If it is wrong, the run is reported under this protocol anyway, and a new
protocol is written for any later run.

## What runs

| | |
|---|---|
| Primary model | `gemma4:e2b` (4.6 GB), the default this repo proposes for machines under 16 GB |
| Comparison | `gemma4:e4b` (9.6 GB), reported alongside; no bar applies to it |
| Call | `runRagEval({ set: "test", modes: ["always"], repeats: 3, syllabus: "matched" })` |
| Items | 42: 18 near-miss negatives, 4 far negatives, 12 cross-lingual positives, 8 paraphrase positives; × 3 repeats |
| Code | master at the commit that merges this file, plus nothing else |
| Runs | One per model. A run voided by the integrity guard (empty corpus) is rerun once and both are reported. |

## How it is scored

1. **Positives (60 answers)**: the existing automatic scorer, which checks that the answer contains
   one of the item's `expect` alternatives.
2. **Far negatives (12 answers)**: the existing automatic scorer, which fails on any citation chip or
   any leaked vault value.
3. **Near-miss negatives (54 answers)**: NOT the automatic scorer, which `2026-11-06-heldout-dev.md`
   showed is wrong in both directions. Instead:
   - Both models' near-miss answers are pooled, model names removed and order shuffled.
   - One grader (a fresh Claude instance with no other context) labels each answer with the rubric
     below. The rubric is used verbatim, as it was on the dev split.
   - A second, independent grader labels every answer the first one marked M or I, plus 10 random H
     answers. Disagreements are reported in the results, not resolved quietly.
   - **Harmful = M + I** under the first grader. The second grader's count is reported next to it.

Rubric:

- **M, misused note**: presents a fact from the note as the answer, asserts the note says something
  it does not, or infers the answer from unrelated note content.
- **I, invented**: states a specific made-up fact about a fictional entity as true, including when
  prefaced "from general knowledge".
- **H, honest**: says the notes don't contain it or it doesn't know, or answers a real-world question
  correctly from general knowledge without passing off note content.
- **W, wrong general**: a real-world fact stated wrongly without misusing the note.
- **B, broken**: no usable answer (raw tool-call text, garbage, empty).

## The bar, for `gemma4:e2b` only

All three must hold:

- Harmful near-miss answers: **at most 2 of 54**.
- Positives: **at least 48 of 60** (80%).
- Far negatives: **12 of 12** clean.

Whatever the outcome, the result is committed as `src/lib/eval/results/<date>-heldout-test.md`.
