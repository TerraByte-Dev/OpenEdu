# define ("what does X mean"): dictionary note, TEST split, 2026-11-12

> **TEST RESULT, read once.** Lever 18 (`docs/BENCHMARKS.md` section 3, suite B8). The test split ran
> once at `eval-test-2026-11-12` (`50c7bd5`), 120 items × 3 repeats per arm, paired arms B (no note)
> and D (the note) on gemma4:e2b (the rule model), gemma4:e4b and qwen3.5:4b.
>
> **Outcome: no kill clause fires on any model, so the lever ships, as a trust/UX feature and not
> as an accuracy lever.** There are two separate reasons, and either one alone would be enough:
> - **The B8 gate missed:** κ was 0.65 on the lenient reading and 0.74 for grader 2 on strict
>   (dev results file), so B8 is descriptive.
> - **The accuracy claim is untestable at this n:** e2b B already passes 40 of 45 target items.
>
> Every arm is complete: 0 ERROR rows, 360/360 detected, 360/360 noted in D, and 0 added model calls.

## Run record

| | |
|---|---|
| Commit | `50c7bd5`, tagged `eval-test-2026-11-12`. Wording 2 of `DICTIONARY_NOTE` was frozen at this commit, after the B8 gate was read (`fc08075`, `50c7bd5`) |
| `git diff 364bdaa 50c7bd5 --stat -- src public/dictionary` | 6 files changed, 246 insertions(+), 9 deletions(-). The only runtime change is `DICTIONARY_NOTE` (`defineWord.ts`, wording 2, `2d872d5`) and its snapshot. The rest is label tooling (`define-label.ts`, `define-kappa.ts`, `define-label-grader2.ts`), which never runs during an eval, plus the dev results file. Nothing that generates or scores a reply changed. |
| `git diff master...eval-test-2026-11-12 -- src` | this PR's own diff (rule 6, as pre-registered for an unmerged lever) |
| Runs (main checkout `.dev/eval-runs/`) | `2026-11-12T06-03-18-321-define-test-B-gemma4_e2b.json`, `…06-08-42-323…-D-gemma4_e2b.json`, `…06-12-25-000…-B-gemma4_e4b.json`, `…06-21-31-845…-D-gemma4_e4b.json`, `…06-29-32-881…-B-qwen3.5_4b.json`, `…06-43-09-552…-D-qwen3.5_4b.json` |
| `EVAL_WIRE` | 1 on both e2b arms |
| Aborted starts | Two earlier attempts (2026-11-11 21:26 and 21:47) were stopped by Claude before any row completed: free RAM was 0.8 to 2.3 GB, so the model could not load. No results file was written and no row was read, so neither is a void arm under the void rule, and the run above is the only one. |

## gemma4:e2b (rule model)

```
define test, gemma4:e2b, commit 50c7bd5, repeats 3

B: rows 360, ERROR 0; detected 360/360; noted 0/360; added calls 0; retried rows 0; tool calls 0
D: rows 360, ERROR 0; detected 360/360; noted 360/360; added calls 0; retried rows 0; tool calls 0

### All items (item-majority)

| Group | n | B | D | lost | gained | McNemar p |
|---|---|---|---|---|---|---|
| common | 50 | 49/50 (89.5–99.6%) | 48/50 (86.5–98.9%) | def-k2-08, def-k2-29 | def-k2-11 | 1.0000 |
| plain-6-8 | 25 | 25/25 (86.7–100.0%) | 24/25 (80.5–99.3%) | def-68-36 | — | 1.0000 |
| plain-k8 | 75 | 74/75 (92.8–99.8%) | 72/75 (88.9–98.6%) | def-k2-08, def-k2-29, def-68-36 | def-k2-11 | 0.6250 |
| rare | 25 | 24/25 (80.5–99.3%) | 25/25 (86.7–100.0%) | — | def-912-14 | 1.0000 |
| sense | 20 | 16/20 (58.4–91.9%) | 17/20 (64.0–94.8%) | sense-k2-03, sense-912-06 | sense-k2-05, sense-k2-08, sense-68-02 | 1.0000 |
| sense-strict | 20 | 15/20 (53.1–88.8%) | 16/20 (58.4–91.9%) | sense-k2-03, sense-68-08, sense-912-06 | sense-k2-05, sense-k2-08, sense-35-06, sense-68-02 | 1.0000 |
| target | 45 | 40/45 (76.5–95.2%) | 42/45 (82.1–97.7%) | sense-k2-03, sense-912-06 | def-912-14, sense-k2-05, sense-k2-08, sense-68-02 | 0.6875 |
| target-strict | 45 | 39/45 (73.8–93.7%) | 41/45 (79.3–96.5%) | sense-k2-03, sense-68-08, sense-912-06 | def-912-14, sense-k2-05, sense-k2-08, sense-35-06, sense-68-02 | 0.7266 |
| plain-all | 100 | 98/100 (93.0–99.4%) | 97/100 (91.5–99.0%) | def-k2-08, def-k2-29, def-68-36 | def-k2-11, def-912-14 | 1.0000 |

### Median reply length in words, by band (descriptive; reading level is not gated)

| Band | B | D |
|---|---|---|
| K-2 | 21 | 21 |
| 3-5 | 38 | 37 |
| 6-8 | 40 | 39 |
| 9-12 | 64 | 61 |

### Lever 18 clauses, as written (lexical; a harm clause that fires goes to blind adjudication of its lost and gained items first)

- holds: harm: common D <= B - 3 (B 49/50, D 48/50; lost def-k2-08, def-k2-29)
- holds: harm: plain-k8 D <= B - 3 (B 74/75, D 72/75; lost def-k2-08, def-k2-29, def-68-36)
- holds: harm: sense D <= B - 3 (B 16/20, D 17/20; lost sense-k2-03, sense-912-06)
- holds: cost: any added model call in D (0 added; turn requests of 0 retried or ERROR row(s) not counted)
- holds: fire: a non-ERROR D row whose word is missed or that gets no note (none)
- holds: errors: D ERROR rows > B + 1 (B 0, D 0)

Lexical outcome: no kill clause fires; accuracy: untestable at this n (ceiling: B passes 40 or more of 45 target items).
Reminder: if the B8 validation gate missed (kappa below 0.8 on either reading, or no grader-1 export by the wording-freeze commit), B8 is descriptive and no accuracy claim is made, whatever this says.
The other-models clause and the void rule are read across files; this compares one model.
```

## gemma4:e4b (other-models clause)

```
define test, gemma4:e4b, commit 50c7bd5, repeats 3

B: rows 360, ERROR 0; detected 360/360; noted 0/360; added calls 0; retried rows 0; tool calls 1
D: rows 360, ERROR 0; detected 360/360; noted 360/360; added calls 0; retried rows 0; tool calls 0

### All items (item-majority)

| Group | n | B | D | lost | gained | McNemar p |
|---|---|---|---|---|---|---|
| common | 50 | 49/50 (89.5–99.6%) | 49/50 (89.5–99.6%) | def-k2-14 | def-35-38 | 1.0000 |
| plain-6-8 | 25 | 25/25 (86.7–100.0%) | 24/25 (80.5–99.3%) | def-68-26 | — | 1.0000 |
| plain-k8 | 75 | 74/75 (92.8–99.8%) | 73/75 (90.8–99.3%) | def-k2-14, def-68-26 | def-35-38 | 1.0000 |
| rare | 25 | 25/25 (86.7–100.0%) | 25/25 (86.7–100.0%) | — | — | 1.0000 |
| sense | 20 | 20/20 (83.9–100.0%) | 18/20 (69.9–97.2%) | sense-35-05, sense-35-06 | — | 0.5000 |
| sense-strict | 20 | 16/20 (58.4–91.9%) | 18/20 (69.9–97.2%) | sense-35-05, sense-35-06 | sense-68-02, sense-68-06, sense-912-05, sense-912-06 | 0.6875 |
| target | 45 | 45/45 (92.1–100.0%) | 43/45 (85.2–98.8%) | sense-35-05, sense-35-06 | — | 0.5000 |
| target-strict | 45 | 41/45 (79.3–96.5%) | 43/45 (85.2–98.8%) | sense-35-05, sense-35-06 | sense-68-02, sense-68-06, sense-912-05, sense-912-06 | 0.6875 |
| plain-all | 100 | 99/100 (94.6–99.8%) | 98/100 (93.0–99.4%) | def-k2-14, def-68-26 | def-35-38 | 1.0000 |

### Median reply length in words, by band (descriptive; reading level is not gated)

| Band | B | D |
|---|---|---|
| K-2 | 25 | 30 |
| 3-5 | 44 | 46 |
| 6-8 | 46 | 49 |
| 9-12 | 75 | 65 |

### Lever 18 clauses, as written (lexical; a harm clause that fires goes to blind adjudication of its lost and gained items first)

- holds: other models: plain-k8 D <= B - 4 (B 74/75, D 73/75; lost def-k2-14, def-68-26)

Lexical outcome: no kill clause fires; accuracy: not read on this model (the accuracy claim is read on gemma4:e2b only).
Reminder: if the B8 validation gate missed (kappa below 0.8 on either reading, or no grader-1 export by the wording-freeze commit), B8 is descriptive and no accuracy claim is made, whatever this says.
The other-models clause and the void rule are read across files; this compares one model.
```

## qwen3.5:4b (other-models clause)

```
define test, qwen3.5:4b, commit 50c7bd5, repeats 3

B: rows 360, ERROR 0; detected 360/360; noted 0/360; added calls 0; retried rows 0; tool calls 49
D: rows 360, ERROR 0; detected 360/360; noted 360/360; added calls 0; retried rows 0; tool calls 0

### All items (item-majority)

| Group | n | B | D | lost | gained | McNemar p |
|---|---|---|---|---|---|---|
| common | 50 | 50/50 (92.9–100.0%) | 50/50 (92.9–100.0%) | — | — | 1.0000 |
| plain-6-8 | 25 | 25/25 (86.7–100.0%) | 25/25 (86.7–100.0%) | — | — | 1.0000 |
| plain-k8 | 75 | 75/75 (95.1–100.0%) | 75/75 (95.1–100.0%) | — | — | 1.0000 |
| rare | 25 | 25/25 (86.7–100.0%) | 25/25 (86.7–100.0%) | — | — | 1.0000 |
| sense | 20 | 20/20 (83.9–100.0%) | 20/20 (83.9–100.0%) | — | — | 1.0000 |
| sense-strict | 20 | 14/20 (48.1–85.5%) | 16/20 (58.4–91.9%) | sense-k2-02, sense-912-06 | sense-35-02, sense-35-05, sense-68-08, sense-912-08 | 0.6875 |
| target | 45 | 45/45 (92.1–100.0%) | 45/45 (92.1–100.0%) | — | — | 1.0000 |
| target-strict | 45 | 39/45 (73.8–93.7%) | 41/45 (79.3–96.5%) | sense-k2-02, sense-912-06 | sense-35-02, sense-35-05, sense-68-08, sense-912-08 | 0.6875 |
| plain-all | 100 | 100/100 (96.3–100.0%) | 100/100 (96.3–100.0%) | — | — | 1.0000 |

### Median reply length in words, by band (descriptive; reading level is not gated)

| Band | B | D |
|---|---|---|
| K-2 | 46 | 46 |
| 3-5 | 77 | 64 |
| 6-8 | 78 | 60 |
| 9-12 | 95 | 65 |

### Lever 18 clauses, as written (lexical; a harm clause that fires goes to blind adjudication of its lost and gained items first)

- holds: other models: plain-k8 D <= B - 4 (B 75/75, D 75/75; lost none)

Lexical outcome: no kill clause fires; accuracy: not read on this model (the accuracy claim is read on gemma4:e2b only).
Reminder: if the B8 validation gate missed (kappa below 0.8 on either reading, or no grader-1 export by the wording-freeze commit), B8 is descriptive and no accuracy claim is made, whatever this says.
The other-models clause and the void rule are read across files; this compares one model.
```

## Reading (descriptive; none of this changes the outcome)

- **Same cause as "trunk" on dev: WordNet sense order.** e2b's 3 lost plain items are "share",
  "shy" and "nonchalant". With the note, "share" was defined as the noun ("a part. It is a piece of
  something") for a K-2 student, who almost certainly meant the verb. WordNet lists the noun first,
  and the 2025 edition dropped the frequency tag counts, so stored order is not usage order. The
  follow-up is #256: rank senses by overlap with the student's sentence and by part of speech,
  deterministically, before the cap.
- **The note can pass the gloss wording through.** For "nonchalant" (6-8), e2b quoted WordNet's
  "marked by blithe unconcern" before rephrasing it. The note asks for words the student can
  understand. The reading-level effect is not gated.
- **qwen3.5:4b gives much shorter replies with the note:** 3-5 went from 77 to 64 words, 6-8 from 78
  to 60 and 9-12 from 95 to 65, with no loss on any group. It also made 49 tool calls in B and 0 in
  D: with the entry in hand, it stopped searching.
- **On the strict sense reading, D gains on all three models** (+1, +2 and +2 target-strict). The
  "explain only the meaning that fits" instruction is the likely cause. None of these reach
  significance, and B8 is descriptive, so this is not a claim.
