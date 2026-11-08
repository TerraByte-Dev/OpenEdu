# Turn classifier (lever 9b) — RAG dev under the product-course prompt, plus a k12-flow MC guard — `gemma4:e2b`, `qwen3.5:4b`, `gemma4:e4b` — dev — 2026-11-08

> **PRE-REGISTERED, NOT YET RUN.** No model has been run for this lever. This file holds the run
> plan; the results sections are filled in after the runs, below the plan, without editing it.
>
> **DEV, not a test result.** Sets: dev vault v2 (`rag-dev-v2.ts`), RAG held-out v1 `dev`, and the 240
> k12-mc items (DEV for k12-flow). The classifier's second revision was written after reading the RAG
> dev question texts (never model answers), so on these sets the trigger is in-sample.

Lever (PR #205, issue #204, stacked on #197): `src/lib/kernel/turnKind.ts` classifies the student's
newest message. An option-list problem gets #197's `FIRST_TURN_HOLD_NOTE`; a typed problem gets
`TYPED_PROBLEM_HOLD_NOTE` (the same note minus its two option clauses); a fact lookup gets
`FACT_LOOKUP_NOTE` (answer directly first, at most one check question; source rules stay with the
grounding block). Each is appended to that user turn only, never saved; the system prompt is
byte-identical on every turn. Prompt-wording iteration 1 of at most 3 for each new note.

The pre-registration is the section "Pre-registration" in the body of
[PR #205](https://github.com/TerraByte-Dev/OpenEdu/pull/205), posted 2026-11-08T13:55:22Z, before any
model run. It is the canonical text; the summary below does not replace it.

## Plan: RAG part (from the pre-registration)

| | |
|---|---|
| Commit | this lever merged with #196 (`EVAL_PROMPT`); SHA recorded at run time, `srcDirty: false` |
| Arms | L: notes on. B: `EVAL_TURN_NOTES=off`. Same commit |
| Call | `EVAL_SET=<dev-v2\|dev> EVAL_PROMPT=product-course EVAL_MODES=always EVAL_SYLLABUS=matched EVAL_REPEATS=3 EVAL_WIRE=1 EVAL_MODEL=<model> [EVAL_TURN_NOTES=off] npm run eval` |
| Order | per model: B dev-v2, L dev-v2, B dev, L dev; models e2b, qwen3.5:4b, e4b |
| Unit | item-majority (≥ 2 of 3; ERROR = fail), Wilson 95%, paired exact McNemar; rows beside items |

Kill rule (verbatim): "Kill if, on gemma4:e2b under product-course rules, name-free positives passing
does not rise by >= 10 items, or the near-miss harm proxy loses more than 1 item, or real-world
answered rows fall."

Thresholds as pre-registered: name-free k_L − k_B ≥ 10 of 22 items; harm proxy (near-miss items clean,
dev-v2 25 + v1 dev 18 = 43) k_B − k_L ≥ 2 kills; real-world answered L rows < B rows (of 75) kills.
qwen3.5:4b and e4b are reported, not applied. The `turnKind` distribution must equal the pins in
`turn-kind-dev.test.ts`, else the run is void.

## Plan: k12-flow MC guard

e2b and e4b, all 240 dev items, 1 repeat, `EVAL_SUITE=k12-flow EVAL_MODEL=<model> EVAL_WIRE=1 npm run eval`
at #197's tip (B) and this lever's head (L), detached, order B L per model.

Kill rule (verbatim): "Kill if G1 or the headline falls by more than 2 points on either gemma model."
As read: a drop of 5 items or more of 240. The T1, T2 and T3 requests are byte-identical between the
arms given the same earlier replies (tested), so this guard can only fire on sampling noise.

## Runs

Not run yet.

## Results

Not run yet.
