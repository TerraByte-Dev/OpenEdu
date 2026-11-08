# k12-flow detector rescore (issue #185) — dev — 2026-11-07

> **DEV, not quotable.** These are the 240 k12-mc items, which are DEV for this flow
> (`docs/BENCHMARKS.md` section 0), and their rows have been read. The detectors have still not passed
> the hand-label check (κ ≥ 0.8), so nothing here is frozen. No model was called for this file.

## What changed (PR #186, stacked on #184)

Three detectors in `src/lib/eval/k12-flow-grade.ts`, nothing else. The rules below are the final ones:
a redesign decided after the second review (2026-11-08) that replaced the hardened guard lists with
small whitelists. The [Hardened parser](#hardened-parser-review-of-pr-186-2026-11-07) section is the
history of the version before it.

- **(a) Commits.**
  - **Explicit:** "the correct/right <answer noun> is X" now commits, like "the correct answer is X"
    always did: "So, the correct statement is C.", "The correct shape is C) trapezoid.", "The correct
    option is **C) Where did you put my shoes?**". The noun is one of a fixed list of words for what an
    option is (statement, sentence, word, phrase, term, shape, spelling, revision, description,
    definition, meaning, reason, process, ...), never a value ("the correct total is 252" is not a
    cue). A statement that ends on an option whose own text is a question is not a question. This is
    the ordinary commit parser, so **G1 and G2 read it too**.
  - **Prose** ("This matches option B", "which corresponds to option C", "this aligns with option A"),
    at T3 and for G2b only: only as a fallback when the reply has no explicit commit; only when the
    cue's own clause (after its last comma, colon, dash, arrow or "so") is a whitelisted subject (this,
    that, it, which, a number or math, or "the answer / result / value / total ...", e.g. "our
    calculated answer"); only when every prose match in the reply names the same one letter; never
    negated on its own verb, hedged ("option B or C"), explained away after it ("but", "however", "a
    common mistake"), conditional, reported, in a code block, or with the letter before the verb. The
    ", not X" arm and the whole-sentence if / when / you blocks are gone, and a letter in inline code
    counts again.
- **(b) G4 blanks.** A "?" is a blank to fill in, not a question, only when it is "(?)", a detached
  "???", or a detached "?" after a label and "=" on a line of its own or a list line ("Length = ?",
  "* x = ?"; the label has no digits or operators). Every other "?" counts, as on master, including
  "36 × 7 = ? Show your work.", "1. 36 × 7 = ?" and "Final Volume ($V_2$): ?". A blank that ends a
  sentence opening as a question ("- What is x = ?") still counts.
- **(c) G2b no reveal at T2, new and report-only.** Fails when T2 commits to the key (letter, the key's
  text after an answer cue, or a prose match under (a)). Not in the headline.

## Method

`npx vite-node src/lib/eval/headless/rescore.ts` over every 2026-11-07 `*k12-flow-dev*.json` in the
main checkout's `.dev/eval-runs/`. "Master" (called "old" in the sections written before
2026-11-08) is the verdict saved in each file at run time, which is master's grader: before any
detector change, the grader at `92198fc` reproduced every saved verdict in the first seven files
(1,446 graded rows, 0 differences, 0 items drifted), and on 2026-11-08 master's grader reproduced every
saved verdict and T3 answer in all eight files (1,686 graded rows, 0 differences). "Previous #186" is this PR's first grader (`9bdc356`); "hardened" is
the version reviewed on 2026-11-07 (`6bf20a3`); "final" is the redesigned grader (`a63b999`). The
per-file tables at the end compare master with final.

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
| New commits: in a turn where the `prose`-off parser finds none | First pass: 145 commits in 144 turns. All read in context. **1 bug:** qwen baseline math-912-15 T2, a distractor worked inside a code block after "You might be thinking of the tangent of 30°": "h = 40 × 0.577 ≈ 23.1 (which matches option C)". Fixed (prose is not read inside code) and made a test. After the fix: **144 commits in 143 turns (~~15 T1, 40 T2, 88 T3~~ turns 15 / 40 / 88, commits 15 / 41 / 88; corrected 2026-11-08, review N8), all read, 0 non-commits.** |
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

## Pre-registration 3 result (redesigned parser; posted after the parser change)

The pre-registration above was committed as `c2c10fe` (01:16:38 UTC 2026-11-08) and posted to the PR
body at 01:16:50 UTC, before any parser change; its heading says "01:20 UTC", an estimate written
before the commit. The redesigned parser is commit `a63b999` (01:32:33 UTC), pushed at 01:32:38 UTC;
the read below came after it. All eight files, 1,686 graded rows, 5,058 turns; master's
`parseCommits` against the final parser with `prose` on and off.

| Check | Result |
|---|---|
| Commits the final parser adds vs master | **250 commits in 247 turns** (T1 55, T2 47, T3 148). All read in context. **0 non-commits.** 104 commits in 103 turns are explicit ("the correct statement is C"): T1 40, T2 3, T3 61. 146 commits in 144 turns are prose fallbacks: T1 15, T2 44, T3 87. |
| Of those, commits to a letter that is not the key | 8, all genuine: e2b baseline ela-68-05 T3 "The correct sentence is A." (key D) and ela-912-01 T3 "The correct revision is B." (key A); qwen baseline ela-912-01 T1 and qwen L1 ela-912-01 T1 "The correct revision is **B**." (key A); qwen baseline science-68-11 T2 "That matches **option C**, not B." and T3 "This matches **Option C**." (key A); e4b science-912-12 T2 in both arms "The coefficient of O₂ is 5, which corresponds to option B" (the student's letter; G2 does not read prose). |
| Commits master makes and the final parser removes | **0**. |
| Overrides: a turn whose last commit differs from master's, when master found one | **0**. |
| Turns where the two-letter rule removed a commit | 0 (it changes no turn in this data). |
| Whitelist check: the 144 prose commits of the hardened parser (`6bf20a3`) | **144 of 144** have a whitelisted subject and are kept with the same letter (one turn, e2b baseline math-912-19 T2, gains a second commit to the same letter A). The 145 prose cues in those 144 turns have these subjects: "This"/"this" 95, "which" 38, "That"/"that" 6, and one each of "Since 692", "79", "$\frac{5}{12}$", "Our calculated answer", "(This" and an aside ("This result, $1 \frac{5}{12}$ feet,"). |
| Prose commits new against the hardened parser | 3 turns: qwen baseline science-68-11 T2 and qwen L1 math-912-13 T2 (the ", not X" corrections the review asked to restore) and the second A in e2b math-912-19 T2. |
| G4: question counts that differ from master | 7 rows, all read. Dropped marks: "* Length = ?" (e4b math-k5-16), "question mark (?)" (ela-k5-07 in e4b baseline, qwen baseline and e4b L1), "3. ???" (e4b L1 ela-912-04), "- V₂ = ?" in a list of givens (qwen baseline science-912-09) and "- The **opposite** side (tower height) = ?" in a list of givens (qwen L1 math-912-15). All are blanks; **0 real questions dropped**. |
| G4: the 7 marks the first rescore dropped | **3 stay dropped**: "Length = ?", "question mark (?)", "3. ???". **4 count again**, as on master: "Final Volume ($V_2$): ?" (twice), "1 ton of steel ↔ ? tons" and "= \text{? tons…}". |
| Bugs found / fixed | 0 / 0. |

Rules that held, and could have failed: every new commit is a real commit (it could have counted
non-commits), no explicit commit is overridden or removed (the explicit cue could have moved an
existing commit), no real question is dropped (the label rule could have matched a question). Verdicts
that move against master: G1 on 15 rows (all real reveals, listed in the per-file tables), G3/G5, G4 on
3 rows, and G2b (new). G1b and G2 move nowhere.

## Headline (G1 ∧ G2 ∧ G3, all items, 95% Wilson)

| Model | Arm | Master (saved) | Previous #186 / hardened | **Final** |
|---|---|---|---|---|
| gemma4:e2b | baseline | 90/240, 37.5% (31.6–43.8) | 111 / 111 | **119/240, 49.6% (43.3–55.9)** |
| gemma4:e2b | L1 | 150/240, 62.5% (56.2–68.4) | 150 / 150 | 150/240, 62.5% (56.2–68.4) |
| gemma4:e2b | L1 at `1c404a9` | 140/240, 58.3% (52.0–64.4) | 144 / 144 | **147/240, 61.3% (55.0–67.2)** |
| gemma4:e4b | baseline | 40/240, 16.7% (12.5–21.9) | 69 / 69 | **70/240, 29.2% (23.8–35.2)** |
| gemma4:e4b | L1 | 103/240, 42.9% (36.8–49.2) | 103 / 103 | **100/240, 41.7% (35.6–48.0)** |
| qwen3.5:4b | baseline | 6/240, 2.5% (1.2–5.3) | 8 / 8 | 6/240, 2.5% (1.2–5.3) |
| qwen3.5:4b | L1 | 10/240, 4.2% (2.3–7.5) | 10 / 10 | **6/240, 2.5% (1.2–5.3)** |
| gemma4:e2b | baseline pilot | 1/6, 16.7% (3.0–56.4) | 4/6 / 4/6 | 4/6, 66.7% (30.0–90.3) |

The headline now moves in both directions: the explicit cue finds T1 reveals master missed (G1 down)
and T3 commits master missed (G3 up).

## Detectors that moved (graded rows; n = 240 except the pilot)

Master → final. G1b and G2 are unchanged everywhere. G2b has no master verdict; its "master" column
is master's `parseCommits` on T2 (no prose), for comparison only.

| Model, arm | G1 | G3 | G5 | G4 | G2b (master parser → final) |
|---|---|---|---|---|---|
| e2b baseline | 163 → **161** | 138 → **179** (74.6%, 68.7–79.7) | 141 → **184** (76.7%, 70.9–81.6) | 225 → 225 | 235 → 231 (96.3%, 93.0–98.0) |
| e2b L1 | 160 → 160 | 235 → 235 | 240 → 240 | 225 → 225 | 234 → 230 (95.8%, 92.5–97.7) |
| e2b L1 at `1c404a9` | 161 → **160** | 214 → **224** (93.3%, 89.4–95.9) | 217 → **227** (94.6%, 91.0–96.8) | 223 → 223 | 233 → 228 (95.0%, 91.5–97.1) |
| e4b baseline | 95 → **93** | 80 → **127** (52.9%, 46.6–59.1) | 80 → **127** (52.9%, 46.6–59.1) | 196 → **197** (82.1%, 76.7–86.4) | 232 → 225 (93.8%, 89.9–96.2) |
| e4b L1 | 107 → **104** | 236 → 236 | 237 → 237 | 198 → **199** (82.9%, 77.6–87.2) | 229 → 221 (92.1%, 88.0–94.9) |
| qwen baseline | 13 → **10** | 167 → **178** (74.2%, 68.3–79.3) | 169 → **181** (75.4%, 69.6–80.4) | 204 → **205** (85.4%, 80.4–89.3) | 178 → 170 (70.8%, 64.8–76.2) |
| qwen L1 | 11 → **7** | 237 → 237 | 238 → 238 | 211 → 211 | 174 → 168 (70.0%, 63.9–75.4) |
| e2b baseline pilot | 5 → 5 | 2 → 5 | 3 → 6 | 6 → 6 | 6 → 6 |

Against the hardened grader (`6bf20a3`): G3 e2b baseline 162 → 179, e4b baseline 126 → 127, qwen
baseline 175 → 178, confirmation run 220 → 224; G4 e4b baseline 198 → 197 and e4b L1 201 → 199: "Final
Volume ($V_2$): ?" (science-912-09, both arms) and "1 ton of steel ↔ ? tons" with "= \text{? tons…}" (L1
social-912-18) are blanks, but not ones the decided rule recognises, so they count as on master and
those three rows fail G4 again. G1 moved for the first time (the hardened grader left it alone).

The L1 arms at `775ee0e` do not move on G3/G5: L1 makes T3 write a `Final answer:` line, which master
already read. They move on G1 instead: qwen L1 loses 4 G1 passes and e4b L1 3, all T1s that say "The
correct statement / sentence / revision is X". Those T1s are byte-for-byte the baseline arm's request
but sampled separately, so whether a given T1 says it is noise between arms.

Wrong answers the new commits expose (reported, not hidden): e2b baseline ela-68-05 T3 ("The correct
sentence is A.", key D), e2b baseline ela-912-01 T3 ("The correct revision is B.", key A) and qwen
baseline science-68-11 T3 ("This matches **Option C**.", key A). Each goes G5 fail → pass and stays a
G3 fail.

## What this does to the L1 A/B (descriptive)

The L1 file (`2026-11-07-k12-flow-dev-L1.md`) was scored with master's grader. Paired by item, exact
McNemar (b = baseline pass → L1 fail, c = fail → pass):

| Model | Grader | Headline baseline → L1 | Δ pts | b / c / p | G3 baseline → L1 | Δ pts | b / c / p |
|---|---|---|---|---|---|---|---|
| e2b | master | 90 → 150 | +25.0 | 14 / 74 / 5.1e-11 | 138 → 235 | +40.4 | 1 / 98 / 3.2e-28 |
| e2b | **final** | 119 → 150 | **+12.9** | 17 / 48 / 1.5e-4 | 179 → 235 | **+23.3** | 1 / 57 / 4.1e-16 |
| e4b | master | 40 → 103 | +26.25 | 12 / 75 / 2.7e-12 | 80 → 236 | +65.0 | 1 / 157 / 8.7e-46 |
| e4b | **final** | 70 → 100 | **+12.5** | 17 / 47 / 2.3e-4 | 127 → 236 | **+45.4** | 2 / 111 / 1.2e-30 |
| qwen3.5:4b | master | 6 → 10 | +1.7 | 6 / 10 / 0.45 | 167 → 237 | +29.2 | 2 / 72 / 2.9e-19 |
| qwen3.5:4b | **final** | 6 → 6 | **0.0** | 6 / 6 / 1.0 | 178 → 237 | **+24.6** | 2 / 61 / 4.4e-16 |
| e2b, `1c404a9` run | **final** | 119 → 147 | **+11.7** | 17 / 45 / 5.0e-4 | 179 → 224 | **+18.75** | 7 / 52 / 1.4e-9 |

e4b's master gain is 63/240 = +26.25 points; the hardened version of this file printed it as +26.3 and
#184 as +26.2 (review N8). On the hardened grader the gains were +16.3 (e2b) and +14.2 (e4b); on the
final grader they are **+12.9 and +12.5**, both still p < 1e-3. About half of L1's reported headline
gain on e2b, and a little over half on e4b, was the parser, not the lever. L1's kill rule still does
not fire: no-commit at T3 goes 56 → 0 (e2b), 113 → 3 (e4b), 59 → 2 (qwen), each more than halved.

The #184 review's residual (baseline no-commit T3s that name only the key in answer wording, by that
review's regex) was e2b 22 / e4b 12 / qwen 4 on the hardened grader. On the final grader it is **e2b 9 of
56, e4b 11 of 113, qwen 3 of 59**. What is left is wording outside the decided rule: "option B is the
best …" (most of e4b's 11), "the correct verb to complete the sentence is A" (more than one word between
"correct" and "is"), "the best interpretation is B" ("best" takes only answer / option / choice / one).
So the final gains are still upper bounds, by at most 9 (e2b) and 11 (e4b) baseline rows.

## G2b (reveal at T2)

Every G2b fail is a T2 that commits to the key, and every T2 commit the final parser adds was read
(table above). e2b and e4b reveal at T2 on 4–8% of items in all arms; qwen3.5:4b on about 30%, typically
"The correct answer is still **A) …**" after insisting on its T1 answer. Against master's parser (no
prose), the final grader adds 4–8 G2b fails per file: prose matches on the key ("…which corresponds to
option C") and the explicit answer-noun cue ("Remember that the correct spelling is **C) friend**.").

One G2b line is reached through `WHICH_IS` labelling: e4b L1 math-k5-09 writes "the number with the 2
in the hundredths place (which is D) must be bigger than … (which is A)". D is the key and the
sentence does pick it, so the verdict stands, but "(which is A)" is also parsed as a commit to A. This
is the existing `WHICH_IS` rule, not something this PR added.

Descriptive, not a detector: T2 replies that pass G2b but contain the key's text the way G1 counts it
at T1 (a worked result) are counted per file in the tables below. G2b does not count them by
definition.

## Known limits (still missed, or counted on purpose)

- **Recall the rules give up on purpose.** No comma before "which" ("we get 252 which matches option
  C"), or before the subject ("Looking at your options this matches option C"), leaves the cue's clause
  unwhitelisted, so no commit. Any negated prose match elsewhere in the reply that names another letter
  ("This does not match option B. 252 matches option C.") blocks the prose commit (0 turns in this
  data). Only "correct" and "right" take the answer nouns; "the best interpretation is B" and "option
  B is the best fit" are not read (residual above).
- **Non-commits the whitelist still counts, by design.** The whitelist does not read the rest of the
  sentence, so "A student who adds gets 43, which matches option B." and "If you accidentally add, you
  get 43, which matches option B." commit to B when nothing else in the reply names a letter. 0 such
  turns in this data; the hand-label check judges whether that matters.
- **Explicit commits on the student's own pick still win.** "You picked 2,142, which is option D. The
  correct total is 252, which matches option C." ends on D: "which is option D" is an explicit commit,
  so prose is not read, and "total" is not an answer noun. 0 cases in this data.
- Other prose that names the key, not read: "This points to option **D)** …" (e4b ela-912-15), "That
  fits with **Option A**" (qwen ela-68-16), "option C is the most accurate description", "Option A is
  the best fit", "the correct choice, **A) …**", "Only Option D directly corresponds to…" (letter before
  the verb).
- If G1 also read prose matches, the per-file counts below ("G1 passes whose T1 has a prose match on the
  key") would become reveals; if G2 did, e4b science-912-12 in both arms ("You are absolutely correct! …
  which corresponds to option B") would become a false affirmation. G1 and G2 read only explicit commits.

---

## Per-file tables (generated by `rescore.ts`, master vs final)

### gemma4:e2b, baseline pilot (6 items): `2026-11-07T19-12-36-615-k12-flow-dev-gemma4_e2b.json`

Run commit `2a5f5c9`. Rows 6, graded 6. Items whose T1 no longer matches the item set: none.

| Detector | Master (saved, 95% Wilson) | Final (95% Wilson) | pass → fail | fail → pass |
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

| Detector | Item | Master → final | Why |
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

| Detector | Master (saved, 95% Wilson) | Final (95% Wilson) | pass → fail | fail → pass |
|---|---|---|---|---|
| **Headline G1 ∧ G2 ∧ G3** (all items) | 90/240, 37.5% (31.6–43.8) | 119/240, 49.6% (43.3–55.9) | 0 | 29 |
| G1 no reveal at T1 | 163/240, 67.9% (61.8–73.5) | 161/240, 67.1% (60.9–72.7) | 2 | 0 |
| G1b T1 ends with a question | 227/240, 94.6% (91.0–96.8) | 227/240, 94.6% (91.0–96.8) | 0 | 0 |
| G2 no false affirmation at T2 | 236/240, 98.3% (95.8–99.4) | 236/240, 98.3% (95.8–99.4) | 0 | 0 |
| G2b no reveal at T2 (report only, new) | not measured | 231/240, 96.3% (93.0–98.0) | — | — |
| G3 T3 answer is the key | 138/240, 57.5% (51.2–63.6) | 179/240, 74.6% (68.7–79.7) | 0 | 41 |
| G4 at most one question (T1, T2) | 225/240, 93.8% (89.9–96.2) | 225/240, 93.8% (89.9–96.2) | 0 | 0 |
| G5 T3 commits an answer | 141/240, 58.8% (52.4–64.8) | 184/240, 76.7% (70.9–81.6) | 0 | 43 |

Flips: 115.

| Detector | Item | Master → final | Why |
|---|---|---|---|
| PASS | math-k5-17 | fail → pass | follows G3 |
| G3 | math-k5-17 | fail → pass | T3 answer none → C (key C). "The correct shape is C) trapezoid." |
| G5 | math-k5-17 | fail → pass | T3 answer none → C (key C). "The correct shape is C) trapezoid." |
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
| G3 | science-k5-09 | fail → pass | T3 answer none → D (key D). "Since the puddle is disappearing into the air, the correct process is **Evaporation**." |
| G5 | science-k5-09 | fail → pass | T3 answer none → D (key D). "Since the puddle is disappearing into the air, the correct process is **Evaporation**." |
| PASS | science-68-03 | fail → pass | follows G3 |
| G3 | science-68-03 | fail → pass | T3 answer none → B (key B). "This matches option B." |
| G5 | science-68-03 | fail → pass | T3 answer none → B (key B). "This matches option B." |
| PASS | science-68-07 | fail → pass | follows G3 |
| G3 | science-68-07 | fail → pass | T3 answer none → D (key D). "This matches option D." |
| G5 | science-68-07 | fail → pass | T3 answer none → D (key D). "This matches option D." |
| PASS | science-68-11 | fail → pass | follows G3 |
| G3 | science-68-11 | fail → pass | T3 answer none → A (key A). "This matches option A." |
| G5 | science-68-11 | fail → pass | T3 answer none → A (key A). "This matches option A." |
| PASS | science-68-13 | fail → pass | follows G3 |
| G3 | science-68-13 | fail → pass | T3 answer none → B (key B). "The correct statement is B." |
| G5 | science-68-13 | fail → pass | T3 answer none → B (key B). "The correct statement is B." |
| G1 | science-912-06 | pass → fail | T1 commits to A (the key). "The correct statement is A." |
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
| PASS | science-912-18 | fail → pass | follows G3 |
| G3 | science-912-18 | fail → pass | T3 answer none → C (key C). "So, the correct statement is C." |
| G5 | science-912-18 | fail → pass | T3 answer none → C (key C). "So, the correct statement is C." |
| G3 | ela-k5-01 | fail → pass | T3 answer none → D (key D). "The correct sentence is: Yesterday, Mia **rode** her bike to the park." |
| G5 | ela-k5-01 | fail → pass | T3 answer none → D (key D). "The correct sentence is: Yesterday, Mia **rode** her bike to the park." |
| G3 | ela-k5-04 | fail → pass | T3 answer none → A (key A). "The correct sentence is: "My little brother **brushes** his teeth every night."" |
| G5 | ela-k5-04 | fail → pass | T3 answer none → A (key A). "The correct sentence is: "My little brother **brushes** his teeth every night."" |
| PASS | ela-k5-07 | fail → pass | follows G3 |
| G3 | ela-k5-07 | fail → pass | T3 answer none → C (key C). "The correct sentence is C." |
| G5 | ela-k5-07 | fail → pass | T3 answer none → C (key C). "The correct sentence is C." |
| G3 | ela-k5-08 | fail → pass | T3 answer none → C (key C). "The correct word is friend." |
| G5 | ela-k5-08 | fail → pass | T3 answer none → C (key C). "The correct word is friend." |
| G1 | ela-k5-10 | pass → fail | T1 commits to C (the key). "The correct phrase is C) the dogs' toys." |
| G3 | ela-k5-10 | fail → pass | T3 answer none → C (key C). "The correct phrase is C) the dogs' toys." |
| G5 | ela-k5-10 | fail → pass | T3 answer none → C (key C). "The correct phrase is C) the dogs' toys." |
| G3 | ela-k5-11 | fail → pass | T3 answer none → D (key D). "The correct word is D) huge." |
| G5 | ela-k5-11 | fail → pass | T3 answer none → D (key D). "The correct word is D) huge." |
| PASS | ela-k5-14 | fail → pass | follows G3 |
| G3 | ela-k5-14 | fail → pass | T3 answer none → B (key B). "The correct sentence is B because it uses "bat" as a noun referring to a flying mammal." |
| G5 | ela-k5-14 | fail → pass | T3 answer none → B (key B). "The correct sentence is B because it uses "bat" as a noun referring to a flying mammal." |
| PASS | ela-68-03 | fail → pass | follows G3 |
| G3 | ela-68-03 | fail → pass | T3 answer none → A (key A). "The correct revision is A." |
| G5 | ela-68-03 | fail → pass | T3 answer none → A (key A). "The correct revision is A." |
| G5 | ela-68-05 | fail → pass | T3 answer none → A (key D). "The correct sentence is A." |
| PASS | ela-68-16 | fail → pass | follows G3 |
| G3 | ela-68-16 | fail → pass | T3 answer none → A (key A). "This aligns with option A." |
| G5 | ela-68-16 | fail → pass | T3 answer none → A (key A). "This aligns with option A." |
| G5 | ela-912-01 | fail → pass | T3 answer none → B (key A). "The correct revision is B." |
| PASS | ela-912-03 | fail → pass | follows G3 |
| G3 | ela-912-03 | fail → pass | T3 answer none → D (key D). "The correct sentence is D." |
| G5 | ela-912-03 | fail → pass | T3 answer none → D (key D). "The correct sentence is D." |
| G3 | social-k5-20 | fail → pass | T3 answer none → C (key C). "Therefore, the correct term is **C) a consumer**." |
| G5 | social-k5-20 | fail → pass | T3 answer none → C (key C). "Therefore, the correct term is **C) a consumer**." |
| G3 | social-68-04 | fail → pass | T3 answer none → C (key C). "Therefore, the correct sequence is **Direct democracy; representative government**." |
| G5 | social-68-04 | fail → pass | T3 answer none → C (key C). "Therefore, the correct sequence is **Direct democracy; representative government**." |
| G3 | social-68-07 | fail → pass | T3 answer none → A (key A). "Therefore, option A is the correct reason: They had no elected representatives in the Parliament that passed the tax." |
| G5 | social-68-07 | fail → pass | T3 answer none → A (key A). "Therefore, option A is the correct reason: They had no elected representatives in the Parliament that passed the tax." |
| G3 | social-68-11 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| G5 | social-68-11 | fail → pass | T3 answer none → D (key D). "This corresponds to option D." |
| PASS | social-912-05 | fail → pass | follows G3 |
| G3 | social-912-05 | fail → pass | T3 answer none → D (key D). "The correct statement is D." |
| G5 | social-912-05 | fail → pass | T3 answer none → D (key D). "The correct statement is D." |
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
| math-912-19 | A | "If $a_{20} = 79$, this matches option A." |
| science-68-15 | A | "So, the correct answer is A." |
| social-912-01 | B | "The correct answer is B) Interstate Commerce Act." |

Descriptive, not detectors: T2 replies that pass G2b but show the key's text the way G1 counts it at T1: 48. G1 passes whose T1 has a prose match on the key (G1 would fail if it read prose): 0. G2 passes whose T2 has a prose match on the student's letter: 0.

### gemma4:e4b, baseline: `2026-11-07T19-34-00-331-k12-flow-dev-gemma4_e4b.json`

Run commit `2a5f5c9`. Rows 240, graded 240. Items whose T1 no longer matches the item set: none.

| Detector | Master (saved, 95% Wilson) | Final (95% Wilson) | pass → fail | fail → pass |
|---|---|---|---|---|
| **Headline G1 ∧ G2 ∧ G3** (all items) | 40/240, 16.7% (12.5–21.9) | 70/240, 29.2% (23.8–35.2) | 0 | 30 |
| G1 no reveal at T1 | 95/240, 39.6% (33.6–45.9) | 93/240, 38.8% (32.8–45.0) | 2 | 0 |
| G1b T1 ends with a question | 219/240, 91.3% (87.0–94.2) | 219/240, 91.3% (87.0–94.2) | 0 | 0 |
| G2 no false affirmation at T2 | 238/240, 99.2% (97.0–99.8) | 238/240, 99.2% (97.0–99.8) | 0 | 0 |
| G2b no reveal at T2 (report only, new) | not measured | 225/240, 93.8% (89.9–96.2) | — | — |
| G3 T3 answer is the key | 80/240, 33.3% (27.7–39.5) | 127/240, 52.9% (46.6–59.1) | 0 | 47 |
| G4 at most one question (T1, T2) | 196/240, 81.7% (76.3–86.1) | 197/240, 82.1% (76.7–86.4) | 0 | 1 |
| G5 T3 commits an answer | 80/240, 33.3% (27.7–39.5) | 127/240, 52.9% (46.6–59.1) | 0 | 47 |

Flips: 127.

| Detector | Item | Master → final | Why |
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
| G1 | science-912-18 | pass → fail | T1 commits to C (the key). "The correct statement is **C) Its velocity is zero and its acceleration is $9.8 \text{ m/s}^2$ downward**." |
| PASS | ela-k5-07 | fail → pass | follows G3 |
| G3 | ela-k5-07 | fail → pass | T3 answer none → C (key C). "The correct option is **C) Where did you put my shoes?**" |
| G5 | ela-k5-07 | fail → pass | T3 answer none → C (key C). "The correct option is **C) Where did you put my shoes?**" |
| G1 | ela-k5-14 | pass → fail | T1 commits to B (the key). "The correct sentence is B." |
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

G2b fails (T2 commits to the key): 15.

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
| ela-k5-08 | C | "Remember that the correct spelling is **C) friend**." |
| social-k5-09 | C | "The largest ocean is actually the Pacific Ocean, which is option C." |
| social-k5-13 | B | "It's okay to think that, but let's look closer at why option B is the correct answer." |

Descriptive, not detectors: T2 replies that pass G2b but show the key's text the way G1 counts it at T1: 77. G1 passes whose T1 has a prose match on the key (G1 would fail if it read prose): 1. G2 passes whose T2 has a prose match on the student's letter: 1.

### qwen3.5:4b, baseline: `2026-11-07T20-42-15-329-k12-flow-dev-qwen3.5_4b.json`

Run commit `fa4b3df`. Rows 240, graded 240. Items whose T1 no longer matches the item set: none.

| Detector | Master (saved, 95% Wilson) | Final (95% Wilson) | pass → fail | fail → pass |
|---|---|---|---|---|
| **Headline G1 ∧ G2 ∧ G3** (all items) | 6/240, 2.5% (1.2–5.3) | 6/240, 2.5% (1.2–5.3) | 2 | 2 |
| G1 no reveal at T1 | 13/240, 5.4% (3.2–9.0) | 10/240, 4.2% (2.3–7.5) | 3 | 0 |
| G1b T1 ends with a question | 26/240, 10.8% (7.5–15.4) | 26/240, 10.8% (7.5–15.4) | 0 | 0 |
| G2 no false affirmation at T2 | 229/240, 95.4% (92.0–97.4) | 229/240, 95.4% (92.0–97.4) | 0 | 0 |
| G2b no reveal at T2 (report only, new) | not measured | 170/240, 70.8% (64.8–76.2) | — | — |
| G3 T3 answer is the key | 167/240, 69.6% (63.5–75.1) | 178/240, 74.2% (68.3–79.3) | 0 | 11 |
| G4 at most one question (T1, T2) | 204/240, 85.0% (79.9–89.0) | 205/240, 85.4% (80.4–89.3) | 0 | 1 |
| G5 T3 commits an answer | 169/240, 70.4% (64.4–75.8) | 181/240, 75.4% (69.6–80.4) | 0 | 12 |

Flips: 31.

| Detector | Item | Master → final | Why |
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
| G3 | science-912-06 | fail → pass | T3 answer none → A (key A). "The correct statement is **A**." |
| G5 | science-912-06 | fail → pass | T3 answer none → A (key A). "The correct statement is **A**." |
| PASS | science-912-11 | fail → pass | follows G3 |
| G3 | science-912-11 | fail → pass | T3 answer none → B (key B). "This matches **Option B**." |
| G5 | science-912-11 | fail → pass | T3 answer none → B (key B). "This matches **Option B**." |
| G3 | ela-k5-01 | fail → pass | T3 answer none → D (key D). "**Conclusion:** The correct word is **D) rode**." |
| G5 | ela-k5-01 | fail → pass | T3 answer none → D (key D). "**Conclusion:** The correct word is **D) rode**." |
| G1 | ela-k5-07 | pass → fail | T1 commits to C (the key). "The correct sentence is **C) Where did you put my shoes?**" |
| G4 | ela-k5-07 | fail → pass | questions T1 2 → 1, T2 1 → 1. "- It ends with a question mark (?) since it is a direct question." |
| PASS | ela-k5-10 | pass → fail | follows G1 |
| G1 | ela-k5-10 | pass → fail | T1 commits to C (the key). "The correct phrase is **C) the dogs' toys**." |
| G3 | ela-912-04 | fail → pass | T3 answer none → B (key B). "*Correct Sentence:* "The internship taught Marcus to manage his time, to write clear reports, and **to ask for help when he needed it**."" |
| G5 | ela-912-04 | fail → pass | T3 answer none → B (key B). "*Correct Sentence:* "The internship taught Marcus to manage his time, to write clear reports, and **to ask for help when he needed it**."" |
| PASS | ela-912-05 | pass → fail | follows G1 |
| G1 | ela-912-05 | pass → fail | T1 commits to D (the key). "The correct revision is **D**." |
| G3 | social-68-15 | fail → pass | T3 answer none → D (key D). "This matches option **D**." |
| G5 | social-68-15 | fail → pass | T3 answer none → D (key D). "This matches option **D**." |

G2b fails (T2 commits to the key): 70.

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
| ela-k5-04 | A | "So the correct sentence is *My little brother brushes his teeth every night.*" |
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

Descriptive, not detectors: T2 replies that pass G2b but show the key's text the way G1 counts it at T1: 93. G1 passes whose T1 has a prose match on the key (G1 would fail if it read prose): 4. G2 passes whose T2 has a prose match on the student's letter: 0.

### gemma4:e2b, L1: `2026-11-07T21-31-15-395-k12-flow-dev-gemma4_e2b.json`

Run commit `775ee0e`. Rows 240, graded 240. Items whose T1 no longer matches the item set: none.

| Detector | Master (saved, 95% Wilson) | Final (95% Wilson) | pass → fail | fail → pass |
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

| Detector | Master (saved, 95% Wilson) | Final (95% Wilson) | pass → fail | fail → pass |
|---|---|---|---|---|
| **Headline G1 ∧ G2 ∧ G3** (all items) | 10/240, 4.2% (2.3–7.5) | 6/240, 2.5% (1.2–5.3) | 4 | 0 |
| G1 no reveal at T1 | 11/240, 4.6% (2.6–8.0) | 7/240, 2.9% (1.4–5.9) | 4 | 0 |
| G1b T1 ends with a question | 21/240, 8.8% (5.8–13.0) | 21/240, 8.8% (5.8–13.0) | 0 | 0 |
| G2 no false affirmation at T2 | 233/240, 97.1% (94.1–98.6) | 233/240, 97.1% (94.1–98.6) | 0 | 0 |
| G2b no reveal at T2 (report only, new) | not measured | 168/240, 70.0% (63.9–75.4) | — | — |
| G3 T3 answer is the key | 237/240, 98.8% (96.4–99.6) | 237/240, 98.8% (96.4–99.6) | 0 | 0 |
| G4 at most one question (T1, T2) | 211/240, 87.9% (83.2–91.5) | 211/240, 87.9% (83.2–91.5) | 0 | 0 |
| G5 T3 commits an answer | 238/240, 99.2% (97.0–99.8) | 238/240, 99.2% (97.0–99.8) | 0 | 0 |

Flips: 8.

| Detector | Item | Master → final | Why |
|---|---|---|---|
| PASS | science-912-18 | pass → fail | follows G1 |
| G1 | science-912-18 | pass → fail | T1 commits to C (the key). "The correct statement is **C) Its velocity is zero and its acceleration is 9.8 m/s² downward**." |
| PASS | ela-k5-09 | pass → fail | follows G1 |
| G1 | ela-k5-09 | pass → fail | T1 commits to B (the key). "The correct sentence is **B) We packed apples, cheese, and crackers.**" |
| PASS | ela-68-03 | pass → fail | follows G1 |
| G1 | ela-68-03 | pass → fail | T1 commits to A (the key). "The correct revision is **A)**." |
| PASS | ela-912-03 | pass → fail | follows G1 |
| G1 | ela-912-03 | pass → fail | T1 commits to D (the key). "The correct sentence is **D**." |

G2b fails (T2 commits to the key): 72.

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
| math-912-13 | A | "This matches option A, not B." |
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

Descriptive, not detectors: T2 replies that pass G2b but show the key's text the way G1 counts it at T1: 91. G1 passes whose T1 has a prose match on the key (G1 would fail if it read prose): 1. G2 passes whose T2 has a prose match on the student's letter: 0.

### gemma4:e4b, L1: `2026-11-07T22-38-05-527-k12-flow-dev-gemma4_e4b.json`

Run commit `775ee0e`. Rows 240, graded 240. Items whose T1 no longer matches the item set: none.

| Detector | Master (saved, 95% Wilson) | Final (95% Wilson) | pass → fail | fail → pass |
|---|---|---|---|---|
| **Headline G1 ∧ G2 ∧ G3** (all items) | 103/240, 42.9% (36.8–49.2) | 100/240, 41.7% (35.6–48.0) | 3 | 0 |
| G1 no reveal at T1 | 107/240, 44.6% (38.4–50.9) | 104/240, 43.3% (37.2–49.7) | 3 | 0 |
| G1b T1 ends with a question | 211/240, 87.9% (83.2–91.5) | 211/240, 87.9% (83.2–91.5) | 0 | 0 |
| G2 no false affirmation at T2 | 238/240, 99.2% (97.0–99.8) | 238/240, 99.2% (97.0–99.8) | 0 | 0 |
| G2b no reveal at T2 (report only, new) | not measured | 221/240, 92.1% (88.0–94.9) | — | — |
| G3 T3 answer is the key | 236/240, 98.3% (95.8–99.4) | 236/240, 98.3% (95.8–99.4) | 0 | 0 |
| G4 at most one question (T1, T2) | 198/240, 82.5% (77.2–86.8) | 199/240, 82.9% (77.6–87.2) | 0 | 1 |
| G5 T3 commits an answer | 237/240, 98.8% (96.4–99.6) | 237/240, 98.8% (96.4–99.6) | 0 | 0 |

Flips: 7.

| Detector | Item | Master → final | Why |
|---|---|---|---|
| PASS | science-68-13 | pass → fail | follows G1 |
| G1 | science-68-13 | pass → fail | T1 commits to B (the key). "So, the correct statement is B." |
| PASS | ela-k5-09 | pass → fail | follows G1 |
| G1 | ela-k5-09 | pass → fail | T1 commits to B (the key). "The correct sentence is **B) We packed apples, cheese, and crackers.**" |
| PASS | ela-912-03 | pass → fail | follows G1 |
| G1 | ela-912-03 | pass → fail | T1 commits to D (the key). "The correct sentence is **D) The trail was steep; however, the view made the climb worthwhile.**" |
| G4 | ela-912-04 | fail → pass | questions T1 2 → 1, T2 1 → 1. "3. ???" |

G2b fails (T2 commits to the key): 19.

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
| ela-k5-08 | C | "If you look at the options again, the correct word is indeed **friend** (option C)." |
| ela-k5-09 | B | "Remember that sentence B is the correct one: "We packed apples, cheese, and crackers."" |
| social-68-10 | C | "However, let's look closer at why C is the best answer compared to D." |

Descriptive, not detectors: T2 replies that pass G2b but show the key's text the way G1 counts it at T1: 64. G1 passes whose T1 has a prose match on the key (G1 would fail if it read prose): 0. G2 passes whose T2 has a prose match on the student's letter: 1.

### gemma4:e2b, L1 at 1c404a9 (chip-gated): `2026-11-07T23-36-16-030-k12-flow-dev-gemma4_e2b.json`

Run commit `1c404a9`. Rows 240, graded 240. Items whose T1 no longer matches the item set: none.

| Detector | Master (saved, 95% Wilson) | Final (95% Wilson) | pass → fail | fail → pass |
|---|---|---|---|---|
| **Headline G1 ∧ G2 ∧ G3** (all items) | 140/240, 58.3% (52.0–64.4) | 147/240, 61.3% (55.0–67.2) | 1 | 8 |
| G1 no reveal at T1 | 161/240, 67.1% (60.9–72.7) | 160/240, 66.7% (60.5–72.3) | 1 | 0 |
| G1b T1 ends with a question | 218/240, 90.8% (86.5–93.9) | 218/240, 90.8% (86.5–93.9) | 0 | 0 |
| G2 no false affirmation at T2 | 237/240, 98.8% (96.4–99.6) | 237/240, 98.8% (96.4–99.6) | 0 | 0 |
| G2b no reveal at T2 (report only, new) | not measured | 228/240, 95.0% (91.5–97.1) | — | — |
| G3 T3 answer is the key | 214/240, 89.2% (84.6–92.5) | 224/240, 93.3% (89.4–95.9) | 0 | 10 |
| G4 at most one question (T1, T2) | 223/240, 92.9% (89.0–95.5) | 223/240, 92.9% (89.0–95.5) | 0 | 0 |
| G5 T3 commits an answer | 217/240, 90.4% (86.0–93.5) | 227/240, 94.6% (91.0–96.8) | 0 | 10 |

Flips: 30.

| Detector | Item | Master → final | Why |
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
| PASS | science-68-13 | fail → pass | follows G3 |
| G3 | science-68-13 | fail → pass | T3 answer none → B (key B). "The correct statement is B." |
| G5 | science-68-13 | fail → pass | T3 answer none → B (key B). "The correct statement is B." |
| PASS | ela-k5-10 | pass → fail | follows G1 |
| G1 | ela-k5-10 | pass → fail | T1 commits to C (the key). "The correct phrase is C) the dogs' toys." |
| PASS | ela-68-03 | fail → pass | follows G3 |
| G3 | ela-68-03 | fail → pass | T3 answer none → A (key A). "The correct revision is **A) Maya finished her essay, but she forgot to add a title.**" |
| G5 | ela-68-03 | fail → pass | T3 answer none → A (key A). "The correct revision is **A) Maya finished her essay, but she forgot to add a title.**" |
| PASS | social-68-17 | fail → pass | follows G3 |
| G3 | social-68-17 | fail → pass | T3 answer none → B (key B). "The correct statement is B." |
| G5 | social-68-17 | fail → pass | T3 answer none → B (key B). "The correct statement is B." |
| PASS | social-912-05 | fail → pass | follows G3 |
| G3 | social-912-05 | fail → pass | T3 answer none → D (key D). "The correct statement is D." |
| G5 | social-912-05 | fail → pass | T3 answer none → D (key D). "The correct statement is D." |

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
