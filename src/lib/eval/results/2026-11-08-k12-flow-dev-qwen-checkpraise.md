# k12-flow MC: check-before-praise on `qwen3.5:4b`, turn-2 reveals, dev, 2026-11-08

> **RUN 2026-11-08. Both runs valid. The pre-registered claim is met: the note also cuts
> qwen3.5:4b's turn-2 reveals on dev.** G2b (no reveal at T2) goes from 78 to 183 of 240 (b 11, c 116,
> exact McNemar p = 2.9e-23) and the headline does not fall (182 → 221). One repeat per arm.
>
> **DEV, not a test result.** The 240 k12-mc items are dev for this flow. The detectors have not
> passed the hand-label check (κ ≥ 0.8), and G2b misses some reveals in both arms (see "Detector
> limits"). The note's wording is in-sample (written for gemma4:e2b).

Question (PR #220): does the check-before-praise note (#213, narrowed by #218) also stop qwen3.5:4b from
giving the answer away at T2 on k12-flow MC? Under #197's first-turn hold, qwen held the answer at T1
(G1 6 → 233 of 240) but revealed it at T2 instead (G2b 178 → 88;
[`2026-11-08-k12-flow-dev-G1hold.md`](2026-11-08-k12-flow-dev-G1hold.md)). The note says, on a wrong
try, "say so kindly and give one hint, without giving the answer".

The pre-registration is the section "Pre-registration" in the body of
[PR #220](https://github.com/TerraByte-Dev/OpenEdu/pull/220), written before any run of this
measurement and not edited after. It is the canonical text.

## Plan (from the pre-registration)

| | |
|---|---|
| Arm B | `cbc373aadce5e0ed5ea4da6ae1be78607d1762b4` (master before #213; has #197's hold and L1) |
| Arm L | `9bb33ac` (master after #213 and #218) |
| Code difference | #213 + #218 only: `checkBeforePraise.ts`, its 9-line wiring in `TutorEngine.ts`, two regexes in `attemptFirst.ts` exported, tests (`git diff --stat cbc373a 9bb33ac -- src/ ':!src/lib/eval/results'`) |
| Model / suite | `qwen3.5:4b`; k12-flow MC, all 240 dev items; 1 repeat per arm, order B then L |
| Call | `EVAL_SUITE=k12-flow EVAL_MODEL=qwen3.5:4b EVAL_WIRE=1 npm run eval`, worktree detached at the arm's commit |
| Metrics | G2b (primary), G2, G1, G3, headline (G1 ∧ G2 ∧ G3); k/240, Wilson 95%; exact two-sided McNemar on paired items |

What may be claimed (verbatim): "the note also cuts qwen3.5:4b's turn-2 reveals on dev" only if G2b
rises with McNemar p < 0.05 **and** the headline does not fall (k_L ≥ k_B). Otherwise the result is
reported as "did not".

## Runs

Run by Claude, 2026-11-08, 22:31:39Z to 23:37:03Z, from one driver script in a separate worktree
(`C:/x/oe-qwen-run`, its own `npm ci`, plain `node_modules` directory). The worktree was checked clean
and `HEAD` checked against the arm's SHA before each run; `ollama stop qwen3.5:4b` and
`ollama stop nomic-embed-text` ran after each. One model process at a time.

| Arm | Commit | srcDirty | Rows | ERROR | void | Started (UTC) | Finished (UTC) | Wall | Exit |
|---|---|---|---|---|---|---|---|---|---|
| B | `cbc373a` | false | 240 | 0 | false | 22:31:43 | 23:03:22 | 31 min 39 s | 0 |
| L | `9bb33ac` | false | 240 | 0 | false | 23:03:34 | 23:36:54 | 33 min 20 s | 1 (tinypool shutdown crash after a complete run) |

Both runs valid on the first attempt; none excluded or rerun. L's exit code 1 is vitest's known
tinypool shutdown crash (`emitter.removeListener is not a function`), printed after the results file
was written; the file is complete (240 rows, `partial` false). The runs took about 32 minutes each,
not the ~80 the pre-registration estimated (#197's first qwen run took 82 minutes, its later ones 32
to 45).

| Before | Free RAM | VRAM used / free / total, GPU util | `ollama ps` |
|---|---|---|---|
| B (22:31:39Z) | 14.1 of 31.9 GB | 1368 / 6651 / 8192 MiB, 0% | empty |
| L (23:03:30Z) | 14.0 of 31.9 GB | 1311 / 6708 / 8192 MiB, 0% | empty |

During each run free RAM fell to about 4 GB (the Ollama runner's working set is about 9 GB). Midway
through L the Claude Code harness stopped the shell that had launched the driver, for low memory. The
driver and the eval process kept running untouched and finished; nothing was restarted.

Model `qwen3.5:4b` `d8b0f5e9760c…`, embedder `nomic-embed-text` `0a109f422b47…`, Ollama 0.40.15,
library on (154 cards), context 8192, tools on, identical in both runs. Hardware: RTX 3070 laptop,
8 GB VRAM. The results JSONs and stdout logs are kept outside the repo (`C:/x/oe-qwen-runs/`, copied
from the main checkout's `.dev/eval-runs/`); they are not committed.

## Results

One repeat per arm, n = 240 items, Wilson 95% in brackets, exact two-sided McNemar (b = pass in B
only, c = pass in L only):

| Detector | B | L | Δ items | b | c | McNemar p |
|---|---|---|---|---|---|---|
| **G2b** (no reveal at T2; primary) | 78/240 = 32.5% [26.9, 38.7] | 183/240 = 76.3% [70.5, 81.2] | +105 | 11 | 116 | 2.9e-23 |
| G2 (no false affirmation at T2) | 221/240 = 92.1% [88.0, 94.9] | 238/240 = 99.2% [97.0, 99.8] | +17 | 1 | 18 | 7.6e-5 |
| G1 (no reveal at T1) | 231/240 = 96.3% [93.0, 98.0] | 231/240 = 96.3% [93.0, 98.0] | 0 | 9 | 9 | 1.000 |
| G3 (T3 final answer is the key) | 205/240 = 85.4% [80.4, 89.3] | 230/240 = 95.8% [92.5, 97.7] | +25 | 8 | 33 | 1.1e-4 |
| **headline** (G1 ∧ G2 ∧ G3) | 182/240 = 75.8% [70.0, 80.8] | 221/240 = 92.1% [88.0, 94.9] | +39 | 11 | 50 | 4.6e-7 |
| G1b (T1 ends with a question) | 180/240 = 75.0% [69.2, 80.1] | 195/240 = 81.3% [75.8, 85.7] | +15 | 33 | 48 | 0.119 |
| G4 (≤ 1 question in T1 and in T2) | 179/240 = 74.6% [68.7, 79.7] | 164/240 = 68.3% [62.2, 73.9] | −15 | 56 | 41 | 0.155 |
| G5 (T3 commits an answer) | 208/240 = 86.7% [81.8, 90.4] | 231/240 = 96.3% [93.0, 98.0] | +23 | 8 | 31 | 2.9e-4 |
| chip offered after T2 | 52/240 = 21.7% [16.9, 27.3] | 104/240 = 43.3% [37.2, 49.7] | +52 | 30 | 82 | 9.3e-7 |

### Verdict: the claim is met

| Condition (pre-registration) | B | L | Verdict |
|---|---|---|---|
| G2b rises with McNemar p < 0.05 | 78 | 183 | +105, b 11, c 116, p 2.9e-23: **met** |
| headline does not fall (k_L ≥ k_B) | 182 | 221 | +39: **met** |

So, as pre-registered: **the note also cuts qwen3.5:4b's turn-2 reveals on dev.** G1 is unchanged
(231 → 231, with 9 items moving each way); T1 requests are identical between arms, so those 18 moves
are sampling noise, the size the pre-registration warned of. G3 and the headline also rise. G4 falls
15 items (not significant): L's T2 replies ask more questions. The note asks for "one hint", and some
replies turn that into a question added to the one they already ask.

The gain is not total. In 11 items L reveals where B did not, and 57 L replies still commit to the key
at T2 (B: 162).

### Context: #197 (not paired)

#197's qwen L arm (commit `32219a6`, the hold without this note) scored G2b 88/240 item-majority of
three repeats (95, 97, 99 per repeat). This run's B arm, which also has the hold, at a later master
(`cbc373a`), scored 78/240 on one repeat, close to that. L's 183/240 is roughly double either figure.
#197's qwen baseline before the hold (no hold, no note) was 178/240: the hold moved the reveal from T1
to T2, and this note takes most of it back off T2. These comparisons cross runs, commits and repeat
counts and are descriptive only.

### Trigger check

Recomputed with the lever's own `isCheckBeforePraiseTurn` (from a `git archive` of `9bb33ac`) on each
saved conversation: L T2 fires 240/240; L T1 0/240; L T3 conversation 0/240.

On the wire (the request actually sent; the tap keeps the last 120 characters of the newest user
message): every one of L's 240 T2 turns has every request ending with the note's tail ("…If it is
wrong, say so kindly and give one hint, without giving the answer. Do not mention this note." then
`</tutor_note>`), 252 requests in all. No L T1 or T3 request and no B request carries it. The note's
last sentence alone ("Do not mention this note.") is not a usable mark: #197's first-turn hold note
ends with the same sentence, and it is on all 240 T1 turns in both arms, as it should be.

### Added model calls

Both runs: 0 `structured` requests; turn requests (excluding the runner's warm-up) equal Σ over turns
of (`attempts` + `toolCalls.length` + 1 for `max_iterations`): B 750 = 750, L 739 = 739; ask-groups
equal turns (720) in both. Added calls: B 0, L 0. No model reload after the first request.

### Prompt tokens

First request of each turn (`promptEvalCount`), median / mean:

| Turn | B | L | median L − median B |
|---|---|---|---|
| T1 | 1709.5 / 1926.7 | 1709.5 / 1926.7 | 0 |
| T2 | 1656.5 / 1833.2 | 1761.5 / 1937.2 | +105 |
| T3 | 1842 / 2022.8 | 1808.5 / 1980.0 | −33.5 |

T2 paired by item, L − B: median +104, mean +104.0, range +19 to +194 (the spread is the T1 replies,
which differ between runs). T1 is identical for every item. T3 is shorter in L because L's T2 replies
are shorter (median 426 characters against 553).

### Detector limits

G2b fails a reply only when it commits to the key (a letter, or prose like "this matches option B").
It misses some reveals in both arms. In B, `science-k5-08` ends "So the correct choice is: **D)
Longer, pointing away from the Sun**" and still passes G2b. In L, `math-k5-04` says "Your answer is B,
not C … so there are 1,534 books left" and passes (example 3 below).

A cruder check, run by Claude after the verdict and not pre-registered: does the T2 reply contain the
key option's text (whole word or number)? It catches reveals G2b misses but also counts a hint that
uses the key's number. Replies containing it: B 171, L 87. Among G2b passes: B 34, L 41. Counting
those as reveals, the stricter reading goes 44 → 142 of 240 (b 11, c 109, p 1.9e-21). The direction
and most of the size hold. A hand-label pass on T2 reveals (the open κ check) would settle how much of
each arm's G2b is real.

## Examples (verbatim T2 replies, same item, B then L)

#### `science-68-15` (key A, scripted try B)

L better: B gives the answer, L asks for the last step.

Problem: "The formula for carbon dioxide is CO2. How many oxygen atoms are in three molecules of carbon dioxide?" Student at T2: "I think it's B."

**B** (G2b FAIL, G2 pass, headline pass):

> That’s not quite right yet. Let me walk through the math again:
>
> 1 molecule of CO₂ has 2 oxygen atoms.
> 3 molecules of CO₂ would have $2 \times 3$ oxygen atoms.
>
> The answer is A) 6.

**L** (G2b pass, G2 pass, headline pass):

> Let's check that together. One molecule of CO₂ has **two** oxygen atoms. So for three molecules, you multiply by 3: 2 times 3 equals...?

#### `math-k5-19` (key C, scripted try D)

L better: B works the whole problem, L only says the try is wrong.

Problem: "A lemonade stand sold 13 cups on Monday, 24 cups on Tuesday, 8 cups on Wednesday, and 19 cups on Thursday. How many more cups were sold on the two best days combined than on the two worst days combined?" Student at T2: "I think it's D."

**B** (G2b FAIL, G2 pass, headline pass):

> Let's check that step by step.
>
> First, let's identify the **two best days** (the highest sales):
> - Tuesday: 24
> - Thursday: 19
> Sum of best days: $24 + 19 = 43$
>
> Next, let's find the **two worst days** (the lowest sales):
> - Wednesday: 8
> - Monday: 13
> Sum of worst days: $8 + 13 = 21$
>
> Now, find the difference between them:
> $43 - 21 = 22$
>
> The correct answer is **C) 22 cups**, not D.

**L** (G2b pass, G2 pass, headline pass):

> Your guess D (11 cups) isn't right—let's add up what you've done so far to find which choice matches the math.

#### `math-k5-04` (key B, scripted try C)

L passes G2b but still gives the answer away: "Your answer is B, not C" and "1,534 books left". The detector misses it (see "Detector limits").

Problem: "A library had 3,002 books. It gave away 1,468 books. How many books does the library have left?" Student at T2: "I think it's C."

**B** (G2b FAIL, G2 pass, headline pass):

> Let's check that together. Subtracting 1,468 from 3,002:
>
> ```
> latex
> 3002 - 1468 = 1534
> ```
>
> The result is **1,534**, which matches option B, not C. It's easy to make a mistake with the subtraction! Did you perhaps mean to add instead of subtract?

**L** (G2b pass, G2 pass, headline pass):

> Your answer is B, not C. The correct calculation is $3002 - 1468 = 1534$, so there are 1,534 books left. I'm glad you tried solving it! Would you like to try another subtraction problem?

#### `ela-k5-16` (key C, scripted try D)

L worse: B points the student back to the passage, L names the answer.

Problem: "Read the passage. Nora planted bean seeds in a cup on Monday. She watered them every morning. By Friday, tiny green sprouts poked through the soil. What did Nora do every morning?" Student at T2: "I think it's D."

**B** (G2b pass, G2 pass, headline pass):

> That isn't quite right. Let's look at the sentence again: "She watered them every morning."
>
> The word "them" refers to the bean seeds. When someone says they "watered" something, they gave it water. So, the action she took was giving the seeds water.
>
> Can you match that action to your answer choices?

**L** (G2b FAIL, G2 pass, headline pass):

> That isn't right. The passage tells us she watered them every morning. Since "watered" means to give something water, the correct choice is C) gave the seeds water.

#### `social-912-11` (key A, scripted try B)

L worse: both explain the House/Senate split; L opens with the answer.

Problem: "Under the US Constitution, after a federal official has been impeached, which body holds the trial to decide whether that official is removed from office?" Student at T2: "I think it's B."

**B** (G2b pass, G2 pass, headline pass):

> Actually, that isn't quite right yet. Let me clarify who handles what part of the impeachment process:
>
> *   **The House of Representatives** (Option B) holds the sole power to *impeach*. This is similar to an indictment in a criminal trial; they vote yes or no on removing the official from office.
> *   **The Senate** (Option A) holds the exclusive power to conduct the *trial* and decide whether the impeached official will be convicted and removed.
>
> So, if the House votes to impeach, it is the **Senate** that sits as a court to try that official.
>
> Which part do you remember correctly from your notes: the vote to remove or the trial itself?

**L** (G2b FAIL, G2 pass, headline fail):

> That's a close guess, but actually it is A) the Senate. The House of Representatives has the power to impeach (bring charges), but the Senate has the power to try and decide on the removal. You are on the right track by thinking about Congress, just remember which chamber does what job in this process.

## What this does not show

One repeat per arm, on dev, with frozen detectors that have not passed the κ check and a note worded
for gemma4:e2b. It does not show the gain holds on held-out items, on other models, or for typed
(k12-flow-fr) problems on qwen. It also does not show the T2 replies teach better: G2b passes a reply
that only says the try is wrong with a thin hint (`math-k5-19`), and the hint's quality was not
measured.
