# Code-owned teaching rules and a tutor temperature (lever 16) — RAG blind set of long notes under the product-course prompt, and the k12-flow guardrail — `gemma4:e2b`, `gemma4:e4b` — 2026-11-10

> **RUN 2026-11-10 at `f78816c`. Rules 2 and 3 FAIL on e2b, the k12-flow guardrail FAILS on both
> models, and the temperature-alone fallback fails its own guardrail on e2b. Lever 16 is
> `not-shipped`. Rule 1 (temperature) holds on both models.**
>
> - **The gain (e2b, RAG).** From master's behaviour (M) to the full proposal (W), positives went from 12 to 32 of 64 (b/c 4/24, p = 0.0002) and real-world answered from 1 to 22 of 48 (p < 0.0001).
> - **Rule 2 (code rules, P vs T) fails twice.** Positives rose +7 (15 → 22), but p = 0.1185. H(P) fails: 4 borrowed against a cap of 2.
> - **Rule 3 (window, W vs P) fails on harm.** Positives rose +10 (22 → 32), p = 0.0129, but H(W) fails: 5 borrowed against a cap of 3.
> - **The guardrail fails on both models.**
>   - e2b mc: G1 232 → 194 of 240 (floor 229) and G2 237 → 233 (floor 234).
>   - e4b mc G1 231 → 220 (floor 228); e4b fr G1 81 → 61 of 81 (floor 78) and G2 79 → 72 (floor 76).
>   - All 46 of e2b's mc G1 failures are on hold turns. The code rules' first line ("When the student asks for information … answer it directly in your first sentence") beat the hold note. KT (master's rules at 0.3) scored G1 230, so the cause is the rules, not the temperature.
> - **Temperature alone does not ship either.** Rule 1 holds, but KT fails e2b fr G2 by one item (74 against a floor of 75).
> - **Good news, reported.** On e4b every RAG rule holds. The window took positives from 27 to 40 of 64 (b/c 2/15, p = 0.0023) with 0 borrowed. The code rules took real-world answered from 0 to 20 of 48 on e2b and from 2 to 29 on e4b (both p < 0.0001).
>
> **Blind, not held out.** The gate set was written by a fresh agent after the pre-registration. The sealed set was not opened. **Nothing here is on master:** the arms are switches on the unmerged stack `fix/teaching-style-followups` → `feat/teaching-style` → `feat/passage-window` (PR [#227](https://github.com/TerraByte-Dev/OpenEdu/pull/227)).

## The lever

Two changes, tested as separate arms at one commit.

1. **`buildSystemPrompt` sends code-owned `TUTOR_RULES` in place of a course's stored rules row.** The stored row ("Guide the student to discover answers rather than giving them immediately") is saved into every course at generation and argued against every lookup lever. The new rules:
   - answer an information request in the first sentence;
   - use a note only when it is about the exact thing asked;
   - give a hint or the next step, not the full solution, when the student is working on a problem.
   - Scope, mastery, quiz-mode and math-formatting lines are unchanged. The kernel's hold notes (`attemptFirst.ts`) still apply. The old text stays as `LEGACY_TUTOR_RULES` for the paired arms.
2. **Tutor turns send temperature 0.3** (`TUTOR_TEMPERATURE`). Before, the kernel sent none and gemma4 sampled at its default of 1.0.

The window (lever 14, `passageFor`) is on this stack and is its own arm. Product decision (Tate, 2026-11-09): lookups are answered and cited; problems get a hint.

The pre-registration is issue [#233](https://github.com/TerraByte-Dev/OpenEdu/issues/233), posted 2026-11-10 00:43:27Z before the blind set existed, with two dated comments before any run. It is the canonical text.

## Plan (from #233)

| | |
|---|---|
| RAG arms | **M** `EVAL_COURSE_RULES=legacy EVAL_TEMPERATURE=model-default EVAL_PASSAGE_WINDOW=off` (master's behaviour). **T** `EVAL_COURSE_RULES=legacy EVAL_PASSAGE_WINDOW=off` (+ temperature 0.3). **P** `EVAL_PASSAGE_WINDOW=off` (+ code rules). **W** unset (+ the window: the proposal) |
| RAG call | `EVAL_SET=blind-16 EVAL_PROMPT=product-course EVAL_MODES=always EVAL_SYLLABUS=matched EVAL_REPEATS=3 EVAL_WIRE=1` plus the arm's switches |
| Gate set | `blind-16`: 16 notes on 16 new topics, 64 positives, 48 near-misses with real-world answers; sha256 `81cf5ecb…6d8267f00`; committed at `f78816c` |
| k12-flow guardrail | `k12-flow` (240 mc) and `k12-flow-fr` (81 typed), each at its frozen configuration. **KM** `EVAL_COURSE_RULES=legacy EVAL_TEMPERATURE=model-default`. **KW** `EVAL_COURSE_RULES=code`. **KT** `EVAL_COURSE_RULES=legacy` (added by the pre-run amendment; gates only the T-alone fallback). The window is on in every k12 arm |
| Models | gemma4:e2b gates. gemma4:e4b is a check: a miss there blocks |
| Unit | RAG: item-majority (≥ 2 of 3; ERROR = fail). k12-flow: one row per item, ERROR = fail. Wilson 95%, exact two-sided McNemar on discordant items |

**Harm rule H(arm):** borrowed ≤ ⌊positives passing ÷ 10⌋. An item is borrowed when its majority answer contains the note's poison value (case-insensitive substring).

**Rule 1 (T vs M), both models:** positives k_T ≥ k_M − 3; borrowed T ≤ M + 1; ERROR rows T ≤ M + 1.

**Rule 2 (P vs T):** on e2b, positives +6 or more with p < 0.05, H(P) holds, ERROR rows P ≤ T + 1. On e4b, positives k_P ≥ k_T − 3 and H(P) holds.

**Rule 3 (W vs P):** on e2b, positives +4 or more with p < 0.05 and H(W) holds. On e4b, positives k_W ≥ k_P − 3 and H(W) holds.

**Guardrail (KW vs KM), each model and suite:** G1 (no reveal at T1) and G2 (no false affirmation at T2) each k_KW ≥ k_KM − 3. The ERROR cap (arm ≤ base + 1) applies to every gated comparison.

**What ships:** W if everything holds; P if only Rule 3 fails; if Rule 2 or the guardrail fails, the code rules do not ship and T ships alone only if Rule 1 holds and KT meets the same G1/G2 floors; if Rule 1 fails, nothing.

## Runs

| | |
|---|---|
| Checkout | worktree `C:/x/oe-16` at `f78816c`; `git status` empty at every start (`status=[]` in `drive.log`); `srcDirty: false` on every RAG file |
| Review | an independent pre-run review found no blockers: M reproduces master's request on the wire, and each arm differs only by its switch |
| Order | per model: M, T, P, W, then KM-mc, KM-fr, KT-mc, KT-fr, KW-mc, KW-fr, as amended before any run |
| Before each model | e2b: 8.27 GB free RAM, 2,874 of 8,192 MiB VRAM in use, GPU 26%. e4b: after `ollama ps` was empty, 14.01 GB free RAM, 2,172 MiB VRAM in use, GPU 18% |
| Results JSON (not committed) | `C:/x/oe-16-runs/<model>-<arm>-a<n>.json`; `drive.sh`, `drive.log`, `check.cjs`, `analyze.cjs` |
| Recounts | An independent regrade recomputed every e2b count from the raw files without `analyze.cjs`: 0 of 1,344 RAG rows and 0 k12 rows disagreed. A second recount agreed with every e4b number |

| Run | Rows | ERROR | UTC (`drive.log`) |
|---|---|---|---|
| `gemma4_e2b-M-a1` | 336 | 0 | 01:06:42–01:11:33 |
| `gemma4_e2b-T-a1` | — | — | 01:11:34–01:12:08, **void**: no results file |
| `gemma4_e2b-T-a2` | 336 | 0 | 01:12:09–01:17:10 |
| `gemma4_e2b-P-a1` | 336 | 0 | 01:17:11–01:20:44 |
| `gemma4_e2b-W-a1` | 336 | 0 | 01:20:46–01:27:42 |
| `gemma4_e2b-KM-mc-a1` / `-fr-a1` | 240 / 81 | 0 / 0 | 01:27:44–01:55:36 / 01:55:37–02:04:37 |
| `gemma4_e2b-KT-mc-a1` / `-fr-a1` | 240 / 81 | 0 / 0 | 02:04:38–02:29:47 / 02:29:48–02:41:46 |
| `gemma4_e2b-KW-mc-a1` / `-fr-a1` | 240 / 81 | 0 / 0 | 02:41:47–02:56:57 / 02:56:58–03:01:53 |
| `gemma4_e4b-M-a1` | 336 | 0 | 03:02:04–03:15:56 |
| `gemma4_e4b-T-a1` | 336 | 0 | 03:15:58–03:30:04 |
| `gemma4_e4b-P-a1` | 336 | 0 | 03:30:05–03:36:46 |
| `gemma4_e4b-W-a1` | 336 | 0 | 03:36:46–03:42:50 |
| `gemma4_e4b-KM-mc-a1` / `-fr-a1` | 240 / 81 | 0 / 0 | 03:42:51–04:13:47 / 04:13:48–04:23:51 |
| `gemma4_e4b-KT-mc-a1` / `-fr-a1` | 240 / 81 | 0 / 0 | 04:23:52–04:53:43 / 04:53:44–05:04:26 |
| `gemma4_e4b-KW-mc-a1` / `-fr-a1` | 240 / 81 | 0 / 0 | 05:04:27–05:33:30 / 05:33:31–05:44:41 |

**One void.** The host's memory-pressure reaper killed e2b T a1's eval process, so it wrote no results file. The driver logged it as void and reran it once as T a2, under the void rule. Every other run was valid on its first attempt. (The log's first note on the kill said the driver itself was stopped; a correction at 03:13:21Z records that only the eval process was killed and every later run came from the same driver.)

## e2b, RAG (the rules)

| Metric (items of 64 / 48) | M | T | P | W |
|---|---|---|---|---|
| Positives passing | 12, 18.8% (11.1–30.0) | 15, 23.4% (14.7–35.1) | 22, 34.4% (23.9–46.6) | 32, 50.0% (38.1–61.9) |
| Borrowed | 2, 4.2% (1.2–14.0) | 2, 4.2% (1.2–14.0) | 4, 8.3% (3.3–19.6) | 5, 10.4% (4.5–22.2) |
| H: cap ⌊positives ÷ 10⌋ | 1, fails | 1, fails | 2, fails | 3, fails |
| Real-world answered | 1, 2.1% (0.4–10.9) | 0, 0.0% (0.0–7.4) | 20, 41.7% (28.8–55.7) | 22, 45.8% (32.6–59.7) |
| Near-miss clean (old harm proxy) | 45 | 45 | 44 | 43 |
| Over-refusal | 5 | 6 | 14 | 12 |
| *Mechanism:* positive's answer in the shown block | 34 | 34 | 34 | 51 |
| ERROR rows | 0 | 0 | 0 | 0 |

| Pair (b/c, p) | T vs M | P vs T | W vs P | W vs M |
|---|---|---|---|---|
| Positives | 2/5, 0.4531 | 4/11, 0.1185 | 2/12, 0.0129 | 4/24, 0.0002 |
| Borrowed | 0/0, 1.0000 | 1/3, 0.6250 | 0/1, 1.0000 | 1/4, 0.3750 |
| Real-world answered | 1/0, 1.0000 | 0/20, < 0.0001 | 0/2, 0.5000 | 0/21, < 0.0001 |

- **Rule 1 holds.** Positives 12 → 15 (floor 9), borrowed 2 → 2 (cap 3), ERROR 0 → 0.
- **Rule 2 fails.** Positives +7 with p = 0.1185 (needs p < 0.05), and H(P) fails (4 > 2). ERROR 0 → 0.
- **Rule 3 fails.** Positives +10 with p = 0.0129 holds, but H(W) fails (5 > 3). ERROR 0 → 0.

**Notes on H, reported without changing it.**
- H fails master's behaviour too (M: 2 borrowed, cap 1).
- Two borrowed items are matching artefacts: `sorting-n3`'s poison "merge sort" is a substring of a correct Timsort answer, and `magnet-n1` answers "tesla metre squared". Without those two, H would hold for P (2 ≤ 2) and W (3 ≤ 3).
- Clear borrowings: "John Glenn" for the first American in space, and 950 °C for alumina's melting point.
- #236 records a new borrowed definition for later levers (poison present **and** the real-world answer absent), decided after this data was seen. Under it, e2b P has 3 and W has 4, still above their caps. Every lever 16 verdict is the same under both definitions, and this record stands on the old one, as pre-registered.

## e4b, RAG (a miss blocks)

| Metric (items of 64 / 48) | M | T | P | W |
|---|---|---|---|---|
| Positives passing | 21, 32.8% (22.6–45.0) | 24, 37.5% (26.7–49.7) | 27, 42.2% (30.9–54.4) | 40, 62.5% (50.3–73.3) |
| Borrowed | 4, 8.3% (3.3–19.6) | 4, 8.3% (3.3–19.6) | 2, 4.2% (1.2–14.0) | 0, 0.0% (0.0–7.4) |
| H: cap ⌊positives ÷ 10⌋ | 2, fails | 2, fails | 2, holds | 4, holds |
| Real-world answered | 4, 8.3% (3.3–19.6) | 2, 4.2% (1.2–14.0) | 29, 60.4% (46.3–73.0) | 27, 56.3% (42.3–69.3) |
| Near-miss clean (old harm proxy) | 43 | 43 | 46 | 48 |
| Over-refusal | 0 | 2 | 10 | 8 |
| *Mechanism:* positive's answer in the shown block | 34 | 34 | 34 | 51 |
| ERROR rows | 0 | 0 | 0 | 0 |

| Pair (b/c, p) | T vs M | P vs T | W vs P | W vs M |
|---|---|---|---|---|
| Positives | 1/4, 0.3750 | 0/3, 0.2500 | 2/15, 0.0023 | 1/20, < 0.0001 |
| Borrowed | 1/1, 1.0000 | 3/1, 0.6250 | 2/0, 0.5000 | 4/0, 0.1250 |
| Real-world answered | 4/2, 0.6875 | 0/27, < 0.0001 | 4/2, 0.6875 | 0/23, < 0.0001 |

- **Rule 1 holds:** positives 21 → 24 (floor 18), borrowed 4 → 4 (cap 5), ERROR 0 → 0.
- **Rule 2 holds:** positives 24 → 27 (floor 21), H(P) 2 ≤ 2.
- **Rule 3 holds:** positives 27 → 40 (floor 24), H(W) 0 ≤ 4.

**Rep agreement** (all 3 reps agree, positives; reported, not tested): e2b M 50, T 56, P 62, W 61 of 64; e4b M 52, T 58, P 59, W 59.

## k12-flow guardrail

**KW vs KM (gates the code rules):**

| Model | Suite | Measure | KM | KW | Floor | b/c, p | |
|---|---|---|---|---|---|---|---|
| e2b | mc | G1 | 232/240, 96.7% (93.6–98.3) | 194, 80.8% (75.4–85.3) | 229 | 41/3, < 0.0001 | **fails** |
| e2b | mc | G2 | 237, 98.8% (96.4–99.6) | 233, 97.1% (94.1–98.6) | 234 | 6/2, 0.2891 | **fails** |
| e2b | fr | G1 | 81/81, 100.0% (95.5–100.0) | 78, 96.3% (89.7–98.7) | 78 | 3/0, 0.2500 | holds |
| e2b | fr | G2 | 78, 96.3% (89.7–98.7) | 75, 92.6% (84.8–96.6) | 75 | 5/2, 0.4531 | holds |
| e4b | mc | G1 | 231/240, 96.3% (93.0–98.0) | 220, 91.7% (87.5–94.5) | 228 | 17/6, 0.0347 | **fails** |
| e4b | mc | G2 | 235, 97.9% (95.2–99.1) | 234, 97.5% (94.7–98.8) | 232 | 5/4, 1.0000 | holds |
| e4b | fr | G1 | 81/81, 100.0% (95.5–100.0) | 61, 75.3% (64.9–83.4) | 78 | 20/0, < 0.0001 | **fails** |
| e4b | fr | G2 | 79, 97.5% (91.4–99.3) | 72, 88.9% (80.2–94.0) | 76 | 9/2, 0.0654 | **fails** |

ERROR rows were 0 in every k12 run.

**KT vs KM (gates only the T-alone fallback):** e2b mc G1 230 (floor 229), mc G2 238 (floor 234), fr G1 81 (floor 78), **fr G2 74 (floor 75): fails** (b/c 6/2, p = 0.2891). e4b mc G1 232 (228), mc G2 236 (232), fr G1 81 (78), fr G2 78 (76): all hold.

**Reported, not gating** (KM / KW / KT, items passing):

| Model, suite | PASS (headline) | G2B (no reveal at T2) | G3 |
|---|---|---|---|
| e2b mc | 201 / 165 / 207 | 240 / 220 / 240 | 210 / 214 / 218 |
| e2b fr | 64 / 69 / 59 | 81 / 81 / 80 | 67 / 78 / 66 |
| e4b mc | 146 / 195 / 173 | 240 / 205 / 240 | 157 / 218 / 180 |
| e4b fr | 36 / 40 / 44 | 81 / 78 / 81 | 37 / 65 / 46 |

PASS KW vs KM: e2b mc b/c 56/20, p < 0.0001; e4b mc 27/76, p < 0.0001.

**Mechanism behind the mc G1 miss (e2b).**
- Every k12-flow mc item's first turn is a hold turn (`firstTurnHold: true` on 240 of 240 rows), and all 46 of KW's G1 failures are among them. The grader reads 44 as the key's text in T1 and 2 as a commit ("The correct answer is C) …").
- The student's message ends "Which one is right?". The code rules' first line ("When the student asks for information … answer it directly in your first sentence") beat the hold note, which already says "This replaces any rule to answer the student's question first".
- KT's G1 is 230, so the cause is the rules line, not the temperature.
- *Correction:* the e2b comment on #233 and the text of #236 say "44 of 46" failures were on hold turns. The run file shows 46 of 46; 44 is the count graded on the key's text.

## Verdict

| Check | e2b | e4b |
|---|---|---|
| Rule 1 (T vs M) | holds | holds |
| Rule 2 (P vs T) | **fails** (p = 0.1185; H(P) 4 > 2) | holds |
| Rule 3 (W vs P) | **fails** (H(W) 5 > 3) | holds |
| Guardrail KW vs KM | **fails** (mc G1, mc G2) | **fails** (mc G1, fr G1, fr G2) |
| Guardrail KT vs KM | **fails** (fr G2 74 < 75) | holds |

Rule 2 and the guardrail fail, so the code rules do not ship. T would ship alone only if KT met the guardrail, and on e2b it misses fr G2 by one item. **Nothing from lever 16 ships: `not-shipped`.**

## What this means

1. **The code rules do what they were for on lookups.** Real-world answered went from 0 to 20 of 48 on e2b and from 2 to 29 on e4b. That fits the earlier finding that the stored Socratic row is what made e2b answer lookups with a question: 2 of 22 note questions answered under the row, 19 of 22 with no rules ([rag-prompt-fidelity](2026-11-08-rag-prompt-fidelity.md)).
2. **On e2b the cost is borrowed values.** The rules alone added 7 positives (not significant) and 2 borrowed items; with the window, 5 borrowed against a cap of 3. Two of the five are matching artefacts and two are clear borrowings. The rule is the rule, and it fails.
3. **One static block with two teaching styles costs hints on problems.** The answer-first line beats the hold note on lettered problems (e2b mc G1 232 → 194), and on e4b it also reaches typed problems (fr G1 81 → 61). k12-flow-fr poses no lettered problem, so the hold note never fires there, and the model is left to choose between the two styles in one block.
4. **The window helps again on a model that answers.** e4b positives 27 → 40 with borrowed 2 → 0; e2b 22 → 32 with borrowed 4 → 5. The answer was in the shown text for 34 → 51 of 64 positives on both models.
5. **Temperature 0.3 is close to neutral on the gates.** Rule 1 holds on both models. Reps agree more often (positives, e2b 50 → 56, e4b 52 → 58 of 64; not tested). Its one miss is KT's e2b fr G2, one item under a floor whose McNemar p is 0.2891.

## What this does not mean

- **It does not say the code rules teach worse overall.** On e4b mc the headline rose from 146 to 195 of 240 under KW (p < 0.0001) and G3 from 157 to 218. On e2b mc it fell from 201 to 165 (p < 0.0001), driven by G1. These are reported, not gating.
- **It is not a held-out result.** `blind-16` is blind, not held out, and the sealed set was not opened.
- **The −3 floors sit near run-to-run noise.** Lever 17's runs repeated KM at `d4db7cd`: e2b mc G1 was 226 there against 232 here, and e4b mc G2 238 against 235. A one-item miss like KT's fr G2 is inside that range, but the floor is the floor.
- **Reported cost not gated here:** under the code rules the tutor gives the answer at T2 more often on mc (G2B e2b 240 → 220, e4b 240 → 205).

## Next step

**Lever 17** ([#236](https://github.com/TerraByte-Dev/OpenEdu/issues/236), `feat/turn-rules` at `d4db7cd`) has the code pick the style per turn: on a hold turn the system prompt drops the answer-first line. Its record is on that branch (`2026-11-10-k12-flow-turn-rules.md`). In short, the mechanism holds (e2b mc G1 193 → 225 of 240 against lever 16's static rules) and the guardrail fails on k12-flow-fr on both models, so it is not shipped either.

**Proposed, not tested:**
- per-turn rules with no answer-first wording on any problem turn, including typed problems the hold detector cannot see;
- a turn-2 safeguard against "That is correct" on a wrong number (lever 17's e2b fr runs show 5 such items).

Per #236, the code rules ship only after a later lever passes the harm rule on e2b on a fresh blind set and runs this guardrail again.
