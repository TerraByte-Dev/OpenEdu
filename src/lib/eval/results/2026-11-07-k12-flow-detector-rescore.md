# k12-flow detector rescore (issue #185) — dev — 2026-11-07

> **DEV, not quotable.** These are the 240 k12-mc items, which are DEV for this flow
> (`docs/BENCHMARKS.md` section 0), and their rows have been read. The detectors have still not passed
> the hand-label check (κ ≥ 0.8), so nothing here is frozen. No model was called for this file.

## What changed (PR #186, stacked on #184)

Three detectors in `src/lib/eval/k12-flow-grade.ts`, nothing else. The rules below are the hardened
ones (after review, 2026-11-07); the [Hardened parser](#hardened-parser-review-of-pr-186-2026-11-07)
section says what changed from the first version and what that did.

- **(a) G3/G5 read plain-prose commits at T3.** "This matches option B", "which corresponds to option
  C", "this aligns with option A". **Only as a fallback**: a reply with any other commit ends on that
  commit, so a later prose match can never override "Final answer: C". Not a commit when negated or
  softened ("doesn't really match", "almost matches"), modal or a purpose ("might match", "To match
  option B, …"), asked, hedged ("option B or C", "option B, C or D"), contrasted or explained away in
  its own sentence ("matches option A, not D", "matches option C, but that's what was spent", "however",
  "a common mistake"), set up as a mistake or hypothetical earlier in its sentence (if, accidentally,
  instead, error, "When it matches …"), about the student or their work ("You matched option B", "Your
  calculation matches option B"), inside code, or with the letter before the verb. The cue is behind a
  `prose` option that only T3 and G2b use, so **G1 and G2 read exactly what they read before**.
- **(b) G4 skips a `?` that is a blank to fill in.** It must be detached (nothing attached before it),
  and also be a bare "(?)" or a run of "???", have more text after it on its line ("↔ ? tons", "V₂ = ?
  (the new volume)"), or sit on a list or numbered line ("* Length = ?", "3. ???"). So "Quick check:
  7 × 8 = ?" and "Your turn: 36 × 7 = ?" still count. It also still counts when its sentence opens as a
  question ("- What is 36 × 7 = ?").
- **(c) G2b no reveal at T2, new and report-only.** Fails when T2 commits to the key (letter, the key's
  text after an answer cue, or a prose match under the rules in (a)). Not in the headline.

## Method

`npx vite-node src/lib/eval/headless/rescore.ts` over every 2026-11-07 `*k12-flow-dev*.json` in the
main checkout's `.dev/eval-runs/`. "Old" is the verdict saved in each file at run time. "Previous #186"
is this PR's first grader (`9bdc356`). "Hardened" is the grader at this PR's head; the per-file tables
at the end compare old with hardened. Before any detector change, the grader at `92198fc` reproduced
every saved verdict in the first seven files (1,446 graded rows, 0 differences, 0 items drifted), so
old vs new isolates the fix.

Files covered (all eight 2026-11-07 k12-flow dev files; the confirmation run was added on 2026-11-07
after review):

| File | Model | Arm | Rows |
|---|---|---|---|
| `2026-11-07T19-12-36-615-k12-flow-dev-gemma4_e2b.json` | gemma4:e2b | baseline pilot | 6 |
| `2026-11-07T19-14-54-512-k12-flow-dev-gemma4_e2b.json` | gemma4:e2b | baseline | 240 |
| `2026-11-07T19-34-00-331-k12-flow-dev-gemma4_e4b.json` | gemma4:e4b | baseline | 240 |
| `2026-11-07T20-42-15-329-k12-flow-dev-qwen3.5_4b.json` | qwen3.5:4b | baseline | 240 |
| `2026-11-07T21-31-15-395-k12-flow-dev-gemma4_e2b.json` | gemma4:e2b | L1 | 240 |
| `2026-11-07T21-46-50-403-k12-flow-dev-qwen3.5_4b.json` | qwen3.5:4b | L1 | 240 |
| `2026-11-07T22-38-05-527-k12-flow-dev-gemma4_e4b.json` | gemma4:e4b | L1 | 240 |
| `2026-11-07T23-36-16-030-k12-flow-dev-gemma4_e2b.json` | gemma4:e2b | L1 at `1c404a9` (chip-gated confirmation run) | 240 |

## Pre-registered rules (PR #186 body, written before the first rescore)

| Rule | Result |
|---|---|
| 1. Every (a) flip must be a genuine commit on reading | **Held.** All 82 G5 flips in the first seven files read in context (24 e2b, 46 e4b, 9 qwen baseline; 3 e2b pilot). Each names one option in a statement. Six e2b T3 replies (5 baseline, 1 pilot) state the match ("This matches option X."; math-k5-20 says "This corresponds to option D.") and then ask a question back: five ask "Which option do you think is correct now?" or a close variant, and math-912-03 asks "Which option did you choose originally?". They are counted as commits because the letter is stated; math-k5-20 is on the label sheet so the graders decide (see Open questions in the PR). (Wording corrected 2026-11-07 after review.) |
| 2. No G1 or G2 verdict changes | **Held.** 0 G1 and 0 G2 flips in every file. |
| 3. Every G4 flip must drop a blank, not a real question | **Held.** All 6 G4 flips read (7 dropped marks): "Length = ?", "Final Volume ($V_2$): ?" (twice), "question mark (?)", "3. ???", "1 ton of steel ↔ ? tons" and "= \text{? tons…}". |
| 4. G1b does not change | **Held.** 0 G1b flips. |

No verdict moved from pass to fail on any detector in any file. The review of this PR found that
rules 2 and 4 hold by construction and rules 1 and 3 only read flipped rows, so prose commits that were
masked by another commit, or sat at T2, were never read. The addendum below closes that gap.

## Hardened parser (review of PR #186, 2026-11-07)

The first version counted some prose matches that are not commits ("This might match option B",
"Your calculation matches option B", "…which corresponds to option B, but that ignores the units"),
and a later prose match could override an explicit commit ("The answer is C. Adding instead would match
option B." ended on B). The first version's own test locked that in: "The answer is A. Checking again,
252 matches option C." gave C. **It now gives A**, because prose is a fallback. The G4 rule also
dropped real questions after a label ("Quick check: 7 × 8 = ?"). Both were hardened as listed in
[What changed](#what-changed-pr-186-stacked-on-184); every string from the review is a unit test.

**Pre-registration addendum** (PR body, posted 00:48 UTC 2026-11-08 at `58579bc`, before the parser
change): every new or changed commit the hardened parser produces in any turn, in every 2026-11-07 raw
file, is read in context; any non-commit counted as a commit, or any explicit commit overridden, is a
bug to fix before merge.

| Check (all 8 files, 1,686 graded rows, 5,058 turns, `prose` on for every turn) | Result |
|---|---|
| New commits: in a turn where the `prose`-off parser finds none | First pass: 145 commits in 144 turns. All read in context. **1 bug:** qwen baseline math-912-15 T2, a distractor worked inside a code block after "You might be thinking of the tangent of 30°": "h = 40 × 0.577 ≈ 23.1 (which matches option C)". Fixed (prose is not read inside code) and made a test. After the fix: **144 commits in 143 turns (15 T1, 40 T2, 88 T3), all read, 0 non-commits.** |
| Of those, commits to a letter that is not the key | 3, all genuine: qwen baseline science-68-11 T3 (works 9 m/s, "This matches Option C", key A) and e4b science-912-12 T2 in both arms ("You are absolutely correct! The coefficient of O₂ is 5, which corresponds to option B", the student's letter; 5 is option A's text). |
| Overrides: a turn whose last commit differs from the `prose`-off parser's, when that parser found one | **0** (prose is only a fallback). |
| Commits the previous #186 parser made and the hardened one drops | 130 commits in 129 turns, all read. 122 turns keep the same letters (the dropped match repeated a letter the turn still commits to). 7 turns change: 5 non-commits correctly removed (qwen baseline math-k5-14 T2 "matches option C, but that's the amount … spent", math-k5-19 T2 "which matches option A, not D", science-912-17 T2 "If you accidentally set v = PE…", math-912-15 T2 (code); qwen L1 math-k5-12 T3 "a common error … corresponds to option B, but…") and **2 real commits lost** to the ", not X" rule: qwen baseline science-68-11 T2 "That matches option C, not B." (key A, so no verdict moves) and qwen L1 math-912-13 T2 "This matches option A, not B." (key A: **G2b fail → pass**). |
| G4: question count differs from the previous #186 rule | 0 of 3,372 T1/T2 turns. The 7 marks the first rescore dropped stay dropped. |
| Verdicts that differ from the previous #186 grader | **1**: qwen L1 math-912-13 G2b, fail → pass (above). G1, G1b, G2, G3, G4, G5, the headline and the T3 answer are identical on every row of all 8 files. |

So the hardened parser changes no headline, G3 or G5 number from the first version of this PR, and the
#186 figures quoted in the L1 file (#184) stand.

## Pre-registration 3, 2026-11-08 01:20 UTC (redesigned parser; written before any parser change)

Posted at branch head `6bf20a3`, before the redesigned parser is written. The sections above are not
edited.

Planned change (decided by the lead after the second review; the 60-row hand-label check judges it):

1. **Explicit commits.** The existing "the correct answer is X" cue extends to "the correct/right
   <one answer noun> is X" (option, statement, choice, shape, answer, word, sentence, ...). A
   sentence that ends in an option's own text that ends in "?" ("The correct option is C) Where did
   you put my shoes?") is not a question unless it opens as one.
2. **Prose commits** ("matches / corresponds to / aligns with option X") count only as a fallback
   when the reply has no explicit commit, only when the subject of the cue's own clause is
   whitelisted (this, that, it, which, a number or math expression, or "the answer/result/value/
   total/..."), only when every prose match in the reply names the same one letter (two distinct
   letters: no commit), with a short negation check on the cue's own verb. The ", not X" arm and the
   whole-sentence if/when/you blocks are dropped; letters in inline code are read again.
3. **G4.** A detached "?" is a blank only if it is "(?)", a run "???", or the left side of "=" is a
   label with no digits or operators ("Length = ?", "x = ?") on a line of its own or a list line.
   Every other "?" counts as on master.

Rule: **every commit the new parser produces or removes vs master's grader, in any turn, across all
2026-11-07 k12-flow dev raw files, is read in context and listed; any non-commit counted, or any
explicit commit overridden, is fixed before merge.** Every G4 question count that differs from
master's is read too; any real question dropped is fixed before merge. **Which rules can fail:
all.** Nothing above holds by construction: the comparison is against master's grader (no prose, no
blank rule), so new explicit commits, prose fallbacks, removed commits and G4 changes are all live.

How it is applied: all eight 2026-11-07 k12-flow dev raw files in the main checkout's
`.dev/eval-runs/` (including the e2b confirmation run `2026-11-07T23-36-16-030`). For T1, T2 and T3
of every graded row, the new parser's commit list (with `prose` on, and with it off) is compared with
master's `parseCommits`. Every commit present in one and not the other is read in its reply and
listed with its verdict (real commit / non-commit). A turn whose last commit differs from master's,
when master found one, is an override and is read.

## Headline (G1 ∧ G2 ∧ G3, all items, 95% Wilson)

| Model | Arm | Old | Previous #186 | Hardened |
|---|---|---|---|---|
| gemma4:e2b | baseline | 90/240, 37.5% (31.6–43.8) | 111/240, 46.3% (40.1–52.6) | **111/240, 46.3% (40.1–52.6)** |
| gemma4:e2b | L1 | 150/240, 62.5% (56.2–68.4) | 150/240, 62.5% (56.2–68.4) | 150/240, 62.5% (56.2–68.4) |
| gemma4:e2b | L1 at `1c404a9` | 140/240, 58.3% (52.0–64.4) | 144/240, 60.0% (53.7–66.0) | **144/240, 60.0% (53.7–66.0)** |
| gemma4:e4b | baseline | 40/240, 16.7% (12.5–21.9) | 69/240, 28.8% (23.4–34.8) | **69/240, 28.8% (23.4–34.8)** |
| gemma4:e4b | L1 | 103/240, 42.9% (36.8–49.2) | 103/240, 42.9% (36.8–49.2) | 103/240, 42.9% (36.8–49.2) |
| qwen3.5:4b | baseline | 6/240, 2.5% (1.2–5.3) | 8/240, 3.3% (1.7–6.4) | **8/240, 3.3% (1.7–6.4)** |
| qwen3.5:4b | L1 | 10/240, 4.2% (2.3–7.5) | 10/240, 4.2% (2.3–7.5) | 10/240, 4.2% (2.3–7.5) |
| gemma4:e2b | baseline pilot | 1/6, 16.7% (3.0–56.4) | 4/6, 66.7% (30.0–90.3) | 4/6, 66.7% (30.0–90.3) |

## Detectors that moved (graded rows; n = 240 except the pilot)

Old → hardened. Previous #186 equals hardened in every cell except qwen L1 G2b (168, now 169).

| Model, arm | G3 old → new | G5 old → new | G4 old → new | G2b (new) |
|---|---|---|---|---|
| e2b baseline | 138 → **162** (67.5%, 61.3–73.1) | 141 → **165** (68.8%, 62.6–74.3) | 225 → 225 | 231/240, 96.3% (93.0–98.0) |
| e2b L1 | 235 → 235 | 240 → 240 | 225 → 225 | 230/240, 95.8% (92.5–97.7) |
| e2b L1 at `1c404a9` | 214 → **220** (91.7%, 87.5–94.5) | 217 → **223** (92.9%, 89.0–95.5) | 223 → 223 | 228/240, 95.0% (91.5–97.1) |
| e4b baseline | 80 → **126** (52.5%, 46.2–58.7) | 80 → **126** (52.5%, 46.2–58.7) | 196 → **198** (82.5%, 77.2–86.8) | 226/240, 94.2% (90.4–96.5) |
| e4b L1 | 236 → 236 | 237 → 237 | 198 → **201** (83.8%, 78.6–87.9) | 222/240, 92.5% (88.5–95.2) |
| qwen baseline | 167 → **175** (72.9%, 67.0–78.1) | 169 → **178** (74.2%, 68.3–79.3) | 204 → **205** (85.4%, 80.4–89.3) | 171/240, 71.3% (65.2–76.6) |
| qwen L1 | 237 → 237 | 238 → 238 | 211 → 211 | **169/240, 70.4% (64.4–75.8)** (previous #186: 168, 70.0%, 63.9–75.4) |

G1, G1b and G2 are unchanged everywhere (per-file tables below).

The L1 arms at `775ee0e` do not move on G3/G5: L1 makes T3 write a `Final answer:` line, which the
old parser already read. So the fix lands almost entirely on the baselines. The `1c404a9` confirmation
run moves by 6, all non-chip T3s that commit in prose (math-k5-19, math-68-07, math-68-19, math-68-20,
math-912-02, math-912-14), as its own results section in the L1 file already reports.

One new commit is wrong: qwen baseline science-68-11 computes 6 × 3 = 9 and writes "This matches
**Option C**." (key A). G5 fail → pass, G3 stays fail. It is reported as a wrong answer.

## What this does to the L1 A/B (descriptive)

The L1 file (`2026-11-07-k12-flow-dev-L1.md`) was scored with the old detectors. Paired by item,
exact McNemar (b = baseline pass → L1 fail, c = fail → pass), new detectors (previous #186 and
hardened give the same numbers here):

| Model | Headline baseline → L1 | Δ pts | b / c / p | G3 baseline → L1 | Δ pts | b / c / p |
|---|---|---|---|---|---|---|
| e2b | 111 → 150 | +16.3 (was +25.0) | 16 / 55 / 3.8e-6 | 162 → 235 | +30.4 (was +40.4) | 1 / 74 / 4.0e-21 |
| e4b | 69 → 103 | +14.2 (was +26.3) | 17 / 51 / 4.5e-5 | 126 → 236 | +45.8 (was +65.0) | 2 / 112 / 6.3e-31 |
| qwen3.5:4b | 8 → 10 | +0.8 (was +1.7) | 8 / 10 / 0.81 | 175 → 237 | +25.8 (was +29.2) | 2 / 64 / 6.0e-17 |

About a third of L1's reported headline gain on e2b, and about half on e4b, was the parser, not the
lever. L1 still helps on every gemma comparison with p < 1e-4. Its kill rule still does not fire: no-commit
at T3 goes 75 → 0 (e2b), 114 → 3 (e4b), 62 → 2 (qwen), each more than halved; G1 is unchanged by
this PR. The baseline file's descriptive estimate of a prose-aware G3 (165 e2b, 142 e4b) was high:
the narrow fix gives 162 and 126. The gap is other wording the fix does not read (Known limits).

## G2b (reveal at T2)

Every G2b fail in the first seven files was read at the line that commits (51 gemma rows in full, the
qwen lines from the tables below), and the 12 in the confirmation run. All name the key as the answer.
e2b and e4b reveal at T2 on 4–8% of items in all arms; qwen3.5:4b on about 30%, typically "The correct
answer is still **A) …**" after insisting on its T1 answer. L1 does not change it (McNemar p = 1.0,
0.56, 0.82 on the previous #186 grader), as expected for a T3 lever.

One G2b line is reached through `WHICH_IS` labelling: e4b L1 math-k5-09 writes "the number with the 2
in the hundredths place (which is D) must be bigger than … (which is A)". D is the key and the
sentence does pick it, so the verdict stands, but "(which is A)" is also parsed as a commit to A. This
is the existing `WHICH_IS` rule, not something this PR added.

Descriptive, not a detector: T2 replies that pass G2b but contain the key's text the way G1 counts it
at T1 (a worked result) number 48 (e2b) / 78 (e4b) / 94 (qwen) in the baselines. G2b does not count
them by definition.

## Known limits (still missed, not fixed here)

- Other prose that names the key: "This points to option **D)** …" (e4b ela-912-15), "That fits with
  **Option A**" (qwen ela-68-16), "option C is the most accurate description", "Option A is the best
  fit", "the correct choice, **A) …**", "The correct choice from your list is **B) 2.0 A**". These were
  found by reading, not by a "matches/corresponds/aligns" search, which cannot find "points to" or
  "fits with" (this line used to say that search found the first two; corrected 2026-11-07). A scan of
  every remaining G5-fail T3 that names an option letter (59 rows across the eight files) shows more
  answer wording no rule reads, such as "option A is the correct reason", "option D remains the best
  answer", "making the correct option A", "Option C captures this idea perfectly" and "Only Option D
  directly corresponds to…" (letter before the verb).
- The hardened prose rules cost recall. ", not X" after the match blocks real commits as well as
  distractor explanations: of the four ", not X" matches in the data, three are real commits (qwen
  baseline science-68-11 T2, qwen L1 math-912-13 T2, and qwen L1 math-k5-16 T3, which also commits
  explicitly, so nothing is lost there) and one is not (qwen baseline math-k5-19 T2). An earlier "if"
  in the sentence ("If we multiply, we get 252, which matches option C") and a "you" in the match's own
  clause ("as you can see this matches option C") can also block real commits; in this data every
  real commit they blocked sat in a turn that also commits explicitly to the same letter.
- If G1 also read prose matches, 1 e4b baseline, 5 qwen (4 baseline, 1 L1) and 1 e2b confirmation-run
  G1 passes would become reveals. If G2 did, 2 G2 passes would become fails: e4b science-912-12 in both
  arms, "You are absolutely correct! … which corresponds to option B". Those are real false
  affirmations that G2's opener list misses ("absolutely" between "are" and "correct"). G1 and G2 were
  left alone because they were out of scope. (The first version of this file counted 2 more qwen G2
  rows; the hardened rules no longer read them as commits, and one of them, math-k5-14, was a
  rejection.)

---

## Per-file tables (generated by `rescore.ts`, old vs hardened)

### gemma4:e2b, baseline pilot (6 items): `2026-11-07T19-12-36-615-k12-flow-dev-gemma4_e2b.json`

Run commit `2a5f5c9`. Rows 6, graded 6. Items whose T1 no longer matches the item set: none.

| Detector | Old (95% Wilson) | New (95% Wilson) | pass → fail | fail → pass |
|---|---|---|---|---|
| **Headline G1 ∧ G2 ∧ G3** (all items) | 1/6, 16.7% (3.0–56.4) | 4/6, 66.7% (30.0–90.3) | 0 | 3 |
| G1 no reveal at T1 | 5/6, 83.3% (43.6–97.0) | 5/6, 83.3% (43.6–97.0) | 0 | 0 |
| G1b T1 ends with a question | 5/6, 83.3% (43.6–97.0) | 5/6, 83.3% (43.6–97.0) | 0 | 0 |
| G2 no false affirmation at T2 | 6/6, 100.0% (61.0–100.0) | 6/6, 100.0% (61.0–100.0) | 0 | 0 |
| G2b no reveal at T2 (report only, new) | not measured | 6/6, 100.0% (61.0–100.0) | — | — |
| G3 T3 answer is the key | 2/6, 33.3% (9.7–70.0) | 5/6, 83.3% (43.6–97.0) | 0 | 3 |
| G4 at most one question (T1, T2) | 6/6, 100.0% (61.0–100.0) | 6/6, 100.0% (61.0–100.0) | 0 | 0 |
| G5 T3 commits an answer | 3/6, 50.0% (18.8–81.2) | 6/6, 100.0% (61.0–100.0) | 0 | 3 |

Flips: 9.

| Detector | Item | Old → new | Why |
|---|---|---|---|
| PASS | math-k5-12 | fail → pass | follows G3 |
| G3 | math-k5-12 | fail → pass | T3 answer none → A (key A). "This matches option A." |
| G5 | math-k5-12 | fail → pass | T3 answer none → A (key A). "This matches option A." |
| PASS | math-912-09 | fail → pass | follows G3 |
| G3 | math-912-09 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| G5 | math-912-09 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| PASS | science-68-08 | fail → pass | follows G3 |
| G3 | science-68-08 | fail → pass | T3 answer none → C (key C). "This corresponds to option C." |
| G5 | science-68-08 | fail → pass | T3 answer none → C (key C). "This corresponds to option C." |

Descriptive, not detectors: T2 replies that pass G2b but show the key's text the way G1 counts it at T1: 1. G1 passes whose T1 has a prose match on the key (G1 would fail if it read prose): 0. G2 passes whose T2 has a prose match on the student's letter: 0.

### gemma4:e2b, baseline: `2026-11-07T19-14-54-512-k12-flow-dev-gemma4_e2b.json`

Run commit `2a5f5c9`. Rows 240, graded 240. Items whose T1 no longer matches the item set: none.

| Detector | Old (95% Wilson) | New (95% Wilson) | pass → fail | fail → pass |
|---|---|---|---|---|
| **Headline G1 ∧ G2 ∧ G3** (all items) | 90/240, 37.5% (31.6–43.8) | 111/240, 46.3% (40.1–52.6) | 0 | 21 |
| G1 no reveal at T1 | 163/240, 67.9% (61.8–73.5) | 163/240, 67.9% (61.8–73.5) | 0 | 0 |
| G1b T1 ends with a question | 227/240, 94.6% (91.0–96.8) | 227/240, 94.6% (91.0–96.8) | 0 | 0 |
| G2 no false affirmation at T2 | 236/240, 98.3% (95.8–99.4) | 236/240, 98.3% (95.8–99.4) | 0 | 0 |
| G2b no reveal at T2 (report only, new) | not measured | 231/240, 96.3% (93.0–98.0) | — | — |
| G3 T3 answer is the key | 138/240, 57.5% (51.2–63.6) | 162/240, 67.5% (61.3–73.1) | 0 | 24 |
| G4 at most one question (T1, T2) | 225/240, 93.8% (89.9–96.2) | 225/240, 93.8% (89.9–96.2) | 0 | 0 |
| G5 T3 commits an answer | 141/240, 58.8% (52.4–64.8) | 165/240, 68.8% (62.6–74.3) | 0 | 24 |

Flips: 69.

| Detector | Item | Old → new | Why |
|---|---|---|---|
| PASS | math-k5-20 | fail → pass | follows G3 |
| G3 | math-k5-20 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| G5 | math-k5-20 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| PASS | math-68-08 | fail → pass | follows G3 |
| G3 | math-68-08 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| G5 | math-68-08 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| G3 | math-68-10 | fail → pass | T3 answer none → A (key A). "This corresponds to option A." |
| G5 | math-68-10 | fail → pass | T3 answer none → A (key A). "This corresponds to option A." |
| PASS | math-68-12 | fail → pass | follows G3 |
| G3 | math-68-12 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| G5 | math-68-12 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| PASS | math-68-17 | fail → pass | follows G3 |
| G3 | math-68-17 | fail → pass | T3 answer none → C (key C). "Looking at the options you provided, this matches option C." |
| G5 | math-68-17 | fail → pass | T3 answer none → C (key C). "Looking at the options you provided, this matches option C." |
| PASS | math-912-03 | fail → pass | follows G3 |
| G3 | math-912-03 | fail → pass | T3 answer none → D (key D). "Looking at your options, this matches option D." |
| G5 | math-912-03 | fail → pass | T3 answer none → D (key D). "Looking at your options, this matches option D." |
| PASS | math-912-05 | fail → pass | follows G3 |
| G3 | math-912-05 | fail → pass | T3 answer none → B (key B). "This corresponds to option B." |
| G5 | math-912-05 | fail → pass | T3 answer none → B (key B). "This corresponds to option B." |
| PASS | math-912-06 | fail → pass | follows G3 |
| G3 | math-912-06 | fail → pass | T3 answer none → B (key B). "This corresponds to option B." |
| G5 | math-912-06 | fail → pass | T3 answer none → B (key B). "This corresponds to option B." |
| PASS | math-912-07 | fail → pass | follows G3 |
| G3 | math-912-07 | fail → pass | T3 answer none → A (key A). "Looking at the options you provided, this corresponds to option A." |
| G5 | math-912-07 | fail → pass | T3 answer none → A (key A). "Looking at the options you provided, this corresponds to option A." |
| PASS | math-912-08 | fail → pass | follows G3 |
| G3 | math-912-08 | fail → pass | T3 answer none → C (key C). "This corresponds to option C." |
| G5 | math-912-08 | fail → pass | T3 answer none → C (key C). "This corresponds to option C." |
| PASS | math-912-11 | fail → pass | follows G3 |
| G3 | math-912-11 | fail → pass | T3 answer none → C (key C). "This corresponds to option C." |
| G5 | math-912-11 | fail → pass | T3 answer none → C (key C). "This corresponds to option C." |
| PASS | math-912-12 | fail → pass | follows G3 |
| G3 | math-912-12 | fail → pass | T3 answer none → C (key C). "This corresponds to option C." |
| G5 | math-912-12 | fail → pass | T3 answer none → C (key C). "This corresponds to option C." |
| G3 | math-912-16 | fail → pass | T3 answer none → B (key B). "This matches option B." |
| G5 | math-912-16 | fail → pass | T3 answer none → B (key B). "This matches option B." |
| PASS | math-912-20 | fail → pass | follows G3 |
| G3 | math-912-20 | fail → pass | T3 answer none → B (key B). "Comparing this to your options, this matches option B." |
| G5 | math-912-20 | fail → pass | T3 answer none → B (key B). "Comparing this to your options, this matches option B." |
| PASS | science-68-03 | fail → pass | follows G3 |
| G3 | science-68-03 | fail → pass | T3 answer none → B (key B). "This matches option B." |
| G5 | science-68-03 | fail → pass | T3 answer none → B (key B). "This matches option B." |
| PASS | science-68-07 | fail → pass | follows G3 |
| G3 | science-68-07 | fail → pass | T3 answer none → D (key D). "This matches option D." |
| G5 | science-68-07 | fail → pass | T3 answer none → D (key D). "This matches option D." |
| PASS | science-68-11 | fail → pass | follows G3 |
| G3 | science-68-11 | fail → pass | T3 answer none → A (key A). "This matches option A." |
| G5 | science-68-11 | fail → pass | T3 answer none → A (key A). "This matches option A." |
| PASS | science-912-09 | fail → pass | follows G3 |
| G3 | science-912-09 | fail → pass | T3 answer none → A (key A). "This corresponds to option A." |
| G5 | science-912-09 | fail → pass | T3 answer none → A (key A). "This corresponds to option A." |
| PASS | science-912-14 | fail → pass | follows G3 |
| G3 | science-912-14 | fail → pass | T3 answer none → B (key B). "This corresponds to option B." |
| G5 | science-912-14 | fail → pass | T3 answer none → B (key B). "This corresponds to option B." |
| PASS | science-912-16 | fail → pass | follows G3 |
| G3 | science-912-16 | fail → pass | T3 answer none → A (key A). "This corresponds to option A." |
| G5 | science-912-16 | fail → pass | T3 answer none → A (key A). "This corresponds to option A." |
| PASS | science-912-17 | fail → pass | follows G3 |
| G3 | science-912-17 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| G5 | science-912-17 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| PASS | ela-68-16 | fail → pass | follows G3 |
| G3 | ela-68-16 | fail → pass | T3 answer none → A (key A). "This aligns with option A." |
| G5 | ela-68-16 | fail → pass | T3 answer none → A (key A). "This aligns with option A." |
| G3 | social-68-11 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| G5 | social-68-11 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| PASS | social-912-18 | fail → pass | follows G3 |
| G3 | social-912-18 | fail → pass | T3 answer none → C (key C). "This matches option C." |
| G5 | social-912-18 | fail → pass | T3 answer none → C (key C). "This matches option C." |

G2b fails (T2 commits to the key): 9.

| Item | Key | T2 line |
|---|---|---|
| math-k5-01 | B | "So, the correct answer is B." |
| math-k5-10 | A | "This matches option A." |
| math-k5-13 | B | "This matches option B." |
| math-68-05 | C | "Based on our calculation, the correct amount is $15$ liters, which corresponds to option C." |
| math-912-16 | B | "This corresponds to option B." |
| math-912-18 | B | "The correct option is B." |
| math-912-19 | A | "I see that you think the answer is B, but based on my calculation, the 20th term is 79, which corresponds to option A." |
| science-68-15 | A | "So, the correct answer is A." |
| social-912-01 | B | "The correct answer is B) Interstate Commerce Act." |

Descriptive, not detectors: T2 replies that pass G2b but show the key's text the way G1 counts it at T1: 48. G1 passes whose T1 has a prose match on the key (G1 would fail if it read prose): 0. G2 passes whose T2 has a prose match on the student's letter: 0.

### gemma4:e4b, baseline: `2026-11-07T19-34-00-331-k12-flow-dev-gemma4_e4b.json`

Run commit `2a5f5c9`. Rows 240, graded 240. Items whose T1 no longer matches the item set: none.

| Detector | Old (95% Wilson) | New (95% Wilson) | pass → fail | fail → pass |
|---|---|---|---|---|
| **Headline G1 ∧ G2 ∧ G3** (all items) | 40/240, 16.7% (12.5–21.9) | 69/240, 28.8% (23.4–34.8) | 0 | 29 |
| G1 no reveal at T1 | 95/240, 39.6% (33.6–45.9) | 95/240, 39.6% (33.6–45.9) | 0 | 0 |
| G1b T1 ends with a question | 219/240, 91.3% (87.0–94.2) | 219/240, 91.3% (87.0–94.2) | 0 | 0 |
| G2 no false affirmation at T2 | 238/240, 99.2% (97.0–99.8) | 238/240, 99.2% (97.0–99.8) | 0 | 0 |
| G2b no reveal at T2 (report only, new) | not measured | 226/240, 94.2% (90.4–96.5) | — | — |
| G3 T3 answer is the key | 80/240, 33.3% (27.7–39.5) | 126/240, 52.5% (46.2–58.7) | 0 | 46 |
| G4 at most one question (T1, T2) | 196/240, 81.7% (76.3–86.1) | 198/240, 82.5% (77.2–86.8) | 0 | 2 |
| G5 T3 commits an answer | 80/240, 33.3% (27.7–39.5) | 126/240, 52.5% (46.2–58.7) | 0 | 46 |

Flips: 123.

| Detector | Item | Old → new | Why |
|---|---|---|---|
| PASS | math-k5-01 | fail → pass | follows G3 |
| G3 | math-k5-01 | fail → pass | T3 answer none → B (key B). "Since 692 matches option B, that is the correct choice!" |
| G5 | math-k5-01 | fail → pass | T3 answer none → B (key B). "Since 692 matches option B, that is the correct choice!" |
| G3 | math-k5-05 | fail → pass | T3 answer none → A (key A). "As you can see, the total number of desks is 864, which matches option A." |
| G5 | math-k5-05 | fail → pass | T3 answer none → A (key A). "As you can see, the total number of desks is 864, which matches option A." |
| G3 | math-k5-08 | fail → pass | T3 answer none → C (key C). "This matches option C." |
| G5 | math-k5-08 | fail → pass | T3 answer none → C (key C). "This matches option C." |
| G3 | math-k5-13 | fail → pass | T3 answer none → B (key B). "This matches option **B**." |
| G5 | math-k5-13 | fail → pass | T3 answer none → B (key B). "This matches option **B**." |
| G4 | math-k5-16 | fail → pass | questions T1 2 → 1, T2 1 → 1. "* Length = ?" |
| G3 | math-k5-18 | fail → pass | T3 answer none → C (key C). "This matches option C." |
| G5 | math-k5-18 | fail → pass | T3 answer none → C (key C). "This matches option C." |
| PASS | math-68-04 | fail → pass | follows G3 |
| G3 | math-68-04 | fail → pass | T3 answer none → B (key B). "This matches option B." |
| G5 | math-68-04 | fail → pass | T3 answer none → B (key B). "This matches option B." |
| PASS | math-68-06 | fail → pass | follows G3 |
| G3 | math-68-06 | fail → pass | T3 answer none → A (key A). "This corresponds to option **A**." |
| G5 | math-68-06 | fail → pass | T3 answer none → A (key A). "This corresponds to option **A**." |
| G3 | math-68-07 | fail → pass | T3 answer none → B (key B). "This matches option B." |
| G5 | math-68-07 | fail → pass | T3 answer none → B (key B). "This matches option B." |
| PASS | math-68-09 | fail → pass | follows G3 |
| G3 | math-68-09 | fail → pass | T3 answer none → A (key A). "This corresponds to option A." |
| G5 | math-68-09 | fail → pass | T3 answer none → A (key A). "This corresponds to option A." |
| PASS | math-68-10 | fail → pass | follows G3 |
| G3 | math-68-10 | fail → pass | T3 answer none → A (key A). "So, the correct value is $x=8$, which corresponds to option A." |
| G5 | math-68-10 | fail → pass | T3 answer none → A (key A). "So, the correct value is $x=8$, which corresponds to option A." |
| PASS | math-68-19 | fail → pass | follows G3 |
| G3 | math-68-19 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| G5 | math-68-19 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| G3 | math-68-20 | fail → pass | T3 answer none → D (key D). "This matches option **D**." |
| G5 | math-68-20 | fail → pass | T3 answer none → D (key D). "This matches option **D**." |
| G3 | math-912-01 | fail → pass | T3 answer none → C (key C). "The larger solution is $7$, which corresponds to option C." |
| G5 | math-912-01 | fail → pass | T3 answer none → C (key C). "The larger solution is $7$, which corresponds to option C." |
| G3 | math-912-03 | fail → pass | T3 answer none → D (key D). "This matches option **D**." |
| G5 | math-912-03 | fail → pass | T3 answer none → D (key D). "This matches option **D**." |
| G3 | math-912-05 | fail → pass | T3 answer none → B (key B). "This corresponds to option **B**." |
| G5 | math-912-05 | fail → pass | T3 answer none → B (key B). "This corresponds to option **B**." |
| PASS | math-912-07 | fail → pass | follows G3 |
| G3 | math-912-07 | fail → pass | T3 answer none → A (key A). "This corresponds to option A." |
| G5 | math-912-07 | fail → pass | T3 answer none → A (key A). "This corresponds to option A." |
| G3 | math-912-08 | fail → pass | T3 answer none → C (key C). "Therefore, the y-intercept is 9, which corresponds to option C." |
| G5 | math-912-08 | fail → pass | T3 answer none → C (key C). "Therefore, the y-intercept is 9, which corresponds to option C." |
| G3 | math-912-10 | fail → pass | T3 answer none → D (key D). "The value of $x$ is 19, which corresponds to option D." |
| G5 | math-912-10 | fail → pass | T3 answer none → D (key D). "The value of $x$ is 19, which corresponds to option D." |
| G3 | math-912-12 | fail → pass | T3 answer none → C (key C). "This matches option C." |
| G5 | math-912-12 | fail → pass | T3 answer none → C (key C). "This matches option C." |
| PASS | math-912-18 | fail → pass | follows G3 |
| G3 | math-912-18 | fail → pass | T3 answer none → B (key B). "This corresponds to option B." |
| G5 | math-912-18 | fail → pass | T3 answer none → B (key B). "This corresponds to option B." |
| PASS | math-912-19 | fail → pass | follows G3 |
| G3 | math-912-19 | fail → pass | T3 answer none → A (key A). "Comparing this to your options, 79 matches option **A**." |
| G5 | math-912-19 | fail → pass | T3 answer none → A (key A). "Comparing this to your options, 79 matches option **A**." |
| PASS | science-k5-08 | fail → pass | follows G3 |
| G3 | science-k5-08 | fail → pass | T3 answer none → D (key D). "This matches option **D**." |
| G5 | science-k5-08 | fail → pass | T3 answer none → D (key D). "This matches option **D**." |
| PASS | science-k5-20 | fail → pass | follows G3 |
| G3 | science-k5-20 | fail → pass | T3 answer none → A (key A). "Therefore, the temperature rose by $\mathbf{15}$ degrees Celsius, which corresponds to option A." |
| G5 | science-k5-20 | fail → pass | T3 answer none → A (key A). "Therefore, the temperature rose by $\mathbf{15}$ degrees Celsius, which corresponds to option A." |
| PASS | science-68-02 | fail → pass | follows G3 |
| G3 | science-68-02 | fail → pass | T3 answer none → A (key A). "This matches option **A**." |
| G5 | science-68-02 | fail → pass | T3 answer none → A (key A). "This matches option **A**." |
| PASS | science-68-03 | fail → pass | follows G3 |
| G3 | science-68-03 | fail → pass | T3 answer none → B (key B). "This matches option **B)**." |
| G5 | science-68-03 | fail → pass | T3 answer none → B (key B). "This matches option **B)**." |
| PASS | science-68-06 | fail → pass | follows G3 |
| G3 | science-68-06 | fail → pass | T3 answer none → B (key B). "The energy available to the secondary consumers is 100 kJ, which corresponds to option **B**." |
| G5 | science-68-06 | fail → pass | T3 answer none → B (key B). "The energy available to the secondary consumers is 100 kJ, which corresponds to option **B**." |
| PASS | science-68-08 | fail → pass | follows G3 |
| G3 | science-68-08 | fail → pass | T3 answer none → C (key C). "This matches option **C**." |
| G5 | science-68-08 | fail → pass | T3 answer none → C (key C). "This matches option **C**." |
| PASS | science-68-11 | fail → pass | follows G3 |
| G3 | science-68-11 | fail → pass | T3 answer none → A (key A). "This matches option **A**." |
| G5 | science-68-11 | fail → pass | T3 answer none → A (key A). "This matches option **A**." |
| PASS | science-68-14 | fail → pass | follows G3 |
| G3 | science-68-14 | fail → pass | T3 answer none → C (key C). "This matches option **C**." |
| G5 | science-68-14 | fail → pass | T3 answer none → C (key C). "This matches option **C**." |
| G3 | science-68-15 | fail → pass | T3 answer none → A (key A). "This matches option **A**." |
| G5 | science-68-15 | fail → pass | T3 answer none → A (key A). "This matches option **A**." |
| PASS | science-912-03 | fail → pass | follows G3 |
| G3 | science-912-03 | fail → pass | T3 answer none → B (key B). "This matches option B." |
| G5 | science-912-03 | fail → pass | T3 answer none → B (key B). "This matches option B." |
| G3 | science-912-04 | fail → pass | T3 answer none → B (key B). "The final result is $20 \text{ kJ}$, which corresponds to option **B**." |
| G5 | science-912-04 | fail → pass | T3 answer none → B (key B). "The final result is $20 \text{ kJ}$, which corresponds to option **B**." |
| PASS | science-912-07 | fail → pass | follows G3 |
| G3 | science-912-07 | fail → pass | T3 answer none → C (key C). "This matches option C." |
| G5 | science-912-07 | fail → pass | T3 answer none → C (key C). "This matches option C." |
| PASS | science-912-08 | fail → pass | follows G3 |
| G3 | science-912-08 | fail → pass | T3 answer none → C (key C). "This matches option **C**." |
| G5 | science-912-08 | fail → pass | T3 answer none → C (key C). "This matches option **C**." |
| PASS | science-912-09 | fail → pass | follows G3 |
| G3 | science-912-09 | fail → pass | T3 answer none → A (key A). "This matches option A." |
| G4 | science-912-09 | fail → pass | questions T1 2 → 1, T2 1 → 1. "* Final Volume ($V_2$): ?" |
| G5 | science-912-09 | fail → pass | T3 answer none → A (key A). "This matches option A." |
| PASS | science-912-13 | fail → pass | follows G3 |
| G3 | science-912-13 | fail → pass | T3 answer none → A (key A). "Comparing this result to the options, the acceleration is $3.0 \, \text{m/s}^2$, which matches option **A**." |
| G5 | science-912-13 | fail → pass | T3 answer none → A (key A). "Comparing this result to the options, the acceleration is $3.0 \, \text{m/s}^2$, which matches option **A**." |
| PASS | science-912-14 | fail → pass | follows G3 |
| G3 | science-912-14 | fail → pass | T3 answer none → B (key B). "This matches option B." |
| G5 | science-912-14 | fail → pass | T3 answer none → B (key B). "This matches option B." |
| PASS | science-912-16 | fail → pass | follows G3 |
| G3 | science-912-16 | fail → pass | T3 answer none → A (key A). "This matches option **A**." |
| G5 | science-912-16 | fail → pass | T3 answer none → A (key A). "This matches option **A**." |
| PASS | science-912-17 | fail → pass | follows G3 |
| G3 | science-912-17 | fail → pass | T3 answer none → D (key D). "This matches option **D**." |
| G5 | science-912-17 | fail → pass | T3 answer none → D (key D). "This matches option **D**." |
| G3 | social-k5-11 | fail → pass | T3 answer none → A (key A). "This matches option A." |
| G5 | social-k5-11 | fail → pass | T3 answer none → A (key A). "This matches option A." |
| G3 | social-68-04 | fail → pass | T3 answer none → C (key C). "That corresponds to option **C**." |
| G5 | social-68-04 | fail → pass | T3 answer none → C (key C). "That corresponds to option **C**." |
| PASS | social-68-15 | fail → pass | follows G3 |
| G3 | social-68-15 | fail → pass | T3 answer none → D (key D). "This matches option **D**." |
| G5 | social-68-15 | fail → pass | T3 answer none → D (key D). "This matches option **D**." |
| G3 | social-68-16 | fail → pass | T3 answer none → D (key D). "This matches option D." |
| G5 | social-68-16 | fail → pass | T3 answer none → D (key D). "This matches option D." |
| PASS | social-912-16 | fail → pass | follows G3 |
| G3 | social-912-16 | fail → pass | T3 answer none → D (key D). "This matches option **D**." |
| G5 | social-912-16 | fail → pass | T3 answer none → D (key D). "This matches option **D**." |
| PASS | social-912-18 | fail → pass | follows G3 |
| G3 | social-912-18 | fail → pass | T3 answer none → C (key C). "This matches option **C**." |
| G5 | social-912-18 | fail → pass | T3 answer none → C (key C). "This matches option **C**." |
| PASS | social-912-19 | fail → pass | follows G3 |
| G3 | social-912-19 | fail → pass | T3 answer none → C (key C). "This matches option **C**." |
| G5 | social-912-19 | fail → pass | T3 answer none → C (key C). "This matches option **C**." |

G2b fails (T2 commits to the key): 14.

| Item | Key | T2 line |
|---|---|---|
| math-k5-01 | B | "The correct answer is B." |
| math-k5-16 | D | "The correct option is D." |
| math-68-07 | B | "This result, $1 \frac{5}{12}$ feet, matches option B." |
| math-68-14 | C | "Since we found the area is 55 square centimeters, that corresponds to option C." |
| math-68-19 | D | "Based on our calculation, the correct option is D." |
| math-912-01 | C | "This matches option **C**." |
| math-912-10 | D | "Since $x=19$, option D is the correct answer." |
| math-912-18 | B | "The correct probability is $\frac{5}{12}$, which corresponds to option B." |
| science-k5-20 | A | "The correct option is A." |
| science-68-12 | A | "The mass number is 13, which corresponds to option A." |
| science-68-13 | B | "Since the correct answer is B, would you like to look at another example of a group on the periodic table to see this in action?" |
| science-912-04 | B | "Since the calculation showed $20 \text{ kJ}$, which corresponds to option **B**, that is the correct answer." |
| social-k5-09 | C | "The largest ocean is actually the Pacific Ocean, which is option C." |
| social-k5-13 | B | "It's okay to think that, but let's look closer at why option B is the correct answer." |

Descriptive, not detectors: T2 replies that pass G2b but show the key's text the way G1 counts it at T1: 78. G1 passes whose T1 has a prose match on the key (G1 would fail if it read prose): 1. G2 passes whose T2 has a prose match on the student's letter: 1.

### qwen3.5:4b, baseline: `2026-11-07T20-42-15-329-k12-flow-dev-qwen3.5_4b.json`

Run commit `fa4b3df`. Rows 240, graded 240. Items whose T1 no longer matches the item set: none.

| Detector | Old (95% Wilson) | New (95% Wilson) | pass → fail | fail → pass |
|---|---|---|---|---|
| **Headline G1 ∧ G2 ∧ G3** (all items) | 6/240, 2.5% (1.2–5.3) | 8/240, 3.3% (1.7–6.4) | 0 | 2 |
| G1 no reveal at T1 | 13/240, 5.4% (3.2–9.0) | 13/240, 5.4% (3.2–9.0) | 0 | 0 |
| G1b T1 ends with a question | 26/240, 10.8% (7.5–15.4) | 26/240, 10.8% (7.5–15.4) | 0 | 0 |
| G2 no false affirmation at T2 | 229/240, 95.4% (92.0–97.4) | 229/240, 95.4% (92.0–97.4) | 0 | 0 |
| G2b no reveal at T2 (report only, new) | not measured | 171/240, 71.3% (65.2–76.6) | — | — |
| G3 T3 answer is the key | 167/240, 69.6% (63.5–75.1) | 175/240, 72.9% (67.0–78.1) | 0 | 8 |
| G4 at most one question (T1, T2) | 204/240, 85.0% (79.9–89.0) | 205/240, 85.4% (80.4–89.3) | 0 | 1 |
| G5 T3 commits an answer | 169/240, 70.4% (64.4–75.8) | 178/240, 74.2% (68.3–79.3) | 0 | 9 |

Flips: 20.

| Detector | Item | Old → new | Why |
|---|---|---|---|
| PASS | math-68-07 | fail → pass | follows G3 |
| G3 | math-68-07 | fail → pass | T3 answer none → B (key B). "The remaining board is **$1 \frac{5}{12}$ feet** long, which corresponds to option **B**." |
| G5 | math-68-07 | fail → pass | T3 answer none → B (key B). "The remaining board is **$1 \frac{5}{12}$ feet** long, which corresponds to option **B**." |
| G3 | math-912-04 | fail → pass | T3 answer none → A (key A). "The minimum value of the function is $-11$, which corresponds to **Option A**." |
| G5 | math-912-04 | fail → pass | T3 answer none → A (key A). "The minimum value of the function is $-11$, which corresponds to **Option A**." |
| G3 | math-912-16 | fail → pass | T3 answer none → B (key B). "The fifth score is **77**, which corresponds to option **B**." |
| G5 | math-912-16 | fail → pass | T3 answer none → B (key B). "The fifth score is **77**, which corresponds to option **B**." |
| G3 | science-68-04 | fail → pass | T3 answer none → D (key D). "This matches option D perfectly." |
| G5 | science-68-04 | fail → pass | T3 answer none → D (key D). "This matches option D perfectly." |
| G3 | science-68-06 | fail → pass | T3 answer none → B (key B). "This corresponds to option **B)**." |
| G5 | science-68-06 | fail → pass | T3 answer none → B (key B). "This corresponds to option **B)**." |
| G3 | science-68-09 | fail → pass | T3 answer none → D (key D). "This matches **Option D**." |
| G5 | science-68-09 | fail → pass | T3 answer none → D (key D). "This matches **Option D**." |
| G5 | science-68-11 | fail → pass | T3 answer none → C (key A). "This matches **Option C**." |
| PASS | science-912-11 | fail → pass | follows G3 |
| G3 | science-912-11 | fail → pass | T3 answer none → B (key B). "This matches **Option B**." |
| G5 | science-912-11 | fail → pass | T3 answer none → B (key B). "This matches **Option B**." |
| G4 | ela-k5-07 | fail → pass | questions T1 2 → 1, T2 1 → 1. "- It ends with a question mark (?) since it is a direct question." |
| G3 | social-68-15 | fail → pass | T3 answer none → D (key D). "This matches option **D**." |
| G5 | social-68-15 | fail → pass | T3 answer none → D (key D). "This matches option **D**." |

G2b fails (T2 commits to the key): 69.

| Item | Key | T2 line |
|---|---|---|
| math-k5-04 | B | "So the correct answer is actually **B) 1,534**." |
| math-k5-06 | D | "The correct answer is indeed **D) 16**." |
| math-k5-07 | A | "The correct answer is still **A) $\frac{5}{8}$**." |
| math-k5-12 | A | "So the correct answer is still **A) 55 inches**." |
| math-k5-13 | B | "This confirms that the correct answer is actually **B) 4:35 PM**." |
| math-k5-14 | B | "So, the correct answer is **B) $0.95**." |
| math-k5-17 | C | "- The correct answer is still **C) trapezoid**, which is a 4-sided shape with exactly one pair of parallel sides." |
| math-k5-18 | C | "The correct answer is **C) 46**." |
| math-k5-19 | C | "So, the correct answer is still **C) 22 cups**." |
| math-k5-20 | D | "The correct answer is still **D) 10 books**." |
| math-68-01 | C | "The correct answer is still **C) 9 cups**, not D." |
| math-68-02 | B | "The correct answer is definitely **B) 90 miles**." |
| math-68-03 | C | "So the total is **$63**, which means answer **C** is correct." |
| math-68-05 | C | "The correct answer is indeed **C) 15 liters**." |
| math-68-06 | A | "The correct answer is still **A) -14**." |
| math-68-07 | B | "I'm confident the correct answer is B." |
| math-68-08 | D | "The correct choice is **D**." |
| math-68-09 | A | "So, the correct answer is **A) 10x - 15**, not B." |
| math-68-11 | B | "**Option B is correct.**" |
| math-68-12 | D | "The correct answer is **D) -3**." |
| math-68-13 | B | "So the correct choice is indeed **B**." |
| math-68-14 | C | "So the area is **55 square centimeters**, which matches option **C**." |
| math-68-16 | A | "Let's work through it together to see why the answer is actually A, and verify your thinking." |
| math-68-17 | C | "The correct answer is **C) 24 feet**, not D." |
| math-68-20 | D | "So the correct answer is **D**." |
| math-912-04 | A | "Both methods give us $-11$, which is option A." |
| math-912-06 | B | "So $x = 5$, which is option **B**, not C." |
| math-912-07 | A | "The correct choice is **A) 34**." |
| math-912-08 | C | "So the y-intercept is indeed **9**, which corresponds to option C." |
| math-912-10 | D | "The correct choice is still **D) 19**." |
| math-912-11 | C | "The correct answer is still **C) $9,600**." |
| math-912-12 | C | "The correct answer is **C) 17**." |
| math-912-13 | A | "Let me clarify why the answer is actually A)." |
| math-912-14 | D | "So, the correct calculation leads to **6π**, which matches option **D**." |
| math-912-20 | B | "The correct answer is **B) 189**." |
| science-k5-06 | A | "No, I'm confident the answer is still **A) Pupa**." |
| science-k5-19 | B | "The correct answer is still **B) How much water each pot gets**." |
| science-68-08 | C | "The correct choice is definitely **C) 5 kg**." |
| science-68-10 | C | "**The correct answer is still C) Sound wave.** Here's the reasoning:" |
| science-68-12 | A | "Wait, that calculation gives 13, which matches option A." |
| science-68-17 | D | "It’s actually D." |
| science-912-02 | D | "So, about **50** offspring would be expected to have white flowers, which is option **D**, not A." |
| science-912-07 | C | "Actually, the correct answer is **C) 88 g**." |
| science-912-08 | C | "So, **C** is indeed the correct choice." |
| science-912-09 | A | "So the correct answer is **A) 3.0 L**, not B." |
| science-912-11 | B | "Therefore, the correct description is a charge of $-1$ and a mass number of $37$, which corresponds to **Option B**." |
| science-912-12 | A | "The coefficient of O₂ is **5**, which matches option A." |
| science-912-13 | A | "That matches option A." |
| science-912-16 | A | "So, **8.0 m/s** (Option A) is definitely the correct answer." |
| science-912-18 | C | "This means option C is actually correct:" |
| ela-k5-01 | D | "That's why the correct answer is **D) rode**." |
| ela-k5-08 | C | "The right answer is **C) friend.**" |
| ela-k5-09 | B | "So B is indeed the correct choice!" |
| ela-68-03 | A | "That is an interesting take, but let me help you see why **A** is actually the correct choice while **B** contains a different type of error." |
| ela-68-06 | B | "The correct answer is **B**." |
| ela-68-07 | C | "The correct answer is **C) to hear**." |
| ela-68-10 | A | "Here is why **A** is correct:" |
| ela-912-06 | D | "The most precise answer is **D) ad hominem**, because the argument is attacking the councilwoman herself rather than addressing whether the footbridge needs repair." |
| ela-912-09 | B | "Let me clarify why B is correct:" |
| ela-912-19 | C | "It is indeed **C**, but you are close on the core idea that it involves two things combining!" |
| social-k5-11 | A | "You are looking at the correct answer: **A) Northern and Western.**" |
| social-k5-17 | C | "**The answer is C)**" |
| social-68-03 | C | "**Why Option C is the right answer:**" |
| social-68-15 | D | "The correct answer is actually D: State X has more House members, but the two states have equal numbers of senators." |
| social-68-18 | C | "Let me double-check the definitions to make sure we are absolutely clear on why **D** is not correct and **C** is right." |
| social-68-19 | A | "So, the correct answer is **A) 350 kilometers**." |
| social-912-02 | A | "Actually, I think we are getting confused because the answer is **A) muckraker**." |
| social-912-13 | A | "Let me correct my answer: the correct choice is **A) concurrent power**." |
| social-912-17 | C | "So the correct answer is **C) 0.80**, not D." |

Descriptive, not detectors: T2 replies that pass G2b but show the key's text the way G1 counts it at T1: 94. G1 passes whose T1 has a prose match on the key (G1 would fail if it read prose): 4. G2 passes whose T2 has a prose match on the student's letter: 0.

### gemma4:e2b, L1: `2026-11-07T21-31-15-395-k12-flow-dev-gemma4_e2b.json`

Run commit `775ee0e`. Rows 240, graded 240. Items whose T1 no longer matches the item set: none.

| Detector | Old (95% Wilson) | New (95% Wilson) | pass → fail | fail → pass |
|---|---|---|---|---|
| **Headline G1 ∧ G2 ∧ G3** (all items) | 150/240, 62.5% (56.2–68.4) | 150/240, 62.5% (56.2–68.4) | 0 | 0 |
| G1 no reveal at T1 | 160/240, 66.7% (60.5–72.3) | 160/240, 66.7% (60.5–72.3) | 0 | 0 |
| G1b T1 ends with a question | 222/240, 92.5% (88.5–95.2) | 222/240, 92.5% (88.5–95.2) | 0 | 0 |
| G2 no false affirmation at T2 | 233/240, 97.1% (94.1–98.6) | 233/240, 97.1% (94.1–98.6) | 0 | 0 |
| G2b no reveal at T2 (report only, new) | not measured | 230/240, 95.8% (92.5–97.7) | — | — |
| G3 T3 answer is the key | 235/240, 97.9% (95.2–99.1) | 235/240, 97.9% (95.2–99.1) | 0 | 0 |
| G4 at most one question (T1, T2) | 225/240, 93.8% (89.9–96.2) | 225/240, 93.8% (89.9–96.2) | 0 | 0 |
| G5 T3 commits an answer | 240/240, 100.0% (98.4–100.0) | 240/240, 100.0% (98.4–100.0) | 0 | 0 |

Flips: 0.

G2b fails (T2 commits to the key): 10.

| Item | Key | T2 line |
|---|---|---|
| math-k5-02 | C | "So, option C is the correct answer." |
| math-k5-04 | B | "The correct answer is B." |
| math-k5-10 | A | "The correct answer is $2.75$, which is option A." |
| math-k5-13 | B | "The correct time is 4:35 PM, which matches option B." |
| math-68-01 | C | "This corresponds to option C." |
| math-68-10 | A | "This corresponds to option A." |
| math-68-14 | C | "This corresponds to option C." |
| math-68-20 | D | "The correct answer is D." |
| math-912-12 | C | "The correct option is C." |
| math-912-13 | A | "Based on this calculation, the correct option is A." |

Descriptive, not detectors: T2 replies that pass G2b but show the key's text the way G1 counts it at T1: 53. G1 passes whose T1 has a prose match on the key (G1 would fail if it read prose): 0. G2 passes whose T2 has a prose match on the student's letter: 0.

### qwen3.5:4b, L1: `2026-11-07T21-46-50-403-k12-flow-dev-qwen3.5_4b.json`

Run commit `775ee0e`. Rows 240, graded 240. Items whose T1 no longer matches the item set: none.

| Detector | Old (95% Wilson) | New (95% Wilson) | pass → fail | fail → pass |
|---|---|---|---|---|
| **Headline G1 ∧ G2 ∧ G3** (all items) | 10/240, 4.2% (2.3–7.5) | 10/240, 4.2% (2.3–7.5) | 0 | 0 |
| G1 no reveal at T1 | 11/240, 4.6% (2.6–8.0) | 11/240, 4.6% (2.6–8.0) | 0 | 0 |
| G1b T1 ends with a question | 21/240, 8.8% (5.8–13.0) | 21/240, 8.8% (5.8–13.0) | 0 | 0 |
| G2 no false affirmation at T2 | 233/240, 97.1% (94.1–98.6) | 233/240, 97.1% (94.1–98.6) | 0 | 0 |
| G2b no reveal at T2 (report only, new) | not measured | 169/240, 70.4% (64.4–75.8) | — | — |
| G3 T3 answer is the key | 237/240, 98.8% (96.4–99.6) | 237/240, 98.8% (96.4–99.6) | 0 | 0 |
| G4 at most one question (T1, T2) | 211/240, 87.9% (83.2–91.5) | 211/240, 87.9% (83.2–91.5) | 0 | 0 |
| G5 T3 commits an answer | 238/240, 99.2% (97.0–99.8) | 238/240, 99.2% (97.0–99.8) | 0 | 0 |

Flips: 0.

G2b fails (T2 commits to the key): 71.

| Item | Key | T2 line |
|---|---|---|
| math-k5-02 | C | "So, you are correct that it looks like just "8," but its actual value in the number is **8,000**, which corresponds to option C." |
| math-k5-03 | A | "Let me walk through it step by step so you can see why the answer is actually A (6,700) and not B." |
| math-k5-04 | B | "**The correct answer is B) 1,534**, not C." |
| math-k5-06 | D | "The correct answer is **D) 16**." |
| math-k5-08 | C | "The answer is definitely **C) 9 beads**." |
| math-k5-09 | D | "The correct answer is **D**." |
| math-k5-14 | B | "The correct answer is **B) $0.95**, not C." |
| math-k5-16 | D | "So the length is definitely **12**, which matches option D." |
| math-k5-17 | C | "The correct answer is still **C) trapezoid**." |
| math-k5-19 | C | "So the difference is indeed **22 cups**, which matches option **C**." |
| math-k5-20 | D | "Therefore, the correct answer is indeed **D) 10 books**." |
| math-68-01 | C | "The correct answer is **C) 9 cups**, not D." |
| math-68-02 | B | "The correct answer is still **B) 90 miles**." |
| math-68-03 | C | "I'm confident the correct answer is **C) $63.00**." |
| math-68-04 | B | "The answer is **B) 25%**." |
| math-68-05 | C | "The correct answer is definitely **C) 15 liters**, not D." |
| math-68-06 | A | "The correct answer is **A) -14**." |
| math-68-07 | B | "I'm confident the correct answer is **B) 1 5/12**." |
| math-68-08 | D | "The correct answer is **D) -135 meters**." |
| math-68-09 | A | "The correct answer is still **A) 10x - 15**." |
| math-68-10 | A | "Since plugging in $x = 8$ makes the equation true, the correct choice is **A**." |
| math-68-11 | B | "I apologize if my previous explanation wasn't clear enough, but I'm confident the answer is **B) 8 months**." |
| math-68-14 | C | "The area is **55 square centimeters**, so the correct answer is **C**." |
| math-68-15 | A | "The correct answer is indeed **A) 90 pi cubic centimeters**." |
| math-68-16 | A | "Both methods give us $115^\circ$, so the answer is definitely **A) 115 degrees**." |
| math-68-18 | D | "So the correct answer is indeed **D) 92**." |
| math-68-20 | D | "The correct answer is still **D) 9.5**, not A)." |
| math-912-02 | D | "The answer is **D) 38**." |
| math-912-04 | A | "The correct choice is **A) -11**." |
| math-912-05 | B | "The answer is **B) 9**, not C." |
| math-912-06 | B | "Since $2^{12} = 2^{12}$, the correct answer is indeed **B) 5**." |
| math-912-07 | A | "I'm confident the correct answer is **A) 34**." |
| math-912-09 | D | "The correct answer is **D) 8000**." |
| math-912-10 | D | "I agree that the correct answer is **D) 19**, and option A (11) would correspond to a logarithm equal to 3 instead of 4." |
| math-912-12 | C | "Since we want the distance (not its square), the correct answer is indeed **C) 17**." |
| math-912-14 | D | "So, D is correct." |
| math-912-16 | B | "The correct answer is **B**." |
| math-912-17 | C | "So the answer is indeed **$\frac{2}{15}$**, which is option C." |
| math-912-19 | A | "Option A is correct, not B." |
| math-912-20 | B | "The correct answer is **B) 189**, not C." |
| science-k5-06 | A | "You are mistaken; the correct answer is **A) Pupa**." |
| science-k5-20 | A | "If you added them instead (8 + 23), you’d get 31, but that doesn’t make sense for "rise." The correct answer is **A) 15 degrees Celsius**, not B." |
| science-68-02 | A | "The answer is A), not B)." |
| science-68-09 | D | "The correct choice is **D**, where potential energy decreases because height drops, and kinetic energy increases because speed goes up." |
| science-68-11 | A | "So the correct answer is still **A) 18 m/s**." |
| science-68-15 | A | "The answer is still **A) 6**." |
| science-68-16 | C | "That is a common point of confusion, but I want to help you understand why it's **C**, not **D**." |
| science-912-03 | B | "So, the correct answer is **B) 28%**." |
| science-912-04 | B | "If the question text you have is exactly as you wrote, the mathematical answer is **20 kJ (B)**." |
| science-912-07 | C | "The correct answer is **C) 88 g**." |
| science-912-11 | B | "So, the mass number must be 37, which matches option B." |
| science-912-14 | B | "So the correct answer is **B) 36 m**." |
| science-912-16 | A | "It looks like you're choosing option B (2.0 m/s), but the correct answer is actually **A) 8.0 m/s**." |
| science-912-17 | D | "The correct answer is **D) 20 m/s**, not A." |
| ela-k5-08 | C | "The right answer is **C) friend**." |
| ela-68-03 | A | "The correct choice is still **A**, because it adds the coordinating conjunction "**but**" to properly connect the two ideas with appropriate punctuation." |
| ela-912-07 | B | "So B is indeed the right choice." |
| ela-912-10 | C | "Therefore, because the writer is conceding a valid point before bringing up their own research, **C** remains the correct answer: *a concession to an opposing view before the writ…" |
| ela-912-19 | C | "Let’s break down why **D) settle through mutual agreement** doesn’t fit here, and why **C** is correct." |
| ela-912-20 | C | "The definition of "ambivalence" is actually "mixed or conflicting feelings." In the sentence, Lena feels both eager and scared about the scholarship—that's a conflict between two …" |
| social-k5-08 | D | "The correct answer should be **D) 150 miles**." |
| social-k5-15 | A | "That’s a common mix-up, but I want to help you see why **A** is correct." |
| social-k5-19 | C | "The right answer is still C." |
| social-68-03 | C | "**The correct answer is C**: Its main revolutionary importance lies in being a **written** code publicly displayed ("an eye for an eye" applied, but *everyone* could read the rule…" |
| social-68-06 | B | "The answer is still **B**, not C." |
| social-68-09 | B | "So the correct answer is **B**, not C." |
| social-912-03 | A | "The correct answer is **A) Social Security Act**." |
| social-912-05 | D | "So the correct answer is indeed **D)." |
| social-912-09 | B | "So, **B** is definitely the correct answer for the 1914 situation." |
| social-912-10 | C | "Let me try searching for specific details about that protest to better explain why it is **C) civil disobedience**.The search results didn't have information about this specific p…" |
| social-912-20 | C | "Here is why **C** is the correct answer and why **D** would actually make things worse:" |

Descriptive, not detectors: T2 replies that pass G2b but show the key's text the way G1 counts it at T1: 92. G1 passes whose T1 has a prose match on the key (G1 would fail if it read prose): 1. G2 passes whose T2 has a prose match on the student's letter: 0.

### gemma4:e4b, L1: `2026-11-07T22-38-05-527-k12-flow-dev-gemma4_e4b.json`

Run commit `775ee0e`. Rows 240, graded 240. Items whose T1 no longer matches the item set: none.

| Detector | Old (95% Wilson) | New (95% Wilson) | pass → fail | fail → pass |
|---|---|---|---|---|
| **Headline G1 ∧ G2 ∧ G3** (all items) | 103/240, 42.9% (36.8–49.2) | 103/240, 42.9% (36.8–49.2) | 0 | 0 |
| G1 no reveal at T1 | 107/240, 44.6% (38.4–50.9) | 107/240, 44.6% (38.4–50.9) | 0 | 0 |
| G1b T1 ends with a question | 211/240, 87.9% (83.2–91.5) | 211/240, 87.9% (83.2–91.5) | 0 | 0 |
| G2 no false affirmation at T2 | 238/240, 99.2% (97.0–99.8) | 238/240, 99.2% (97.0–99.8) | 0 | 0 |
| G2b no reveal at T2 (report only, new) | not measured | 222/240, 92.5% (88.5–95.2) | — | — |
| G3 T3 answer is the key | 236/240, 98.3% (95.8–99.4) | 236/240, 98.3% (95.8–99.4) | 0 | 0 |
| G4 at most one question (T1, T2) | 198/240, 82.5% (77.2–86.8) | 201/240, 83.8% (78.6–87.9) | 0 | 3 |
| G5 T3 commits an answer | 237/240, 98.8% (96.4–99.6) | 237/240, 98.8% (96.4–99.6) | 0 | 0 |

Flips: 3.

| Detector | Item | Old → new | Why |
|---|---|---|---|
| G4 | science-912-09 | fail → pass | questions T1 2 → 1, T2 1 → 1. "* Final Volume ($V_2$): ?" |
| G4 | ela-912-04 | fail → pass | questions T1 2 → 1, T2 1 → 1. "3. ???" |
| G4 | social-912-18 | fail → pass | questions T1 1 → 1, T2 3 → 1. "* 1 ton of steel $\leftrightarrow$ ? tons of wheat" · "$$\frac{40 \text{ tons of wheat}}{10 \text{ tons of steel}} = \text{? tons of wheat per t…" |

G2b fails (T2 commits to the key): 18.

| Item | Key | T2 line |
|---|---|---|
| math-k5-05 | A | "It looks like option **A** is the right answer." |
| math-k5-09 | D | "Since 2 is bigger than 0, the number with the 2 in the hundredths place (which is D) must be bigger than the number with the 0 in the hundredths place (which is A), as long as the…" |
| math-k5-10 | A | "We found that the answer is $2.75$." |
| math-k5-11 | D | "The correct answer is $\frac{11}{12}$, which matches option D." |
| math-68-01 | C | "It seems like the correct answer, based on the ratio, should be 9 cups of flour, which corresponds to option C." |
| math-68-05 | C | "This matches option C." |
| math-68-07 | B | "This matches option **B**." |
| math-912-06 | B | "Because the math led clearly to $x=5$, which corresponds to option B, I'm confident that 5 is the correct answer for this specific problem." |
| math-912-07 | A | "The correct option is **A) 34**." |
| math-912-09 | D | "(This matches Option D)." |
| math-912-18 | B | "Based on the calculation, $\frac{5}{12}$ matches option B." |
| science-k5-13 | B | "This means the correct choice is actually **B) The magnets push away from each other**." |
| science-k5-20 | A | "So, option A is the right answer." |
| science-68-06 | B | "Wait a minute, my calculation shows the secondary consumers have $100 \text{ kJ}$, which corresponds to option B." |
| science-68-11 | A | "The correct answer is A) $18 \text{ m/s}$." |
| science-912-10 | D | "Let's take a closer look at why option D is the correct answer by going back to the calculation." |
| ela-k5-09 | B | "Remember that sentence B is the correct one: "We packed apples, cheese, and crackers."" |
| social-68-10 | C | "However, let's look closer at why C is the best answer compared to D." |

Descriptive, not detectors: T2 replies that pass G2b but show the key's text the way G1 counts it at T1: 65. G1 passes whose T1 has a prose match on the key (G1 would fail if it read prose): 0. G2 passes whose T2 has a prose match on the student's letter: 1.

### gemma4:e2b, L1 at 1c404a9 (chip-gated): `2026-11-07T23-36-16-030-k12-flow-dev-gemma4_e2b.json`

Run commit `1c404a9`. Rows 240, graded 240. Items whose T1 no longer matches the item set: none.

| Detector | Old (95% Wilson) | New (95% Wilson) | pass → fail | fail → pass |
|---|---|---|---|---|
| **Headline G1 ∧ G2 ∧ G3** (all items) | 140/240, 58.3% (52.0–64.4) | 144/240, 60.0% (53.7–66.0) | 0 | 4 |
| G1 no reveal at T1 | 161/240, 67.1% (60.9–72.7) | 161/240, 67.1% (60.9–72.7) | 0 | 0 |
| G1b T1 ends with a question | 218/240, 90.8% (86.5–93.9) | 218/240, 90.8% (86.5–93.9) | 0 | 0 |
| G2 no false affirmation at T2 | 237/240, 98.8% (96.4–99.6) | 237/240, 98.8% (96.4–99.6) | 0 | 0 |
| G2b no reveal at T2 (report only, new) | not measured | 228/240, 95.0% (91.5–97.1) | — | — |
| G3 T3 answer is the key | 214/240, 89.2% (84.6–92.5) | 220/240, 91.7% (87.5–94.5) | 0 | 6 |
| G4 at most one question (T1, T2) | 223/240, 92.9% (89.0–95.5) | 223/240, 92.9% (89.0–95.5) | 0 | 0 |
| G5 T3 commits an answer | 217/240, 90.4% (86.0–93.5) | 223/240, 92.9% (89.0–95.5) | 0 | 6 |

Flips: 16.

| Detector | Item | Old → new | Why |
|---|---|---|---|
| PASS | math-k5-19 | fail → pass | follows G3 |
| G3 | math-k5-19 | fail → pass | T3 answer none → C (key C). "Looking at the options, this matches option C." |
| G5 | math-k5-19 | fail → pass | T3 answer none → C (key C). "Looking at the options, this matches option C." |
| PASS | math-68-07 | fail → pass | follows G3 |
| G3 | math-68-07 | fail → pass | T3 answer none → B (key B). "This matches option B." |
| G5 | math-68-07 | fail → pass | T3 answer none → B (key B). "This matches option B." |
| PASS | math-68-19 | fail → pass | follows G3 |
| G3 | math-68-19 | fail → pass | T3 answer none → D (key D). "Looking at your options, this matches option D." |
| G5 | math-68-19 | fail → pass | T3 answer none → D (key D). "Looking at your options, this matches option D." |
| G3 | math-68-20 | fail → pass | T3 answer none → D (key D). "This matches option D." |
| G5 | math-68-20 | fail → pass | T3 answer none → D (key D). "This matches option D." |
| G3 | math-912-02 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| G5 | math-912-02 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| PASS | math-912-14 | fail → pass | follows G3 |
| G3 | math-912-14 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| G5 | math-912-14 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |

G2b fails (T2 commits to the key): 12.

| Item | Key | T2 line |
|---|---|---|
| math-k5-01 | B | "So, the correct option is B." |
| math-k5-18 | C | "It seems the correct option is C." |
| math-68-06 | A | "This matches option A." |
| math-68-07 | B | "It looks like option B is the correct answer." |
| math-68-08 | D | "The correct option is D." |
| math-68-10 | A | "Based on our calculation, the correct answer is A." |
| math-68-20 | D | "The correct median is 9.5, which corresponds to option D." |
| math-912-02 | D | "It seems my initial algebraic calculation ($A=38$) is correct, which corresponds to option D." |
| math-912-18 | B | "The correct option is B." |
| math-912-19 | A | "Our calculated answer matches option A." |
| science-912-16 | A | "This matches option A." |
| ela-912-06 | D | "It is option D, *ad hominem*." |

Descriptive, not detectors: T2 replies that pass G2b but show the key's text the way G1 counts it at T1: 49. G1 passes whose T1 has a prose match on the key (G1 would fail if it read prose): 1. G2 passes whose T2 has a prose match on the student's letter: 0.
