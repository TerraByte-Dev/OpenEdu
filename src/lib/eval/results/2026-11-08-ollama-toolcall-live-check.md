# Ollama tool-call 500 recovery, live before/after check, `qwen3.5:4b` — 2026-11-08

> **DEV, not a test result.** Sets: dev vault v2 (`rag-dev-v2.ts`) and RAG held-out v1 `dev`, retrieval
> `always`, syllabus `matched`, 1 repeat. The sealed set was not touched.

Issue #198, PR #199 (merged to master 2026-11-08 14:25 UTC). This is the live check pre-registered in
PR #199's body (written 13:41 UTC at `d979ec3`, before any model run of the code), run exactly as
written there. Nothing in the pre-registration was changed.

**Result: not exercised live.** Neither arm produced a single tool-call parse failure: 0 in the wire
logs and 0 in Ollama's `server.log` across all 4 runs (178 turns, 238 `/api/chat` requests). Per the
pre-registration, 0 events is recorded as "not exercised live". **It is not a pass of H1**, and the run
was not repeated to hunt for an event (that would need its own pre-registration). The mechanism's
evidence stays the 8 fake-Ollama tests in `src/lib/eval/headless/toolcall-error-path.test.ts`. What this
run does show: on the real path, the PR added no ERROR rows, no aborts and no non-200 responses, and the
B1 counts moved within sampling noise (paired McNemar p = 0.73 and 1.0).

## Arms

| Arm | Commit | `srcDirty` | Worktree |
|---|---|---|---|
| *before* | `cce3051` (master at the time, the PR's merge base) | false | `C:/x/oe-199b`, `npm ci` |
| *after* | `d979ec3` (the PR's head when the pre-registration was written) | false | `C:/x/oe-199a`, `npm ci` |

The PR's final head `cbe384e` differs from `d979ec3` only in `docs/ARCHITECTURE.md` (one line), so
`src/` is identical to the merged code. Both files record `srcDiffersFromMaster: true`, because master
has moved on (#196, #197 and others merged since); neither arm contains #196, so both send the runner's
default `standin` prompt, as the pre-registration requires. Ollama 0.40.15; `qwen3.5:4b` digest
`d8b0f5e9…8c04`, `nomic-embed-text:latest` digest `0a109f42…e59f`, the same in all 4 files. GPU
(8 GB). Before the first run: 15.72 GB RAM free, 1043 MiB VRAM in use, `ollama ps` empty (a different
eval had just finished; this run waited for the GPU and Ollama to be idle for 2 minutes first).

Commands (verbatim from the PR, `EVAL_OUT` into `C:/x/oe-199-runs/`):
```
EVAL_MODEL=qwen3.5:4b EVAL_SET=dev-v2 EVAL_MODES=always EVAL_SYLLABUS=matched EVAL_REPEATS=1 EVAL_WIRE=1 EVAL_OUT=<dir>/<arm>-dev-v2.json npm run eval
EVAL_MODEL=qwen3.5:4b EVAL_SET=dev    EVAL_MODES=always EVAL_SYLLABUS=matched EVAL_REPEATS=1 EVAL_WIRE=1 EVAL_OUT=<dir>/<arm>-dev.json    npm run eval
```

| Run (in order) | Start (UTC) | End (UTC) | Exit |
|---|---|---|---|
| before dev-v2 | 17:10:57.8 | 17:12:11.1 | 0 |
| before dev | 17:12:12.1 | 17:13:20.4 | 0 |
| after dev-v2 | 17:13:21.5 | 17:14:32.0 | 0 |
| after dev | 17:14:33.0 | 17:15:46.5 | 0 |

## Counted (as pre-registered)

| | before dev-v2 | before dev | after dev-v2 | after dev |
|---|---|---|---|---|
| Turns (rows) | 47 | 42 | 47 | 42 |
| `/api/chat` calls, wire log | 66 | 55 | 62 | 55 |
| `/api/chat` requests, `server.log` GIN lines in the window | 66 | 55 | 62 | 55 |
| **Tool-call 500s, wire log** (`status: 500`) | **0** | **0** | **0** | **0** |
| **Tool-call 500s, `server.log`** (`tool call parsing failed` + next GIN `\| 500 \|`) | **0** | **0** | **0** | **0** |
| Any `tool call parsing failed` line, any model, in the window | 0 | 0 | 0 | 0 |
| Any non-200 `/api/chat` (wire) | 0 | 0 | 0 | 0 |
| **Recovered turns** (`toolCallRecovery !== null`) | n/a (field absent) | n/a | **0** | **0** |
| **ERROR rows** | **0** | **0** | **0** | **0** |
| **Run aborts** | none | none | none | none |
| `turnFailures.always` | n/a | n/a | 0 errors, 0 recovered | 0 errors, 0 recovered |

The wire and server-log request counts agree on every run, which checks that each time window caught
exactly that run's traffic.

Rates with Wilson 95% (n = turns; 1 repeat, so item-majority is the single row):
- Tool-call 500s: *before* 0/89, 0.0% (0.0–4.1%); *after* 0/89, 0.0% (0.0–4.1%).
- ERROR rows: *before* 0/89 (0.0–4.1%); *after* 0/89 (0.0–4.1%). Per set: dev-v2 0/47 (0.0–7.6%),
  dev 0/42 (0.0–8.4%), both arms.
- Share recovered: undefined (no event; 0 of 0).

#196 saw about 3 such 500s in roughly 800 qwen turns (~0.4%). At that rate, 89 turns per arm expect
~0.33 events, and P(0 events) ≈ 0.72 per arm (Poisson), so this outcome is the one the pre-registration called
most likely.

## Decision rule (verbatim) and how each clause stands

> "The PR passes the live check if, on *after*: (1) no run aborts with a vault-guard message while
> `noteCandidates > 0`; (2) the number of tool-call 500s equals recovered turns plus ERROR rows that carry
> a parser message; (3) the retry is one call: in the wire log, each tool-call 500 is followed by exactly
> one more `/api/chat` call with the same `ask` before the next question's calls begin."

| Clause | *after* | Reading |
|---|---|---|
| (1) no vault-guard abort | no abort, either set | holds, but it was never challenged: no turn failed |
| (2) 500s = recovered + parser ERROR rows | 0 = 0 + 0 | vacuous |
| (3) one retry call per 500 | no 500 to follow | vacuous |

**Recorded as "not exercised live". Not a pass of H1.** The *before* arm did not show its expected
failure mode (a tool-call 500 aborting with "NO note candidates") for the same reason.

## B1 numbers printed next to the counts (descriptive; no bar applies to this check)

Wilson 95%; n = items; 1 repeat. Paired exact McNemar on per-item pass, *before* vs *after*.

| | before | after |
|---|---|---|
| dev-v2 positives passing | 22/22, 100% (85.1–100) | 22/22, 100% (85.1–100) |
| dev-v2 negatives passing | 14/25, 56.0% (37.1–73.3) | 12/25, 48.0% (30.0–66.5) |
| dev-v2 real-world answered | 17/19, 89.5% (68.6–97.1) | 18/19, 94.7% (75.4–99.1) |
| dev-v2 all items passing | 36/47, 76.6% (62.8–86.4) | 34/47, 72.3% (58.2–83.1) |
| dev positives passing | 19/20, 95.0% (76.4–99.1) | 19/20, 95.0% (76.4–99.1) |
| dev negatives passing | 13/22, 59.1% (38.7–76.7) | 13/22, 59.1% (38.7–76.7) |
| dev real-world answered | 6/6, 100% (61.0–100) | 5/6, 83.3% (43.6–97.0) |
| dev all items passing | 32/42, 76.2% (61.5–86.5) | 32/42, 76.2% (61.5–86.5) |
| Note retrieved (gold/near) | dev-v2 47/47; dev 38/42 | dev-v2 47/47; dev 38/42 |

| Paired, per-item pass | n | both pass | before only | after only | neither | McNemar p |
|---|---|---|---|---|---|---|
| dev-v2 | 47 | 31 | 5 | 3 | 8 | 0.73 |
| dev | 42 | 26 | 6 | 6 | 4 | 1.00 |

No turn in either arm reached the recovery code, so every row in *after* went through the same request
path as in *before*; the discordant rows are sampling (temperature > 0, 1 repeat), not the PR. Wire calls
per turn differ (dev-v2 66 vs 62), which is the model choosing to call a tool on different turns.

## Limits

- **0 events: the live check did not test the recovery.** The PR's evidence for the mechanism is the
  fake-Ollama path tests, not this run.
- The parse failure that arrives as an error line inside a 200 stream is invisible to the wire log's
  `status`; the `server.log` count covers it (0 `tool call parsing failed` lines of any kind).
- 1 repeat, dev sets only; B1 numbers here are descriptive, not a benchmark result.
- *before* runs that abort write no results file; none aborted, so all 4 files exist.

## Files

Results JSON (not committed, local): `C:/x/oe-199-runs/{before,after}-{dev-v2,dev}.json`, console logs
`*.log`, the pre-run RAM/VRAM/`ollama ps` snapshots `pre-*.txt`, the run windows `windows.txt`, and the
counting script `analyze.cjs` with its output `analysis.json`.
