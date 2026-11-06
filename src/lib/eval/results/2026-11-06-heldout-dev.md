# Held-out RAG eval, dev split — qwen3.5:0.8b, gemma4:e2b, gemma4:e4b, and the quote check — 2026-11-06

The first runs on `rag-heldout.ts` (#152), questions written without looking at any gate. Dev split
only: 18 near-miss negatives, 4 far negatives, 12 cross-lingual positives (es/fr/hi/sw/ar/am), 8
English paraphrases = 42 items × 3 repeats, `retrieval: "always"`. The test split has not been run.

## Configuration

| | |
|---|---|
| Models | `qwen3.5:0.8b` (1.0 GB), `gemma4:e2b` (4.6 GB), `gemma4:e4b` (9.6 GB), all via Ollama, `think: false` |
| Embedder | `nomic-embed-text` |
| Context | 8192 |
| Hardware | RTX 3070 laptop (8 GB) / Ryzen 7 5800H; gemma4 partly offloaded to CPU |
| Commit | `exp/quote-check` @ `739c4b2` = #152 plus the runner `set` option in this PR and the quote check (off unless asked) |

## Automatic scorer (the pre-committed rule: a negative fails on any citation chip or any vault value)

| | near-miss clean | far clean | cross-lingual | paraphrase | positives |
|---|---|---|---|---|---|
| qwen3.5:0.8b | 35/54 | 12/12 | 20/36 | 22/24 | 42/60 (70%) |
| qwen3.5:0.8b + quote check | 37/54 | 12/12 | 24/36 | 17/24 | 41/60 (68%) |
| gemma4:e2b | 54/54 | 12/12 | 27/36 | 20/24 | 47/60 (78%) |
| gemma4:e4b | 42/54 | 12/12 | 30/36 | 24/24 | 54/60 (90%) |

Neither model meets the bar (≥80% positives and no failed negative).

## The automatic scorer is wrong on near-misses, in both directions

All 108 near-miss answers (both models, quote check off) were graded by an independent grader, blind
to which model wrote each answer and shuffled. A single grader (Claude, a separate instance from
the one that wrote the fixture), so treat the split as an estimate, not a measurement.

Labels: **misused note**: the note's fact is presented as the answer, or the note is misquoted.
**Invented**: a made-up specific about a fictional entity is stated as fact. **Wrong general**:
a real-world fact stated wrongly, without misusing the note. **Honest**: says the notes don't hold
it, or answers a real-world question correctly from general knowledge.

| | misused note | invented | wrong general | honest | **harmful (misused + invented)** |
|---|---|---|---|---|---|
| qwen3.5:0.8b | 18 | 20 | 9 | 7 | **38/54 (70%)** |
| gemma4:e2b | 0 | 0 | 0 | 54 | **0/54 (0%)** |
| gemma4:e4b | 0 | 4 | 0 | 50 | **4/54 (7%)** |

How the automatic scorer compares with the grader:

| | scorer fail, harmful | scorer pass, **harmful** (missed) | scorer **fail**, honest (false alarm) | scorer pass, honest |
|---|---|---|---|---|
| qwen3.5:0.8b | 15 | **23** | 4 | 12 |
| gemma4:e4b | 1 | 3 | **11** | 39 |

- On 0.8b the scorer misses 23 harmful answers, because they invent a value instead of leaking a
  vault value: "invented by economist William E. O'Neil", "26.850 kg", "turns blue with iodide".
- On gemma4 11 of its 12 "failures" are honest refusals. The model says the notes do not answer and
  quotes what they do say ("your notes mention it turns orange with chloride, but not iodide"), so
  the n-gram detector shows a citation chip. The chip is technically accurate and looks like a source.
- gemma4's 4 harmful answers all say "I am answering from general knowledge" and then name an
  inventor for the fictional Wexler ratio or a colour for a fictional reagent.

gemma4:e2b was graded in a separate pass with the same rubric (54 rows, shuffled) and every label was
checked by hand. It is honest by refusing: on the 18 near-miss rows about real-world facts (Everest,
Ben Nevis, the US Constitution, Sirius, acetone, ethanol) it answered 5 and said "I do not have
information about … in the context provided" on 13. It will not tell a student the height of Everest
when a geography note is in the window. Safe, and unhelpful in a way a learner will notice.

**Conclusions.** The 1 GB model is not safe to tutor from notes: 7 in 10 answers to a near-miss
question misuse the note or invent. gemma4:e4b is honest on 50 of 54. gemma4:e2b, the only one of the three that fits an 8 GB machine, never misused
a note or invented a fact, but over-refuses general-knowledge questions and answers 78% of positives
(bar: 80%). The remaining gemma4:e4b problem a
student would see is a citation chip on a refusal, which is a display problem, not a model one.

## The quote check: no effect

Before answering, the model copies the sentence that answers, or returns an empty string; code keeps
a passage only if the copy is literally in it (code on `exp/quote-check`, not merged).

On 0.8b, **0 of 114 quote calls returned an empty string.** The model always copied a real
sentence, usually the note's headline fact whatever was asked ("Does it conduct electricity?" got the
boiling point), so code had to keep the passage. Grounding was removed on 3 of 54 near-miss rows.
Every difference in the table above is within repeat-to-repeat noise. A 0.8B model copies text
faithfully; it cannot judge whether the text answers the question, and that judgement is the job.
Not run on the test split.

## Other findings

- h-xl-hi01 and h-xl-ar01 retrieved nothing for either model. A fictional name transliterated into
  Devanagari or Arabic script matches neither the embedder nor the library ranker.
- gemma4:e2b answered h-xl-am03 in Amharic but wrote "orange" in Bengali or Greek letters all three
  times ("উজ্জ্বল কমলা"), so the scorer could not find the Amharic word. A script-mixing failure, not a
  grounding one.
- Cross-lingual positives: 0.8b 56%, gemma4:e2b 75%, gemma4:e4b 83%. The main fixture's two Spanish items overstated all three.

## Reproduce

```js
await window.__runRagEval({ set: "dev", modes: ["always"], repeats: 3 })
// quote check: branch exp/quote-check, add quoteCheck: true
```
