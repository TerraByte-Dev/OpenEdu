# Mastery mark sweep, 2026-11-21 (OpenEdu)

Ported from TerraTutor #289, whose sweep answered TerraTutor's audit of 2026-11-21 (guardrails 2 and 5: "changes to
mastery marking need a probe set run before merge"). Run by Claude (agent) on OpenEdu branch
`fix/port-tt-model-mark-sweep`, cut from master `74af4a80`. No model, no GPU and no network were used: the model is a
scripted stand-in. Everything else is OpenEdu's own: the kernel (`tutorEngine.run`), the `ask_user.question` and
`progress.mark_mastered` tools, `progress.ts` and `db.ts` on an in-memory SQLite built from OpenEdu's migrations
(`src-tauri/src/lib.rs`), and OpenEdu's own picker, verdict and repeat texts (`PICKER_QUESTION`,
`NEXT_PICKER_QUESTION`, `VERDICT_FALLBACK`, `nonAnswerReply`, `hintAnswerBack`, `ASSESS_MESSAGE`).

**Source:** `src/lib/kernel/masteryMarkSweep.test.ts`. To rerun it and regenerate the "after" tables:
`SWEEP_OUT=<file> npx vitest run src/lib/kernel/masteryMarkSweep.test.ts`. The "before" table is the same file run on
master's `TutorEngine.ts`, `answerCheck.ts` and `assessPicker.ts` (the sweep was written first and run on master
before the fix went in).

## What was swept

1,733 generated cases (path x prior turn x answer kind x who marks), each through `tutorEngine.run` on a `tiny` chat
model (gemma4:e2b's tier, OpenEdu's default below 16 GB), where both the app's mark (`appMark`) and the model's own
`progress.mark_mastered` call can mark. The matrix is TerraTutor's, unchanged, so the two repos' numbers compare row
for row; the course is a three-skill multiplication level with two similar titles ("Equal Groups" / "Equal Groups
with Arrays" / "Sharing Fairly"). The paths, prior turns, answer kinds and markers are listed in the test file's
`PATHS`, `PRIORS`, `ANSWERS` and `Marker`.

**The expected outcome** of every case comes from the rule in `docs/ARCHITECTURE.md`, not from the code: a mark needs
a first-try correct verdict on a question about that exact skill, with no help before it (a plain yes to "Does that
make sense?" or "Are you ready?" uses no try), in a check still open, on a skill not already mastered, on a turn that
was not stopped, and with no "no" on the "Is that okay?" card. A **wrong mark** is a skill saved as learned that the
rule does not mark. A **missed mark** is one the rule marks and the code does not.

## Before (master `74af4a80`)

| Path | Cases | Rule marks | Code marks | Wrong marks | Missed marks |
|---|---|---|---|---|---|
| app picker | 148 | 10 | 30 | 23 | 3 |
| app picker, chip text typed | 142 | 10 | 30 | 23 | 3 |
| app picker, similar title | 142 | 10 | 30 | 23 | 3 |
| app picker, then model card | 142 | 10 | 30 | 23 | 3 |
| one skill left, no picker | 142 | 10 | 17 | 10 | 3 |
| typed into the picker, no pick | 142 | 10 | 26 | 23 | 7 |
| skill already mastered | 142 | 0 | 13 | 13 | 0 |
| app which-next card | 142 | 10 | 28 | 23 | 5 |
| app which-next card after verdict line | 142 | 10 | 28 | 23 | 5 |
| model's own which-next card | 142 | 10 | 26 | 23 | 7 |
| next skill named in prose | 142 | 10 | 26 | 23 | 7 |
| last skill left, named in prose | 142 | 10 | 13 | 10 | 7 |
| card on the opening turn | 15 | 6 | 8 | 4 | 2 |
| model's prose copy of a card | 8 | 0 | 2 | 2 | 0 |
| **All** | **1733** | **116** | **307** | **246** | **55** |

All 246 wrong marks came from the model's own call; the app's mark made none. 132 were the model's mark of a
subtopic other than the one the check was on; 114 were its mark of the checked skill where the rule allows none
(after help, "I don't know", a wrong try, a meaning question, "Yes but explain again", a hint or another message the
check counts as no try, or on an answer that only named a skill). OpenEdu master gives
the same numbers as TerraTutor master `056f0fa0` on every path.

## The fix (structural, no phrase constant)

1. On a `tiny` or `small` chat model, the model's own "mastered" mark must pass the gate the app's mark already uses
   (`TutorEngine.ts markTarget`, factored out of `appMark`; `modelMarkAllowed`), and must name the subtopic code
   knows the check is on. Otherwise it is refused with `MASTERY_REFUSED_NOT_FIRST_TRY`. Where code knows no exact
   subtopic (two or more not mastered and none picked), the model's choice stands, as before. `medium` and `large`
   models are not gated.
2. The learner's messages the check counts as no try still let the model's mark follow (`answerCheck.ts
   freeInCheck`, which shares `openCheckAt`'s own test, `usedNoTryAt`): a hint request, an answer to a hint's own
   question, one that answered nothing. The TerraTutor click test 2026-11-19 part 8 decision, pinned in
   `answerCheckTurn.test.ts`, keeps that.
3. `pickedNextSkill` lets a plain yes to a ready question (`usedNoTry`) come between the app's "which next?" pick and
   the next skill's first answer. Before, nothing in that check could mark the next skill there.
4. A call the kernel refuses without running it carries the kernel's own line in `toolCalls[].refused`.

## After (this branch)

| Path | Cases | Rule marks | Code marks | Wrong marks | Missed marks |
|---|---|---|---|---|---|
| app picker | 148 | 10 | 14 | 4 | 0 |
| app picker, chip text typed | 142 | 10 | 14 | 4 | 0 |
| app picker, similar title | 142 | 10 | 14 | 4 | 0 |
| app picker, then model card | 142 | 10 | 14 | 4 | 0 |
| one skill left, no picker | 142 | 10 | 14 | 4 | 0 |
| typed into the picker, no pick | 142 | 10 | 14 | 11 | 7 |
| skill already mastered | 142 | 0 | 0 | 0 | 0 |
| app which-next card | 142 | 10 | 10 | 0 | 0 |
| app which-next card after verdict line | 142 | 10 | 10 | 0 | 0 |
| model's own which-next card | 142 | 10 | 0 | 0 | 10 |
| next skill named in prose | 142 | 10 | 0 | 0 | 10 |
| last skill left, named in prose | 142 | 10 | 0 | 0 | 10 |
| card on the opening turn | 15 | 6 | 6 | 0 | 0 |
| model's prose copy of a card | 8 | 0 | 0 | 0 | 0 |
| **All** | **1733** | **116** | **110** | **31** | **37** |

**Wrong marks: 246 to 31. Missed marks: 55 to 37.** No row is wrong on the branch that was right on master. The
branch numbers are TerraTutor's after #289, row for row.

### New missed marks (right on master, missed on the branch): 9, all the model's own call

| Rows | Path | Why | In the same check |
|---|---|---|---|
| #1345, #1347, #1349 | model's own which-next card | A pick on the model's own card never counts; after it the check's skill reads as the one picked there, which is not mastered, so the app's which-next card never comes up. | **Known regression** (TerraTutor issue #288): nothing in that check can mark it. A new check marks it on its first answer (pinned in the sweep). |
| #1465, #1467, #1469 | next skill named in prose (two titles left) | A skill named only in prose never counts. | The app's which-next card comes up on this turn, and the first answer after its pick marks the skill (pinned). |
| #1585, #1587, #1589 | last skill left, named in prose | With one title left there is no which-next card (`nextPickerCard` wants two or more). | **Known regression** (TerraTutor issue #288): nothing in that check can mark it. A new check marks it on its first answer (pinned). |

On these 9 rows the app's own mark missed the skill on master too (the `app` rows of the same paths).

### Known wrong marks left: 31, all the model's own call, all on master too (TerraTutor issue #285)

| Class | Rows | Why it stays |
|---|---|---|
| The model's mark after a message the check counts as no try (a hint, the hint's own question answered, an answer that answered nothing, five hint requests) | 24, on six paths | The TerraTutor 2026-11-19 part 8 decision, pinned in `answerCheckTurn.test.ts`. |
| The model's mark of another skill where code knows no exact one (typed into the picker, two not mastered, no pick) | 7: #925, #927, #929, #933, #947, #949, #951 | `markTarget` gives `null`, so the model's choice stands, as documented. |

### Every row that differs from the rule on the branch

Each is an `it.fails` row in the sweep, so it flags if it starts to pass.

| Case | Rule | Code | Verdict | Tag | Why it stays |
|---|---|---|---|---|---|
| #076 typed into the picker, no pick / first try / right by code / app | 1.1 | none | correct |  | missed (conservative): two or more not mastered and no pick, so code knows no exact skill and makes no mark |
| #077 typed into the picker, no pick / "Yes" to "Does that make sense?" / right by code / app | 1.1 | none | correct |  | missed (conservative): two or more not mastered and no pick, so code knows no exact skill and makes no mark |
| #078 typed into the picker, no pick / "I'm ready!" to "Are you ready?" / right by code / app | 1.1 | none | correct |  | missed (conservative): two or more not mastered and no pick, so code knows no exact skill and makes no mark |
| #1345 model's own which-next card / first try / right by code / model's call | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): a pick on the model's own card never counts, and the app's which-next card never comes up after it, so nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #1347 model's own which-next card / "Yes" to "Does that make sense?" / right by code / model's call | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): a pick on the model's own card never counts, and the app's which-next card never comes up after it, so nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #1349 model's own which-next card / "I'm ready!" to "Are you ready?" / right by code / model's call | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): a pick on the model's own card never counts, and the app's which-next card never comes up after it, so nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #136 model's own which-next card / first try / right by code / app | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): a pick on the model's own card never counts, and the app's which-next card never comes up after it, so nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #137 model's own which-next card / "Yes" to "Does that make sense?" / right by code / app | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): a pick on the model's own card never counts, and the app's which-next card never comes up after it, so nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #138 model's own which-next card / "I'm ready!" to "Are you ready?" / right by code / app | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): a pick on the model's own card never counts, and the app's which-next card never comes up after it, so nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #1405 model's own which-next card / first try / right by code / model's call on another skill | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): a pick on the model's own card never counts, and the app's which-next card never comes up after it, so nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #1407 model's own which-next card / "Yes" to "Does that make sense?" / right by code / model's call on another skill | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): a pick on the model's own card never counts, and the app's which-next card never comes up after it, so nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #1409 model's own which-next card / "I'm ready!" to "Are you ready?" / right by code / model's call on another skill | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): a pick on the model's own card never counts, and the app's which-next card never comes up after it, so nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #1465 next skill named in prose / first try / right by code / model's call | 1.3 | none | correct |  | missed (conservative): a skill named only in prose never counts; the app's which-next card comes up on this turn, and the first answer after its pick marks |
| #1467 next skill named in prose / "Yes" to "Does that make sense?" / right by code / model's call | 1.3 | none | correct |  | missed (conservative): a skill named only in prose never counts; the app's which-next card comes up on this turn, and the first answer after its pick marks |
| #1469 next skill named in prose / "I'm ready!" to "Are you ready?" / right by code / model's call | 1.3 | none | correct |  | missed (conservative): a skill named only in prose never counts; the app's which-next card comes up on this turn, and the first answer after its pick marks |
| #151 next skill named in prose / first try / right by code / app | 1.3 | none | correct |  | missed (conservative): a skill named only in prose never counts; the app's which-next card comes up on this turn, and the first answer after its pick marks |
| #152 next skill named in prose / "Yes" to "Does that make sense?" / right by code / app | 1.3 | none | correct |  | missed (conservative): a skill named only in prose never counts; the app's which-next card comes up on this turn, and the first answer after its pick marks |
| #1525 next skill named in prose / first try / right by code / model's call on another skill | 1.3 | none | correct |  | missed (conservative): a skill named only in prose never counts; the app's which-next card comes up on this turn, and the first answer after its pick marks |
| #1527 next skill named in prose / "Yes" to "Does that make sense?" / right by code / model's call on another skill | 1.3 | none | correct |  | missed (conservative): a skill named only in prose never counts; the app's which-next card comes up on this turn, and the first answer after its pick marks |
| #1529 next skill named in prose / "I'm ready!" to "Are you ready?" / right by code / model's call on another skill | 1.3 | none | correct |  | missed (conservative): a skill named only in prose never counts; the app's which-next card comes up on this turn, and the first answer after its pick marks |
| #153 next skill named in prose / "I'm ready!" to "Are you ready?" / right by code / app | 1.3 | none | correct |  | missed (conservative): a skill named only in prose never counts; the app's which-next card comes up on this turn, and the first answer after its pick marks |
| #1585 last skill left, named in prose / first try / right by code / model's call | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): one title left, so no which-next card, and nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #1587 last skill left, named in prose / "Yes" to "Does that make sense?" / right by code / model's call | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): one title left, so no which-next card, and nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #1589 last skill left, named in prose / "I'm ready!" to "Are you ready?" / right by code / model's call | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): one title left, so no which-next card, and nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #1645 last skill left, named in prose / first try / right by code / model's call on another skill | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): one title left, so no which-next card, and nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #1647 last skill left, named in prose / "Yes" to "Does that make sense?" / right by code / model's call on another skill | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): one title left, so no which-next card, and nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #1649 last skill left, named in prose / "I'm ready!" to "Are you ready?" / right by code / model's call on another skill | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): one title left, so no which-next card, and nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #166 last skill left, named in prose / first try / right by code / app | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): one title left, so no which-next card, and nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #167 last skill left, named in prose / "Yes" to "Does that make sense?" / right by code / app | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): one title left, so no which-next card, and nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #168 last skill left, named in prose / "I'm ready!" to "Are you ready?" / right by code / app | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): one title left, so no which-next card, and nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #216 typed into the picker, no pick / first try / right by model / app | 1.1 | none | correct |  | missed (conservative): two or more not mastered and no pick, so code knows no exact skill and makes no mark |
| #244 model's own which-next card / first try / right by model / app | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): a pick on the model's own card never counts, and the app's which-next card never comes up after it, so nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #251 next skill named in prose / first try / right by model / app | 1.3 | none | correct |  | missed (conservative): a skill named only in prose never counts; the app's which-next card comes up on this turn, and the first answer after its pick marks |
| #258 last skill left, named in prose / first try / right by model / app | 1.3 | none | correct |  | missed, KNOWN REGRESSION on the model's call (master let it land; code's own mark missed it there too): one title left, so no which-next card, and nothing in that check can mark it; a new check marks it on its first answer; TerraTutor issue #288 |
| #273 app picker / hint / right by code / model's call | none | 1.1 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #287 app picker / answers nothing, code asks again / right by code / model's call | none | 1.1 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #289 app picker / the hint's own question answered / right by code / model's call | none | 1.1 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #291 app picker / five hint requests / right by code / model's call | none | 1.1 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #393 app picker, chip text typed / hint / right by code / model's call | none | 1.1 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #407 app picker, chip text typed / answers nothing, code asks again / right by code / model's call | none | 1.1 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #409 app picker, chip text typed / the hint's own question answered / right by code / model's call | none | 1.1 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #411 app picker, chip text typed / five hint requests / right by code / model's call | none | 1.1 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #513 app picker, similar title / hint / right by code / model's call | none | 1.2 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #527 app picker, similar title / answers nothing, code asks again / right by code / model's call | none | 1.2 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #529 app picker, similar title / the hint's own question answered / right by code / model's call | none | 1.2 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #531 app picker, similar title / five hint requests / right by code / model's call | none | 1.2 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #633 app picker, then model card / hint / right by code / model's call | none | 1.3 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #647 app picker, then model card / answers nothing, code asks again / right by code / model's call | none | 1.3 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #649 app picker, then model card / the hint's own question answered / right by code / model's call | none | 1.3 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #651 app picker, then model card / five hint requests / right by code / model's call | none | 1.3 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #753 one skill left, no picker / hint / right by code / model's call | none | 1.1 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #767 one skill left, no picker / answers nothing, code asks again / right by code / model's call | none | 1.1 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #769 one skill left, no picker / the hint's own question answered / right by code / model's call | none | 1.1 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #771 one skill left, no picker / five hint requests / right by code / model's call | none | 1.1 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #873 typed into the picker, no pick / hint / right by code / model's call | none | 1.1 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #887 typed into the picker, no pick / answers nothing, code asks again / right by code / model's call | none | 1.1 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #889 typed into the picker, no pick / the hint's own question answered / right by code / model's call | none | 1.1 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #891 typed into the picker, no pick / five hint requests / right by code / model's call | none | 1.1 | correct |  | wrong by the rule, kept: the model's mark after a message the check counts as no try (freeInCheck), the TerraTutor 2026-11-19 part 8 decision pinned in answerCheckTurn.test.ts; TerraTutor issue #285 |
| #925 typed into the picker, no pick / first try / right by code / model's call on another skill | 1.1 | 1.2 | correct |  | wrong by the rule, kept: code knows no exact skill (no pick), so the model's choice stands as documented; TerraTutor issue #285 |
| #927 typed into the picker, no pick / "Yes" to "Does that make sense?" / right by code / model's call on another skill | 1.1 | 1.2 | correct |  | wrong by the rule, kept: code knows no exact skill (no pick), so the model's choice stands as documented; TerraTutor issue #285 |
| #929 typed into the picker, no pick / "I'm ready!" to "Are you ready?" / right by code / model's call on another skill | 1.1 | 1.2 | correct |  | wrong by the rule, kept: code knows no exact skill (no pick), so the model's choice stands as documented; TerraTutor issue #285 |
| #933 typed into the picker, no pick / hint / right by code / model's call on another skill | none | 1.2 | correct |  | wrong by the rule, kept: code knows no exact skill (no pick), so the model's choice stands as documented; TerraTutor issue #285 |
| #947 typed into the picker, no pick / answers nothing, code asks again / right by code / model's call on another skill | none | 1.2 | correct |  | wrong by the rule, kept: code knows no exact skill (no pick), so the model's choice stands as documented; TerraTutor issue #285 |
| #949 typed into the picker, no pick / the hint's own question answered / right by code / model's call on another skill | none | 1.2 | correct |  | wrong by the rule, kept: code knows no exact skill (no pick), so the model's choice stands as documented; TerraTutor issue #285 |
| #951 typed into the picker, no pick / five hint requests / right by code / model's call on another skill | none | 1.2 | correct |  | wrong by the rule, kept: code knows no exact skill (no pick), so the model's choice stands as documented; TerraTutor issue #285 |
