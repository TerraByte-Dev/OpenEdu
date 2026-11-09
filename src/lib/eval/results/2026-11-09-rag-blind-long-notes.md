# Long notes: show the matching part of a passage (lever 14) and a meaning check under the notes-miss switch (lever 9g) — RAG blind set of long notes under the product-course prompt — `gemma4:e2b`, `gemma4:e4b` — 2026-11-09

> **RUN 2026-11-09. Both gates FAIL their pre-registered rules on e2b, so both are `not-shipped`.**
>
> - **Lever 14, the passage window ([#227](https://github.com/TerraByte-Dev/OpenEdu/pull/227)).** It fixes a real bug (#226): on long notes, the answer was in the text shown to the model for 28 of 64 blind positives, and for 57 with the window. e2b barely used it under master's tutoring rules: positives went 7 → 11 of 64, p = 0.34, and the rule needed +4 with p < 0.05. e4b, reported and harm-checked only, used it: positives 20 → 35 of 64 (b/c 5/20, p = 0.004), near-miss clean 42 → 40 of 48 (the harm check allowed −3).
> - **Lever 9g, the meaning check ([#228](https://github.com/TerraByte-Dev/OpenEdu/pull/228)).** It halved the notes-miss switch's false hides on fresh long notes, 8 → 4 positive items, but the rule allowed 1. All four scored 0.64–0.67 against a 0.68 cut. On real long notes, the meaning scores of right notes and look-alikes overlap.
> - **Descriptive, not a gate:** on the same blind long notes, the unmerged turn-note stack (fact-lookup note plus the 9f switch) against no turn notes, both with the window, took e2b's positives from 12 to 39–41 of 64. Real-world answered went from 0 to 24–25 of 48, and near-miss clean from 46 to 44–45.
>
> **Blind, not held out.** The gate set was written by a fresh agent after both levers were frozen and pre-registered. It is still a model's idea of student notes. The sealed set was not opened. **Not on master:** lever 14 is on `feat/passage-window` (#227), and 9g is on `feat/lookup-meaning` (#228, stacked on 9f's #224). Both are draft and labelled `not-shipped`.

**Naming.** #227, its commits and its code comments call the window "lever 10". BENCHMARKS.md already has a lever 10 ("Trim trailing passages"), so this record and BENCHMARKS call it **lever 14**.

## The levers

**Lever 14** (`ground.ts` `passageFor`, issue #226).
- **The bug.** A note chunk is up to 512 estTokens (about 2,000 characters), but each passage is shown capped at 250 (about 1,000) from its start. On a long note, retrieval could find the right chunk while the model read the half without the answer.
- **The change.** `passageFor` shows the run of whole sentences around the sentence that shares the most content words with the question.
- **When nothing changes.** The passage fits, no sentence shares a word, or the head already shows the best sentence.
- **Cost and scope.** No model or embed call. It also applies to library reference cards, which are fetched at up to 1,800 characters. The PR body said otherwise; the pre-run review corrected it before any run.
- **Paired arm:** `EVAL_PASSAGE_WINDOW=off`.

**Lever 9g** (`kernel/meaning.ts`, issue #204).
- **The change.** On a turn 9e/9f's word switch would fire on, one embed call scores the question against every sentence of the shown passages' full chunk text. The switch fires only when no sentence reaches cosine 0.68 (nomic-embed-text). Otherwise, or when the call fails, the turn sends the plain lookup note with the passages.
- **Paired arm:** `EVAL_NOTES_MEANING=off`, which is 9f.

Both were chosen offline on dev data before the blind set existed. The data is the older dev sets plus 12 long dev notes, all committed with the scripts in `scripts/eval-offline/`:
- Lever 14 took long-note answers in the shown text from 21 to 38 of 48.
- 9g hid 0 of 164 dev positives (the word switch alone hid 19) and caught 80 of 167 near-misses (alone: 129).

The pre-registrations are the bodies of #227 (posted 18:03:13Z) and #228 (18:03:56Z). Their dated comments add three things, all posted before the blind set existed and before any run: void rules (a run with no results file, or a dirty src, is rerun once; ERROR rows are outcomes), the pre-run review's corrections, and the run start. They are the canonical text; this summary does not replace them.

## Plan (from the pre-registrations)

| | |
|---|---|
| Gate set | `blind-10`: 16 long notes (721–837 words, real school topics with class-specific values spread through each note), 64 positives, 48 near-misses with real-world `expect`s; sha256 `7f35a493…63957a`; written by a fresh agent after both pre-registrations |
| Call | `EVAL_SET=blind-10 EVAL_PROMPT=product-course EVAL_MODES=always EVAL_SYLLABUS=matched EVAL_REPEATS=3 EVAL_WIRE=1 EVAL_MODEL=<model>` plus the arm's switch |
| Lever 14 arms | at `8ca08fe` on `feat/passage-window` (master plus the lever): **W-B** `EVAL_PASSAGE_WINDOW=off`, **W-W** unset |
| Lever 9g arms | at `48b9887` on `feat/lookup-meaning`, window on in every arm: **G-B** `EVAL_TURN_NOTES=off`, **G-D** `EVAL_NOTES_MEANING=off` (9f), **G-G** unset |
| Unit | item-majority (≥ 2 of 3; ERROR = fail), Wilson 95%, exact two-sided McNemar on discordant items |

**Lever 14 ships if, on e2b:**
1. positives k_W − k_B ≥ +4 with McNemar p < 0.05;
2. near-miss clean k_W ≥ k_B − 2;
3. ERROR rows W ≤ B + 1.

**e4b harm check:** positives k_W ≥ k_B − 3 and near-miss clean k_W ≥ k_B − 3.

**9g passes if, on e2b:**
1. at most 1 positive item has a G row whose note is `notes-drop` or `notes-miss` (a false hide);
2. positives k_G ≥ k_B − 2 and k_G ≥ k_D;
3. near-miss clean k_G ≥ k_B − 2;
4. real-world answered k_G − k_B ≥ +4 with p < 0.05.

e4b is reported only.

## Runs

| | |
|---|---|
| Checkouts | worktrees `C:/x/oe-win` (lever 14) and `C:/x/oe-9g` (9g), each with its own `node_modules`; `git status` empty at every run's start; `srcDirty: false` on every run |
| Machine | RTX 3070 laptop (8 GB VRAM), 32 GB RAM; Ollama on 127.0.0.1:11434; embedder `nomic-embed-text:latest` |
| Before each model | e2b: `ollama ps` empty, 14.73 GB free RAM, 1,230 MiB VRAM in use. e4b: the driver first refused to start (18:37:42Z) because the embedder was still loaded; after `ollama stop`, `ollama ps` was empty, 14.56 GB free, 1,324 MiB |
| Results JSON (not committed) | `C:/x/oe-10-runs/<model>-<arm>-a1.json` and `.stdout.txt`; `drive.sh`, `drive.log`, `check.cjs`, `analyze.cjs` |

| Run | Commit | srcDirty | Rows | ERROR | notes-miss / notes-drop rows | meaning check asked | UTC |
|---|---|---|---|---|---|---|---|
| `gemma4_e2b-W-B-a1` | `8ca08fe` | false | 336 | 0 | 0 / 0 | 0 | 18:22:34–18:25:41 |
| `gemma4_e2b-W-W-a1` | `8ca08fe` | false | 336 | 0 | 0 / 0 | 0 | 18:25:45–18:28:54 |
| `gemma4_e2b-G-B-a1` | `48b9887` | false | 336 | 0 | 0 / 0 | 0 | 18:28:58–18:32:10 |
| `gemma4_e2b-G-D-a1` | `48b9887` | false | 336 | 0 | 6 / 69 | 0 | 18:32:14–18:34:40 |
| `gemma4_e2b-G-G-a1` | `48b9887` | false | 336 | 0 | 0 / 51 | 75 | 18:34:44–18:37:41 |
| `gemma4_e4b-W-B-a1` | `8ca08fe` | false | 336 | 0 | 0 / 0 | 0 | 18:37:59–18:46:32 |
| `gemma4_e4b-W-W-a1` | `8ca08fe` | false | 336 | 0 | 0 / 0 | 0 | 18:46:37–18:54:09 |
| `gemma4_e4b-G-D-a1` | `48b9887` | false | 336 | 0 | 6 / 69 | 0 | 18:54:13–19:00:20 |
| `gemma4_e4b-G-G-a1` | `48b9887` | false | 336 | 0 | 0 / 51 | 75 | 19:00:25–19:06:56 |

All 9 runs were the first attempt; no run was void or excluded. Retrieval is deterministic, so in every G-G run the meaning check was asked on exactly the 75 rows D fired on (25 items × 3), and it let 51 of them fire.

## Lever 14 (the window)

### e2b: the rule

| Metric (items of 64 / 48) | W-B (head) | W-W (window) | b / c | McNemar p |
|---|---|---|---|---|
| Positives passing | 7, 10.9% (5.4–20.9) | 11, 17.2% (9.9–28.2) | 3 / 7 | 0.3438 |
| Near-miss clean | 46, 95.8% (86.0–98.8) | 46, 95.8% (86.0–98.8) | 0 / 0 | 1.0000 |
| Real-world answered | 1, 2.1% | 2, 4.2% | 0 / 1 | 1.0000 |
| *Mechanism:* positive's answer in the shown block | 28, 43.8% | 57, 89.1% | 0 / 29 | < 0.0001 |
| *Mechanism:* near-miss poison in the shown block | 24, 50.0% | 29, 60.4% | 1 / 6 | 0.1250 |

1. Positives +4, p = 0.3438: **fails** (p ≥ 0.05).
2. Near-miss clean 46 against a floor of 44: holds.
3. ERROR rows 0 against 1: holds.

**Lever 14 is not shipped.**

Why e2b did not move: under master's product-course rules, with no turn note, e2b mostly answers a lookup with a question. In W-W, the answer was in the shown block on 171 of 192 positive rows, and only 39 of those passed. Of the 132 that failed, 113 ended with a question mark, and 1 had a refusal phrase. The window put the answer in front of the model; e2b did not read it out.

### e4b: harm check (reported)

| Metric (items) | W-B | W-W | b / c | p |
|---|---|---|---|---|
| Positives passing | 20, 31.3% (21.2–43.4) | 35, 54.7% (42.6–66.3) | 5 / 20 | 0.0041 |
| Near-miss clean | 42, 87.5% | 40, 83.3% | 6 / 4 | 0.7539 |
| Real-world answered | 5, 10.4% | 3, 6.3% | 2 / 0 | 0.5000 |

The harm check holds: positives 35 against a floor of 17, near-miss clean 40 against a floor of 39. The positive gain is not a gate.

## Lever 9g (the meaning check)

### e2b: the rule

| Metric (items) | G-B (no notes) | G-D (9f) | G-G (9g) |
|---|---|---|---|
| Positives passing | 12, 18.8% (11.1–30.0) | 39, 60.9% (48.7–71.9) | 41, 64.1% (51.8–74.7) |
| Near-miss clean | 46, 95.8% | 45, 93.8% | 44, 91.7% (80.4–96.7) |
| Real-world answered | 0, 0.0% (0.0–7.4) | 25, 52.1% | 24, 50.0% (36.4–63.6) |
| Positive items the switch fired on (false hides) | — | 8 | **4** |
| Near-miss items the switch fired on | — | 17 | 13 |

Exact McNemar tests: G-G vs G-B, positives b/c 1/30 and real-world 0/24, both p < 0.0001. G-G vs G-D, positives 0/2, p = 0.5.

1. False hides 4, need ≤ 1: **fails**.
2. Positives 41 against 10 and against D's 39: holds.
3. Near-miss clean 44 against a floor of 44: holds, at the floor.
4. Real-world +24, p < 0.0001: holds.

**9g is not shipped.**

The four false hides, with the check's best cosine (the cut is 0.68) and the phrase the word switch parsed:

| Item | Question | Phrase | Best cosine |
|---|---|---|---|
| `b10-elec-p4` | What was the resistance of the light sensor thing when someone covered it with their hand? | "light sensor thing" | 0.664 |
| `b10-sleep-p3` | how long is one sleep cyle | "sleep cyle" | 0.670 |
| `b10-sleep-p4` | What was Mia's time to fall asleep before she changed her routine? | "routine" | 0.673 |
| `b10-eco-p1` | what was the mean number of daisies per quadrat on the field | "daisies" | 0.640 |

9f hid these four and four more. The check removed four false hides (`b10-acids-p2` "difference", `b10-frrev-p4` "vote", `b10-weather-p1`, `b10-weather-p2`) and four near-miss catches (17 → 13). Dev put 0 of 164 positives below 0.68. On fresh long notes, 4 of 64 sit just below it. A typo, a vague description, or a detail the note words differently scores the same as a look-alike.

### e4b (reported)

| Metric (items) | G-D (9f) | G-G (9g) | b / c | p |
|---|---|---|---|---|
| Positives passing | 46, 71.9% | 47, 73.4% | 3 / 4 | 1.0000 |
| Near-miss clean | 41, 85.4% | 42, 87.5% | 1 / 2 | 1.0000 |
| Real-world answered | 29, 60.4% | 29, 60.4% | 2 / 2 | 1.0000 |

The false hides are the same four items (retrieval does not depend on the chat model).

### Cost

The check is one extra embed call, made only on turns the word switch would fire on. On the 75 rows where it was asked, median time to first text was:

| Model | 9g | 9f, same rows |
|---|---|---|
| e2b | 487 ms | 96 ms |
| e4b | 561 ms | 134 ms |

These are GPU numbers. The comparison is not the check's cost alone, because 9f dropped the passages on all of those rows, while 9g kept them on the 24 it vetoed.

## Descriptive: the turn-note stack on long notes (not a gate)

G-B and G-D share a commit and the window, and differ only by the turn-note stack: FACT_LOOKUP_NOTE on fact lookups, with 9e/9f's switch. On e2b, the stack against no turn notes gave:
- positives 12 → 39 of 64 (b/c 1/28, p < 0.0001);
- real-world answered 0 → 25 of 48 (0/25);
- near-miss clean 46 → 45 (3/2).

No arm runs the lookup note without the switch, so this table cannot separate the note from the switch. The stack is not on master. Its open review items (#209/#221, #222, #224) stand.

## What this means

1. **#226 is real and lever 14 fixes the mechanism.** It is not shipped, because the pre-registered gate was on e2b, and e2b under master's rules does not read answers out of notes on lookups. The window's effect shows where the model answers: e4b +15 positives, with the harm check holding. A new pre-registration with a fresh set could gate it under a turn that asks for the answer. That needs either the lookup note on master or e4b as the gate model. This set cannot be reused, because it has been seen.
2. **The notes-miss switch cannot be made safe by similarity alone.** Word overlap (9e/9f) and sentence meaning (9g) both fire on fresh positives whose wording differs from the note. 9g halves that rate, but four of 64 is still the student's own right notes hidden. This closes the switch line. The next candidate is the lookup note without any switch, measured for harm on long notes.
3. **The model's reading, not retrieval, is now e2b's limit on long notes.** Retrieval found the right note for 183 of 192 positive rows, and the window shows the answer for 89% of positive items. Under master's rules, e2b passes 11–17% of them (7 and 11 of 64 items).
