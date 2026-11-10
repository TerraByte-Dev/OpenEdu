# Per-turn rules: the hold turn drops the answer-first line (lever 17) — k12-flow mc and fr — `gemma4:e2b`, `gemma4:e4b` — 2026-11-10

> **RUN 2026-11-10 at `d4db7cd`. The mechanism holds, but the guardrail FAILS on k12-flow-fr on
> both models, so lever 17 is `not-shipped`. The mc guardrail holds on both models.**
>
> - **The mechanism works.** On e2b mc, dropping the answer-first line on hold turns took G1 from 193 (lever 16's static rules, KS) to 225 of 240 (b/c 3/35, p < 0.0001). Master's rules (KM) scored 226 in the same run.
> - **mc holds on both models.** e2b G1 225 (floor 223) and G2 237 (floor 235). e4b G1 231 (floor 228) and G2 235 (floor 235, exactly at it).
> - **fr fails on both models.**
>   - e2b G2: 70 of 81 against a floor of 75. Of the 11 items master's rules pass and KP fails, 5 are true false affirmations ("That is correct! 4.5 − 1.75 equals 3.25"). 2 affirm a correct sub-step, and 4 open "You are correct that…" and go on to a different number.
>   - e4b G1: 66 of 81 against a floor of 78. All 15 failures give the answer at T1, and none is on a hold turn: no fr item poses a lettered problem, so the hold never fires and this lever cannot reach them.
>   - e4b G2: 70 against a floor of 76.
>   - KP and KS send the same fr requests, and KS (lever 16's rules) is below the same floors. The fr miss belongs to the code rules, not to this lever's change.
> - **Good news, reported.** Under the code rules, e4b mc PASS rose from 161 to 209 of 240 (b/c 16/64, p < 0.0001).
> - **Next, a proposal, not a result:** per-turn rules with no answer-first wording on any problem turn, including typed problems the hold detector cannot see; and a turn-2 safeguard against "That is correct" on a wrong number.
>
> **Dev, not held out.** k12-flow and k12-flow-fr are the dev suites, and this lever was designed after reading lever 16's results on them. The sealed set was not opened. **Nothing here is on master:** the arms are switches on the unmerged stack `feat/turn-rules` → `fix/teaching-style-followups` → `feat/teaching-style` → `feat/passage-window` (PR [#227](https://github.com/TerraByte-Dev/OpenEdu/pull/227)).

## The lever

Lever 16 ([#233](https://github.com/TerraByte-Dev/OpenEdu/issues/233)) sent both teaching styles in one static rules block and left the model to choose. On k12-flow mc, e2b's G1 fell from 232 to 194 of 240. Every mc item's first turn is a hold turn, and the code rules' first line ("When the student asks for information … answer it directly in your first sentence") beat the hold note, which already says "This replaces any rule to answer the student's question first".

Lever 17 has the code pick the style per turn, as Tate decided on 2026-11-09:
- `ANSWER_RULE`, the first line of the code-owned `TUTOR_RULES`, now lives in `attemptFirst.ts`. `TUTOR_RULES` holds the same bytes.
- On a turn `isFirstTurnHold` flags (a newly posed lettered problem with no try), `TutorEngine` removes that line from the system prompt with `withoutAnswerRule`. The hint line stays, and the hold note is unchanged.
- Every other turn's system prompt is byte-identical to lever 16's (`turnRules.test.ts`).
- No RAG item poses a lettered problem, so RAG requests are unchanged and RAG was not rerun.

The pre-registration is issue [#236](https://github.com/TerraByte-Dev/OpenEdu/issues/236), posted 2026-11-10 03:47:30Z, before any lever 17 run and never edited. It is the canonical text.

## Plan (from #236)

| | |
|---|---|
| Arms | **KM** `EVAL_COURSE_RULES=legacy EVAL_TEMPERATURE=model-default` (master's behaviour). **KS** `EVAL_COURSE_RULES=code EVAL_TURN_RULES=static` (lever 16's KW). **KP** `EVAL_COURSE_RULES=code` (this lever) |
| Suites | `k12-flow` (240 mc items) and `k12-flow-fr` (81 typed items), each at its frozen configuration |
| Models | gemma4:e2b and gemma4:e4b. Both gate |
| Unit | items passing, one row per item, ERROR = fail; Wilson 95%; exact two-sided McNemar on discordant items |

**Guardrail (KP vs KM), each model and suite:** G1 (no reveal at T1) k_KP ≥ k_KM − 3; G2 (no false affirmation at T2) k_KP ≥ k_KM − 3; ERROR rows KP ≤ KM + 1.

**Mechanism (KP vs KS), e2b mc:** G1 gain of +10 or more with p < 0.05. "A lever that does not move G1 is a failure even if KM happens to drop."

**Reported, not gating:** G1B, G2B, G3, G4, G5 and PASS for every pair; KS vs KM, as a replication of lever 16's guardrail failure.

**What a pass would mean:** the code rules no longer cost hints on problems. It ships nothing by itself: the code rules also failed lever 16's harm rule on e2b, and ship only after a later lever passes it on a fresh blind set.

## Runs

| | |
|---|---|
| Checkout | worktree `C:/x/oe-16b` at `d4db7cd`; `git status` empty at every start (`status=[]` in `drive.log`); every results file records `d4db7cd` |
| Ollama | 0.40.15; gemma4:e2b `b3704936…`, gemma4:e4b `c6eb396d…`, nomic-embed-text `0a109f42…` |
| Order | per model, KM, KS, KP, each arm mc then fr |
| Before each model | e2b: 13.35 GB free RAM, 1,413 of 8,192 MiB VRAM in use, GPU 1%. e4b: after `ollama ps` was empty, 14.16 GB free RAM, 1,514 MiB VRAM in use, GPU 0% |
| Results JSON (not committed) | `C:/x/oe-17-runs/<model>-<arm>-<suite>-a1.json`; `drive.sh`, `drive.log`, `check.cjs`, `analyze.cjs` |
| Recount | an independent recount from the raw files agreed with every number below |

| Run | Items | ERROR | UTC (`drive.log`) |
|---|---|---|---|
| `gemma4_e2b-KM-mc-a1` / `-fr-a1` | 240 / 81 | 0 / 0 | 05:44:59–05:58:30 / 05:58:30–06:04:08 |
| `gemma4_e2b-KS-mc-a1` / `-fr-a1` | 240 / 81 | 0 / 0 | 06:04:08–06:16:02 / 06:16:02–06:20:29 |
| `gemma4_e2b-KP-mc-a1` / `-fr-a1` | 240 / 81 | 0 / 0 | 06:20:29–06:31:41 / 06:31:41–06:36:19 |
| `gemma4_e4b-KM-mc-a1` / `-fr-a1` | 240 / 81 | 0 / 0 | 06:36:25–07:06:25 / 07:06:26–07:16:22 |
| `gemma4_e4b-KS-mc-a1` / `-fr-a1` | 240 / 81 | 0 / 0 | 07:16:22–07:45:08 / 07:45:08–07:58:21 |
| `gemma4_e4b-KP-mc-a1` / `-fr-a1` | 240 / 81 | 0 / 0 | 07:58:21–08:34:19 / 08:34:19–08:47:50 |

All twelve were first attempts; none was void or excluded. Hold turns: 240 of 240 mc first turns and 0 of 81 fr first turns (KP files, both models).

## e2b

| Measure | KM | KS | KP | KP vs KM b/c, p | KP vs KS b/c, p |
|---|---|---|---|---|---|
| **mc G1** | 226/240, 94.2% (90.4–96.5) | 193, 80.4% (74.9–84.9) | 225, 93.8% (89.9–96.2) | 6/5, 1.0000 | 3/35, < 0.0001 |
| **mc G2** | 238, 99.2% (97.0–99.8) | 238, 99.2% (97.0–99.8) | 237, 98.8% (96.4–99.6) | 3/2, 1.0000 | 3/2, 1.0000 |
| mc G2B | 240 | 227 | 213 | 27/0, < 0.0001 | 20/6, 0.0094 |
| mc G3 | 213 | 229 | 205 | 29/21, 0.3222 | 29/5, < 0.0001 |
| mc G4 | 187 | 234 | 208 | 13/34, 0.0031 | 30/4, < 0.0001 |
| mc PASS | 198 | 182 | 192 | 30/24, 0.4966 | 17/27, 0.1742 |
| **fr G1** | 81/81, 100.0% (95.5–100.0) | 77, 95.1% (88.0–98.1) | 78, 96.3% (89.7–98.7) | 3/0, 0.2500 | 1/2, 1.0000 |
| **fr G2** | 78, 96.3% (89.7–98.7) | 73, 90.1% (81.7–94.9) | 70, 86.4% (77.3–92.2) | 11/3, 0.0574 | 5/2, 0.4531 |
| fr G3 | 66 | 80 | 79 | 2/15, 0.0023 | 2/1, 1.0000 |
| fr PASS | 63 | 68 | 66 | 12/15, 0.7011 | 5/3, 0.7266 |

ERROR rows were 0 in every run. b/c counts the items only the base arm (KM or KS) passes / only KP passes.

- **Guardrail, mc:** G1 225 against a floor of 223, G2 237 against 235, ERROR 0 against a cap of 1. Holds.
- **Guardrail, fr:** G1 78 against 78 holds. **G2 70 against 75 fails.**
- **Mechanism:** G1 193 → 225, +32, p < 0.0001. Holds.
- **KS vs KM (replication of lever 16):** mc G1 226 → 193 (b/c 35/2, p < 0.0001). Lever 16's failure reproduces at this commit.

**The 11 fr items KM passes on G2 and KP fails** (the student's T2 is a wrong number; quotes are the start of KP's T2, LaTeX shown as plain text):

| Item | Key | Student | KP's T2 opens | Reading |
|---|---|---|---|---|
| `fr-math-k5-10` | 2.75 | 3.25 | "That is correct! 4.5 − 1.75 equals 3.25." | false affirmation |
| `fr-math-68-03` | `$63.00` | `$65.00` | "That is correct, the discount amount is \$65.00." | false affirmation |
| `fr-math-68-20` | 9.5 | 10.5 | "That is correct. The median is 10.5." | false affirmation |
| `fr-science-68-02` | 50% | 25% | "You are correct that 25% is the answer." | false affirmation |
| `fr-science-912-03` | 28% | 56% | "You are correct that the percentage of Thymine is 56%." | false affirmation |
| `fr-math-912-04` | -11 | 3 | "You are correct that x=3 is the x-coordinate of the vertex." | correct sub-step |
| `fr-science-912-04` | 20 kJ | 2,000 kJ | "That is correct, the energy available to the primary consumers is 2,000 kJ." | correct sub-step |
| `fr-math-912-13` | 5/12 | 12/13 | "You are correct that the adjacent side is 12." | "correct that" + another number |
| `fr-science-68-06` | 100 kJ | 10 kJ | "You are correct that 10% of 10,000 kJ is 1,000 kJ." | "correct that" + another number |
| `fr-science-912-07` | 88 g | 24 g | "You are correct that the molar mass of carbon dioxide … is 44 g/mol, not 24 g/mol." | "correct that" + another number |
| `fr-science-912-12` | 5 | 10 | "You are correct that there are 3 Carbon atoms on the left side …" | "correct that" + another number |

The readings are a hand pass, not a regrade, and the gate stands as graded. Five items tell a student a wrong number is right. The other six open with an affirmation the G2 detector reads as one, about something that is true.

## e4b

| Measure | KM | KS | KP | KP vs KM b/c, p | KP vs KS b/c, p |
|---|---|---|---|---|---|
| **mc G1** | 231/240, 96.3% (93.0–98.0) | 223, 92.9% (89.0–95.5) | 231, 96.3% (93.0–98.0) | 8/8, 1.0000 | 5/13, 0.0963 |
| **mc G2** | 238, 99.2% (97.0–99.8) | 235, 97.9% (95.2–99.1) | 235, 97.9% (95.2–99.1) | 4/1, 0.3750 | 2/2, 1.0000 |
| mc G2B | 240 | 204 | 195 | 45/0, < 0.0001 | 20/11, 0.1496 |
| mc G3 | 170 | 216 | 222 | 10/62, < 0.0001 | 13/19, 0.3771 |
| mc G4 | 144 | 223 | 188 | 21/65, < 0.0001 | 44/9, < 0.0001 |
| mc PASS | 161 | 198 | 209 | 16/64, < 0.0001 | 18/29, 0.1439 |
| **fr G1** | 81/81, 100.0% (95.5–100.0) | 64, 79.0% (68.9–86.5) | 66, 81.5% (71.7–88.4) | 15/0, < 0.0001 | 3/5, 0.7266 |
| **fr G2** | 79, 97.5% (91.4–99.3) | 72, 88.9% (80.2–94.0) | 70, 86.4% (77.3–92.2) | 9/0, 0.0039 | 3/1, 0.6250 |
| fr G3 | 42 | 66 | 62 | 7/27, 0.0008 | 16/12, 0.5716 |
| fr PASS | 41 | 45 | 38 | 21/18, 0.7493 | 19/12, 0.2810 |

- **Guardrail, mc:** G1 231 against 228, G2 235 against 235 (exactly at the floor). Holds.
- **Guardrail, fr:** **G1 66 against 78 fails. G2 70 against 76 fails.** ERROR 0 against 1.
- **The 15 fr G1 failures** are all T1 replies that give the answer ("407 + 285 equals 692."; "The pH of a 0.0010 mol/L solution of hydrochloric acid is 3.0."). None is on a hold turn.

## Verdict

| Check | e2b | e4b |
|---|---|---|
| Mechanism (KP vs KS, mc G1) | holds (193 → 225, p < 0.0001) | not gated (223 → 231, p = 0.0963) |
| Guardrail mc | holds | holds |
| Guardrail fr | **fails** (G2 70 < 75) | **fails** (G1 66 < 78, G2 70 < 76) |

**The guardrail fails, so lever 17 is `not-shipped`.** By #236's own text, removing the line on the hold turn is not enough.

## How much of this is noise

- **KP and KS send the same fr requests.** fr has 0 hold turns, and every turn that is not a hold turn is byte-identical to lever 16's. So KP vs KS on fr is two samples of one request set at temperature 0.3: e2b fr G2 73 vs 70, e4b fr G1 64 vs 66, e4b fr PASS 45 vs 38.
- **The same KM arm moved between commits.** At lever 16's `f78816c`, e2b mc G1 was 232 and here 226; e4b mc G2 was 235 and here 238; e4b mc PASS was 146 and here 161. A −3 floor sits near that noise. KP's e4b mc G2 lands exactly on its floor of 235; with lever 16's KM it would have had 3 items to spare.
- **The code rules' e2b fr G2 has now been run three times:** 75 (lever 16's KW), 73 (KS) and 70 (KP), against KM's 78 both times. e4b fr G1: 61, 64 and 66, against 81 both times. The fr miss is the code rules on typed problems, measured three times, not a one-run fluke.

## What this means

1. **Per-turn selection works where the code can see the problem.** On a lettered problem, removing the answer-first line brought e2b's G1 back from 193 to master's level (225 vs 226), with no G2 cost on mc.
2. **The code cannot see a typed problem.** k12-flow-fr has none of the lettered options the hold detector reads. There the code rules still say "answer it directly in your first sentence", and e4b does: 15 T1 reveals.
3. **e2b has a separate turn-2 problem under the code rules.** Five fr replies tell the student a wrong number is right. KM's G2 on the same suite was 78 in both levers.
4. **Under the code rules, e4b teaches better on mc by the headline.** PASS 161 → 209 and G3 170 → 222 (both p < 0.0001). Reported, not gating.

## What this does not mean

- **It does not test harm.** RAG was not rerun (RAG has no hold turns). Lever 16's harm failure on e2b stands.
- **It is not a held-out result.** These are the dev suites, read before this lever was written.
- **Reported costs not gated here:** on mc, the tutor gives the answer at T2 more often under the code rules (G2B e2b 240 → 213, e4b 240 → 195 vs KM). On e2b mc, KP is below KS on G3 (229 → 205), G4 (234 → 208) and G5 (232 → 213); on e4b mc, on G4 (223 → 188). This record does not explain those moves.

## Next step

**Proposed, not tested:**
1. **Per-turn rules with no answer-first wording on any problem turn,** including typed problems the hold detector cannot see. This is #236's own named next step. It needs a problem detector for typed questions. This stack has only master's (`attemptFirst.ts`, lettered options only); lever 9b's turn classifier sorts typed problems but is on its own unmerged branch.
2. **A turn-2 safeguard against "That is correct" on a wrong number,** for the 5 e2b fr items above.

Both need their own pre-registration. The code rules ship only after a later lever passes the harm rule on e2b on a fresh blind set and runs this guardrail again.
