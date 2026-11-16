# Written-answer grading: a note to the model on misspellings (dev)

2026-11-16. DEV only. The note's wording was chosen on these sets after three tries, so these numbers
overstate what a new set will show. Labels by Claude, not blind. Runner:
`src/lib/eval/headless/grade-dev.eval.ts` (the app's path: `settleByCode`, then `gradeAnswersBatch`,
batches of 10, one fixed shuffled order), `EVAL_GRADE_SET=misspell|signs|synonyms|round2`. Ollama
local, RTX 3070 laptop. Before = master `359250e` with only the new set added (`038cb64`). After =
`5bdee4c`.

Why: on held-out v4 (results/2026-11-15-grade-dev-signs-letters.md) e2b failed right answers that are
misspellings on every run ("hunny", "chlorophyl", "the panama canel"). On dev it failed "skelitin",
"vertebrait", "geolagest" and "carnivour". Code can't accept two-edit misspellings (that rule leaked and
was deleted in #325). The hypothesis was that the model fails them because nothing tells it the answer
may be a misspelling.

## What the model was doing

The hypothesis was half wrong. The prompt already said "even if it is ... misspelled". With a note
saying the answer may be a misspelling, e2b's feedback read "The student misspelled conduction as
conducshon", and it still marked the answer wrong, on every run. e2b recognises the misspelling, then
counts it as wrong. What helped was telling it, for that answer only, that spelling isn't marked.

## The change

Code (`answer-match.ts` `misspellingNote`, dictionary from `quiz.ts` `misspellingNotes`) adds a note
under an answer when:
- the answer follows one of the key's forms word for word, and each differing word is one edit (key
  word 4+ letters) or two edits (7+) from the key's word;
- that word is not a real word, or it is the key's word with one British/American spelling swap
  (our/or, ise/ize, re/er, ae/oe/e, ph/f, ll/l, ium/um) and the dictionary lists the two as synonyms
  ("aluminium");
- the key's word is in the dictionary (it has no names of places or people);
- no other one-word dictionary headword or irregular form is as close to it ("glucogan": glycogen;
  "orbet": sorbet; "volumn": column; "vertebrait": vertebra), nor any regular form of one the
  dictionary resolves ("attatching": attaching; added in review cycle 2, below);
- no other word in the question is as close (checked for real words too).

Review of #327 (after these runs): the first version took any one-word WordNet synonym of a real word,
and WordNet's synonym sets also hold other forms and related words, so "bacterium" for bacteria,
"earlier" for earliest, "quick" for quickly, "arena" for area and "arc" for arch all got a note; the
real-word branch also skipped the question check, so "further" for "farther or further?" did too.
Over the whole dictionary, 12,846 (real word, synonym) pairs fall inside the edit limits; with the
spelling-swap rule 3,028 remain, and those read as other spellings (colour, haemal, travelled,
metre). The notes on the four dev sets are the same 26 answers before and after the fix, so every dev
prompt is unchanged and the runs below stand.

Review of #327, cycle 2: the word list for "no other real word is as close" held headwords and
irregular forms only, so another word's regular -ing or -ed form never counted. "attatching" for
Attacking (one edit from attaching, two from attacking) got a note, and e2b passed it 3/3 with the
note against 0/3 at master. "imigrating" for Emigrating (immigrating), "enhaling" for Exhaling
(inhaling), "enhaled" for Exhaled (inhaled) and "emmigrating" for Immigrating (emigrating) got one too.
The fix (`formsWithin`) makes every spelling WordNet's suffix rules read back to a headword that is
within the edits, and counts the ones `lookupWord` resolves. That is every string that close the
dictionary resolves, including morphy's over-generation: "mitosiss" (mitosis + s), "glacer" (glace +
r), "bipolarest". So "mitossis", "glaicer" and "biolagest" lost their notes: 17 of the `misspell`
set's 60 right answers get one now, still 0 of the wrong. That is the conservative side, and the note
has now leaked in two review cycles, so it stays there. The `signs`, `synonyms` and `round2` prompts are
byte-identical to before, so only `misspell` was rerun (`a7f4bfa`):

| Set | Model | Before | After (cycle 1) | After (cycle 2) |
|---|---|---|---|---|
| misspell (60 / 60) | e2b x3 | 23 / 0, 20 / 1, 23 / 0 | 8 / 0, 6 / 0, 6 / 1 | 13 / 0, 8 / 1, 9 / 1 |
| misspell (60 / 60) | e4b x1 | 2 / 2 | 1 / 2 | 4 / 2 |

- e2b: "biolagest" and "mitossis" fail 3/3 again, "glaicer" 2/3. "sulfer" (no note) fails 3/3 again: its
  batch's only note was "mitossis", so that batch is back to the old prompt. Run 1 also failed
  "antanim", "hybernasion", "volumn" and "ajektive", which runs 2 and 3 passed.
- Wrong passed: "glucogan" in runs 2 and 3. Its batch has no note before or after (the prompt is
  byte-identical to master), so this is sampling noise; it passed 1/3 at master too.
- e4b: right failed "verbe", "biolagest", "mytosys", "an orbet"; wrong passed "meitosis" and "glucogan",
  the same two as before, both in batches with no note.

The item then reads:

    Student answer: skelitin
    Note: "skelitin" may be a misspelling of "skeleton". If it is, mark it correct: for this answer, spelling is not marked.

A batch with a note also gets one line after "Judge only what the student wrote...": `A Note under an
answer applies to that answer only; check every other answer as above.` A batch with no note gets the
old prompt byte for byte, so `synonyms` and `round2`, which get no note, measure only run-to-run noise.

Notes on the dev sets (bundled dictionary, `quiz-misspelling-note.test.ts`): `misspell` 20 of 60
right answers (17 after review cycle 2), 0 of 60 wrong; `signs` 6 of 60 right (the two-edit misspellings, except "vertebrait":
vertebra is as close), 0 wrong; `synonyms` and `round2` none.

## Set

`misspell` (`GRADE_DEV_MISSPELLINGS`, new): 30 questions, 60 right answers (33 one edit, 25 two edits,
2 other spellings) and 60 wrong. 20 of the wrong are adversarial: a different real word spelt close to
the key (14: "geologist" for Biologist, "objective", "mystery", "herb", "column", "nocturne", "content",
"stalagmite", "convection", "meiosis", "glycogen"...), a misspelling of one (4: "geolagist", "mistery",
"stalagmight", "convecshun"), or a word as close to another real word as to the key (2: "meitosis" for
Mitosis, one edit from meiosis too; "glucogan" for Glucagon, two edits from glycogen too). Code
settles 21 of the 120 answers, the same before and after.

## Results

Right failed / wrong passed, per run.

| Set | Model | Before | After |
|---|---|---|---|
| misspell (60 / 60) | e2b x3 | 23 / 0, 20 / 1, 23 / 0 | 8 / 0, 6 / 0, 6 / 1 |
| misspell (60 / 60) | e4b x1 | 2 / 2 | 1 / 2 |
| signs (60 / 60) | e2b x3 | 7 / 0, 7 / 0, 5 / 0 | 1 / 1, 2 / 0, 2 / 0 |
| signs (60 / 60) | e4b x1 | 1 / 2 | 0 / 2 |
| synonyms (74 / 80) | e2b x3 | 14 / 1, 16 / 1, 15 / 1 | 13 / 1, 14 / 1, 15 / 1 |
| synonyms (74 / 80) | e4b x1 | 11 / 0 | 12 / 1 |
| round2 (30 / 30) | e2b x3 | 0 / 0, 0 / 0, 0 / 0 | 0 / 0, 0 / 0, 0 / 0 |
| round2 (30 / 30) | e4b x1 | 1 / 0 | 1 / 0 |

Misspelling right answers e2b failed, summed over 3 runs: `misspell` 66 → 20, `signs` 13 → 0.

Right answers e2b now passes that it failed before (runs failed, before → after):
- `misspell`: biolagest, mitossis, glukagone, conducshon, mikroskope, glaicer, a virb, verbe, sulfer,
  ocktagun, orbitt, ekwilateral, merkurey, continant (each 3 → 0); mytochondrea, nokternal (1 → 0);
  kenetic enrgy 3 → 2; kinetik energie 2 → 1.
- `signs`: skelitin, vertebrait, geolagest (3 → 0); carnivour, hipothisis (2 → 0).
- Still failing: mytosys, artirees, an orbet, nocturnel (3 → 3); ajektive, volumn (2 → 2); a kontinant
  (1 → 1). None of these gets a note. Their plural or two-edit form doesn't pair with the key's word,
  or a real word is as close (sorbet, nocturne, column, continuant, ejective).
- Some answers with no note improved too (verbe, sulfer, continant, vertebrait). They sat in a batch
  with a note, so the effect isn't confined to the noted answer. For right answers that helped; for
  wrong answers see below.

Wrong passed:
- e2b, every new wrong pass sat in a batch with no note, so its prompt was byte-identical to before.
  These are sampling noise, not the note. `misspell` "glucogan" passed 1 of 3 runs before and 1 of 3
  after, same batch, same prompt. `signs` "Go" for Au passed in run 1 (batch 4: the two answers the
  model saw had no note). `synonyms` "the cerebrum" passed every run before and after (identical
  prompts throughout).
- e4b: the same "meitosis", "glucogan", "CO" for "Co" and "<" for "=" before and after. `synonyms`
  "37 degrees Fahrenheit" passed once after, on a prompt identical to before (round 4 saw e4b pass it
  once too).
- No adversarial near-word passed in any e2b run after: "geologist", "objective", "mystery", "herb",
  "column", "nocturne", "content", "stalagmite", "convection", "meiosis", "glycogen", "geolagist",
  "mistery", "stalagmight", "convecshun".

## Wordings tried (dev, e2b x3 unless marked)

| Wording | misspell right failed / wrong passed | signs | Verdict |
|---|---|---|---|
| None (before) | 23 / 0, 20 / 1, 23 / 0 | 7 / 0, 7 / 0, 5 / 0 | |
| A: one fixed line, no notes ("Learners are children and often misspell. A misspelling of the expected answer's word is correct if it can only be that word.") | 3 / 2, 2 / 3, 4 / 3 | 3 / 1, 2 / 1, 2 / 1 | leaks: "content" for continent every run, "meitosis" every run, "No" for "NO" every run; e4b also passed "stalagmight" and "carnivour" for Herbivore |
| B: note "may be a misspelling", batch line "It is not a verdict: decide from the question whether that is what the student meant." | 16 / 0, 17 / 0, 13 / 0 | 3 / 0, 5 / 0, 4 / 0 | clean, but e2b still failed noted answers it called misspelt |
| B2: note as B, batch line "Spelling is not marked: if the student meant the expected word, the answer is correct even though it is misspelled." | 5 / 1, 5 / 1, 3 / 2 | 1 / 0, 1 / 0, 1 / 0 | leaks: "meitosis" (no note) every run; the batch line reaches answers with no note |
| B3 (kept): note with "If it is, mark it correct: for this answer, spelling is not marked.", batch line "A Note under an answer applies to that answer only; check every other answer as above." | 8 / 0, 6 / 0, 6 / 1 | 1 / 1, 2 / 0, 2 / 0 | the wrong passes are on unchanged prompts (above) |

e4b, one run each, misspell / signs: before 2 / 2, 1 / 2; A 1 / 4, 0 / 3; B 1 / 2, 1 / 2; B2 1 / 2,
1 / 2; B3 1 / 2, 0 / 2. `synonyms` and `round2` get no note under B, B2 or B3, so their runs are
noise: e2b synonyms right failed ranged 13-17 across the 12 runs with identical prompts. Under A (a
line in every batch), e4b `synonyms` failed 16 right answers against 10-12 for the others.

## Verdict

Kept. On e2b the misspelling right-fails drop from 66 to 20 (`misspell`) and from 13 to 0 (`signs`)
over three runs. Wrong passed doesn't rise on any set: each new wrong pass came from a batch whose
prompt didn't change. After review cycle 2 (three fewer notes) `misspell` is 66 → 30, wrong passed
again only "glucogan" on an unchanged prompt.

Limits:
- The wording was picked on these sets after three tries (B, B2, B3), and the labels are Claude's. A
  fresh held-out set has to confirm it before merge.
- The note can't help where a real word is as close, or the key word is short: "canel" (camel, panel
  are one edit away), "hunny" (two edits from a 5-letter key; funny and bunny are one edit away).
  "chlorophyl" does get a note: the dictionary lists it as another spelling of chlorophyll, as it does
  "aluminium" for aluminum. The held-out v4 answers weren't run here.
- An answer with no note can still pass more easily when it shares a batch with a noted one. No wrong
  answer did on dev, but the batch line is the only thing scoping the note, and B2 showed how easily
  that scope breaks.
- The check reads every one-word dictionary headword the first time an answer needs it (72,539 words,
  about 0.5 s headless), then keeps the word list (not the shards) for the session.
