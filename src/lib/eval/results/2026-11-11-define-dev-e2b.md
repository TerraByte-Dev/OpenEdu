# define ("what does X mean"): dictionary note, dev, `gemma4:e2b` (rule model) and `qwen3.5:0.8b` (descriptive), 2026-11-11

> **DEV RUNS, 2026-11-11. Not a test result, and not pooled into any claim.** Lever 18
> (`docs/BENCHMARKS.md` section 3, suite B8). Two note wordings were run on the 64 dev items, each as paired
> arms at one commit, 3 repeats. Every run is complete: 0 ERROR rows, 192 of 192 rows detected, 0 added
> calls. On e2b the note changes almost nothing that the lexical grader can see. The one consistent loss
> is **sense-k2-07 ("trunk")**: the frozen sense cap hides the elephant's-nose sense, and the note's "do
> not add meanings" makes e2b define the torso instead. Wording 2 did not fix it (1 of 3 D replies passes).
> **There is no wording 3.** Wording 2 is the candidate for the freeze. The wording-freeze commit waits on
> the hand-label gate: grader 2 has answered, **grader 1 (Tate) is pending**, and with no grader-1 export
> by the freeze B8 is descriptive (B1). **B already passes 25/25 target items on dev**, so if the test
> split looks like dev, the pre-registered ceiling outcome is the likely reading.

Lever (PR #254, issue #251): when the student's newest message asks what a word means, `TutorEngine.run`
appends a `<dictionary_entry source="Open English WordNet">` block and a `<tutor_note>` to that message
(`src/lib/kernel/defineWord.ts`). No model call is added, the system prompt is byte-identical, and the
note is never saved. The pre-registration is row 18 and B8 in `docs/BENCHMARKS.md`, frozen at `364bdaa`
apart from `DICTIONARY_NOTE`, which may change between dev iterations (at most 3 wordings).

## Plan (from the pre-registration)

| | |
|---|---|
| Arms | B `EVAL_DICTIONARY=off`, D unset (the note), both at one commit |
| Call | `EVAL_SUITE=define EVAL_SET=dev EVAL_REPEATS=3 [EVAL_DICTIONARY=off] EVAL_MODEL=<model> npm run eval`, context 8192, tools as detected, retrieval "always" |
| Items | the 64 dev items of `define-items.ts` (r3): 52 plain, 12 sense |
| Unit of analysis | item-majority (2 of 3 repeats; an ERROR repeat fails), Wilson 95%, exact two-sided McNemar, compared with `headless/define-compare.ts` |
| Models | gemma4:e2b under the rule; qwen3.5:0.8b descriptive only (not a pre-registered model; run to see the note on a weaker model) |
| Dev iterations | at most 3 note wordings; only `DICTIONARY_NOTE` may change between them |

## Runs

Run by Claude, 2026-11-11, one model process at a time. Ollama 0.40.15; gemma4:e2b digest
`b37049369adf…`, qwen3.5:0.8b digest `f3817196d142…`. Every run completed on its first attempt with
`srcDirty: false`, the arm's commit, full rows, 0 ERROR rows, not void, not partial. No run was excluded
or rerun. Files are in the main checkout's `.dev/eval-runs/`.

| Wording | Model | Arm | Commit | File | Rows | ERROR | Detected | Noted | Added calls | Tool calls | Started–finished (UTC) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | e2b | B | `364bdaa` | `2026-11-11T19-48-06-615-define-dev-B-gemma4_e2b.json` | 192 | 0 | 192 | 0 | 0 | 0 | 19:48:06–19:49:58 |
| 1 | e2b | D | `364bdaa` | `2026-11-11T19-50-01-940-define-dev-D-gemma4_e2b.json` | 192 | 0 | 192 | 192 | 0 | 0 | 19:50:01–19:51:52 |
| 1 | 0.8b | B | `364bdaa` | `2026-11-11T19-52-51-903-define-dev-B-qwen3.5_0.8b.json` | 192 | 0 | 192 | 0 | 0 | 5 | 19:52:51–19:54:39 |
| 1 | 0.8b | D | `364bdaa` | `2026-11-11T19-54-43-058-define-dev-D-qwen3.5_0.8b.json` | 192 | 0 | 192 | 192 | 0 | 7 | 19:54:43–19:56:33 |
| 2 | e2b | B | `2d872d5` | `2026-11-11T20-02-46-265-define-dev-B-gemma4_e2b.json` | 192 | 0 | 192 | 0 | 0 | 0 | 20:02:46–20:04:34 |
| 2 | e2b | D | `2d872d5` | `2026-11-11T20-04-37-377-define-dev-D-gemma4_e2b.json` | 192 | 0 | 192 | 192 | 0 | 0 | 20:04:37–20:06:16 |
| 2 | 0.8b | B | `2d872d5` | `2026-11-11T20-06-19-699-define-dev-B-qwen3.5_0.8b.json` | 192 | 0 | 192 | 0 | 0 | 13 | 20:06:19–20:08:14 |
| 2 | 0.8b | D | `2d872d5` | `2026-11-11T20-08-18-451-define-dev-D-qwen3.5_0.8b.json` | 192 | 0 | 192 | 192 | 0 | 5 | 20:08:18–20:10:12 |

The B arm runs the same code at both commits (the switch skips the note, and only the note text changed),
so the two B runs per model differ by sampling alone. On e2b they differ on def-k2-10 and on one strict
sense item; read every 1-item difference below in that light.

## Wording 1 (`364bdaa`, the pre-registration freeze commit)

```
The student asked what "{word}" means. Use the dictionary entry above as the source for its meaning. Explain it in words the student can understand, with one everyday example. If several meanings are listed, use the one that fits the student's sentence; if there is no sentence, briefly give the common ones. Do not add meanings that are not listed. Do not mention this note.
```

### gemma4:e2b (rule model)

| Group | n | B | D | lost | gained | McNemar p |
|---|---|---|---|---|---|---|
| common | 26 | 25/26 (81.1–99.3%) | 26/26 (87.1–100.0%) | — | def-k2-10 | 1.0000 |
| plain-6-8 | 13 | 13/13 (77.2–100.0%) | 13/13 (77.2–100.0%) | — | — | 1.0000 |
| plain-k8 | 39 | 38/39 (86.8–99.5%) | 39/39 (91.0–100.0%) | — | def-k2-10 | 1.0000 |
| rare | 13 | 13/13 (77.2–100.0%) | 13/13 (77.2–100.0%) | — | — | 1.0000 |
| sense | 12 | 12/12 (75.8–100.0%) | 11/12 (64.6–98.5%) | sense-k2-07 | — | 1.0000 |
| sense-strict | 12 | 11/12 (64.6–98.5%) | 9/12 (46.8–91.1%) | sense-k2-07, sense-35-07, sense-68-04 | sense-35-01 | 0.6250 |
| target | 25 | 25/25 (86.7–100.0%) | 24/25 (80.5–99.3%) | sense-k2-07 | — | 1.0000 |
| target-strict | 25 | 24/25 (80.5–99.3%) | 22/25 (70.0–95.8%) | sense-k2-07, sense-35-07, sense-68-04 | sense-35-01 | 0.6250 |
| plain-all | 52 | 51/52 (89.9–99.7%) | 52/52 (93.1–100.0%) | — | def-k2-10 | 1.0000 |

No item has an ERROR row, so the table without ERROR items is identical. Median reply length in words
(descriptive): K-2 20 / 23, 3-5 36 / 36, 6-8 41 / 43, 9-12 68 / 64 (B / D).

- **Lost, sense-k2-07 ("trunk", "the elephant lifted water with its trunk")**: B said "a long nose" 3 of 3. The 3-per-part-of-speech cap hides the proboscis sense, and under "Do not add meanings that are not listed" D said "Trunk means the body" / "the main part … the body of an animal" 3 of 3. This is the failure the sense harm clause guards, and the review predicted it for figure, bear and temper on test.
- **Lost (strict only), sense-35-07 ("crane")**: D listed the machine meaning before choosing the bird ("One meaning is a machine … another meaning is a bird") 3 of 3. That is correct, but it fails strict on "machine". B named only the bird.
- **Lost (strict only), sense-68-04 ("novel idea")**: D gave "new, original" and then "it can also mean a book" 3 of 3, which fails strict on "book". Two replies ended by asking the student which meaning fits.
- **Gained, def-k2-10 ("nibble")**: B said "a small piece" or "a small amount" (a noun reading the expect list does not hold; it passed 1 of 3 on "small bite"). D said "to take small bites" 3 of 3. This is a lexical-grader difference as much as a meaning difference.
- **Gained (strict only), sense-35-01 ("bank" of a river)**: B named the river bank and also the money bank 2 of 3 ("It can also mean a place where you keep money"). D gave only the land-beside-water sense 3 of 3.

### qwen3.5:0.8b (descriptive)

| Group | n | B | D | lost | gained | McNemar p |
|---|---|---|---|---|---|---|
| common | 26 | 23/26 (71.0–96.0%) | 25/26 (81.1–99.3%) | def-k2-19 | def-k2-10, def-k2-31, def-k2-34 | 0.6250 |
| plain-6-8 | 13 | 13/13 (77.2–100.0%) | 13/13 (77.2–100.0%) | — | — | 1.0000 |
| plain-k8 | 39 | 36/39 (79.7–97.3%) | 38/39 (86.8–99.5%) | def-k2-19 | def-k2-10, def-k2-31, def-k2-34 | 0.6250 |
| rare | 13 | 13/13 (77.2–100.0%) | 12/13 (66.7–98.6%) | def-912-04 | — | 1.0000 |
| sense | 12 | 8/12 (39.1–86.2%) | 7/12 (32.0–80.7%) | sense-912-07 | — | 1.0000 |
| sense-strict | 12 | 7/12 (32.0–80.7%) | 2/12 (4.7–44.8%) | sense-35-04, sense-35-07, sense-68-04, sense-912-04, sense-912-07 | — | 0.0625 |
| target | 25 | 21/25 (65.3–93.6%) | 19/25 (56.6–88.5%) | def-912-04, sense-912-07 | — | 0.5000 |
| target-strict | 25 | 20/25 (60.9–91.1%) | 14/25 (37.1–73.3%) | def-912-04, sense-35-04, sense-35-07, sense-68-04, sense-912-04, sense-912-07 | — | 0.0313 |
| plain-all | 52 | 49/52 (84.4–98.0%) | 50/52 (87.0–98.9%) | def-k2-19, def-912-04 | def-k2-10, def-k2-31, def-k2-34 | 1.0000 |

0 ERROR rows. Median reply length in words: K-2 30 / 37, 3-5 51 / 53, 6-8 47 / 51, 9-12 63 / 53.

- **Lost, def-k2-19 ("soggy")**: D copied a cooking sense ("the consistency of dough because of … leavening") 2 of 3 and missed "wet". B said "wet" 3 of 3.
- **Lost, def-912-04 ("perfunctory")**: D gave "done as a formality only" and a meta reply ("let me look up a dictionary") 2 of 3, neither of which is on the expect list. B passed on "superficial" 3 of 3.
- **Lost, sense-912-07 ("appreciated" in value)**: D chose the gratitude sense ("recognize with gratitude") 2 of 3. B gave "increase in value" 3 of 3.
- **Lost (strict only), sense-35-04 (pitcher), sense-35-07 (crane), sense-68-04 (novel), sense-912-04 (champion)**: D named the other sense (baseball, lifting machine, book, winner) beside the right one.
- **Gained, def-k2-10 ("nibble")**: B defined the computing nibble ("half a byte") 2 of 3. D gave "a small bite".
- **Gained, def-k2-31 ("squeal")**: B gave a non-answer 2 of 3 ("What is 'squeal'?"). D said "high-pitched cry".
- **Gained, def-k2-34 ("messy")**: B described messiness without an expected word 3 of 3 ("out of place"). D said "dirty and disorderly".

## Wording 2 (`2d872d5`, dev iteration 2; only `DICTIONARY_NOTE` changed)

```
The student asked what "{word}" means. Use the dictionary entry above as the source for its meaning. Explain it in words the student can understand, with one everyday example. If the student's message includes a sentence, explain only the meaning that fits that sentence, and do not list the other meanings. If none of the listed meanings fits the sentence, set them aside and say what the word means in that sentence. If there is no sentence, begin with the most common meaning, briefly. Except in that one case, do not add meanings that are not listed. Do not mention this note.
```

Written after reading wording 1's dev replies, so dev is in-sample for it. It targets both failure modes:
the trunk case ("if none of the listed meanings fits … say what the word means in that sentence") and
the listing case ("explain only the meaning that fits … do not list the other meanings"). The
note-collision test (`define-items.test.ts`) blocked drafts that contained "gave", "forc*", "first" and
"apart", each an expect or wrongSense term, until the wording avoided them. Caps, filter, detector, items
and grader are unchanged (the entries hash test passes).

### gemma4:e2b (rule model)

| Group | n | B | D | lost | gained | McNemar p |
|---|---|---|---|---|---|---|
| common | 26 | 26/26 (87.1–100.0%) | 26/26 (87.1–100.0%) | — | — | 1.0000 |
| plain-6-8 | 13 | 13/13 (77.2–100.0%) | 13/13 (77.2–100.0%) | — | — | 1.0000 |
| plain-k8 | 39 | 39/39 (91.0–100.0%) | 39/39 (91.0–100.0%) | — | — | 1.0000 |
| rare | 13 | 13/13 (77.2–100.0%) | 13/13 (77.2–100.0%) | — | — | 1.0000 |
| sense | 12 | 12/12 (75.8–100.0%) | 11/12 (64.6–98.5%) | sense-k2-07 | — | 1.0000 |
| sense-strict | 12 | 10/12 (55.2–95.3%) | 11/12 (64.6–98.5%) | sense-k2-07 | sense-35-01, sense-912-01 | 1.0000 |
| target | 25 | 25/25 (86.7–100.0%) | 24/25 (80.5–99.3%) | sense-k2-07 | — | 1.0000 |
| target-strict | 25 | 23/25 (75.0–97.8%) | 24/25 (80.5–99.3%) | sense-k2-07 | sense-35-01, sense-912-01 | 1.0000 |
| plain-all | 52 | 52/52 (93.1–100.0%) | 52/52 (93.1–100.0%) | — | — | 1.0000 |

0 ERROR rows. Median reply length in words: K-2 19 / 22, 3-5 38 / 38, 6-8 43 / 40, 9-12 66 / 59.

- **Lost, sense-k2-07 ("trunk")**: still lost. D said "the main part … the body of the elephant" 2 of 3; one reply recovered ("The elephant's trunk is its long nose"). The model reads the torso sense as fitting the sentence, so the "if none fits" clause never applies. B said "a long nose" 3 of 3.
- **Gained (strict only), sense-35-01 ("bank")**: B again named the money bank 2 of 3; D gave only the river sense 3 of 3.
- **Gained (strict only), sense-912-01 ("gravity of the situation")**: B said "not the physical force that pulls objects to the Earth" 3 of 3, which is correct but fails strict on "force". D gave only seriousness.
- crane and novel no longer list the other sense: wording 2 fixed the listing failure on e2b dev.

### qwen3.5:0.8b (descriptive)

| Group | n | B | D | lost | gained | McNemar p |
|---|---|---|---|---|---|---|
| common | 26 | 25/26 (81.1–99.3%) | 25/26 (81.1–99.3%) | def-k2-19 | def-k2-37 | 1.0000 |
| plain-6-8 | 13 | 13/13 (77.2–100.0%) | 13/13 (77.2–100.0%) | — | — | 1.0000 |
| plain-k8 | 39 | 38/39 (86.8–99.5%) | 38/39 (86.8–99.5%) | def-k2-19 | def-k2-37 | 1.0000 |
| rare | 13 | 13/13 (77.2–100.0%) | 13/13 (77.2–100.0%) | — | — | 1.0000 |
| sense | 12 | 8/12 (39.1–86.2%) | 7/12 (32.0–80.7%) | sense-35-04, sense-912-07 | sense-912-04 | 1.0000 |
| sense-strict | 12 | 7/12 (32.0–80.7%) | 5/12 (19.3–68.0%) | sense-k2-01, sense-35-04 | — | 0.5000 |
| target | 25 | 21/25 (65.3–93.6%) | 20/25 (60.9–91.1%) | sense-35-04, sense-912-07 | sense-912-04 | 1.0000 |
| target-strict | 25 | 20/25 (60.9–91.1%) | 18/25 (52.4–85.7%) | sense-k2-01, sense-35-04 | — | 0.5000 |
| plain-all | 52 | 51/52 (89.9–99.7%) | 51/52 (89.9–99.7%) | def-k2-19 | def-k2-37 | 1.0000 |

0 ERROR rows. Median reply length in words: K-2 32 / 37, 3-5 51 / 51, 6-8 46 / 51, 9-12 57 / 54.

- **Lost, def-k2-19 ("soggy")**: D failed 2 of 3: once with the dough/leavening sense, as in wording 1, and once with "soft and watery", which is not on the expect list.
- **Lost, sense-35-04 ("pitcher" of lemonade)**: D failed 2 of 3: one reply described only the baseball pitcher, and one said "a bowl or cup", which is near the right meaning but not on the expect list.
- **Lost, sense-912-07 ("appreciated" in value)**: D chose gratitude 2 of 3, as in wording 1.
- **Lost (strict only), sense-k2-01 ("bat" flew out of the cave)**: D named the baseball bat 2 of 3, once as the meaning.
- **Gained, def-k2-37 ("sniff")**: B gave a non-answer or described a sneeze 2 of 3; D said "smell … through the nose".
- **Gained, sense-912-04 ("championed")**: B gave "great effort" or "fights hard against" without an expected word 2 of 3; D said "fights for" or "defend".
- target-strict on 0.8b went 14 → 18 of 25 between wordings (D), so the listing failure eased, though not to B's 20.

## Decision: no wording 3

Trunk is structural: the needed sense is hidden by a frozen cap (3 per part of speech), and the note
cannot show a sense that is not in the entry. A third wording aimed at it would be tuned to one dev item.
**Wording 2 is the candidate for the freeze.** On e2b dev it keeps every plain item, fixes the listing
failure, and loses only trunk, as wording 1 did.

The wording-freeze commit waits on the hand-label gate, per B1: with no grader-1 export by the freeze,
B8 is descriptive and no accuracy claim is made.

## Hand-label gate (B8), status

| | |
|---|---|
| Sheet | `define-label-gemma4_e2b-r578155460d-g364bdaa+0884354`, built from the wording-1 e2b files |
| Rows | 60: B 30, D 30; sense 16; lexical fail 4; strict-only fail 4 |
| Grader 2 | `openai/gpt-6.1-sol`, reached through OpenRouter (`DEFINE_GRADER2_ROUTE=openrouter`, commit `4296211`; OpenAI's own API returned 429, no credit, on the account behind `OPENAI_API_KEY`). 60 of 60 rows answered; export `.dev/label-exports/grader2-gpt-6.1-sol.json` in the main checkout |
| Grader 1 (Tate) | **pending** |
| Kappa | not computed (needs both exports) |

The sheet holds only 4 lexical-fail rows against a minimum of 12: the wording-1 e2b pool has exactly 4
model-arm-item pairs with a lexical fail (B def-k2-10, B def-912-16, D sense-k2-07, D def-912-04), and
the draw rule takes "as many as the pool holds". So the lenient κ will rest on few fail rows, and the strict κ on 16 sense rows.

## Ceiling note (descriptive, dev only)

On dev, B (no note) already passes **25 of 25 target items** and **13 of 13 rare items** on e2b, at both
commits. If the test split looks like dev, the pre-registered ceiling outcome ("accuracy untestable at
this n", B ≥ 40 of 45 target items) is the likely reading, and the lever would be reported as a trust/UX
feature whatever D does. Even qwen3.5:0.8b passes 13 of 13 rare items with no note, and several of the
0.8b B replies that pass are wrong on reading (a crane as "a large metal cage", a pitcher as a
pressurised metal container). That suggests the lexical grader is lenient on rare words and some sense
items, which is exactly what the hand-label gate checks. None of this is pooled into the test claim.

## Follow-up (not part of lever 18)

Rank senses by word overlap with the student's sentence (a simplified Lesk), deterministically, before the
cap: "elephant" appears in the hidden snout gloss of "trunk". That would be a later lever with its own
pre-registration.
