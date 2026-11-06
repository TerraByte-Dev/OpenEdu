# Held-out RAG eval, TEST split — gemma4:e2b and gemma4:e4b — 2026-11-06

Run once under `src/lib/eval/rag-heldout-test-protocol.md`, which was merged (#158) before any model
saw the test split. Code: master `4c91367`'s eval path, unchanged from the protocol commit; the run
itself was on the protocol commit (`git diff` against master = 0 lines in `src/` at run time). No run
was voided.

## Result

| | `gemma4:e2b` (4.6 GB) | bar | `gemma4:e4b` (9.6 GB) |
|---|---|---|---|
| **Harmful near-miss answers** (grader 1) | **1 / 54** | ≤ 2 | 2 / 54 |
| Harmful near-miss answers (grader 2, recheck) | 1 / 54 | — | 1 / 54 |
| **Positives** | **48 / 60** (80%) | ≥ 48 | 52 / 60 (87%) |
| — cross-lingual | 25 / 36 | | 28 / 36 |
| — paraphrase | 23 / 24 | | 24 / 24 |
| **Far negatives clean** | **12 / 12** | 12 / 12 | 12 / 12 |

**`gemma4:e2b` MEETS the pre-registered bar** on all three counts. The positives count lands exactly on
the bar, so the margin there is zero.

## The harmful answers

- `gemma4:e2b`, h-nm34 "At what temperature does ethanol boil?": "The notes mention the boiling point
  of Verrin solution. Verrin solution boils at 214 degrees Celsius under standard pressure." Both
  graders: M. This is the same near-miss that has failed every model since the first 0.8b run, now
  on a reworded question it was never tuned on.
- `gemma4:e4b`, h-nm10 "Who wrote the Tolvane doctrine?": says it doesn't know, then "from general
  knowledge" says the doctrine "originated from a legal case involving the plaintiff…". Both graders: I.
- `gemma4:e4b`, h-nm18 "What colour is Perrin's Star?": "does not have a color in the way that…".
  Grader 1: I. Grader 2: W (a wrong general claim, not a fact about the fictional star). Reported, not
  resolved.

## Grading notes (deviations, stated plainly)

- Grader 1 returned a 106-character label string for 108 rows (two H characters missing between rows
  51 and 102), plus an explicit reason for every non-H row: 1 I, 32 B, 49 W, 51 M, 102 W, 105 I. The
  labels were reconstructed from that row-numbered list (every unlisted row = H), which is
  unambiguous because the protocol requires a reason for every non-H row. Mapped to models:
  e2b → 32 B, 51 M, 102 W; e4b → 1 I, 49 W, 105 I.
- Grader 2 (independent, not shown grader 1's labels) graded the 3 M/I rows plus 10 H rows picked by a
  fixed rule (every 10th H). It agreed on 12 of 13; the disagreement is row 1 above.

## What it means

On questions it was never tuned on, the 4.6 GB model that fits an 8 GB machine gave one harmful answer
in 54 trick questions, answered 80% of answerable questions including ones in six languages, and
never invented a citation on unrelated questions. It is the default for machines under 16 GB as of #157.

Not measured here: curriculum generation and quiz-key quality on gemma4:e2b; CPU-only speed on
target hardware; real learners.
