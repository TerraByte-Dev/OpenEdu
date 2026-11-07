# Held-out v2: sealed test set, committed before any harness change

This file is committed **before** any lever from [`docs/BENCHMARKS.md`](../../../docs/BENCHMARKS.md)
is built or merged. It fixes the identity of the test set and the rules for running it. Nothing below
changes after a run. If something here turns out to be wrong, the run is reported under this protocol
anyway, and a new protocol is written for any later run.

## The set

| | |
|---|---|
| File | `heldout-v2.json`, kept **outside the repository** by the custodian |
| Size | 97,781 bytes, UTF-8 |
| SHA-256 | `47b288964b23735e24a4dc79af13b1874a969b8ab2d63e0ea4b5b39c97931291` |
| Written | 2026-11-07, by an agent with no role in tuning, which returned only the hash, the counts and the schema |
| Contents | RAG: 16 notes in a new fictional vault sharing no names with `RAG_FIXTURE`; 78 items (30 near-miss, 8 far, 24 cross-lingual with 4 each in es, fr, sw, pt, hi, ar, 16 paraphrase). k12: 120 multiple-choice items (math 40, science 30, ELA 25, social studies 25), K-5 / 6-8 / 9-12 |
| Opened by | nobody, as of this commit. The people and agents tuning the harness never open it |

Anyone can check the set wasn't changed after this commit: hash the file at run time and compare.

## Rules

1. **The run script is the only reader.** It refuses to start if the file's SHA-256 differs from the
   one above.
2. **Name lint before any model call.** The run script extracts the set's made-up names and
   distinctive tokens and searches `src/` (excluding `src/lib/eval/`). Any match voids the run.
3. **Tuning happens on dev only.** That means the v1 dev split, the v1 test split (spent on
   2026-11-06 and now dev), the 240 k12-mc items (all read, so all dev) and any new dev vault. No
   lever may contain an item id, a fictional entity or a fact taken from any eval item.
4. **One frozen commit per run.** The run happens at a tag (`eval-test-<date>`), with `git diff`
   against master = 0 in `src/`. The commit SHA goes in the results file.
5. **Models.** Primary: `gemma4:e2b`. Also run: `gemma4:e4b`, `qwen3.5:2b`, `qwen3.5:4b`, `phi4-mini`.
6. **Scoring** follows `docs/BENCHMARKS.md` B1 (near-miss and far negatives, two blind graders on every
   rubric row, the second from a different model family or a human), B2 (cross-lingual and paraphrase
   positives, deterministic `expect`) and B3/B4 (the k12 items run as the attempt-first flow:
   question, scripted wrong attempt, "Show me the full worked answer.").
7. **Every run is reported**, including voided runs, crashes and runs that miss their bar. A rerun is
   allowed only under a void rule written here before the run: the integrity guard finds an empty
   corpus, or Ollama fails to load a model. Both runs are then reported.
8. **A set burns when it is read.** After the first run, this set's failure rows will be read for
   diagnosis, which moves it to dev. The next claim needs a new sealed set and a new protocol.

The bars for each benchmark are in `docs/BENCHMARKS.md` §1 and are fixed by this commit.
