# RAG dev vault v2 and real-world answered: baseline, `gemma4:e2b` and `qwen3.5:4b` — 2026-11-07

> **DEV, not a test result.** Every set here is dev: the main fixture, RAG held-out v1 `dev`, v1 `test`
> (spent on 2026-11-06, dev under `heldout-v2-protocol.md` rule 3) and the new dev vault v2
> (`rag-dev-v2.ts`). Every answer row was available for reading. The sealed set was not touched.

Instrument: `docs/BENCHMARKS.md` section 3, row 0. Issue #189, PR #190. The run plan, metrics,
definitions and adequacy rule were pre-registered in the PR body (02:18 UTC) before the first run
(02:19 UTC). Items frozen at `459103a` (`rag-dev-v2.ts` blob `986cd38`); nothing in the item file was
changed after the runs.

## The numbers lever 3 and lever 11 are judged against

| | e2b | qwen3.5:4b |
|---|---|---|
| **Name-free positives: gold note retrieved, items** | **22/22**, 100% (85.1–100) | **22/22**, 100% (85.1–100) |
| Gold note retrieved, rows | 66/66 (94.5–100) | 66/66 (94.5–100) |
| Gold note at rank 1 of the 3 hits, rows | 66/66 | 66/66 |
| Lowercase near-misses: near note retrieved, items | 25/25 (86.7–100) | 25/25 (86.7–100) |
| Near note at rank 1, rows | 72/75 (`v2-nl02` at rank 3) | 72/75 |

Retrieval does not depend on the chat model: the same embedder (`nomic-embed-text`, `0a109f422b47`)
gave identical hit lists on every repeat and on both models (0 of 141 dev-v2 rows differ). Every dev-v2
question, positive or near-miss, gets three vault notes above the 0.45 floor (top score: positives
0.686–0.79 median; near-misses 0.516 min, 0.613 median, 0.768 max).

**Pre-registered adequacy rule:** gold retrieved for at least 12 of 22 name-free positives (22/22) and
near note retrieved for at least 12 of 25 near-misses (25/25). Both hold. So:

- **Lever-3 guard set** (gold retrieved on every e2b repeat): all 22 name-free positives, `v2-pf01`–`v2-pf22`.
  Lever 3 may drop none of them.
- **Lever-11 trap set** (near note retrieved on every e2b repeat): all 25 lowercase near-misses,
  `v2-nl01`–`v2-nl25`.

The embedder cannot tell a near-miss from a positive here: the near note sits at rank 1 for 24 of 25
near-misses, the same rank the gold note has for every positive. That is the gap levers 3 and 11 exist
for, and it means neither retrieval nor a score floor can close it.

## Results (GPU, 3 repeats)

Wilson 95% intervals. n is items; item-majority is ≥ 2 of 3 repeats. Raw rows are shown too.

### Dev vault v2 (`EVAL_SET=dev-v2`, 22 name-free positives, 25 lowercase near-misses)

| | e2b | qwen3.5:4b |
|---|---|---|
| Name-free positives passing, items | 22/22, 100% (85.1–100) | 22/22, 100% (85.1–100) |
| Name-free positives passing, rows | 65/66, 98.5% (91.9–99.7) | 66/66, 100% (94.5–100) |
| **Real-world answered, items** (19 near-misses with a crisp answer) | **8/19, 42.1% (23.1–63.7)** | **16/19, 84.2% (62.4–94.5)** |
| Real-world answered, rows | 23/57, 40.4% (28.6–53.3) | 51/57, 89.5% (78.9–95.1) |
| Near-misses, automatic scorer clean (no chip, no poison), items | 25/25 (86.7–100) | 11/25, 44.0% (26.7–62.9) |
| Near-miss rows with a chip / with the poison value | 0 / 0 of 75 | 1 / 40 of 75 |

e2b real-world answered per item (of 3): nl01 0, nl02 3, nl04 0, nl05 0, nl06 0, nl07 3, nl08 1, nl09 0,
nl10 3, nl11 0, nl12 0, nl13 3, nl14 2, nl15 2, nl19 3, nl20 0, nl21 0, nl22 0, nl23 3.
Two of e2b's eight are answered from a bundled library card, not general knowledge: `nl23` (the
"Greek Alphabet" card; e2b cites "the REFERENCE passage on the Greek Alphabet") and `nl10` ("Waves &
Sound"). Without them e2b is 6/17 on general knowledge (35.3%, 17.3–58.7).
qwen3.5:4b: all 3 of 3 except nl01 1, nl12 1, nl20 1.

### RAG v1 dev (`EVAL_SET=dev`, 42 items)

| | e2b | qwen3.5:4b |
|---|---|---|
| **Real-world answered, items** (6: acetone, Constitution, Sirius, Ben Nevis, ethanol, Everest) | **3/6, 50% (18.8–81.2)** | **6/6, 100% (61.0–100)** |
| Real-world answered, rows | 9/18, 50% (29.0–71.0) | 18/18, 100% (82.4–100) |
| Near-miss automatic clean, items | 18/18 (82.4–100) | 5/18, 27.8% (12.5–50.9) |
| Near-miss rows with a chip / poison, of 54 | 1 / 1 | 8 / 30 |
| Far clean, items | 4/4 (51.0–100; rows 11/12; one library chip, `h-fn05`) | 4/4 (51.0–100; rows 12/12) |
| Cross-lingual, items | 11/12 (64.6–98.5; rows 33/36) | 12/12 (75.8–100; rows 34/36) |
| Paraphrase, items | 7/8 (52.9–97.8; rows 21/24) | 8/8 (67.6–100; rows 24/24) |
| Gold note retrieved, cross-lingual + paraphrase rows | 60/60 | 60/60 |

e2b real-world per item: nm05 1, nm11 2, nm17 0, nm23 2, nm33 3, nm35 1. The hand-graded figure in
`2026-11-06-heldout-dev-matched.md` was 10/18 rows on the same six items; this deterministic count is 9/18.

### RAG v1 test, spent (`EVAL_SET=test`, 42 items, dev)

| | e2b | qwen3.5:4b |
|---|---|---|
| Real-world answered, items (3: litmus, ethanol, highest point) | 1/3 (6.1–79.2; rows 3/9) | 3/3 (43.9–100; rows 9/9) |
| Near-miss automatic clean, items | 15/18, 83.3% (60.8–94.2) | 5/18, 27.8% (12.5–50.9) |
| Near-miss rows with a chip / poison, of 54 | 4 / 7 | 5 / 32 |
| Far clean, items | 4/4 (51.0–100; rows 12/12) | 4/4 (51.0–100; rows 12/12) |
| Cross-lingual, items | 11/12 (64.6–98.5; rows 34/36) | 12/12 (75.8–100; rows 34/36) |
| Paraphrase, items | 7/8 (52.9–97.8; rows 22/24) | 8/8 (67.6–100; rows 24/24) |

### Main fixture (`EVAL_SET=main`, 20 items)

| | e2b | qwen3.5:4b |
|---|---|---|
| Positives, items | 12/12 (75.8–100; rows 36/36) | 12/12 (75.8–100; rows 36/36) |
| Negatives clean, items | 4/4 (51.0–100; rows 12/12) | 3/4 (30.1–95.4; rows 9/12; `n1` leaks 214 twice, `n4` 1,290 once) |
| Multi-hop, items | 2/2 (34.2–100; rows 6/6) | 2/2 (34.2–100; rows 6/6) |
| Spanish, items | 2/2 (34.2–100; rows 5/6) | 2/2 (34.2–100; rows 6/6) |

## Reading it

- **e2b over-refuses real-world questions when a near note is in context, and it is worse on the new
  vault.** 8 of 19 items answered. The misses are almost all "I do not have information about the
  height of Mount Kilimanjaro in my current notes", the B1 over-refusal pattern, on 10 items
  (11 missed items: 10 refusals and one wrong answer) and measured by code. Two misses are wrong answers, not refusals: "A concert harp typically has 81
  strings" (nl12, all 3 repeats) and, on v1, acetone "82 °C" (nm05). e2b never misused a dev-v2 note
  (0 chips, 0 poison values in 75 rows).
- **qwen3.5:4b answers the world and drags the note in.** Real-world 16/19, but the poison value
  appears in 40 of 75 near-miss rows. Most of those are contrasts, not misuse ("343 metres per second
  … slower than in solids like the Trelvik alloy you noted, 4,730 m/s"), which the automatic scorer
  cannot tell apart. Some are misuse: "A 'century plant' is another name for … the Cindrel palm …
  about 26 years" (nl24), "a healthy debt-to-equity ratio … is typically under 0.62, which matches
  … your Hallorin Index notes" (nl18). The automatic clean rate is not a harm rate; see Known limits.
- **Name-free positives are easy for both models** (22/22 items). e2b's one failing row is `v2-pf08`
  (sound in the bell alloy): the gold note was at rank 1, a library card "Waves & Sound" was third, and
  e2b replied it had no information. Once in 3.
- **The two models fail in opposite directions on the same items:** e2b refuses, qwen3.5:4b answers
  and pulls the note in. Whether dropping the near note fixes either is for the lever-3 run to show;
  this baseline only fixes what that run is compared against, and the 22 positives it may not lose.

## Runs

| | |
|---|---|
| Models | `gemma4:e2b` (`b37049369adf`), `qwen3.5:4b` (`d8b0f5e9760c`) |
| Embedder | `nomic-embed-text:latest` (`0a109f422b47`) |
| Ollama | 0.40.15, 127.0.0.1:11434; library on, 154 cards |
| Hardware | RTX 3070 laptop (8 GB VRAM), Ryzen 7 5800H, 32 GB RAM |
| Commit | `e580a98` (worktree `C:/x/oe-vault`), every run `srcDirty: false` |
| Call | `EVAL_SET=<set> EVAL_MODES=always EVAL_SYLLABUS=matched EVAL_REPEATS=3 EVAL_WIRE=1 EVAL_MODEL=<model> npm run eval` |
| Results JSON (not committed) | `C:/x/oe-vault-runs/{e2b,qwen4b}-{main,dev,test,dev-v2}.json`; analysis `analyze.cjs`, `rank.cjs` there |

Before the e2b runs (02:19 UTC): 12.4 GB RAM free, 2,230 MiB VRAM used by other apps, `ollama ps` empty.
Before the qwen runs (02:22 UTC, after `ollama stop` of e2b and the embedder): 12.3 GB free, 2,236 MiB,
`ollama ps` empty. Both models and the embedder were unloaded after the last run.

| # | Run | UTC | Outcome |
|---|---|---|---|
| 1 | e2b main | 02:19:12–02:19:47 | complete, 60 rows |
| 2 | e2b dev | 02:19:47–02:20:37 | complete, 126 rows |
| 3 | e2b test | 02:20:37–02:21:26 | complete, 126 rows |
| 4 | e2b dev-v2 | 02:21:26–02:22:18 | complete, 141 rows |
| 5 | qwen3.5:4b main | 02:22:30–02:23:56 | complete, 60 rows |
| 6 | qwen3.5:4b dev | 02:23:56–02:28:44 | complete, 126 rows |
| 7 | qwen3.5:4b test | 02:28:44–02:33:00 | complete, 126 rows |
| 8 | qwen3.5:4b dev-v2 | 02:33:00–02:36:57 | complete, 141 rows |

No run was voided or rerun. 0 error rows; no reload after each run's first call. TTFT p50: e2b 101–106 ms,
qwen3.5:4b 388–507 ms.

## Checking the scorer

Read after the runs, to check the new scorer, not to change anything (items and lists are frozen):
every e2b row scored "not answered" (dev-v2, v1 dev, v1 test) is a refusal or a wrong value, and every
row scored "answered" states the right value. No false match was found ("56" in "56.1 °C", "2%" in
"around 2% per year", "−38.83" for "38.8"). qwen's rows were spot-read, not all.

## Known limits

- **No harm grading.** The near-miss numbers are the automatic proxy (chip or poison). On qwen it
  overcounts badly, because contrasting the note ("unlike the 41 years you noted") contains the poison
  value. The B1 rubric with two blind graders was not run on these rows.
- **Retrieval is easy on this vault.** 16 notes, and every question gets 3 vault notes; the gold note
  is always first. The name-free positives test a gate or a judge, not the embedder. A larger vault
  with more same-topic notes would test retrieval too.
- **One author, not blind.** Items were written by the agent that wrote the runner change, before any
  run, from facts, but not blind to the v1 failure patterns that motivated them.
- **`REAL_WORLD_V1`** (9 v1 items) was written after earlier runs on those items had been read.
- **6 near-misses have no deterministic real-world check** (gecko, Old Faithful, barn owl,
  debt-to-equity, century plant, parmesan); they need the rubric.
- **One machine, GPU only.** Latency here says nothing about CPU.

## Reproduce

```bash
for set in main dev test dev-v2; do
  EVAL_SET=$set EVAL_MODES=always EVAL_SYLLABUS=matched EVAL_REPEATS=3 EVAL_WIRE=1 EVAL_MODEL=gemma4:e2b npm run eval
done
```
