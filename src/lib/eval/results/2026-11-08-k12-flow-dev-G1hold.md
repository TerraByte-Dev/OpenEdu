# k12-flow (attempt-first) — first-turn hold A/B — `gemma4:e2b`, `gemma4:e4b`, `qwen3.5:4b` — dev — 2026-11-08

> **PRE-REGISTERED, NOT YET RUN.** No model has been run for this lever. This file holds the run
> plan; the results sections are filled in after the runs, below the plan, without editing it.
>
> **DEV, not a test result.** The 240 k12-mc items are DEV for this flow (`docs/BENCHMARKS.md`
> section 0). The detectors have not passed the hand-label check (κ ≥ 0.8).

Lever (PR #197, issue #195): when the student's newest message poses a problem with a lettered option
list and no try of their own after the options, `TutorEngine.run` appends `FIRST_TURN_HOLD_NOTE`
(`src/lib/kernel/attemptFirst.ts`) to that user message, after the grounding block and the student's
text. No model call is added; the system prompt is byte-identical on every turn. Prompt-wording
iteration 1 of at most 3.

The pre-registration is the section "Pre-registration" in the body of
[PR #197](https://github.com/TerraByte-Dev/OpenEdu/pull/197), posted 2026-11-08T03:38:38Z, before any
model run. It is the canonical text; the summary below does not replace it.

## Plan (from the pre-registration)

| | |
|---|---|
| Baseline arm B | master `cce30513bdd7e23d30e40e36eeb015b1bd7296b6` |
| Lever arm L | `32219a69e92d29876ef3e1e039ea63a62ce9805e` |
| Items | 240 dev, no `EVAL_LIMIT` / `EVAL_SAMPLE` / `EVAL_ONLY` (as the L1 run) |
| Call | `EVAL_SUITE=k12-flow EVAL_MODEL=<model> EVAL_WIRE=1 npm run eval`, from `C:/x/oe-g1` with the arm's commit checked out (detached) |
| Repeats | 3 per arm per model, order B1 L1 B2 L2 B3 L3 per model; models e2b, e4b, qwen3.5:4b |
| Unit of analysis | item-majority (≥ 2 of 3 repeats; an ERROR repeat is a fail), n = 240, Wilson 95%; paired exact McNemar |

Kill rule (verbatim): "Kill if, on either gemma model, G1 does not rise by >= 8 points with McNemar
p < 0.05, or the headline falls, or G3 falls by more than 3 points, or any added model call."

Thresholds as pre-registered: G1 needs k_L − k_B ≥ 20 items, c > b and p < 0.05 on each gemma model;
the headline falls if k_L < k_B; G3 falls by more than 3 points if k_B − k_L ≥ 8 items.

## Runs

Not run yet. For each run: start (UTC), wall, free RAM, VRAM in use, `ollama ps` before, commit and
`srcDirty` from the JSON, ERROR rows, void or not, results JSON path.

## Results

Not run yet.
