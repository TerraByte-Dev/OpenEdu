# The plain lookup note with the long-note window (lever 15) — RAG blind set of long notes under the product-course prompt — `gemma4:e2b`, `gemma4:e4b` — 2026-11-09

> **RUN 2026-11-09 at `4fd8f3f`. Rule A FAILS on its harm clause, so lever 15 is `not-shipped`. Rule W
> (the window under the note) holds.**
>
> - **The gain.** On fresh long notes, e2b with the fact-lookup note and the window (L), against master's behaviour (B), went from 12 to 42 of 64 positives and from 0 to 22 of 48 real-world answers. Both p < 0.0001.
> - **The harm.** Near-miss clean fell from 48 to 43 of 48, against a floor of 46.
>   - Read one by one, 3 of the 5 lost items are borrowed or wrong values: the note's 1937 for *The Grapes of Wrath*, "percent sign" for SQL's one-character wildcard, and China as the most populous country.
>   - One is a citation chip on a formula sentence.
>   - One is a correct answer the substring grader fails because it names the poison as background: "Friedman and Phelps, who built upon earlier work like the Phillips curve".
>   - Without that one, near-miss clean is still 44, below the floor.
> - **The trade-off the rule encodes.** Master is 48 of 48 "clean" because it answers almost nothing: 0 of 48 real-world answers, and it answers lookups with a question.
> - **The window, under the note (rule W).** Positives went from 27 to 42 of 64 (b/c 1/16, p = 0.0003), and near-miss clean from 44 to 43 (floor 42). e4b repeats it: 32 → 45 (p = 0.004), near-miss clean 41 → 41. With [#229](2026-11-09-rag-blind-long-notes.md)'s e4b result, this is the third time on fresh data that showing the matching part of a long note helped a model that answers, with no added harm. By #230's wording, W ships only with the note, so it does not ship here.
>
> **Blind, not held out.** The gate set was written by a fresh agent after the pre-registration. The sealed set was not opened. **Nothing here is on master:** the arms are switches on the unmerged stack (`feat/lookup-note-window`, PR [#231](https://github.com/TerraByte-Dev/OpenEdu/pull/231), stacked on #228 → #224 → #222).

## The lever

On a turn the classifier calls a fact lookup, the student's message ends with FACT_LOOKUP_NOTE (wording 2, #215). There is no notes-miss switch and no meaning check. Every long passage is shown through `passageFor` (lever 14, #227). There is no new kernel code: the arms are switches at one commit.

The pre-registration is issue [#230](https://github.com/TerraByte-Dev/OpenEdu/issues/230), posted 19:24:48Z before the blind set existed. It is the canonical text.

## Plan (from #230)

| | |
|---|---|
| Arms | **B** `EVAL_TURN_NOTES=off EVAL_PASSAGE_WINDOW=off` (master's requests; the pre-run review confirmed it for all 112 items). **N** `EVAL_NOTES_MISS=off EVAL_PASSAGE_WINDOW=off` (the note, passages from their start). **L** `EVAL_NOTES_MISS=off` (the note and the window) |
| Gate set | `blind-15`: 16 long notes on 16 new topics (710–1,015 words), 64 positives, 48 near-misses with real-world `expect`s; sha256 `234d9836…3292c0`; committed at `4fd8f3f` (19:39:35Z) |
| Classifier pins (before any run) | 74 fact-lookup, 37 other, 1 typed-problem. Only 36 of the 64 positives are fact lookups, so the note can act on at most 36 |
| Call | `EVAL_SET=blind-15 EVAL_PROMPT=product-course EVAL_MODES=always EVAL_SYLLABUS=matched EVAL_REPEATS=3 EVAL_WIRE=1 EVAL_MODEL=<model>` plus the arm's switches |
| Unit | item-majority (≥ 2 of 3; ERROR = fail), Wilson 95%, exact two-sided McNemar |

**Rule A, on e2b, L vs B.** All four must hold:
1. positives +6 or more with p < 0.05;
2. real-world answered +6 or more with p < 0.05;
3. near-miss clean k_L ≥ k_B − 2;
4. ERROR rows L ≤ B + 1.

**e4b harm check:** positives and near-miss clean each k_L ≥ k_B − 3.

**Rule W, on e2b, L vs N.** Positives +4 or more with p < 0.05, and near-miss clean k_L ≥ k_N − 2. If A holds and W fails, the proposal falls back to N.

## Runs

| | |
|---|---|
| Checkout | worktree `C:/x/oe-15` at `4fd8f3f`; `git status` empty at every start; `srcDirty: false` on every run |
| Review | an independent pre-run review (arms, B against master, loader, checker, scorer) found nothing blocking before the first run |
| Before each model | `ollama ps` empty. e2b: 13.20 GB free RAM, 1,661 MiB VRAM in use. e4b: 12.87 GB, 1,593 MiB |
| Results JSON (not committed) | `C:/x/oe-15-runs/<model>-<arm>-a1.json`; `drive.sh`, `drive.log`, `check.cjs`, `analyze.cjs` |

| Run | Rows | ERROR | Lookup-note rows | UTC |
|---|---|---|---|---|
| `gemma4_e2b-B-a1` | 336 | 0 | 0 | 19:42:34–19:46:13 |
| `gemma4_e2b-N-a1` | 336 | 0 | 222 | 19:46:17–19:49:25 |
| `gemma4_e2b-L-a1` | 336 | 0 | 222 | 19:49:30–19:52:29 |
| `gemma4_e4b-B-a1` | 336 | 0 | 0 | 19:52:36–20:01:56 |
| `gemma4_e4b-N-a1` | 336 | 0 | 222 | 20:02:01–20:10:00 |
| `gemma4_e4b-L-a1` | 336 | 0 | 222 | 20:10:05–20:18:02 |

All six were first attempts; none was void or excluded. 222 rows is 74 fact-lookup items × 3.

## e2b (the rules)

| Metric (items of 64 / 48) | B | N | L | L vs B b/c, p | L vs N b/c, p |
|---|---|---|---|---|---|
| Positives passing | 12, 18.8% (11.1–30.0) | 27, 42.2% (30.9–54.4) | 42, 65.6% (53.4–76.1) | 3/33, < 0.0001 | 1/16, 0.0003 |
| Near-miss clean | 48, 100.0% (92.6–100.0) | 44, 91.7% (80.4–96.7) | 43, 89.6% (77.8–95.5) | 5/0, 0.0625 | 1/0, 1.0000 |
| Real-world answered | 0, 0.0% (0.0–7.4) | 21, 43.8% | 22, 45.8% (32.6–59.7) | 0/22, < 0.0001 | 1/2, 1.0000 |
| Near-miss answer contains the poison | 0 | 3 | 4 | 0/4, 0.125 | 0/1, 1.0000 |
| *Mechanism:* positive's answer in the shown block | 36 | 36 | 55 | 0/19 | 0/19 |

**Rule A:**
1. Positives +30, p < 0.0001: holds.
2. Real-world +22, p < 0.0001: holds.
3. Near-miss clean 43 against a floor of 46: **fails**.
4. ERROR rows 0 against 1: holds.

**Rule A fails, so lever 15 is not shipped.**

**Rule W:** positives +15, p = 0.0003, and near-miss clean 43 against a floor of 42. It holds. Because A fails, W's "ships with the note" does not apply.

**The five near-miss items L lost against B** (all fact lookups that got the note):

| Item | Question | Poison (note) | Real answer | L's three answers |
|---|---|---|---|---|
| `b15-mice-n1` | what year was The Grapes of Wrath published | 1937 | 1939 | "published in 1937" ×3 |
| `b15-sql-n1` | which wildcard matches exactly one character in a LIKE pattern | percent sign | underscore | percent sign ×2, underscore ×1 |
| `b15-population-n1` | which country has the biggest population in the world now | China | India | China ×3 |
| `b15-immune-n3` | what % of people need to be vaccinated for herd immunity against measles | 75% | about 95% | gives the 1 − 1/R₀ formula, no number; cites the note ×3 (citation chip) |
| `b15-inflation-n3` | who came up with the natural rate of unemployment idea | Phillips | Friedman, Phelps | "Friedman and Phelps, who built upon earlier work like [Phillips]" ×2, "Friedman" ×1 |

The first two are values borrowed from the note. China may be the note's value or stale knowledge: it was true before 2023. The citation chip is a real harm under the proxy's definition. The last is a grader artifact: a correct answer that names the poison as background. None of this changes the verdict.

## e4b (harm check, reported)

| Metric (items) | B | N | L | L vs B b/c, p | L vs N b/c, p |
|---|---|---|---|---|---|
| Positives passing | 24, 37.5% | 32, 50.0% | 45, 70.3% (58.2–80.1) | 1/22, < 0.0001 | 3/16, 0.0044 |
| Near-miss clean | 43, 89.6% | 41, 85.4% | 41, 85.4% | 2/0, 0.5000 | 2/2, 1.0000 |
| Real-world answered | 1, 2.1% | 21, 43.8% | 25, 52.1% | 0/24, < 0.0001 | 2/6, 0.2891 |
| Near-miss answer contains the poison | 5 | 5 | 7 | 0/2, 0.5000 | 0/2, 0.5000 |

The harm check holds: positives 45 against a floor of 21, near-miss clean 41 against a floor of 40.

## What this means

1. **The lookup note buys a lot and costs a little, and the pre-registered rule says the cost is too much.**
   - On e2b it turns a tutor that answers almost no lookup (0 of 48 real-world answers, 12 of 64 note answers) into one that answers about half.
   - The cost is about 3 borrowed or wrong values on 48 trick questions, where master gave 0.
   - That trade is a product decision. The 2-item margin was set before this run and is not reopened here.
2. **The window is now the best-supported change in this line.** It added 15 positives with the note on e2b, 13 on e4b, and 15 on e4b without the note (#229). Near-miss clean was never lower than the same arm without it by more than 2.
   - It is pure and short notes are byte-identical, but it has not passed a rule of its own on master's behaviour. On master, e2b does not answer lookups, so the window has nothing to act through.
   - Shipping it alone is a decision about e4b and larger models, which take the window's gain without a note.
3. **The classifier caps the note's reach.** It labels only 36 of the 64 blind positives as fact lookups. The 27 it calls "other" get no note and stay at master's behaviour.
