# RAG runner prompt fidelity: stand-in vs the product's instructions, `gemma4:e2b` and `qwen3.5:4b` — 2026-11-08

> **DEV, not a test result.** Sets: dev vault v2 (`rag-dev-v2.ts`) and RAG held-out v1 `dev`. Every
> answer row was available for reading. The sealed set was not touched (`EVAL_PROMPT` is refused with it).

Issue #194, PR #196. Pre-registered in the PR body (PR opened 03:34:20 UTC) after the arm code was
committed (`b1e8f31`, 03:32:58 UTC) and before the first model run (03:35:26 UTC). CI green at `b1e8f31`.
Every run: commit `b1e8f31`, `srcDirty: false`.

**Verdict: no product arm meets the pre-registered rule. The runner keeps `standin`.** Per the rule, the
stand-in prompt is not what drives e2b's over-refusal: with the stand-in instructions removed
(`product-default`), e2b answered 29 of 75 real-world rows against 28 with them (the rule needed +6).
The run found a different problem, in the other direction: the stand-in's "Answer the student's question
directly and concisely" is doing work the product prompt does not do. Under the generated-course rules
block (`product-course`), e2b answered **2 of 22** name-free note questions it answers **22 of 22**
under the stand-in; it replies with a question instead.

## What the arms send

The full account of the app's prompt is in the PR body (section 1). In short, `buildSystemPrompt`'s
instructions slot gets:

| Arm | Identity | Pedagogy | Rules |
|---|---|---|---|
| `standin` (the runner's default, every B1 result so far) | "You are a helpful tutor." | "Answer the student's question directly and concisely." | "Be accurate. If you do not know something, say so." |
| `product-default` (a course with no stored instructions) | `DEFAULT_TUTOR_IDENTITY` | none | none |
| `product-course` (a generated course, minus its model-written pedagogy) | `DEFAULT_TUTOR_IDENTITY` | none | `TUTOR_RULES` (curriculum.ts) |

Everything else in the request is byte-identical between arms (`parity.test.ts`): syllabus ("matched"),
`explain` mode, output rules, tools manifest, and the `<context>` block in the user turn. No arm sends a
persona, and a real generated course would also carry its own model-written pedagogy and usually the
`sage` persona. Those are the main limits of this run.

## Decision rule (verbatim from the pre-registration)

> "Adopt a product arm as the RAG runner's default if, on e2b, its real-world answered rows rise by >= 6 over standin (dev-v2 + v1 dev combined) and name-free positives passing items do not fall. If no product arm meets it, the runner keeps standin and the docs record that the stand-in prompt is not what drives e2b's over-refusal."

| e2b | standin | product-default | product-course |
|---|---|---|---|
| Real-world answered rows, dev-v2 + v1 dev (clause 1, need ≥ +6) | 28/75 | 29/75 (**+1**, not met) | 1/75 (**−27**, not met) |
| Name-free positives passing, items (clause 2, must not fall) | 22/22 | 19/22 (**falls**) | 2/22 (**falls**) |
| Meets the rule | — | no | no |

## Results (Wilson 95%; n = items, item-majority ≥ 2 of 3 repeats; raw rows next to it)

### gemma4:e2b

| | standin | product-default | product-course |
|---|---|---|---|
| **Real-world answered, items (25)** | 9/25, 36.0% (20.2–55.5) | 10/25, 40.0% (23.4–59.3) | 0/25, 0% (0–13.3) |
| Real-world answered, rows (75) | 28/75, 37.3% (27.3–48.6) | 29/75, 38.7% (28.5–50.0) | 1/75, 1.3% (0.2–7.2) |
| … dev-v2 (19 items) | 7/19 (19.1–59.0); rows 22/57 | 6/19 (15.4–54.0); rows 19/57 | 0/19 (0–16.8); rows 0/57 |
| … v1 dev (6 items) | 2/6 (9.7–70.0); rows 6/18 | 4/6 (30.0–90.3); rows 10/18 | 0/6 (0–39.0); rows 1/18 |
| **Over-refusal rows** (not answered and a refusal phrase, of 75) | 42/75, 56.0% (44.7–66.7); items 14/25 | 30/75, 40.0% (29.7–51.3); items 11/25 | 13/75, 17.3% (10.4–27.4); items 4/25 |
| Not answered, no refusal phrase (rows of 75) | 5/75 | 16/75 | 61/75 |
| **Name-free positives passing, items (22)** | 22/22, 100% (85.1–100) | 19/22, 86.4% (66.7–95.3) | 2/22, 9.1% (2.5–27.8) |
| Name-free positives passing, rows (66) | 66/66 (94.5–100) | 53/66, 80.3% (69.2–88.1) | 10/66, 15.2% (8.4–25.7) |
| v1 dev cross-lingual, items (12) | 11/12 (64.6–98.5); rows 33/36 | 10/12 (55.2–95.3); rows 28/36 | 4/12 (13.8–60.9); rows 13/36 |
| v1 dev paraphrase, items (8) | 7/8 (52.9–97.8); rows 21/24 | 6/8 (40.9–92.9); rows 18/24 | 3/8 (13.7–69.4); rows 7/24 |
| Harm proxy, dev-v2 near-miss clean, items (25) | 25/25 (86.7–100); rows 75/75 | 24/25 (80.5–99.3); rows 73/75 | 24/25 (80.5–99.3); rows 73/75 |
| Harm proxy, v1 dev near-miss clean, items (18) | 18/18 (82.4–100); rows 53/54 | 18/18 (82.4–100); rows 53/54 | 17/18 (74.2–99.0); rows 49/54 |
| Near-miss rows with a chip / poison (dev-v2 75 + v1 dev 54) | 1 / 0 | 1 / 2 | 6 / 1 |
| v1 dev far negatives clean, items (4) | 4/4 (51.0–100); rows 12/12 | 4/4; rows 12/12 | 4/4; rows 12/12 |
| Gold note retrieved, positives (dev-v2 22 + v1 dev 20 items) | 42/42; rows 126/126 | 42/42; rows 126/126 | 42/42; rows 126/126 |

Paired vs standin (McNemar exact, two-sided):

| e2b | real-world items (25) | real-world rows, paired by (item, repeat) | name-free positive items (22) |
|---|---|---|---|
| product-default | 3 lost / 4 gained, p = 1.00 | 13 / 14, p = 1.00 | 3 / 0, p = 0.25 |
| product-course | 9 / 0, p = 0.004 | 27 / 0, p < 0.0001 | 20 / 0, p < 0.0001 |

Per item, real-world answered of 3 (standin / product-default / product-course): nl01 0/0/0, nl02 2/2/0,
nl04 0/1/0, nl05 0/0/0, nl06 0/1/0, nl07 3/0/0, nl08 1/0/0, nl09 0/0/0, nl10 3/3/0, nl11 0/0/0,
nl12 0/0/0, nl13 3/1/0, nl14 2/3/0, nl15 1/2/0, nl19 3/0/0, nl20 0/0/0, nl21 0/0/0, nl22 1/3/0,
nl23 3/3/0; h-nm05 2/2/1, h-nm11 1/3/0, h-nm17 0/1/0, h-nm23 0/0/0, h-nm33 3/2/0, h-nm35 0/2/0.

The standin arm here (28/75) is the same configuration as the #190 baseline (32/75 at `e580a98`); the
gap is within sampling.

### qwen3.5:4b (reported, not applied)

| | standin | product-default | product-course |
|---|---|---|---|
| Real-world answered, items (25) | 24/25, 96.0% (80.5–99.3) | 23/25, 92.0% (75.0–97.8) | 23/25, 92.0% (75.0–97.8) |
| Real-world answered, rows (75) | 72/75, 96.0% (88.9–98.6) | 65/75, 86.7% (77.2–92.6) | 65/75, 86.7% (77.2–92.6) |
| Over-refusal rows (of 75) | 1/75 (0.2–7.2); items 0/25 | 6/75 (3.7–16.4); items 0/25 | 5/75 (2.9–14.7); items 0/25 |
| Name-free positives passing, items (22) | 22/22 (85.1–100); rows 66/66 | 22/22; rows 66/66 | 22/22; rows 66/66 |
| v1 dev cross-lingual, items (12) | 12/12 (75.8–100); rows 35/36 | 12/12; rows 36/36 | 11/12 (64.6–98.5); rows 34/36 |
| v1 dev paraphrase, items (8) | 8/8 (67.6–100); rows 24/24 | 8/8; rows 24/24 | 8/8; rows 23/24 |
| Harm proxy, dev-v2 near-miss clean, items (25) | 10/25, 40.0% (23.4–59.3); rows 34/75 | 13/25, 52.0% (33.5–70.0); rows 35/75 | 12/25, 48.0% (30.0–66.5); rows 34/75 |
| Harm proxy, v1 dev near-miss clean, items (18) | 6/18, 33.3% (16.3–56.3); rows 18/54 | 6/18; rows 23/54 | 5/18, 27.8% (12.5–50.9); rows 19/54 |
| v1 dev far negatives clean, items (4) | 4/4; rows 11/12 | 4/4; rows 12/12 | 4/4; rows 11/12 |
| Gold note retrieved, positives (42 items) | 42/42; rows 126/126 | 42/42 | 42/42 |

Paired vs standin: real-world items 1/0 (p = 1.00) for both product arms; real-world rows by (item,
repeat) 9/2 (p = 0.065, product-default) and 8/1 (p = 0.039, product-course). The row pairing is by
repeat index across separate runs, so it is arbitrary; treat the row p-values as rough.

## Reading it

- **"Say so" is not the cause.** Dropping the stand-in (product-default) cut e2b's refusal-phrase rows
  from 42 to 30 of 75, but the rows that stopped refusing did not start answering: answered went 28 → 29.
  They became replies with no refusal phrase (5 → 16 rows), mostly a question back or a promise to look
  something up that never comes ("I can tell you about the melting point of iron. I need to look up this
  specific piece of information for you."). The item-level change is 3 lost, 4 gained (p = 1.0). Same
  conclusion as lever 3 from a different direction: e2b's over-refusal is not one sentence in the prompt.
- **The stand-in makes e2b more direct than the app.** Under `product-course`, e2b turns lookups into
  Socratic questions. 84 of the 96 positive rows it failed end with a question mark (standin: 2 of 6), for
  example "What is the temperature at which Ostravine oil boils, according to your notes?" asked back to
  the student who asked it. A real-world question gets the same: "What are you looking to learn about
  Mount Kilimanjaro?". It also misuses notes a little more on v1 dev (49/54 clean rows vs 53/54; 5 chips).
  Under `product-default` the effect is smaller but real on positives: name-free 22 → 19 items, and 19 of its 27
  failing positive rows end with a question. The likely source is the rules block's "Guide the student to
  discover answers rather than giving them immediately" and "When stuck, give hints — not full solutions",
  with no "answer directly" line to counter them. That is a hypothesis; no arm isolates those lines.
- **qwen3.5:4b barely notices.** Positives stay 22/22 in every arm. Real-world answered drops 72 → 65 rows
  in both product arms (p ≈ 0.04–0.07 on the arbitrary row pairing; items 24 → 23). Its note misuse
  (harm proxy) does not change materially.
- **So the B1 numbers are not product numbers for e2b, in the direction that flatters the product.**
  Every B1 e2b result so far was measured with an instruction to answer directly that a generated course
  does not have. What a real generated course does depends on its model-written pedagogy and persona,
  which this run did not send.

## Runs

| | |
|---|---|
| Models | `gemma4:e2b` (`b37049369adf`), `qwen3.5:4b` (`d8b0f5e9760c`) |
| Embedder | `nomic-embed-text:latest` (`0a109f422b47`) |
| Ollama | 0.40.15, 127.0.0.1:11434; library on, 154 cards |
| Hardware | RTX 3070 laptop (8 GB VRAM), 32 GB RAM; GPU only |
| Commit | `b1e8f31` (worktree `C:/x/oe-fid`), every run `srcDirty: false` |
| Call | `EVAL_SET=<dev-v2\|dev> EVAL_PROMPT=<arm> EVAL_MODES=always EVAL_SYLLABUS=matched EVAL_REPEATS=3 EVAL_WIRE=1 EVAL_MODEL=<model> npm run eval` |
| Results JSON (not committed) | `C:/x/oe-fid-runs/{e2b,qwen4b}-{dev-v2,dev}-{standin,product-default,product-course}.json`; analysis `analyze.cjs`, output `analysis.txt` there |

Before e2b (03:35:19 UTC): 11.3 GB RAM free of 31.9, 2,350 MiB VRAM in use (other apps), `ollama ps`
empty. Before qwen (03:42:53 UTC, after `ollama stop` of e2b and the embedder): 13.0 GB free, 2,260 MiB,
`ollama ps` empty. After the last run (04:19:23 UTC) both models were stopped; `ollama ps` empty.

| # | Run | UTC | Outcome |
|---|---|---|---|
| 1–3 | e2b dev-v2 standin, product-default, product-course | 03:35:26–03:39:07 | complete, 141 rows each |
| 4–6 | e2b dev standin, product-default, product-course | 03:39:07–03:42:32 | complete, 126 rows each |
| 7 | qwen dev-v2 standin | 03:42:55–03:43:33 | **void**: aborted at `v2-nl03`, repeat 1 |
| 8 | qwen dev-v2 product-default | 03:43:33–03:45:43 | **void**: aborted at `v2-nl03`, repeat 2 |
| 9 | qwen dev-v2 product-course | 03:45:43–03:51:15 | complete, 141 rows |
| 10 | qwen dev standin | 03:51:15–03:54:03 | **void**: aborted at `h-pp09`, repeat 2 |
| 11–12 | qwen dev product-default, product-course | 03:54:03–04:05:21 | complete, 126 rows each |
| 13 | qwen dev-v2 standin (rerun) | 04:05:33–04:10:05 | complete, 141 rows |
| 14 | qwen dev-v2 product-default (rerun) | 04:10:06–04:14:58 | complete, 141 rows |
| 15 | qwen dev standin (rerun) | 04:14:58–04:19:02 | complete, 126 rows |

**The three voids** were aborted by the runner's integrity guard ("Fixture vault returned NO note
candidates"), which the pre-registration names as grounds to void and rerun. The message was wrong:
grounding had found 6 candidates for the turn. Ollama's server log shows `qwen3.5 tool call parsing
failed … expected element type <function> but have <parameter>` and an HTTP 500 on `/api/chat` at each
abort time (22:43:32, 22:45:43, 22:54:02 local). The kernel threw, the runner recorded an ERROR answer
with an empty grounding trace, and the guard read the empty trace as an empty vault. Each was rerun once
and completed. qwen's standin cells therefore come from runs made after its product arms, not in the
planned order. No e2b run was voided. 0 ERROR rows in any completed run. TTFT p50: e2b 110–119 ms,
qwen 456–462 ms; no arm differs.

## Known limits

- **No persona and no generated pedagogy.** A course made in the app has both. `product-course` is the
  fixed part of a generated course only. A persona arm and an arm with a real generated pedagogy are the
  obvious next runs.
- **Refusal list** (`refusal.ts`) was written before the runs and not changed; the "not answered, no
  refusal phrase" row shows what it does not catch. The question-back counts (rows ending in "?") were
  not pre-registered; they are descriptive.
- **Harm proxy, not rubric.** Same caveats as the #190 baseline: on qwen, contrasting a note counts as
  poison.
- **Two sets, two models, one machine, GPU only.** `main` and spent v1 `test` were not run.
- **Single-turn questions.** The app's prompt also carries history, a knowledge summary and progress
  context on later turns.

## Not changed in this PR

- `src/lib/eval/k12-runner.ts` has the same stand-in (`K12_INSTRUCTIONS`, including "If you do not know
  something, say so."), so the k12-mc single-turn results used it too. The k12-flow runner already
  sends `{}` (the `product-default` instructions).
- The integrity guard's misattribution of a kernel error (above).

## Reproduce

```bash
for model in gemma4:e2b qwen3.5:4b; do for set in dev-v2 dev; do for arm in standin product-default product-course; do
  EVAL_SET=$set EVAL_PROMPT=$arm EVAL_MODES=always EVAL_SYLLABUS=matched EVAL_REPEATS=3 EVAL_WIRE=1 EVAL_MODEL=$model npm run eval
done; done; done
```
