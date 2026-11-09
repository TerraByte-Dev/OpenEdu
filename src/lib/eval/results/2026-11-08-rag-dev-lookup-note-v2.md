# Lookup note, wording 2 (lever 9b, iteration 2) — RAG dev under the product-course prompt — `gemma4:e2b`, `gemma4:e4b` — dev — 2026-11-08

> **RUN 2026-11-08 at `505ecd1`. KILLED by the pre-registered rule.** On gemma4:e2b the iteration-2
> note keeps iteration 1's gains (name-free positives 3 → 22 of 22 items; real-world answered rows
> 3 → 60 of 75), but the near-miss harm proxy loses 2 items (40 → 38 of 43). The rule allows 1. The two
> items lost are the two dev-v2 items iteration 1 lost. A gecko question is still answered "The Pellomir
> newt regrows a lost tail in 17 days." and Old Faithful still gets "The Ombrevast geyser erupts every
> 38 minutes, give or take two.", on 3 of 3 repeats each. On e2b the added sentence moved no near-miss
> item: iteration 2's L arm has the same near-miss outcome as iteration 1's L arm on every one of the 43
> items except `h-nm15` (3/3 → 2/3 clean).
>
> **DEV, in-sample.** The added sentence was written by Claude after reading iteration 1's failing dev
> answers. Sets: dev vault v2 (`rag-dev-v2.ts`) and RAG held-out v1 `dev`. Nothing under the sealed set
> was opened. **Not on master:** the lever code is on branch `feat/lookup-note-v2` (PR #215, closed); this file records the kill on master.

Lever (PR #215, issue #204): #205's turn classifier and `FACT_LOOKUP_NOTE`, with two sentences added
after "for this question only.": *"Answer about the exact thing the student asked about. If the
background above is about a different thing (another animal, place, event, object or substance), it
does not answer this question: do not give its numbers or facts as the answer."* Nothing else in the
note changed (`98240ac`; `estTokens` 143 → 203). This is prompt-wording iteration 2 of at most 3.

The pre-registration is the section "Pre-registration" in the body of
[PR #215](https://github.com/TerraByte-Dev/OpenEdu/pull/215), plus its dated correction (2026-11-08,
before any run) about `h-nm03`. Both were posted before any model run of this wording. They are the
canonical text; the summary below does not replace them.

## Plan (from the pre-registration)

| | |
|---|---|
| Models | `gemma4:e2b` (the kill rule applies), then `gemma4:e4b` (reported, not applied) |
| Commit | the PR head at run time, `srcDirty: false` on every run; later commits docs only |
| Arms | L: notes on (`EVAL_TURN_NOTES` unset). B: `EVAL_TURN_NOTES=off`. Same commit |
| Call | `EVAL_SET=<dev-v2\|dev> EVAL_PROMPT=product-course EVAL_MODES=always EVAL_SYLLABUS=matched EVAL_REPEATS=3 EVAL_WIRE=1 EVAL_MODEL=<model> [EVAL_TURN_NOTES=off] npm run eval` |
| Order | per model: B dev-v2, L dev-v2, B dev, L dev |
| Unit | item-majority (≥ 2 of 3; ERROR = fail), Wilson 95%, paired exact two-sided McNemar on items; rows beside items |
| Void | integrity-guard abort, ERROR rows, or `turnKind` counts ≠ the pins in `turn-kind-dev.test.ts` × 3; the tinypool shutdown crash does not void |

Kill rule (verbatim): "Kill if, on gemma4:e2b under product-course rules, name-free positives passing
does not rise by >= 10 items, or the near-miss harm proxy loses more than 1 item, or real-world
answered rows fall, or any model call is added."

As pre-registered: name-free k_L − k_B ≥ 10 of 22 items is needed. On the harm proxy (near-miss items
clean, dev-v2 25 + v1 dev 18 = 43), k_B − k_L ≥ 2 kills. Real-world answered L rows < B rows (of 75)
kills. An added call is a wire turn request in L beyond B's count for the same row structure. No
k12-flow guard was run (reason fixed in the pre-registration: the classifier code is unchanged since
`f64ade7`, and a test shows the note never reaches a k12-flow MC turn).

## Runs

| | |
|---|---|
| Commit | **`505ecd1`** (`505ecd1b455a`), the PR head at run time: `98240ac` (the wording) plus a merge of master that brought in only #214's results docs. Every run file records it with `srcDirty: false` |
| Checkout | worktree `C:/x/oe-look2` on `feat/lookup-note-v2`, its own `node_modules`; nothing in it changed during the run window |
| Models | `gemma4:e2b` (`b37049369adf`), `gemma4:e4b` (`c6eb396dbd59`); embedder `nomic-embed-text:latest` (`0a109f422b47`) |
| Ollama | 0.40.15, 127.0.0.1:11434; library on, 154 cards; RTX 3070 laptop (8 GB VRAM), 32 GB RAM, GPU only |
| Results JSON (not committed) | `C:/x/oe-look2-runs/<model>-<set>-<off\|on>-a1.json`; scripts `run.sh`, `all.sh`, `check.cjs`, `analyze.cjs`, `poison.cjs`, `side.cjs`, `recompute.cjs` (adapted from #205's and #214's review); outputs `analysis-<model>.txt`, `poison-<model>.txt`, `side-<model>.txt`, `examples-e2b.txt`, `recompute.txt`; log `run.log` |

| Before | UTC | `ollama ps` | Free RAM | VRAM in use |
|---|---|---|---|---|
| e2b | 22:08:59 | empty | 12.86 GB | 1,519 / 8,192 MiB |
| e4b | 22:13:31 | empty (after `ollama stop gemma4:e2b`) | 12.80 GB | 1,495 MiB |
| after e4b | 22:24:14 | empty (after `ollama stop gemma4:e4b`) | 12.84 GB | 1,413 MiB |

| Run | Arm | Commit | srcDirty | Rows | ERROR | UTC | rc |
|---|---|---|---|---|---|---|---|
| `gemma4_e2b-dev-v2-off-a1` | B | `505ecd1` | false | 141 | 0 | 22:09:04–22:10:14 | 0 |
| `gemma4_e2b-dev-v2-on-a1` | L | `505ecd1` | false | 141 | 0 | 22:10:18–22:11:10 | 0 |
| `gemma4_e2b-dev-off-a1` | B | `505ecd1` | false | 126 | 0 | 22:11:14–22:12:24 | 0 |
| `gemma4_e2b-dev-on-a1` | L | `505ecd1` | false | 126 | 0 | 22:12:28–22:13:24 | 0 |
| `gemma4_e4b-dev-v2-off-a1` | B | `505ecd1` | false | 141 | 0 | 22:13:35–22:16:44 | 0 |
| `gemma4_e4b-dev-v2-on-a1` | L | `505ecd1` | false | 141 | 0 | 22:16:47–22:18:56 | 0 |
| `gemma4_e4b-dev-off-a1` | B | `505ecd1` | false | 126 | 0 | 22:18:59–22:21:49 | 0 |
| `gemma4_e4b-dev-on-a1` | L | `505ecd1` | false | 126 | 0 | 22:21:53–22:24:08 | 0 |

**No run was void and none was rerun.** Every run has all rows, 0 ERROR, no abort and the expected
`turnNotes`. Each one's `turnKind` count per group equals the pins × 3 (dev-v2: 66 + 75 `fact-lookup`;
v1 dev: cross-lingual 36 `other`, paraphrase 12 `fact-lookup` + 12 `other`, near-miss 48 `fact-lookup`
+ 6 `other`, far 9 `fact-lookup` + 3 `typed-problem`). `turnNoted` is true on exactly the
`fact-lookup` rows in L and on no row in B. Every run exited 0 (no tinypool crash this time).

An independent recompute (`recompute.cjs`, from #214's review) grades from the raw answers alone. It
gives 0 mismatches against the runner's `verdict` and `realWorld` fields on all 1,068 rows, and the
same numbers below.

## Results

All intervals are Wilson 95%. Items are item-majority (≥ 2 of 3 repeats). McNemar is exact,
two-sided, on items paired by id. The row pairing (by item and repeat index across separate runs) is
arbitrary, so row p-values are rough.

### Kill rule on gemma4:e2b (applied literally)

| Clause | B (notes off) | L (notes on) | Change | Threshold | Verdict |
|---|---|---|---|---|---|
| Name-free positives passing, items (22) | 3/22, 13.6% (4.7–33.3) | 22/22, 100% (85.1–100) | +19 (b/c 0/19, p < 0.0001) | must rise ≥ 10 | met |
| Near-miss harm proxy, items clean (43) | 40/43, 93.0% (81.4–97.6) | 38/43, 88.4% (75.5–94.9) | −2 (b/c 2/0, p = 0.50) | losing ≥ 2 kills | **KILL** |
| Real-world answered, rows (75) | 3/75, 4.0% (1.4–11.1) | 60/75, 80.0% (69.6–87.5) | +57 (rows 0/57, p < 0.0001) | any fall kills | met |
| Added model calls | turn calls = rows + tool calls (160 + 146); 18 structured (v1 dev) | turn calls = rows + tool calls (141 + 127); 18 structured | none added; L makes 38 fewer turn calls (fewer tool calls) | any added call kills | met |

**The iteration-2 lookup note is killed** by the harm-proxy clause. The items lost are `v2-nl03` (gecko,
3/3 clean → 0/3) and `v2-nl16` (Old Faithful, 3/3 → 0/3). None was gained. The two v1 dev items
iteration 1 lost were already failing in this B (`h-nm03` 1/3 clean, `h-nm13` 0/3) and stay failing in
L, so they no longer count as losses. That is a fresh B sample, not a fix (side by side below).

### gemma4:e2b (kill rule applies)

| | B (notes off) | L (notes on) | b / c, p |
|---|---|---|---|
| **Name-free positives passing, items (22)** | 3/22, 13.6% (4.7–33.3) | 22/22, 100% (85.1–100) | 0/19, < 0.0001 |
| Name-free positives passing, rows (66) | 12/66, 18.2% (10.7–29.1) | 66/66, 100% (94.5–100) | rows 0/54, < 0.0001 |
| **Real-world answered, items (25)** | 1/25, 4.0% (0.7–19.5) | 20/25, 80.0% (60.9–91.1) | 0/19, < 0.0001 |
| **Real-world answered, rows (75)** | 3/75, 4.0% (1.4–11.1) | 60/75, 80.0% (69.6–87.5) | rows 0/57, < 0.0001 |
| … dev-v2, items (19); rows (57) | 1/19, 5.3% (0.9–24.6); 3/57 | 15/19, 78.9% (56.7–91.5); 46/57 | 0/14, 0.0001 |
| … v1 dev, items (6); rows (18) | 0/6 (0–39.0); 0/18 | 5/6, 83.3% (43.6–97.0); 14/18 | 0/5, 0.0625 |
| **Over-refusal rows** (not answered, refusal phrase, of 75) | 17/75, 22.7% (14.7–33.3) | 0/75, 0% (0–4.9) | rows 17/0, < 0.0001 |
| Over-refusal, items (25) | 5/25, 20.0% (8.9–39.1) | 0/25, 0% (0–13.3) | 5/0, 0.0625 |
| Not answered, no refusal phrase, rows (75) | 55/75, 73.3% (62.4–82.0) | 15/75, 20.0% (12.5–30.4) | rows 44/4 |
| **Harm proxy, near-miss items clean (43)** | 40/43, 93.0% (81.4–97.6) | 38/43, 88.4% (75.5–94.9) | 2/0, 0.50 |
| Harm proxy, rows (129) | 122/129, 94.6% (89.2–97.3) | 112/129, 86.8% (79.9–91.6) | rows 11/1, 0.006 |
| … dev-v2 near-miss items (25) | 24/25, 96.0% (80.5–99.3) | 22/25, 88.0% (70.0–95.8) | 2/0, 0.50 |
| … v1 dev near-miss items (18) | 16/18, 88.9% (67.2–96.9) | 16/18, 88.9% (67.2–96.9) | 0/0 |
| **Near-miss rows containing the vault value** (of 129) | 4 (dev-v2 2, v1 dev 2) | 14 (dev-v2 10, v1 dev 4) | |
| Near-miss rows with a citation chip (of 129) | 7 | 11 | |
| Near-miss rows with a chip or the value (of 129) | 7 | 17 | |
| v1 dev cross-lingual passing, items (12) (no note: `other`) | 4/12, 33.3% (13.8–60.9); rows 12/36 | 6/12, 50.0% (25.4–74.6); rows 13/36 | 0/2, 0.50 |
| v1 dev paraphrase passing, items (8) | 3/8, 37.5% (13.7–69.4); rows 9/24 | 6/8, 75.0% (40.9–92.9); rows 17/24 | 0/3, 0.25 |
| v1 dev far negatives clean, items (4) | 4/4 (51.0–100); rows 12/12 | 4/4 (51.0–100); rows 12/12 | |
| Gold note retrieved, positives (42 items) | 42/42 (91.6–100); rows 126/126 | 42/42 (91.6–100); rows 126/126 | |
| Name-free positive rows ending with "?" (of 66) | 61/66 (49 of them failing) | 66/66 (all passing) | |
| TTFT p50 (dev-v2 / dev) | 115 / 104 ms | 131 / 118 ms | |

The vault-value row is new in this report. #205's "chip / poison" row labelled each row once, chip
first, which hides poison values under chips (#214's review). Here, "containing the vault value" counts
every near-miss row whose answer contains that item's poison string, whatever its label.

### gemma4:e4b (reported, not applied)

| | B (notes off) | L (notes on) | b / c, p |
|---|---|---|---|
| Name-free positives passing, items (22) | 13/22, 59.1% (38.7–76.7); rows 37/66 | 22/22, 100% (85.1–100); rows 66/66 | 0/9, 0.0039 |
| Real-world answered, items (25) | 5/25, 20.0% (8.9–39.1) | 21/25, 84.0% (65.3–93.6) | 0/16, < 0.0001 |
| Real-world answered, rows (75) | 20/75, 26.7% (18.0–37.6) | 63/75, 84.0% (74.1–90.6) | rows 0/43, < 0.0001 |
| Over-refusal rows (of 75); items (25) | 5/75, 6.7% (2.9–14.7); 0/25 (0–13.3) | 2/75, 2.7% (0.7–9.2); 1/25, 4.0% (0.7–19.5) | rows 4/1, 0.375; items 0/1 |
| Harm proxy, near-miss items clean (43) | 38/43, 88.4% (75.5–94.9) | 39/43, 90.7% (78.4–96.3) | 2/3, 1.0 |
| Harm proxy, rows (129) | 108/129, 83.7% (76.4–89.1) | 110/129, 85.3% (78.1–90.4) | rows 8/10, 0.81 |
| … dev-v2 (25) / v1 dev (18) items | 25/25 (86.7–100) / 13/18 (49.1–87.5) | 24/25 (80.5–99.3) / 15/18 (60.8–94.2) | 1/0, 1.0 / 1/3, 0.625 |
| Near-miss rows containing the vault value (of 129) | 14 (dev-v2 2, v1 dev 12) | 15 (dev-v2 4, v1 dev 11) | |
| Near-miss rows with a citation chip (of 129) | 14 | 12 | |
| v1 dev cross-lingual, items (12) (no note: `other`) | 11/12, 91.7% (64.6–98.5); rows 29/36 | 8/12, 66.7% (39.1–86.2); rows 25/36 | 4/1, 0.375 |
| v1 dev paraphrase, items (8) | 6/8 (40.9–92.9); rows 16/24 | 7/8 (52.9–97.8); rows 21/24 | 0/1, 1.0 |
| v1 dev far negatives clean, items (4) | 4/4; rows 12/12 | 4/4; rows 12/12 | |
| Gold note retrieved (42 items) | 42/42; rows 126/126 | 42/42; rows 126/126 | |
| Name-free positive rows ending with "?" | 64/66 | 66/66 | |
| Added calls | turn calls = rows + tool calls (153 + 147); 18 structured | turn calls = rows + tool calls (141 + 128); 18 structured | none added |
| TTFT p50 (dev-v2 / dev) | 150 / 142 ms | 195 / 160 ms | |

Read against the e2b rule (not applied to e4b), e4b would be killed on the name-free clause: +9 items,
the most possible from a B of 13/22. Its harm proxy does not fall (+1, b/c 2/3). e4b loses `v2-nl03`
(3/3 → 1/3 clean) and `h-nm01` (2/3 → 1/3), and gains `h-nm07`, `h-nm15` and `h-nm19`. The
cross-lingual drop (11 → 8 items) is on turns that get no note (`other`), so it is run-to-run noise. Two
of those rows also retrieved differently between the arms.

### Prompt tokens (from the wire)

Each row's first turn call (the one carrying the student's turn) was aligned to its row, with one
follow-up call per tool call; every alignment was checked against the request's tail. L − B
`prompt_eval_count` on the same item and repeat: **noted turns +170 tokens on all 210, for both e2b and
e4b** (iteration 1: +121; the added sentence costs about 49 tokens). Un-noted turns: 0 on all 57,
except 1 row for e2b (−59) and 2 for e4b (−67, +67). Each of those is a cross-lingual row (Amharic,
Arabic) whose retrieval differed between the runs. No call was added. L made fewer turn calls than B
because both models called tools less with the note (rows with tool calls B/L, dev-v2: e2b 18/0, e4b
11/0; v1 dev: e2b 17/1, e4b 19/2).

### e2b answer pairs (dev-v2 name-free positives, repeat 1, B then L, verbatim)

- `v2-pf01` "The pale green lubricant that gets pressed out of seed husks: at what temperature does it boil?" (expect 287)
  - B (fail): "What is the temperature at which Ostravine oil boils, according to your notes?"
  - L (pass): "The pale green lubricant, Ostravine oil, boils at 287 degrees Celsius under standard pressure.\n\nCan you tell me what substance the oil is pressed from?"
- `v2-pf02` "how cold does that green husk oil have to get before it turns into a waxy solid?" (expect minus 31)
  - B (fail): "I see you are asking about the properties of Ostravine oil based on your notes.\n\nLet's look closely at your notes for information about Ostravine oil. What does your lab log say about what happens to the oil when it gets very cold?"
  - L (pass): "The Ostravine oil sets into a waxy solid below minus 31 degrees Celsius.\n\nCan you tell me what temperature the oil boils at under standard pressure?"
- `v2-pf03` "How many days does the little orange-bellied newt from the fast mountain streams need to grow back a lost tail?" (expect 17)
  - B (fail): "Based on your notes, what do you see regarding the time it takes for the Pellomir newt to regrow a lost tail?"
  - L (pass): "The little orange-bellied newt needs 17 days to regrow a lost tail.\n\nDoes this information help you with your notes on biology?"
- `v2-pf04` "How high is the top of that ridge with juniper on its southern slope and the old copper mine?" (expect 2,614)
  - B (fail): "I can certainly look at your notes to find that information.\n\nWhat section of your notes do you think might contain details about a ridge with juniper scrub and a copper mine?"
  - L (pass): "The top of that ridge is 2,614 metres high.\n\nDoes that information make sense in the context of the notes you have taken?"
- `v2-pf05` "In what year did the three river towns sign their agreement over fishing rights?" (expect 1683)
  - B (fail): "What information do you have written down about the Vossmerren Accord?"
  - L (pass): "The three river towns signed their agreement over fishing rights in 1683.\n\nDo you remember what the Vossmerren Accord was about?"

### e2b near-miss leaks in L (verbatim)

The new sentence names exactly this case ("another animal … do not give its numbers or facts as the
answer"). e2b still does it:

- `v2-nl03` "how long does it take a gecko to regrow its tail?", all 3 L repeats (value 17). L repeat 1:
  "The Pellomir newt regrows a lost tail in 17 days.\n\nDo you remember what subject this information
  falls under?" B repeat 1: "I do not see any information about a gecko in your notes.\n\nCan you tell
  me what subject you are currently working on? Are we focusing on science, geography, history, or
  economics?"
- `v2-nl16` "how often does old faithful erupt?", all 3 L repeats (value 38, chip): "The Ombrevast geyser
  erupts every 38 minutes, give or take two.\n\nDoes that make sense?" B repeat 2: "I do not have any
  information about an \"old faithful\" erupting in my notes or general knowledge. Could you tell me
  what you are referring to so I can help you find the answer?"
- `v2-nl20` "how long did the general strike in britain in 1926 last?", L repeat 1 (value 63): "The
  general strike in Britain in 1926 lasted for 63 days.\n\nCan you tell me something else you remember
  about the learning objectives for this general course?" B repeat 1: "I do not have information about
  a general strike in Britain in 1926 in my current notes or resources. …"
- `v2-nl24` "how long does a century plant take to flower?", all 3 L repeats (value 26, already failing
  in B: 2 chips of 3). L repeat 1: "The Cindrel palm takes about 26 years to flower.\n\nDoes that make
  sense?"
- `h-nm01` "How deep were the sample pits in the Marlow Basin survey?", L repeat 1 (value 3.71, chip):
  "The provided notes mention that the Marlow Basin sediment index came out at 3.71 across all four
  sample pits, but they do not state the actual depth of the sample pits. …" (B: 3/3 clean.)

One L answer also echoes the note's own wording: `h-nm13` L repeat 1, "The student should bake
Brannock bread until the crust sounds hollow when tapped." (the note opens "The student is asking for
information"). e4b does the same more than once ("The student notes indicate …"; `h-nm19` L repeat 3:
"Since the student is asking a specific chemical question and the provided notes mention a reaction
with *chloride*, I should check …").

e4b's `v2-nl03` leaks are a different kind: repeat 2 says "Geckos are not known to regrow their tails
… Your notes mention that the Pellomir newt regrows a lost tail in 17 days". The scorer counts the
contrast as a leak, and the gecko claim is false.

### Side by side with iteration 1's L arm (`f64ade7`), descriptive only

Not paired: iteration 1's L ran at 17:05–17:09 (e2b) and 18:17–18:24 (e4b) UTC the same day, at a
different commit, on a box with about 3 GB more free RAM. It is set beside this run's B and L.

| e2b | it1 L (`f64ade7`) | it2 B (`505ecd1`) | it2 L (`505ecd1`) |
|---|---|---|---|
| Name-free positives passing, items (22) | 22/22 (85.1–100); rows 66/66 | 3/22 (4.7–33.3); rows 12/66 | 22/22 (85.1–100); rows 66/66 |
| Harm proxy, near-miss items clean (43) | 38/43, 88.4% (75.5–94.9); rows 113/129 | 40/43, 93.0% (81.4–97.6); rows 122/129 | 38/43, 88.4% (75.5–94.9); rows 112/129 |
| Real-world answered, items (25) | 19/25, 76.0% (56.6–88.5); rows 59/75 | 1/25 (0.7–19.5); rows 3/75 | 20/25, 80.0% (60.9–91.1); rows 60/75 |
| Over-refusal rows (of 75) | 1 | 17 | 0 |
| Near-miss rows containing the vault value (of 129) | 14 | 4 | 14 |
| Near-miss rows with a citation chip (of 129) | 8 | 7 | 11 |

| e4b | it1 L (`f64ade7`) | it2 B (`505ecd1`) | it2 L (`505ecd1`) |
|---|---|---|---|
| Name-free positives passing, items (22) | 22/22 (85.1–100); rows 66/66 | 13/22 (38.7–76.7); rows 37/66 | 22/22 (85.1–100); rows 66/66 |
| Harm proxy, near-miss items clean (43) | 34/43, 79.1% (64.8–88.6); rows 100/129 | 38/43, 88.4% (75.5–94.9); rows 108/129 | 39/43, 90.7% (78.4–96.3); rows 110/129 |
| Real-world answered, items (25) | 21/25, 84.0% (65.3–93.6); rows 63/75 | 5/25 (8.9–39.1); rows 20/75 | 21/25, 84.0% (65.3–93.6); rows 63/75 |
| Near-miss rows containing the vault value (of 129) | 23 | 14 | 15 |
| Near-miss rows with a citation chip (of 129) | 15 | 14 | 12 |

The four items iteration 1 lost on e2b, near-miss clean of 3 (it1 L / it2 B / it2 L):

| Item | Question | e2b | e4b | it2 L on e2b, repeat 1 (verbatim) |
|---|---|---|---|---|
| `v2-nl03` | "how long does it take a gecko to regrow its tail?" | 0 / 3 / 0 | 0 / 3 / 1 | "The Pellomir newt regrows a lost tail in 17 days.\n\nDo you remember what subject this information falls under?" |
| `v2-nl16` | "how often does old faithful erupt?" | 0 / 3 / 0 | 3 / 3 / 3 | "The Ombrevast geyser erupts every 38 minutes, give or take two.\n\nDoes that make sense?" |
| `h-nm03` | "How much rain fell in the Marlow Basin during the survey?" | 0 / 1 / 0 | 0 / 0 / 0 | "The provided notes state that the Marlow Basin sediment index came out at 3.71, which was lower than the team expected given the rainfall. I do not have the specific amount of rain that fell during the survey recorded in these notes. …" |
| `h-nm13` | "What oven temperature should Brannock bread be baked at?" | 1 / 0 / 1 | 0 / 0 / 0 | "The student should bake Brannock bread until the crust sounds hollow when tapped.\n\nDoes that make sense, or would you like to review anything else about baking?" |

On e2b, iteration 2's L matches iteration 1's L per item on 42 of 43 near-miss items (`h-nm15` 3/3 →
2/3 is the exception), and on every name-free positive. On real-world answered it matches on 24 of 25
items (`h-nm05` 1/3 → 2/3). The sentence was written for e2b's failures and changed none of them. On
e4b, `v2-nl03` moved from 0/3 to 1/3 clean and the vault-value rows fell from 23 to 15. With a
different B and a different time, that is within the run-to-run spread seen between the two B arms
(e4b B harm proxy 36/43 at `f64ade7`, 38/43 here; e2b 42/43 then, 40/43 now).

## Reading it

- **The sentence did nothing measurable on the model the rule is for.** It names the failure almost
  word for word (another animal; do not give its numbers), and e2b still answers the gecko question
  with the newt's 17 days on 3 of 3 repeats. Iteration 1's and iteration 2's L arms give the same
  per-item outcome on 42 of 43 near-miss items. The likely reading (not tested here) is that "answer
  directly, starting in your first sentence" wins over a qualifier placed after it in the same note.
- **The gains are intact.** Name-free 22/22, real-world answered 60/75 rows, refusal-phrase rows 17 → 0.
  The note costs 170 prompt tokens on a lookup turn (49 more than iteration 1) and adds no call.
- **The kill is narrower than iteration 1's but has the same cause.** Iteration 1 lost 4 items against
  its B; this one loses 2, because the two v1 dev items already failed in this B sample. The two dev-v2
  losses are 3/3 → 0/3 each in both iterations: a confident wrong value, no hedge.
- **e4b** is not harmed on the proxy (+1 item) and gains on name-free positives and real-world answered (its cross-lingual items fall 11 → 8 of 12, over-refusal items 0 → 1), but it is not the model
  the rule is written for, and its name-free gain is capped at +9.
- **What is left:** wording iteration 3 is the last allowed on dev (PR #215's pre-registration). This
  result suggests e2b does not respond to a qualifier added *after* the directness instruction. A third
  wording would have to change the order or the scope of that instruction itself (for example, answer
  directly only from a passage about the asked-for thing, and say so when none is), or the note should
  fire only when the top passage matches the question's subject, which is code, not wording. Either
  needs its own pre-registration with the same harm clause.

## Known limits

- **DEV, in-sample** for both the classifier trigger and this sentence, which was written after reading
  iteration 1's failing answers on these items. A pass would have been dev evidence only.
- **Harm proxy, not rubric.** A chip on an answer that says the value is absent counts as harm (`h-nm13`
  on both arms). Applied as written.
- **B is a fresh sample** of the same arm as #205's B (the note is not sent in B; the code is
  otherwise unchanged in the paths B uses). Its numbers differ from #205's B by noise (e2b harm proxy
  42 → 40, real-world rows 1 → 3, refusal-phrase rows 11 → 17).
- **Side by side is not paired** and spans about 5 hours and a different free-RAM state.
- **Single-turn questions, no persona, no generated pedagogy** (as #196 and #205).
- **One machine, GPU only.** Free RAM 12.8–12.9 GB, VRAM 1.4–1.5 GB in use before the runs (desktop
  apps), against 15.6–15.9 GB and 1.0 GB in #205.
- **Branch not merged with current master.** Master gained #213 (check-before-praise, code in
  `TutorEngine.ts`) after this branch was cut; merging it would put another lever's code on this
  branch after the run, which the pre-registration does not allow. The branch is behind master and
  conflicts in `turnRules.test.ts`.
