# Drop the passages on a notes-miss turn (lever 9f) — RAG blind set + dev + probe under the product-course prompt — `gemma4:e2b`, `gemma4:e4b` — 2026-11-09

> **RUN 2026-11-09 at `a03674b`. Blind gate (e2b): FIRES on positives (−5 against 9e), so `not-shipped`.
> Independently, a pre-merge review found a real-student regression that blocks shipping on its own.**
> Where 9f hid the passages, e2b stopped borrowing: on the 48-item blind near-miss set, 0 vault values and
> 0 citation chips in 144 answers, and real-world answers rose from 1 to 31 of 48 items against no note.
> But the trigger it rests on (9e's frozen lexical extractor) fired on 5 of 48 fresh positives. 9f hid the
> right note on all five and e2b failed all 15 of their answers. The review then showed the same trigger
> firing on ordinary student questions ("What is the formula for kinetic energy?", "When did WW2 end?",
> "What is photosythesis?"), which no eval set here can measure.
>
> **Blind, not held out.** The gate set was written by a fresh agent after 9f was frozen and pre-registered.
> It is still a model's idea of student questions. Dev and the probe are in-sample for 9f's 3-word cut and
> are descriptive only. Nothing under the sealed set was opened. **Not on master:** the lever is on branch
> `feat/lookup-drop-passage` (PR #224, draft, `not-shipped`), stacked on #222.

Lever (PR #224, issue #204): on a `fact-lookup` turn where lever 9e's notes-miss switch fires (no shown
passage contains every content word of the asked-about phrase) and the phrase has at most 3 words
(`NOTES_DROP_MAX_WORDS`), the grounding block is not put in front of the student's message, and the note is
`notesDropNote`: FACT_LOOKUP_LEAD, then *"The student's notes do not mention "<phrase>"."*, then 9e's last
four sentences. Longer phrases keep 9e's behaviour. No model call is added.

The pre-registration is the section "Pre-registration" in the body of
[PR #224](https://github.com/TerraByte-Dev/OpenEdu/pull/224) (posted 08:51Z, before the blind set
existed), plus its dated sections at 09:00Z (the set, pins, thresholds, the declared token regrade) and
09:08Z (review findings and clarifications, posted before any blind result was read). They are the
canonical text; the summary below does not replace them.

## Plan (from the pre-registration)

| | |
|---|---|
| Models | `gemma4:e2b` (the rule applies), then `gemma4:e4b` (reported, not applied) |
| Arms | **B** `EVAL_TURN_NOTES=off` (no note: what master sends). **N** `EVAL_NOTES_DROP=off` (lever 9e). **D** none set (lever 9f). Same commit |
| Call | `EVAL_SET=<set> EVAL_PROMPT=product-course EVAL_MODES=always EVAL_SYLLABUS=matched EVAL_REPEATS=3 EVAL_WIRE=1 EVAL_MODEL=<model> [EVAL_TURN_NOTES=off \| EVAL_NOTES_DROP=off] npm run eval` |
| Order | per model: B, N, D on `blind-9f`; then `dev-v2`, `dev`, `probe-v2`, `probe-v1` (descriptive) |
| Unit | item-majority (≥ 2 of 3; ERROR = fail), Wilson 95%, paired exact two-sided McNemar on items; rows beside items |
| Gate set | `blind-9f`: 16 invented notes, 48 positives, 48 near-misses (each with a real-world `expect`), sha256 `2debb427…e07c48` |

Rule (verbatim): "Do not ship (label `not-shipped`, keep as draft) if, on gemma4:e2b under product-course
rules, on blind-9f: near-miss items clean in D lose 2 or more against B; or near-miss items clean in D are
fewer than in N; or positives passing in D lose 3 or more items against N; or positives passing in D are
fewer than in B; or real-world answered items in D lose 3 or more against N; or real-world answered items in
D do not exceed B by at least a quarter of the near-miss items with an expect (rounded up); or any model call
is added."

## Runs

| | |
|---|---|
| Commit | **`a03674b`**, the PR head at run time; `srcDirty: false` on every scored run; `git status` empty at every scored run's start |
| Checkout | worktree `C:/x/oe-drop` on `feat/lookup-drop-passage`, its own `node_modules` |
| Models | `gemma4:e2b`, `gemma4:e4b`; embedder `nomic-embed-text:latest`; Ollama on 127.0.0.1:11434; RTX 3070 laptop (8 GB VRAM), 32 GB RAM |
| Before each model | `ollama ps` empty; e2b 17.57 GB free RAM, 1,299 MiB VRAM in use (restart after the excluded run: 17.61 GB, 1,265 MiB); e4b 17.54 GB, 1,265 MiB. After each, `ollama stop` was issued for both models (after e4b the embedder was still "Stopping..." when logged) |
| Results JSON (not committed) | `C:/x/oe-drop-runs/<model>-<set>-<arm>-a<n>.json` and `.stdout.txt`; driver `drive.sh`, log `drive.log`; `check.cjs` (void checks), `analyze.cjs` (rule, grades, descriptive; `GRADE=token` for the declared regrade) |

| Run | Arm | Commit | srcDirty | Rows | ERROR | notes-miss / notes-drop rows | UTC |
|---|---|---|---|---|---|---|---|
| `gemma4_e2b-blind-9f-B-a1` | B | `a03674b` | false | 288 | 0 | 0 / 0 | 09:01:16–09:03:14 |
| `gemma4_e2b-blind-9f-N-a1` | N | `a03674b` | false | 288 | 0 | 123 / 0 | 09:03:18–09:04:54 |
| `gemma4_e2b-blind-9f-D-a1` | D | `a03674b` | true | 288 | 0 | 3 / 120 | 09:04:57–09:06:35 | **excluded (dirty)**
| `gemma4_e2b-blind-9f-D-a2` | D | `a03674b` | false | 288 | 0 | 3 / 120 | 09:07:18–09:08:59 |
| `gemma4_e2b-dev-v2-B-a1` | B | `a03674b` | false | 141 | 0 | 0 / 0 | 09:09:03–09:10:07 |
| `gemma4_e2b-dev-v2-N-a1` | N | `a03674b` | false | 141 | 0 | 66 / 0 | 09:10:11–09:11:01 |
| `gemma4_e2b-dev-v2-D-a1` | D | `a03674b` | false | 141 | 0 | 3 / 63 | 09:11:05–09:11:55 |
| `gemma4_e2b-dev-B-a1` | B | `a03674b` | false | 126 | 0 | 0 / 0 | 09:11:59–09:13:06 |
| `gemma4_e2b-dev-N-a1` | N | `a03674b` | false | 126 | 0 | 21 / 0 | 09:13:10–09:14:05 |
| `gemma4_e2b-dev-D-a1` | D | `a03674b` | false | 126 | 0 | 0 / 21 | 09:14:09–09:15:04 |
| `gemma4_e2b-probe-v2-B-a1` | B | `a03674b` | false | 177 | 0 | 0 / 0 | 09:15:08–09:16:30 |
| `gemma4_e2b-probe-v2-N-a1` | N | `a03674b` | false | 177 | 0 | 87 / 0 | 09:16:34–09:17:41 |
| `gemma4_e2b-probe-v2-D-a1` | D | `a03674b` | false | 177 | 0 | 6 / 81 | 09:17:45–09:18:52 |
| `gemma4_e2b-probe-v1-B-a1` | B | `a03674b` | false | 57 | 0 | 0 / 0 | 09:18:56–09:19:21 |
| `gemma4_e2b-probe-v1-N-a1` | N | `a03674b` | false | 57 | 0 | 27 / 0 | 09:19:25–09:19:45 |
| `gemma4_e2b-probe-v1-D-a1` | D | `a03674b` | false | 57 | 0 | 3 / 24 | 09:19:49–09:20:10 |
| `gemma4_e4b-blind-9f-B-a1` | B | `a03674b` | false | 288 | 0 | 0 / 0 | 09:20:16–09:25:47 |
| `gemma4_e4b-blind-9f-N-a1` | N | `a03674b` | false | 288 | 0 | 123 / 0 | 09:25:51–09:29:43 |
| `gemma4_e4b-blind-9f-D-a1` | D | `a03674b` | false | 288 | 0 | 3 / 120 | 09:29:48–09:33:41 |
| `gemma4_e4b-dev-v2-B-a1` | B | `a03674b` | false | 141 | 0 | 0 / 0 | 09:33:45–09:36:32 |
| `gemma4_e4b-dev-v2-N-a1` | N | `a03674b` | false | 141 | 0 | 66 / 0 | 09:36:36–09:38:37 |
| `gemma4_e4b-dev-v2-D-a1` | D | `a03674b` | false | 141 | 0 | 3 / 63 | 09:38:40–09:40:46 |
| `gemma4_e4b-dev-B-a1` | B | `a03674b` | false | 126 | 0 | 0 / 0 | 09:40:50–09:43:31 |
| `gemma4_e4b-dev-N-a1` | N | `a03674b` | false | 126 | 0 | 21 / 0 | 09:43:35–09:45:42 |
| `gemma4_e4b-dev-D-a1` | D | `a03674b` | false | 126 | 0 | 0 / 21 | 09:45:46–09:48:01 |
| `gemma4_e4b-probe-v2-B-a1` | B | `a03674b` | false | 177 | 0 | 0 / 0 | 09:48:05–09:51:40 |
| `gemma4_e4b-probe-v2-N-a1` | N | `a03674b` | false | 177 | 0 | 87 / 0 | 09:51:43–09:54:23 |
| `gemma4_e4b-probe-v2-D-a1` | D | `a03674b` | false | 177 | 0 | 6 / 81 | 09:54:28–09:57:08 |
| `gemma4_e4b-probe-v1-B-a1` | B | `a03674b` | false | 57 | 0 | 0 / 0 | 09:57:12–09:58:24 |
| `gemma4_e4b-probe-v1-N-a1` | N | `a03674b` | false | 57 | 0 | 27 / 0 | 09:58:28–09:59:20 |
| `gemma4_e4b-probe-v1-D-a1` | D | `a03674b` | false | 57 | 0 | 3 / 24 | 09:59:24–10:00:18 |

**Excluded run.** The first e2b blind D run (09:04:57Z) started while the independent reviewer's untracked
scratch test sat in `src/lib/kernel/`, so it recorded `srcDirty: true` and the driver stopped. No app code
changed. It is kept (`gemma4_e2b-blind-9f-D-a1.json`) and not scored. Both models were unloaded and D rerun as
attempt 2. The cause was Claude's brief, which told the reviewer scratch files were fine in the run's own
worktree. The driver now refuses to start a run on a dirty worktree.

**Process slip.** The model runs started before the independent pre-run code review that #222 had. The
review began after the runs. Its regression finding (below) was posted to the PR at 09:08Z, before any blind
result was read.

**No void.** Every scored run: all rows, 0 ERROR, `turnKind` = pins ×3, D's fired items equal N's on every
set (blind 41 items on both models). Every run exited 0.

## Results

### The gate: gemma4:e2b, blind-9f (applied literally)

| Clause | B (master) | N (9e) | D (9f) | Reading | Threshold | Verdict |
|---|---|---|---|---|---|---|
| Near-miss clean, items (48), D vs B | 48/48, 100% (92.6–100) | 47/48, 97.9% (89.1–99.6) | 48/48, 100% (92.6–100) | k_B − k_D = 0 (b/c 0/0) | ≥ 2 blocks | pass |
| Near-miss clean, D vs N | | 47 | 48 | k_D ≥ k_N (b/c 0/1) | k_D < k_N blocks | pass |
| **Positives passing, items (48), D vs N** | 3/48, 6.3% (2.1–16.8) | 43/48, 89.6% (77.8–95.5) | 38/48, 79.2% (65.7–88.3) | **k_N − k_D = 5** (b/c 5/0, p = 0.0625) | ≥ 3 blocks | **BLOCKS** |
| Positives passing, D vs B | 3 | | 38 | k_D ≥ k_B (b/c 0/35) | k_D < k_B blocks | pass |
| Real-world answered, items (48), D vs N | 1/48, 2.1% (0.4–10.9) | 28/48, 58.3% (44.3–71.2) | 31/48, 64.6% (50.4–76.6) | k_N − k_D = −3 (b/c 0/3) | ≥ 3 blocks | pass |
| Real-world answered, D vs B | 1 | | 31 | k_D − k_B = +30 (b/c 1/31, p < 0.0001) | needs ≥ 12 | pass |
| Added model call | turn calls = rows + tool calls; 0 structured | same | same | none added | any blocks | pass |

**The rule fires: `not-shipped`.** The declared token-boundary regrade gives the same numbers on every clause
and the same verdict. Rows: positives B 19/144, N 130/144, D 116/144; near-miss clean B 144/144, N 140/144,
D 144/144; real-world answered B 6/144, N 85/144, D 96/144; over-refusal (not answered + refusal phrase)
B 23/144, N 17/144, D 7/144.

| Blind near-miss rows (144 per arm) | B | N | D |
|---|---|---|---|
| Contain the vault value (any label) | 0 | 4 (`b9-tes-n2`, Everest, 3 of 3; `b9-pem-n1` 1) | **0** |
| Citation chip | 0 | 0 | 0 |

**Where the drop applied (e2b, blind):** 40 items, 120 rows (the 41st 9e fire, `b9-orc-n1` "van gogh paint
starry", has 4 words and kept 9e's behaviour).

| | Rows | Vault value D / N | Clean D / N | Real-world answered D / N | Pass D / N |
|---|---|---|---|---|---|
| Dropped near-misses | 105 | 0 / 3 | 105 / 102 | 89 / 79 | |
| Dropped positives | 15 | | | | **0 / 15** |

The five dropped positives are 9e's false fires on fresh questions: `b9-tes-p2` "mountain", `b9-tes-p3`
"black basalt peak", `b9-tar-p2` "mining town sport", `b9-fen-p2` "swapped", `b9-ter-p1` "tervish alphabet"
(the note is titled and written "Tervish Script").

**Noise floor.** On the 55 blind items 9e never fired on, D and N sent byte-identical requests
(`prompt_eval_count` delta 0 on all 165 of their rows) and disagreed on 1 item majority
(`b9-pem-n1`, an over-refusal flip). On dropped turns the prompt was 185 to 566 tokens shorter (median 359).
Rows whose answer says "general knowledge": B 11, N 1, D 2 (0 of the 120 dropped rows). Rows with a tool
call: B 20, N 2, D 5; none of the dropped rows called `notebook.search`.

### gemma4:e4b, blind-9f (reported, not applied)

| | B | N | D |
|---|---|---|---|
| Positives passing, items (48) | 34/48, 70.8% (56.8–81.8) | 45/48, 93.8% (83.2–97.9) | 41/48, 85.4% (72.8–92.8) |
| Near-miss clean, items (48) | 47/48, 97.9% | 48/48 | 48/48 |
| Real-world answered, items (48) | 11/48, 22.9% (13.3–36.5) | 35/48, 72.9% (59.0–83.4) | 40/48, 83.3% (70.4–91.3) |
| Near-miss rows with the vault value (144) | 10 | 3 | **0** |
| Dropped positive rows (15): pass | | 13 | 0 |

Read against the e2b rule, e4b would also be blocked: positives k_N − k_D = 4 (b/c 5/1). Every other clause
passes.

### Dev and probe (descriptive; in-sample for the 3-word cut)

Items, B / N / D. Vault-value rows are counted on their own, not behind the chip.

| | Positives passing | Near-miss clean | Real-world answered | Near-miss rows with the vault value |
|---|---|---|---|---|
| e2b dev (dev-v2 + v1 dev; 42 / 43 / 25 items; 129 rows) | 9 / 31 / 31 | 42 / 41 / 41 | 0 / 20 / 20 | 3 / 3 / 3 |
| e2b probe (38 / 40 / 23; 120 rows) | 6 / 36 / 35 | 38 / 35 / **39** | 0 / 14 / 13 | 8 / 15 / **2** |
| e4b dev | 31 / 40 / 41 | 38 / 41 / 41 | 7 / 20 / 21 | 14 / 7 / 7 |
| e4b probe | 29 / 38 / 35 | 36 / 39 / **40** | 2 / 18 / 17 | 18 / 5 / **0** |

Every pre-registered expectation held. 9f dropped on every 9e fire except the 3 long-phrase probe positives
and `v2-nl21`. It cost exactly the two synonym fires (`v2-pf04` "ridge" and `bp-cor-1` "peak": 0 of 6 dropped
rows pass on e2b). It dropped on all seven of #222's 9e near-miss failures (`v2-nl03`, `v2-nl24`,
`bn-pel-2`, `bn-hal-1`, `bn-cin-1`, `bn-cin-2`, `bn-wex-1`), and D gave their vault value 0 times on both models
(in this run, e2b's N gave it on six of them, all but `v2-nl03`; e4b's N on none). On dropped dev and probe near-miss
rows, e2b gave the vault value 0 times (9e on the same rows: 18). Every dev and probe vault-value row that
remains in D is on a row 9f did not drop (on e2b: `h-nm01`, which names the note's own entity, and
`bn-tre-2`). On dev, a few unfired rows differ in prompt tokens between D and N: on e2b two rows of the Amharic
item `h-xl-am01` (±59), on e4b `h-xl-ar01` (−67, twice) and `h-xl-am01` (+60). These are cross-lingual
items whose glossed retrieval returned different notes between runs, none with a tool call. That is not
a lever effect. No unfired probe row differs on either model. No call was added
in any set or model.

## The review's regression (blocks shipping on its own)

Claude reproduced each of these with the frozen extractor against a passage that answers the question. All
fire, and all parse to one word, so 9f would hide the passage and tell the model the notes do not mention it:

| Question | Parsed phrase | Why it fires |
|---|---|---|
| What is the formula for kinetic energy? | `formula` | a property-like head the extractor's list lacks |
| What's the difference between mitosis and meiosis? | `difference` | same |
| What are the three branches of government? | `government` | the passage says "legislative, executive and judicial" |
| What is photosythesis? | `photosythesis` | a typo |
| When did WW2 end? | `ww2` | an abbreviation ("World War II" in the notes) |
| What does the mitochondria do? | `mitochondria` | a later chunk that does not repeat its topic |

The extractor is never shown note titles, so any chunk that does not repeat its note's subject can fire.
Library REFERENCE cards are hidden the same way, and the note calls them "the student's notes". Every
note in these eval vaults is one short chunk that names its own subject, so no set here can measure this.
9e has the same false fires; it keeps the passages but tells the model they are about a different thing.

## What this settles

- **Removing the number works.** Hiding the passage is the first lever in this line to stop e2b borrowing:
  0 vault values on 105 dropped blind near-miss rows (9e: 3 on the same rows), 0 on 102 dropped probe rows
  (9e: 15).
- **The trigger is the limit, not the prompt or the passage.** The cost of 9f is exactly 9e's false fires,
  now made worse: a false fire hides the right note. On fresh questions that is 5 of 48 positives on e2b and
  4 of 48 on e4b. In real student text, with long chunked notes, it would be more.
- **The next idea, not started:** decide "is this passage about the asked thing" by meaning, not by words.
  Embed the parsed phrase once (no chat call), and compare it with each shown passage and its note's title.
  That needs its own pre-registration, a fresh blind set, and a vault of long, chunked, realistic notes, so
  that the failure the review found can be measured.
