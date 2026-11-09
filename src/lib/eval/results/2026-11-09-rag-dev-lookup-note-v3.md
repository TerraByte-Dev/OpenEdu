# Lookup note, wording 3: notes-miss switch (lever 9e, iteration 3) — RAG dev + probe under the product-course prompt — `gemma4:e2b`, `gemma4:e4b` — 2026-11-09

> **RUN 2026-11-09 at `8d861f0`. Kill rule (dev): does not fire. Probe gate: FIRES, so `not-shipped`.**
> On gemma4:e2b, on dev, the switch removes iteration 2's two near-miss losses (gecko `v2-nl03`: 0/3
> clean in L, 2/3 in N; Old Faithful `v2-nl16`: 0/3 in L, 3/3 in N) and keeps the gains. Against B:
> name-free positives 3 → 22 of 22 items, real-world answered rows 3 → 61 of 75, harm proxy 41 → 41 of
> 43. Against wording 2 at the same commit (L) it loses nothing on any ruled metric. On the 78-item
> semi-blind probe, the near-miss harm proxy in N loses 3 items against B (38 → 35 of 40). The gate
> blocks at 2. All five probe items N fails are near-misses the switch fired on, where e2b still gives
> the vault's number. On two of them (`bn-cin-1`, `bn-cin-2`) N gives the vault's 26 years as a fact
> about the real plant, with no citation chip on 5 of those 6 rows.
>
> **DEV, in-sample** for both the extractor and the wording. The probe is semi-blind: the extractor's
> author saw its questions. Nothing under the sealed set was opened. **Not on master:** the lever code is
> on branch `feat/lookup-notes-miss` (PR #222, draft, labelled `not-shipped`). Wording iteration 3 of 3,
> so the lookup-note line is closed on the current dev sets.

Lever (PR #222, issue #204): on a `fact-lookup` turn with at least one grounding hit, a zero-call
lexical parser (`src/lib/kernel/askedThing.ts`, frozen logic, sha256 `aa76d4a5…1d4c63`) pulls out the
thing the question asks about. If no single shown passage contains every content word of it, the turn
gets the switched note: FACT_LOOKUP_NOTE's first four sentences, then *"The background above does not
contain the words "<phrase>", so it is about a different thing: do not give its names, numbers or facts
as the answer. Answer from general knowledge about "<phrase>" and say that you are. If you do not know,
say so plainly. After the answer you may ask one short question to check understanding. Do not mention
this note."* Otherwise FACT_LOOKUP_NOTE is sent byte for byte. `8d861f0` adds two guards in
`TutorEngine.run` (multi-sentence messages and "what do my notes say" keep the plain note). They change
no pinned dev or probe decision.

The pre-registration is the section "Pre-registration" in the body of
[PR #222](https://github.com/TerraByte-Dev/OpenEdu/pull/222), plus its dated section
(2026-11-09T02:30:15Z) adding the guards. Both were posted before any model run. They are the canonical
text; the summary below does not replace them.

## Plan (from the pre-registration)

| | |
|---|---|
| Models | `gemma4:e2b` (the kill rule and the probe gate apply), then `gemma4:e4b` (reported, not applied) |
| Commit | the PR head at run time, `srcDirty: false` on every run; later commits docs only |
| Arms | **B** `EVAL_TURN_NOTES=off` (no note). **L** `EVAL_NOTES_MISS=off` (wording 2 on every lookup turn). **N** both unset (the lever). Same commit |
| Call | `EVAL_SET=<set> EVAL_PROMPT=product-course EVAL_MODES=always EVAL_SYLLABUS=matched EVAL_REPEATS=3 EVAL_WIRE=1 EVAL_MODEL=<model> [EVAL_TURN_NOTES=off \| EVAL_NOTES_MISS=off] npm run eval` |
| Order | per model: B, L, N on dev-v2; then dev; then probe-v2; then probe-v1 |
| Unit | item-majority (≥ 2 of 3; ERROR = fail), Wilson 95%, paired exact two-sided McNemar on items; rows beside items |
| Void | integrity-guard abort, ERROR rows, `turnKind` ≠ pins × 3, or on dev `notes-miss` rows ≠ the frozen fire pins × 3 (29 items in N, 0 in B and L). Probe fire-set differences are reported, not voiding |

Kill rule (verbatim): "Kill if, on gemma4:e2b under product-course rules, on dev-v2 + v1 dev: the
near-miss harm proxy in N loses more than 1 item against B; or name-free positives passing in N do not
rise by >= 10 items against B; or real-world answered rows in N fall below B; or name-free positives
passing in N lose more than 1 item against L; or real-world answered items in N lose more than 2 against
L; or any model call is added. Do not ship (label `not-shipped`, keep as draft) if, on probe-v2 +
probe-v1, the near-miss harm proxy in N loses more than 1 item against B, or positives passing in N lose
more than 2 items against L."

## Runs

| | |
|---|---|
| Commit | **`8d861f0`** (`8d861f03773c`), the PR head at run time. Every run file records it with `srcDirty: false`; `git status` was empty at the start of every run |
| Checkout | worktree `C:/x/oe-look3` on `feat/lookup-notes-miss`, its own `node_modules`; no `npm test` in the run window |
| Models | `gemma4:e2b` (`b37049369adf`), `gemma4:e4b` (`c6eb396dbd59`); embedder `nomic-embed-text:latest` (`0a109f422b47`) |
| Ollama | 0.40.15, 127.0.0.1:11434; library on, 154 cards; RTX 3070 laptop (8 GB VRAM), 32 GB RAM, GPU only |
| Arm env | B and L set only their one variable. N ran under `env -u EVAL_TURN_NOTES -u EVAL_NOTES_MISS`; its run files record `options.turnNotes` and `options.notesMiss` as absent, not empty |
| Results JSON (not committed) | `C:/x/oe-look3-runs/<model>-<set>-<B\|L\|N>-a1.json` and `.stdout.txt`, copied from the main checkout's `.dev/eval-runs/`. Driver `drive.sh`, log `drive.log`. `check.cjs` (void checks), `analyze.cjs` (rule and gate), `recompute3.cjs` (independent regrade from the raw answers, after `C:/x/oe-214-review/recompute.cjs`), `tokens.cjs` (wire token deltas) |

| Before | UTC | `ollama ps` | Free RAM | VRAM in use |
|---|---|---|---|---|
| e2b | 02:33:15 | empty | 7.82 GB | 2,510 / 8,192 MiB |
| e4b, first try | 02:46:45 | **not empty**: `nomic-embed-text` still loaded (the driver stopped only the chat model) | 7.23 GB | 2,951 MiB |
| e4b, restart | 02:47:21 | empty (after stopping both models) | 8.00 GB | 2,424 MiB |
| after e4b | 03:18:22 | empty (`ollama stop gemma4:e4b` and the embedder) | 8.23 GB | 2,220 MiB |

**The first e4b try was stopped by the operator** about 25 s into e4b dev-v2 B, before its first row
finished, because the pre-model check had not been met. It wrote no results file; its stdout is kept in
`C:/x/oe-look3-runs/aborted-e4b-precondition/`. Both models were unloaded and e4b restarted from its
first run. It is not a void under the rule, and nothing from it is scored.

| Run | Arm | Commit | srcDirty | Rows | ERROR | `notes-miss` rows (pin) | UTC | rc |
|---|---|---|---|---|---|---|---|---|
| `gemma4_e2b-dev-v2-B` | B | `8d861f0` | false | 141 | 0 | 0 (0) | 02:33:18–02:34:48 | 0 |
| `gemma4_e2b-dev-v2-L` | L | `8d861f0` | false | 141 | 0 | 0 (0) | 02:34:53–02:35:53 | 0 |
| `gemma4_e2b-dev-v2-N` | N | `8d861f0` | false | 141 | 0 | 66 (66) | 02:35:57–02:36:56 | 0 |
| `gemma4_e2b-dev-B` | B | `8d861f0` | false | 126 | 0 | 0 (0) | 02:37:01–02:38:16 | 0 |
| `gemma4_e2b-dev-L` | L | `8d861f0` | false | 126 | 0 | 0 (0) | 02:38:20–02:39:27 | 0 |
| `gemma4_e2b-dev-N` | N | `8d861f0` | false | 126 | 0 | 21 (21) | 02:39:31–02:40:37 | 0 |
| `gemma4_e2b-probe-v2-B` | B | `8d861f0` | false | 177 | 0 | 0 | 02:40:42–02:42:20 | 0 |
| `gemma4_e2b-probe-v2-L` | L | `8d861f0` | false | 177 | 0 | 0 | 02:42:24–02:43:43 | 0 |
| `gemma4_e2b-probe-v2-N` | N | `8d861f0` | false | 177 | 0 | 87 (sim. 87) | 02:43:48–02:45:09 | 0 |
| `gemma4_e2b-probe-v1-B` | B | `8d861f0` | false | 57 | 0 | 0 | 02:45:14–02:45:45 | 0 |
| `gemma4_e2b-probe-v1-L` | L | `8d861f0` | false | 57 | 0 | 0 | 02:45:49–02:46:15 | 0 |
| `gemma4_e2b-probe-v1-N` | N | `8d861f0` | false | 57 | 0 | 27 (sim. 27) | 02:46:19–02:46:42 | 0 |
| `gemma4_e4b-dev-v2-B` | B | `8d861f0` | false | 141 | 0 | 0 (0) | 02:47:25–02:51:04 | 0 |
| `gemma4_e4b-dev-v2-L` | L | `8d861f0` | false | 141 | 0 | 0 (0) | 02:51:08–02:53:27 | 0 |
| `gemma4_e4b-dev-v2-N` | N | `8d861f0` | false | 141 | 0 | 66 (66) | 02:53:32–02:55:56 | 0 |
| `gemma4_e4b-dev-B` | B | `8d861f0` | false | 126 | 0 | 0 (0) | 02:56:00–02:59:24 | 0 |
| `gemma4_e4b-dev-L` | L | `8d861f0` | false | 126 | 0 | 0 (0) | 02:59:29–03:02:11 | 0 |
| `gemma4_e4b-dev-N` | N | `8d861f0` | false | 126 | 0 | 21 (21) | 03:02:16–03:04:49 | 0 |
| `gemma4_e4b-probe-v2-B` | B | `8d861f0` | false | 177 | 0 | 0 | 03:04:53–03:09:11 | 0 |
| `gemma4_e4b-probe-v2-L` | L | `8d861f0` | false | 177 | 0 | 0 | 03:09:15–03:12:15 | 0 |
| `gemma4_e4b-probe-v2-N` | N | `8d861f0` | false | 177 | 0 | 87 (sim. 87) | 03:12:19–03:15:07 | 0 |
| `gemma4_e4b-probe-v1-B` | B | `8d861f0` | false | 57 | 0 | 0 | 03:15:11–03:16:23 | 0 |
| `gemma4_e4b-probe-v1-L` | L | `8d861f0` | false | 57 | 0 | 0 | 03:16:27–03:17:24 | 0 |
| `gemma4_e4b-probe-v1-N` | N | `8d861f0` | false | 57 | 0 | 27 (sim. 27) | 03:17:28–03:18:21 | 0 |

**No run was void and none was rerun.** Every run has all rows, 0 ERROR, no abort and the expected
`turnNotes`/`notesMiss`. Each one's `turnKind` counts equal the pins × 3 (dev-v2 141 `fact-lookup`; v1
dev 69 `fact-lookup`, 54 `other`, 3 `typed-problem`; probe-v2 162 + 15 `other`; probe-v1 54 + 3). The
dev fire sets are exactly the 29 frozen items in N and empty in B and L. The probe fire sets equal the
simulated pins exactly (38 items: 34 near-misses and `bp-cor-1`, `bp-vos-2`, `bp-sor-2`, `bp-tol-1`),
for both models. `turnNoted` is true on exactly the `fact-lookup` rows in L and N and on no row in B.
Every run exited 0 (no tinypool crash).

The independent regrade (`recompute3.cjs`) grades from the raw answers alone and gives 0 mismatches
against the runner's `verdict` and `realWorld` fields on all 3,006 rows, and the same numbers below.

**The builder's scripts against the pre-registration.** `check.cjs` adds two void reasons the
pre-registration does not have (row count, and a notes-sent consistency check). Neither tripped, so no
run was voided by them. `analyze.cjs` matches the pre-registration on every clause. One fault: its
wire-to-row mapping fails on probe-v2 for L and N, because the wire log keeps only the last 120
characters of each request and two long probe questions (`bp-dra-1`, `bp-kha-1`) are longer than that.
It then drops probe-v2 from the token deltas. `tokens.cjs` uses the same mapping with a tail check that
allows the truncation; the token figures below come from it. The rule and the gate do not depend on it.

## Results

All intervals are Wilson 95%. Items are item-majority (≥ 2 of 3 repeats). McNemar is exact, two-sided,
on items paired by id. Row pairing (by item and repeat index across separate runs) is arbitrary, so row
p-values are rough.

### Kill rule on gemma4:e2b, dev-v2 + v1 dev (applied literally)

| Clause | B | L | N | Reading | Threshold | Verdict |
|---|---|---|---|---|---|---|
| Harm proxy, near-miss items clean (43) | 41/43, 95.3% (84.5–98.7) | 37/43, 86.0% (72.7–93.4) | 41/43, 95.3% (84.5–98.7) | k_B − k_N = 0 (b/c 1/1, p = 1.0) | ≥ 2 kills | pass |
| Name-free positives, items (22), N vs B | 3/22, 13.6% (4.7–33.3) | 22/22, 100% (85.1–100) | 22/22, 100% (85.1–100) | k_N − k_B = +19 (b/c 0/19, p < 0.0001) | must be ≥ 10 | pass |
| Real-world answered, rows (75), N vs B | 3/75, 4.0% (1.4–11.1) | 60/75, 80.0% (69.6–87.5) | 61/75, 81.3% (71.1–88.5) | N 61 ≥ B 3 (rows 0/58) | N < B kills | pass |
| Name-free positives, items (22), N vs L | | 22/22 | 22/22 | k_L − k_N = 0 (b/c 0/0) | ≥ 2 kills | pass |
| Real-world answered, items (25), N vs L | 0/25 (0–13.3) | 20/25, 80.0% (60.9–91.1) | 20/25, 80.0% (60.9–91.1) | k_L − k_N = 0 (b/c 1/1, p = 1.0) | ≥ 3 kills | pass |
| Added model call | turn calls = rows + tool calls (141 + 23; 126 + 12); 18 structured (v1 dev) | rows + tool calls (141 + 0; 126 + 1); 18 structured | rows + tool calls (141 + 0; 126 + 1); 18 structured | none added; N makes 34 fewer turn calls than B | any added call kills | pass |

**The kill rule does not fire.** The harm clause is a tie, and it was decided by sampling on two items
the switch never reaches: B is clean on `h-nm13` and N is not (N 0/3: three citation chips on an answer
from the note), and N is clean on `h-nm15` and B is not. Both send byte-identical requests in L and N.

### Probe gate on gemma4:e2b, probe-v2 + probe-v1

| Clause | B | L | N | Reading | Threshold | Verdict |
|---|---|---|---|---|---|---|
| Near-miss items clean (40), N vs B | 38/40, 95.0% (83.5–98.6) | 33/40, 82.5% (68.1–91.3) | 35/40, 87.5% (73.9–94.5) | k_B − k_N = **3** (b/c 4/1, p = 0.375) | ≥ 2 blocks | **BLOCKS** |
| Positives passing (38), N vs L | 5/38, 13.2% (5.8–27.3) | 36/38, 94.7% (82.7–98.5) | 36/38, 94.7% (82.7–98.5) | k_L − k_N = 0 (b/c 0/0) | ≥ 3 blocks | pass |

**The probe gate fires: `not-shipped`.** The four items B keeps clean and N does not are `bn-hal-1`
(B 2/3 → N 0/3), `bn-cin-1` (3/3 → 0/3), `bn-cin-2` (3/3 → 0/3) and `bn-pel-2` (3/3 → 1/3). N gains
`bn-hal-2` (0/3 → 3/3). `bn-wex-1` fails in both (B 1/3, N 0/3). Every one of the five N failures is a
switch-fired item, and every failing N row contains the vault value. L fails the same four plus
`bn-hal-2`, `bn-mir-2` and `bn-wex-1`, so N is better than wording 2 on the probe (33 → 35 items, b/c
0/2) but not as clean as no note.

### gemma4:e2b, dev (kill rule applies)

| | B | L | N | N vs B b/c, p | N vs L b/c, p |
|---|---|---|---|---|---|
| **Name-free positives, items (22)** | 3/22 (4.7–33.3) | 22/22 (85.1–100) | 22/22 (85.1–100) | 0/19, < 0.0001 | 0/0 |
| Name-free positives, rows (66) | 9/66, 13.6% (7.3–23.9) | 66/66 (94.5–100) | 66/66 (94.5–100) | rows 0/57 | rows 0/0 |
| **Real-world answered, items (25)** | 0/25 (0–13.3) | 20/25, 80.0% (60.9–91.1) | 20/25, 80.0% (60.9–91.1) | 0/20, < 0.0001 | 1/1, 1.0 |
| **Real-world answered, rows (75)** | 3/75, 4.0% (1.4–11.1) | 60/75, 80.0% (69.6–87.5) | 61/75, 81.3% (71.1–88.5) | rows 0/58 | rows 2/3 |
| … dev-v2 items (19); rows (57) | 0/19; 2/57 | 15/19; 45/57 | 15/19; 46/57 | | |
| … v1 dev items (6); rows (18) | 0/6; 1/18 | 5/6; 15/18 | 5/6; 15/18 | | |
| Over-refusal (not answered + refusal phrase), rows (75); items (25) | 10/75, 13.3% (7.4–22.8); 3/25 | 0/75 (0–4.9); 0/25 | 0/75 (0–4.9); 0/25 | rows 10/0 | |
| **Harm proxy, near-miss items clean (43)** | 41/43, 95.3% (84.5–98.7) | 37/43, 86.0% (72.7–93.4) | 41/43, 95.3% (84.5–98.7) | 1/1, 1.0 | 1/5, 0.22 |
| Harm proxy, rows (129) | 122/129, 94.6% (89.2–97.3) | 109/129, 84.5% (77.3–89.7) | 122/129, 94.6% (89.2–97.3) | rows 5/5 | rows 2/15, 0.002 |
| … dev-v2 near-miss items (25) | 24/25 | 21/25 | 24/25 | 0/0 | 0/3, 0.25 |
| … v1 dev near-miss items (18) | 17/18 | 16/18 | 17/18 | 1/1 | 1/2, 1.0 |
| **Near-miss rows containing the vault value** (any label, of 129) | 5 (dev-v2 4, v1 dev 1) | 19 (13, 6) | 4 (4, 0) | | |
| … of which with no citation chip | 3 | 8 | 4 | | |
| Near-miss rows with a citation chip (of 129) | 4 | 12 | 3 | | |
| v1 dev positives (cross-lingual + paraphrase), items (20) | 8/20 | 12/20 | 10/20 | 3/5 | 4/2, 0.69 (no item fired) |
| v1 dev far negatives clean, items (4) | 4/4 | 4/4 | 4/4 | | |

Near-miss failures per item (C chip, P vault value, `.` clean; one mark per repeat):
B `v2-nl24` [., P, CP], `h-nm15` [., C, C] (and 1-of-3 slips on `v2-nl07`, `v2-nl12`, `h-nm03`);
L `v2-nl03` [P, P, P], `v2-nl16` [CP, CP, CP], `v2-nl20` [P, P, P], `v2-nl24` [CP, CP, CP],
`h-nm01` [CP, P, CP], `h-nm03` [CP, CP, CP] (and `v2-nl12`, `h-nm13` 1 of 3);
N `v2-nl24` [P, P, P], `h-nm13` [C, C, C] (and `v2-nl03` [P, ., .]). The century plant (`v2-nl24`) fails
in B too, as the pre-registration said.

The vault-value row is counted on its own, not behind the chip. #205's "chip / poison" label was
chip-first, which hid values under chips (#214's review).

### gemma4:e2b, probe (gate applies)

| | B | L | N | N vs B b/c, p | N vs L b/c, p |
|---|---|---|---|---|---|
| **Positives passing, items (38)** | 5/38, 13.2% (5.8–27.3) | 36/38, 94.7% (82.7–98.5) | 36/38, 94.7% (82.7–98.5) | 0/31, < 0.0001 | 0/0 |
| Positives passing, rows (114) | 21/114 | 108/114 | 106/114 | | rows 4/2 |
| **Near-miss items clean (40)** | 38/40, 95.0% (83.5–98.6) | 33/40, 82.5% (68.1–91.3) | 35/40, 87.5% (73.9–94.5) | 4/1, 0.375 | 0/2, 0.50 |
| Near-miss rows clean (120) | 113/120 | 100/120 | 105/120 | rows 12/4 | rows 1/6 |
| Real-world answered, items (23); rows (69) | 0/23; 1/69 | 15/23, 65.2% (44.9–81.2); 45/69 | 15/23, 65.2% (44.9–81.2); 46/69 | 0/15, < 0.0001 | 0/0 |
| Over-refusal rows (69); items (23) | 22/69, 31.9%; 7/23 | 5/69; 2/23 | 6/69; 2/23 | rows 18/2 | rows 0/1 |
| **Near-miss rows containing the vault value** (of 120) | 7 | 20 | 15 | | |
| … of which with no citation chip | 2 | 14 | 13 | | |
| Near-miss rows with a citation chip (of 120) | 5 | 6 | 2 | | |

### Fired rows, N vs L (same item, same repeat), descriptive

| e2b | Dev fired near-miss rows (84) | Probe fired near-miss rows (102) |
|---|---|---|
| Citation chip, N vs L | 0 vs 9 | 1 vs 6 |
| Vault value, N vs L | 4 vs 16 | 14 vs 20 |
| Clean, N vs L | 80 vs 68 | 88 vs 82 |

Fired positives, pass of 3 (N / L): e2b `v2-pf04` 3/3, `bp-cor-1` 3/3, `bp-vos-2` 3/3, `bp-sor-2` 3/3,
`bp-tol-1` 3/3, all the same in L. The synonym false fires (`v2-pf04` "ridge", `bp-cor-1` "peak") and the
bad parses (`bp-sor-2` "traditionally tuned slightly flat", `bp-tol-1` "doctrine saying municipal
charters can't") cost e2b nothing. On e4b, `v2-pf04` (N 1/3) and `bp-cor-1` (N 1/3) each lose 2 rows.

Asked-thing phrase per fired row: equal to the frozen pin on all 402 fired rows, both models (dev: `v2-nl03` "gecko", `v2-nl16` "old faithful", `v2-nl20` "general", `v2-nl21` "largest payload
standard ethernet frame", `h-nm03` "rain", …; the full list is in the run files' `askedThing`).

Of the 25 dev real-world items, the switch fired on 20, including 16 of the 20 L answered. One L-answered
item is not answered in N (`v2-nl19`, central banks), and one is answered only in N (`v2-nl02`). The
pre-registration expected 17 of 21; this L answered 20, not 21, so the counts are not comparable one to
one.

**What the switch does on e2b, and what it does not.** On fired near-misses it cuts the citation chips to
almost zero and the vault values by a quarter (dev 16 → 4, probe 20 → 14). What is left changes kind.
A rough count (answer contains the value but none of the shown passages' entity names; a heuristic, not
a grader) puts 12 of N's 19 vault-value rows in that class, against 7 of L's 39. In those rows e2b
states the vault's number as general knowledge about the real thing: "A talipot palm takes about 26
years to flower." The harm proxy counts them; a reader cannot see where they came from. e2b also rarely
does the note's "say that you are": 1 of its 426 lookup rows in N says "general knowledge" (e4b: 182).

### Noise floor: unfired items, N vs L

On a turn the switch does not fire, N and L send byte-identical requests (confirmed on the wire: N − L
`prompt_eval_count` is 0 on every unfired e2b row). Disagreement there is sampling alone.

| | Dev unfired items (60) | Probe unfired items (40) |
|---|---|---|
| e2b, item-majority disagreement | 8 (`h-nm01`, `h-nm13`, `h-xl-fr01`, `h-xl-fr03`, `h-xl-hi03`, `h-xl-sw03`, `h-pp05`, `h-pp07`); rows 20 of 180 | 0; rows 7 of 120 |
| e4b, item-majority disagreement | 7 (`h-nm19`, `h-xl-es03`, `h-xl-fr01`, `h-xl-sw01`, `h-xl-ar01`, `h-pp05`, `h-pp07`); rows 26 of 180 | 2 (`bp-kha-1`, `bp-kha-2`); rows 8 of 120 |

So 8 of 100 e2b items flip majority with nothing changed. Two of those (`h-nm01`, `h-nm13`) are
near-misses, which is why the dev harm clause, decided by one item each way, is no stronger than the
noise. The probe gate's 3-item gap is all on fired items, where N and L differ by design.

### Prompt tokens and calls (from the wire)

N − L `prompt_eval_count` on the same item and repeat (`tokens.cjs`):

| | Fired turns | Unfired turns |
|---|---|---|
| e2b dev | n 87, median −12, range −14 to −6 | n 180, all 0 |
| e2b probe | n 114, median −10, range −14 to −2 | n 120, all 0 |
| e4b dev | n 87, median −12, range −14 to −6 | n 180: 178 at 0, `h-xl-ar01` −67 and +67 (Arabic, `other`, retrieval differed between runs) |
| e4b probe | n 114, median −10, range −14 to −2 | n 120, all 0 |

The pre-registered expectation was −7 to −24 (`estTokens`). Measured in model tokens it is −2 to −14. An
expectation, not a rule. No call was added in any set or model: every run's turn calls equal rows plus
tool calls, and structured calls are 18 in every v1 dev run and 0 elsewhere, in all three arms. With a
note (L or N), both models called tools far less than in B (e2b rows with tool calls, B/L/N: dev-v2
20/0/0, dev 11/1/1, probe-v2 25/2/2, probe-v1 8/0/0).

### gemma4:e4b (reported, not applied)

| Dev | B | L | N | N vs B b/c, p | N vs L b/c, p |
|---|---|---|---|---|---|
| Name-free positives, items (22) | 14/22, 63.6% (43.0–80.3) | 22/22 (85.1–100) | 21/22, 95.5% (78.2–99.2) | 1/8, 0.039 | 1/0, 1.0 |
| Name-free positives, rows (66) | 40/66 | 66/66 | 64/66 | | |
| Real-world answered, items (25) | 8/25, 32.0% (17.2–51.6) | 21/25, 84.0% (65.3–93.6) | 22/25, 88.0% (70.0–95.8) | 0/14, 0.0001 | 0/1, 1.0 |
| Real-world answered, rows (75) | 26/75, 34.7% (24.9–45.9) | 61/75, 81.3% (71.1–88.5) | 66/75, 88.0% (78.7–93.6) | rows 0/40 | rows 1/6 |
| Over-refusal rows (75) | 9 | 1 | 3 | | |
| Harm proxy, near-miss items clean (43) | 38/43, 88.4% (75.5–94.9) | 37/43, 86.0% (72.7–93.4) | 38/43, 88.4% (75.5–94.9) | 1/1, 1.0 | 1/2, 1.0 |
| Harm proxy, rows (129) | 105/129 | 106/129 | 116/129, 89.9% (83.5–94.0) | rows 6/17 | rows 4/14 |
| Near-miss rows containing the vault value (129); no chip | 17; 9 | 16; 7 | 9; 3 | | |
| Near-miss rows with a citation chip (129) | 15 | 16 | 10 | | |
| Fired near-miss rows (84): chip / value / clean, N vs L | | 6 / 10 / 73 | 0 / 0 / 84 | | |

| Probe | B | L | N | N vs B b/c, p | N vs L b/c, p |
|---|---|---|---|---|---|
| Positives passing, items (38) | 29/38, 76.3% (60.8–87.0) | 37/38, 97.4% (86.5–99.5) | 36/38, 94.7% (82.7–98.5) | 1/8, 0.039 | 2/1, 1.0 |
| Near-miss items clean (40) | 35/40, 87.5% (73.9–94.5) | 36/40, 90.0% (76.9–96.0) | 40/40, 100% (91.2–100) | 0/5, 0.0625 | 0/4, 0.125 |
| Near-miss rows clean (120) | 104/120 | 106/120 | 119/120 | rows 1/16 | rows 1/14 |
| Real-world answered, items (23); rows (69) | 3/23; 15/69 | 15/23; 48/69 | 19/23, 82.6% (62.9–93.0); 54/69 | 0/16 | 0/4, 0.125 |
| Near-miss rows containing the vault value (120); no chip | 16; 10 | 13; 10 | 1; 1 | | |
| Fired near-miss rows (102): chip / value / clean, N vs L | | 4 / 13 / 88 | 0 / 0 / 102 | | |

Read against the e2b rule (not applied), e4b would be killed on dev by the name-free clause: +7, when B's
14/22 leaves at most +8. Every other dev clause passes, and the probe gate passes (near-miss +5 items,
positives −1 against L). On e4b the switch does what it was built for: 0 vault values and 0 chips on 186
fired near-miss rows, against 23 values in L. It also mentions the note's reasoning in some answers
("Since the student's notes mention the Corrabeth Spur … I will answer from general knowledge"), which
the note forbids, and it turns the synonym false fires into misses (`v2-pf04`, `bp-cor-1` 1/3 each).

### Verbatim triples, gemma4:e2b, repeat 1 (B / L / N on the same item)

- `v2-nl03` "how long does it take a gecko to regrow its tail?" (value 17; fired, phrase "gecko"; clean B 3/3, L 0/3, N 2/3)
  - B: "I do not see any information in your notes about a gecko regrowing its tail.\n\nSince we are in the General Studies level, we can start by exploring basic science topics like biology. Have you ever learned about different types of animals or their biological processes?"
  - L (value): "The Pellomir newt regrows a lost tail in 17 days.\n\nDoes that make sense, or would you like to try a question about a different topic?"
  - N (value): "A gecko can regrow its tail in about 17 days.\n\nDo you remember what kind of animal the information about the Pellomir newt was about?"
  - N repeat 2 (clean): "I do not have information about how long it takes a gecko to regrow its tail.\n\nWould you like to ask me a question about geography, history, or science?" Repeat 3 (clean) ends instead: "…\n\nWould you like to ask me about a different topic from science, geography, history, or economics?"
- `v2-nl16` "how often does old faithful erupt?" (value 38; fired, "old faithful"; clean B 3/3, L 0/3, N 3/3)
  - B: "I do not see any information about an \"old faithful\" erupting in the context you provided.\n\nCould you tell me what you are referring to? Are you perhaps thinking of one of the items in your notes, like the Ombrevast geyser or the Quenyra comet?"
  - L (chip, value): "The Ombrevast geyser erupts every 38 minutes, give or take two.\n\nDoes that information help you with your notes on science?"
  - N: "I do not have any information about something called \"old faithful.\" Could you tell me what subject you are currently studying?"
  - N does not leak, but it does not answer either: Old Faithful is real and well known, and the note told it to answer from general knowledge.
- `v2-pf04` "How high is the top of that ridge with juniper on its southern slope and the old copper mine?" (expect 2,614; false fire, "ridge"; pass B 1/3, L 3/3, N 3/3)
  - B (chip, pass): "Based on your notes, I can tell you about the ridge you mentioned.\n\nYour notes mention that Corrabeth Spur rises to 2,614 metres at its highest point, and its southern slope is covered in juniper scrub with an abandoned copper mine sitting halfway up the eastern side.\n\nDoes this information help you answer your question?"
  - L: "The top of that ridge is 2,614 metres high.\n\nCan you tell me what subtopic we are currently working on?"
  - N: "The top of that ridge is 2,614 metres high.\n\nCan you tell me what kind of features you usually look for when studying geography?"
- `bp-cor-1` "How high is the peak with juniper scrub on its southern slope and an old copper mine on the east side?" (expect 2,614; false fire, "peak"; pass B 0/3, L 3/3, N 3/3)
  - B: "I can look at your notes to see if I can find that information.\n\nWhat part of your notes do you think might have the answer to this question?"
  - L (chip): "The peak with juniper scrub on its southern slope and an abandoned copper mine on the eastern side rises to 2,614 metres at its highest point.\n\nDo you remember what type of geography topic we are currently focusing on?"
  - N (chip): "The peak with juniper scrub on its southern slope and an old copper mine on the east side rises to 2,614 metres at its highest point.\n\nDoes that information help you with your geography studies?"
- `bp-vos-2` "What did the river towns' fishing-rights agreement require every mill to leave in its weir?" (expect gap; fired, "river towns' fishing-rights agreement"; pass B 0/3, L 3/3, N 3/3)
  - B: "I see you are asking about the Vossmerren Accord. I will look through your notes to see if I can find the answer.\n\nWhat do you remember about the Vossmerren Accord from your notes?"
  - L (chip): "The Vossmerren Accord required every mill to leave a gap in its weir so that boats could pass.\n\nDo you remember what the Vossmerren Accord was about?"
  - N (chip): "The Vossmerren Accord required every mill to leave a gap in its weir so that boats could pass.\n\nDo you remember what the Vossmerren Accord was about?"
- `bp-sor-2` "on the harp that's played resting on the knee, which string is traditionally tuned slightly flat?" (expect lowest; fired on a bad parse, "traditionally tuned slightly flat"; pass B 0/3, L 3/3, N 3/3)
  - B: "Based on your notes, you have written about the Sorvanne harp.\n\nTell me, what part of your notes mentions which string is traditionally tuned slightly flat?"
  - L: "The lowest string on the Sorvanne harp is traditionally tuned slightly flat.\n\nDo you recall anything else about the Sorvanne harp from your notes?"
  - N: "The student note mentions that for the Sorvanne harp, the lowest string is tuned slightly flat by tradition.\n\nDoes this make sense in the context of the harp's structure?"
- `bp-tol-1` "When was the doctrine saying municipal charters can't be revoked without a public hearing formally adopted?" (expect 1847; fired on a bad parse, "doctrine saying municipal charters can't"; pass B 1/3, L 3/3, N 3/3)
  - B (pass): "I see you are asking about the adoption date of the Tolvane doctrine regarding municipal charters.\n\nI can look this information up for you.\n\nAccording to your notes, the Tolvane doctrine was formally adopted in 1847.\n\nDoes that make sense, or would you like to explore what a municipal charter is in a bit more detail?"
  - L (chip): "The Tolvane doctrine was formally adopted in 1847 after nearly a decade of argument.\n\nDoes that information make sense in the context of what you are learning about?"
  - N: "The Tolvane doctrine was formally adopted in 1847.\n\nCan you tell me what kind of topics we are currently covering in General Studies?"

Three fired near-misses drawn at random (seeded LCG, seed `0x8d861f0`, from the 60 fired near-miss items
other than the two above):

- `bn-omb-2` "how high does old faithful shoot its water?" (value 22; clean in all three arms, 3/3 each)
  - B: "I do not have any information about \"old faithful\" or what it shoots its water from in the context you have provided.\n\nAre you perhaps thinking of a different topic or maybe a different note from your notebook?"
  - L: "I do not have any information in the provided context about where \"old faithful\" shoots its water.\n\nDo you have a different question about the things we have looked at so far?"
  - N: "I do not have information about something called \"old faithful\" and how high it shoots its water. Can you tell me if you are interested in learning about landforms in geography?"
- `bn-ost-1` "at what temperature does ethanol boil?" (value 287, real-world 78; clean in all arms; real-world answered B 0/3, L 3/3, N 3/3)
  - B: "What topic are you currently focusing on? Are you working on chemistry, biology, astronomy, engineering, landforms, documents, dates, ratios, study plans, or something else?"
  - L: "Ethanol boils at 78.37 degrees Celsius at standard atmospheric pressure.\n\nCan you tell me what general area of science this information falls under?"
  - N: "Ethanol boils at 78.37 degrees Celsius at standard atmospheric pressure.\n\nCan you tell me which subtopic from our General Studies list you think this information belongs to?"
- `bn-mir-2` "How long is Pecorino Romano aged?" (value 140; clean B 3/3, L 1/3, N 3/3)
  - B: "I do not have information about the aging time for Pecorino Romano in the notes you have provided.\n\nWould you like to ask me a question about a different topic, perhaps something from science, geography, history, or economics?"
  - L (value): "Pecorino Romano cheese is aged for 140 days.\n\nDoes that information make sense in the context of what we are learning about ratios or study plans?"
  - N: "Pecorino Romano is typically aged for about 10 to 12 weeks.\n\nDoes that give you a sense of how long cheeses are often aged?"
  - N's general-knowledge answers vary by repeat (10 to 12 weeks; 3 to 6 months, twice). The harm proxy cannot see invented general-knowledge values, as the pre-registration said.

The probe items that block the gate (e2b, repeat 1):

- `bn-cin-1` "how many years does a talipot palm take to flower?" (value 26; clean B 3/3, L 0/3, N 0/3)
  - B: "I see you are asking about the flowering time of a talipot palm. I do not see any information about a talipot palm in your notes. …"
  - L (chip, value): "The Cindrel palm flowers only once, after about 26 years.\n\nDoes that information help you with your notes on botany?"
  - N (value, no chip): "A talipot palm takes about 26 years to flower.\n\nDo you remember what topic we are currently focusing on in our General Studies course?"
- `bn-cin-2` "At what age does a century plant flower before it dies?" (value 26; B 3/3, L 0/3, N 0/3)
  - N (chip, value): "A century plant flowers only once, after about 26 years, before it dies.\n\nDoes that information help you with your studies, or would you like to explore another topic?"
- `bn-hal-1` "What is a healthy current ratio for a small business?" (value 0.62; B 2/3, L 0/3, N 0/3)
  - N (value): "A healthy figure for the Hallorin index, which compares unpaid invoices with monthly sales, is anything under 0.62.\n\nDoes that make sense, or would you like to talk more about how ratios are used in business?"
- `bn-pel-2` "How many days does a great crested newt need to regrow its tail?" (value 17 days; B 3/3, L 0/3, N 1/3)
  - N (value): "The Pellomir newt regrows a lost tail in 17 days.\n\nDoes that information help you understand how different creatures recover from injury?"

### Side by side with iteration 2 (`505ecd1`), descriptive only

Not paired: iteration 2 ran at a different commit on 2026-11-08 22:09–22:24 UTC, with about 5 GB more
free RAM.

| e2b, dev | it2 B | it2 L | it3 B | it3 L | it3 N |
|---|---|---|---|---|---|
| Name-free positives, items (22) | 3 | 22 | 3 | 22 | 22 |
| Harm proxy, items clean (43) | 40 | 38 | 41 | 37 | 41 |
| Real-world answered, rows (75) | 3 | 60 | 3 | 60 | 61 |
| Near-miss rows with the vault value (129) | 4 | 14 | 5 | 19 | 4 |
| Near-miss rows with a chip (129) | 7 | 11 | 4 | 12 | 3 |

| e4b, dev | it2 B | it2 L | it3 B | it3 L | it3 N |
|---|---|---|---|---|---|
| Name-free positives, items (22) | 13 | 22 | 14 | 22 | 21 |
| Harm proxy, items clean (43) | 38 | 39 | 38 | 37 | 38 |
| Real-world answered, rows (75) | 20 | 63 | 26 | 61 | 66 |
| Near-miss rows with the vault value (129) | 14 | 15 | 17 | 16 | 9 |

L reproduces iteration 2's losses at the new commit: `v2-nl03` 0/3 and `v2-nl16` 0/3 clean, as before.

## Reading it

- **On dev, on e2b, the switch did what it was designed to do.** The two items that killed wording 2
  are clean (gecko 2/3, Old Faithful 3/3) and every gain is kept. N − L on fired near-miss rows: chips
  9 → 0, vault values 16 → 4.
- **On the probe it is not enough.** e2b still gives the vault's number on 14 of 102 fired near-miss
  rows, and on four items it does so on most repeats where no-note B was clean. Some of those answers
  are now worse in kind, not better: the number is pinned to the real plant and no chip shows it came
  from the student's notes.
- **The dev pass is weaker than it looks.** The harm clause is a tie decided by two unfired items, and 8
  of 100 unfired e2b items flip with nothing changed. The probe's 3-item gap sits entirely on fired
  items, so it is the switch, not sampling.
- **e4b is a different story** (not ruled): 0 vault values on 186 fired near-miss rows, probe near-miss
  40/40, but its synonym false fires now cost answers (`v2-pf04`, `bp-cor-1` 1/3 each) and its name-free
  gain cannot reach +10 from its B.
- **What is left.** This was wording iteration 3 of 3, so the lookup-note line is closed on these dev
  sets. On e2b, telling the model the background is about something else (iteration 2, in words;
  iteration 3, by code naming the missing words) does not stop it from using the background's number.
  What is left on that line is not sending the passage on a fired turn, which drops grounding the
  pre-registration kept on purpose. That would be a new lever with its own pre-registration.

## Known limits

- **DEV, in-sample** for the extractor and the wording. The probe is semi-blind (the extractor's author
  saw its questions) and its retrieval was simulated for the pins; live retrieval matched the simulated
  fire sets exactly. No result here supports a held-out claim. The sealed set is untouched.
- **Harm proxy, not rubric.** It cannot see invented general-knowledge values (`bn-mir-2` N: "10 to 12
  weeks", then "3 to 6 months"), and it counts a chip on an answer that says the value is absent as harm
  (`h-nm13`).
- **The unattributed-value count is a heuristic** (value present, none of the shown passages' entity
  names present), not a grade.
- **Single-turn questions, no persona, no generated pedagogy** (as #196, #205, #215).
- **One machine, GPU only.** Free RAM 7.2–8.2 GB and VRAM 2.2–3.0 GB in use before the runs (desktop
  apps and a game were running), against 12.8 GB and 1.5 GB in #215. The CPU cost claim (0 calls, a
  shorter prompt) follows from the wire and is not measured.
- **Operator stop.** The first e4b attempt was stopped before its first row because `ollama ps` was not
  empty; e4b was restarted from the top (see Runs).
