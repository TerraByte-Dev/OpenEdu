# Held-out RAG eval, dev split, matched course — six small models — 2026-11-06

Follow-up to `2026-11-06-heldout-dev.md`. That run enrolled the learner in the tool-golden "Python
Basics" syllabus while the notes are about geography, chemistry and economics, and the most
instruction-following model refused real-world questions as off-syllabus. This run uses
`syllabus: "matched"`, a "General Studies" course that covers the vault's subjects, for every model.

## Configuration

| | |
|---|---|
| Call | `runRagEval({ set: "dev", modes: ["always"], repeats: 3, syllabus: "matched" })` |
| Items | 42 dev items × 3: 54 near-miss, 12 far, 36 cross-lingual, 24 paraphrase answers per model |
| Hardware | RTX 3070 laptop (8 GB), Blender holding ~1.5 GB VRAM for part of the run |
| Ollama | 0.40.15; `phi4-mini` and `qwen3.5:2b` ran with the generation cap from #155, the other four before it |
| Commit | `feat/rag-matched-syllabus` (master + the `syllabus` option) |

## Result

| model | on disk | **harmful near-miss** | broken | positives | cross-lingual | far clean |
|---|---|---|---|---|---|---|
| `qwen3.5:0.8b` | 1.0 GB | **33 / 54** | 0 | 40/60 (67%) | 18/36 | 12/12 |
| `phi4-mini` | 2.5 GB | **9 / 54** | 22 / 54 | 35/60 (58%) | 14/36 | 12/12 |
| `qwen3.5:2b` | 2.7 GB | **18 / 54** | 0 | 49/60 (82%) | 25/36 | 12/12 |
| `qwen3.5:4b` | 3.3 GB | **9 / 54** | 0 | 54/60 (90%) | 30/36 | 12/12 |
| `gemma4:e2b` | 4.6 GB | **1 / 54** | 0 | 50/60 (83%) | 27/36 | 12/12 |
| `gemma4:e4b` | 9.6 GB | **0 / 54** | 1 / 54 | 54/60 (90%) | 30/36 | 12/12 |

**Harmful** = the note misused (M) or a fact invented (I), by a blind grader using the rubric in
`rag-heldout-test-protocol.md`. Answers were pooled, model names removed and shuffled. The 0.8b,
4b, e2b and e4b answers were graded together (216 rows, two batches); 2b and phi4-mini were graded
in separate passes. One grader per answer, so treat each count as an estimate within a few rows.

## Reading it

- **`gemma4:e2b` is the only model under 9 GB that is both safe and useful.** Its one harmful answer:
  "Dalquist reagent turns a different colour in the presence of iodide", an inference the note does
  not support. It clears 80% on positives with the matched course (83%; 78% under the Python syllabus).
- **The course scope mattered for gemma4:e4b too.** Under the Python syllabus it invented 4 times
  (fictional inventors, "from general knowledge"); under the matched course, 0.
- **`qwen3.5:4b` is the most accurate model below 4 GB** (90% positives), but 1 in 6 trick questions
  gets a harmful answer: fictional inventors, made-up rotor weights, the assignment deadline given
  as the exam date.
- **`phi4-mini` cannot use this harness.** 0 real tool calls in 126 turns: it writes tool calls as
  plain text (`library.lookup dataset="economics" query="Wexler ratio"`), and that text becomes the
  answer. One loop of fake tool-call JSON ran to the #155 cap (~40,000 characters).
- **`qwen3.5:2b` answers well and invents often**: "a monument built by Lord Ruthven in 1767",
  "Professor Robert Wexler".
- **`qwen3.5:0.8b`**: 33 of 54 harmful, plus 12 real-world facts stated wrongly. Not a tutor.

## What changed in gemma4:e2b's over-refusal

With the Python syllabus it answered 5 of 18 real-world near-miss questions (Everest, Ben Nevis, the
US Constitution, Sirius, acetone, ethanol). With the matched course, 10 of 18 (Constitution 0 → 3 of
3). It still says "I do not have the height of Ben Nevis in my current notes" when a geography note is
loaded, though with no notes it answers 1,345 m. Rewording the grounding instruction made this worse
and introduced inventions, so it was reverted (not committed).

## Reproduce

```js
await window.__runRagEval({ set: "dev", modes: ["always"], repeats: 3, syllabus: "matched" })
```
