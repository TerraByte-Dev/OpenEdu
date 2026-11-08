# B7 CPU latency: `qwen3.5:0.8b`, `gemma4:e2b`, `qwen3.5:4b` on a Ryzen 7 5800H, CPU only — 2026-11-08

> **DEV, descriptive timing.** No quality is scored. The scenarios are dev items only (k12 math K-5,
> `h-pp01`, `h-xl-hi01`). The sealed set was not touched.

Issue #200, harness PR #201 (merged 2026-11-08T14:24:48Z). Pre-registered in the PR body at
2026-11-08T13:46:37Z, before any B7 run, at commit `90bb9d1`. Every run: commit `90bb9d1`
(`90bb9d10298cad95ab0a5e5663fd079414aff6a3`), `srcDirty: false`, `abort: null`. Run by Claude.

**Answer to the primary question (warm p50 wall time ≤ 15 s for every turn kind?):**

| Model | Every kind ≤ 15 s at p50? | Slowest kind (p50 wall) | Its slowest step |
|---|---|---|---|
| `qwen3.5:0.8b` | **No** (4 of 5 kinds under) | `notes-hi-gloss` 17.9 s | generate |
| `gemma4:e2b` | **Yes** (5 of 5) | `k12-t3-show-answer` 12.5 s | generate |
| `qwen3.5:4b` | **No** (0 of 5 kinds under) | `notes-hi-gloss` 35.3 s | generate |

On this 16-thread laptop, e2b is the only one of the three that keeps a learner under 15 s at p50 on
every turn kind. qwen3.5:4b generates at 11.4 tok/s, a third of the other two, and misses on all five.
qwen3.5:0.8b misses only on the Hindi notes turn, where its gloss call times out every time (3 s lost)
and it writes long replies.

## Setup (as pre-registered)

| | |
|---|---|
| Machine | AMD Ryzen 7 5800H with Radeon Graphics, 8 physical cores / 16 logical CPUs, 31.9 GB RAM, Windows 10.0.26200, Node 24.19.0, power `ac` in every run file (Win32_Battery status 2 before and after every run) |
| Server | second `ollama serve` at `127.0.0.1:11435`, `CUDA_VISIBLE_DEVICES=-1`, `HIP_VISIBLE_DEVICES=-1`, `OLLAMA_LLM_LIBRARY=cpu`, `OLLAMA_NUM_PARALLEL=1`, keep-alive default (5m), stderr to a log file. Same binary as the usual server (Ollama 0.40.15). Log: `inference compute id=cpu library=cpu`, total_vram 0 B |
| Threads | Ollama default (not set). The runner's log line reads `n_threads = 8 (n_threads_batch = 8) / 16`. The results files record `server.threads: null`: the harness's pattern (`--threads N` / `threads=N`) does not match this Ollama version's log line |
| CPU-only check | 17:20:46Z: `ollama run qwen3.5:0.8b "Say ok"` via `:11435` → `ollama ps` PROCESSOR `100% CPU`, `/api/ps` `size_vram: 0`; NVIDIA VRAM unchanged at 1043 MiB; model stopped before the first run |
| Usual server | `127.0.0.1:11434` had no model loaded before, during (harness check) and after every run; it was not touched |
| Models | `qwen3.5:0.8b` (`f3817196d142`), `gemma4:e2b` (`b37049369adf`), `qwen3.5:4b` (`d8b0f5e9760c`), in that order; embedder `nomic-embed-text` (`0a109f422b47`); context cap 8192 (app default) |
| Per model | 1 cold + 5 warm repeats per scenario (`EVAL_REPEATS` default 5), 30 measured turns |
| CPU busy before run (harness, 3 s) | 3.4% / 3.8% / 6.3% |

| Run | Started (UTC) | Finished (UTC) | Free RAM before | VRAM before | Void? |
|---|---|---|---|---|---|
| `qwen3.5:0.8b` | 17:21:14 | 17:26:35 | 16.0 GB | 1043 MiB | no |
| `gemma4:e2b` | 17:26:54 | 17:30:22 | 16.0 GB | 1043 MiB | no |
| `qwen3.5:4b` | 17:30:39 | 17:44:24 | 16.2 GB | 1043 MiB | no |

No run was refused or voided, so no rerun was due. All 90 measured turns returned a reply (0 errors).
Command per model, from the worktree at `90bb9d1`:
`EVAL_SUITE=b7-cpu EVAL_OLLAMA_URL=http://127.0.0.1:11435 EVAL_B7_SERVER_LOG=<log> EVAL_MODEL=<m> EVAL_OUT=<run folder>/b7-cpu-dev-<m>-run1.json npm run eval`.
`EVAL_OUT` only moves the JSON out of the main checkout; it changes no scenario.

## Results per model (warm repeats, n = 5 per kind; nearest rank, so p90 = max)

Times in seconds. Steps are p50 per step. "Prompt tok/s" is Ollama's prompt count over its prompt-eval
time; the count includes a cached prefix, so it is an effective rate, not raw prefill speed (see
"Rates" below). No confidence intervals on percentiles (pre-registered).

### qwen3.5:0.8b

| Turn kind | Wall p50 | p90 | max | TTFT p50 | TTFT p90 | Load | Prefill | Generate | Embed | Other | Slowest | Prompt tok p50 | Prompt tok/s p50 | Out tok p50 | Out tok/s p50 | Calls/turn | ≤ 15 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| k12-t1-new-problem | 7.1 | 8.4 | 8.4 | 4.8 | 4.8 | 0.0 | 4.7 | 2.3 | 0.1 | 0.0 | prefill | 2299 | 494 | 82 | 35.1 | 1 | yes |
| k12-t2-wrong-try | 4.5 | 11.3 | 11.3 | 0.7 | 0.9 | 0.0 | 0.6 | 3.8 | 0.0 | 0.0 | generate | 2396 | 4160 | 131 | 34.9 | 1 | yes |
| k12-t3-show-answer | 4.3 | 7.6 | 7.6 | 0.9 | 1.9 | 0.0 | 0.8 | 3.3 | 0.0 | 0.0 | generate | 2570 | 3210 | 114 | 34.8 | 1 | yes |
| notes-en | 5.5 | 6.5 | 6.5 | 3.8 | 4.7 | 0.0 | 3.7 | 1.6 | 0.0 | 0.0 | prefill | 1890 | 504 | 60 | 36.8 | 1 | yes |
| notes-hi-gloss | 17.9 | 20.7 | 20.7 | 6.0 | 6.1 | 0.0 | 3.0 | 9.5 | 0.1 | 3.0 | generate | 1628 | 572 | 349 | 36.8 | 2.6 | **no** |

### gemma4:e2b

| Turn kind | Wall p50 | p90 | max | TTFT p50 | TTFT p90 | Load | Prefill | Generate | Embed | Other | Slowest | Prompt tok p50 | Prompt tok/s p50 | Out tok p50 | Out tok/s p50 | Calls/turn | ≤ 15 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| k12-t1-new-problem | 5.5 | 8.6 | 8.6 | 2.3 | 2.4 | 0.0 | 2.2 | 3.2 | 0.1 | 0.1 | generate | 2051 | 1624 | 101 | 32.0 | 1.2 | yes |
| k12-t2-wrong-try | 4.4 | 5.9 | 5.9 | 0.2 | 0.4 | 0.0 | 0.1 | 4.0 | 0.0 | 0.0 | generate | 2168 | 16301 | 145 | 34.7 | 1 | yes |
| k12-t3-show-answer | 12.5 | 18.4 | 18.4 | 1.8 | 2.7 | 0.0 | 2.0 | 12.3 | 0.0 | 0.1 | generate | 2417 | 2953 | 403 | 35.9 | 1.4 | yes |
| notes-en | 2.1 | 2.5 | 2.5 | 0.7 | 0.7 | 0.0 | 0.6 | 1.4 | 0.0 | 0.0 | generate | 1673 | 2935 | 41 | 29.0 | 1 | yes |
| notes-hi-gloss | 2.4 | 2.4 | 2.4 | 1.8 | 1.8 | 0.0 | 1.0 | 1.3 | 0.1 | 0.0 | generate | 3015 | 3131 | 45 | 35.5 | 2 | yes |

### qwen3.5:4b

| Turn kind | Wall p50 | p90 | max | TTFT p50 | TTFT p90 | Load | Prefill | Generate | Embed | Other | Slowest | Prompt tok p50 | Prompt tok/s p50 | Out tok p50 | Out tok/s p50 | Calls/turn | ≤ 15 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| k12-t1-new-problem | 24.2 | 28.4 | 28.4 | 10.7 | 11.0 | 0.0 | 10.6 | 13.7 | 0.1 | 0.0 | generate | 2299 | 218 | 158 | 11.5 | 1 | **no** |
| k12-t2-wrong-try | 27.3 | 32.3 | 32.3 | 2.1 | 2.5 | 0.0 | 2.0 | 25.8 | 0.0 | 0.0 | generate | 2468 | 1212 | 293 | 11.4 | 1 | **no** |
| k12-t3-show-answer | 29.9 | 73.2 | 73.2 | 3.6 | 4.1 | 0.0 | 3.5 | 27.6 | 0.0 | 0.0 | generate | 2708 | 787 | 312 | 11.3 | 1 | **no** |
| notes-en | 18.0 | 23.3 | 23.3 | 10.7 | 15.5 | 0.0 | 10.6 | 6.2 | 0.0 | 0.0 | prefill | 1890 | 180 | 73 | 11.8 | 1.2 | **no** |
| notes-hi-gloss | 35.3 | 38.6 | 38.6 | 16.0 | 16.1 | 0.0 | 7.7 | 19.3 | 0.1 | 8.2 | generate | 1628 | 212 | 225 | 11.8 | 2 | **no** |

## Cold start

"Cold" = not in Ollama's memory; the model file was very likely still in the OS file cache (the
models were loaded minutes earlier), so a first launch after a reboot is slower than this.

| Model | Cold-start first turn (k12 T1, chat + embedder load) | Its TTFT | Its load | Cold notes-en | Cold notes-hi-gloss |
|---|---|---|---|---|---|
| `qwen3.5:0.8b` | **58.3 s** | 11.6 s | 1.9 s | 10.4 s (load 1.6) | 17.3 s (load 1.6) |
| `gemma4:e2b` | **14.8 s** | 9.0 s | 4.7 s | 9.2 s (load 4.0) | 8.7 s (load 3.7) |
| `qwen3.5:4b` | **34.7 s** | 25.8 s | 3.1 s | 29.2 s (load 2.8) | 46.0 s (load not seen, below) |

- The 0.8b cold T1 is long because the model made **7 chat calls** in that turn (21,700 prompt tokens,
  808 output tokens), not because loading was slow (1.9 s). Every other k12 T1 for every model made 1–2
  calls. One turn: it says what this model did on `math-k5-01`, not what its cold start always costs.
- qwen3.5:4b's cold Hindi turn: the gloss call, which carried the model load, hit its 20 s cold deadline
  and was cancelled, so Ollama never reported its `load_duration`; the load shows as 0 and the time sits
  in "other" (20.1 s). An accounting gap, not a missing load.
- k12 repeat 0, T2 and T3 (model now warm, reported apart as pre-registered): 0.8b 9.9 s and 14.3 s
  (T3: 3 calls), e2b 4.6 s and 15.8 s (T3: 3 calls), 4b 12.4 s and 16.7 s.

## Rates

| Model | Uncached prefill (first call of each cold turn, tok/s) | Warm T1 first call, prompt tok/s (5 reps) | Generation, all warm chat calls | Effective prompt rate, all warm chat calls (cache counted) |
|---|---|---|---|---|
| `qwen3.5:0.8b` | 236 (k12), 278 (en), 276 (hi gloss) | 491, 498, 494, 495, 491 | 3,865 tok / 107.8 s = **35.8 tok/s** | 858 tok/s |
| `gemma4:e2b` | 491 (k12), 500 (en), 480 (hi gloss) | 914, 935, 953, 7222, 5592 | 3,903 tok / 113.7 s = **34.3 tok/s** | 2,693 tok/s |
| `qwen3.5:4b` | 101 (k12), 100 (en) | 211, 221, 213, 218, 219 | 5,200 tok / 454.4 s = **11.4 tok/s** | 329 tok/s |

A new problem (warm T1) shares only the course's system prompt with the turn before. e2b's prefill on it
is 2.2 s at p50 and drops to 0.3–0.4 s on the last two repeats; both qwen3.5 models re-prefill it at a steady rate
every time (4.7 s on 0.8b, 10.6 s on 4b at p50), so they get much less from Ollama's prompt cache on a new
conversation than e2b does. Why was not measured. Within one conversation (T2, T3) all three reuse the
cache.

## Descriptive, against B7's other bars (cannot pass or fail here: not the reference box)

Wilson 95% on every proportion. Item-majority and McNemar do not apply: no item is repeated with a
binary outcome and no two arms are paired; each proportion below is over turns.

| | `qwen3.5:0.8b` | `gemma4:e2b` | `qwen3.5:4b` |
|---|---|---|---|
| Warm reloads (B7 bar: 0) | 0/25, 0% (0–13.3%) | 0/25, 0% (0–13.3%) | 0/25, 0% (0–13.3%) |
| Warm gloss errors (3 s warm deadline) | **5/5**, 100% (56.6–100%), all "timed out after 3000 ms" | 0/5, 0% (0–43.4%), gloss 1.15–1.16 s | **5/5**, 100% (56.6–100%), all "timed out after 3000 ms" |
| Warm turns with wall ≤ 15 s (turns, not independent) | 22/25, 88.0% (70.0–95.8%) | 23/25, 92.0% (75.0–97.8%) | 1/25, 4.0% (0.7–19.5%) |
| notes-en TTFT (B7 bar for e2b on the reference box: p50 ≤ 6 s, p95 ≤ 20 s) | p50 3.8 s, max 4.7 s | p50 **0.65 s**, max 0.70 s | p50 10.7 s, max 15.5 s |
| Model calls per notes-en turn, mean (B7 bar: 0 extra) | 1.0 | 1.0 | 1.2 (one warm turn made 2) |

On qwen3.5:0.8b and 4b the L2 gloss never finished inside its warm deadline on this CPU, so every warm
Hindi turn paid 3 s for nothing and retrieved on the untranslated question. On CPU those two models get
no benefit from L2.

## Rows (all 90 measured turns, in run order)

Times in seconds. "Chat calls" counts chat and structured (gloss) calls. Gloss: the L2 outcome.

#### qwen3.5:0.8b

| Turn | Rep | Item | Wall s | TTFT s | Load s | Prefill s | Generate s | Other s | Prompt tok | Out tok | Out tok/s | Chat calls | Resident before (chat/embed) | Gloss |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| k12-t1-new-problem | 0 cold | math-k5-01 | 58.3 | 11.6 | 1.9 | 32.5 | 23.6 | 0.3 | 21700 | 808 | 34.3 | 7 | n/n |  |
| k12-t2-wrong-try | 0 | math-k5-01 | 9.9 | 2.7 | 0.0 | 2.6 | 7.2 | 0.1 | 2825 | 249 | 34.6 | 1 | y/y |  |
| k12-t3-show-answer | 0 | math-k5-01 | 14.3 | 6.2 | 0.0 | 2.6 | 11.5 | 0.1 | 9559 | 392 | 34.2 | 3 | y/y |  |
| k12-t1-new-problem | 1 | math-k5-02 | 7.1 | 4.8 | 0.0 | 4.7 | 2.3 | 0.0 | 2299 | 82 | 35.6 | 1 | y/y |  |
| k12-t2-wrong-try | 1 | math-k5-02 | 4.4 | 0.7 | 0.0 | 0.6 | 3.7 | 0.0 | 2396 | 130 | 34.8 | 1 | y/y |  |
| k12-t3-show-answer | 1 | math-k5-02 | 7.6 | 0.9 | 0.0 | 0.8 | 6.7 | 0.0 | 2542 | 233 | 34.8 | 1 | y/y |  |
| k12-t1-new-problem | 2 | math-k5-03 | 7.0 | 4.7 | 0.0 | 4.6 | 2.3 | 0.0 | 2295 | 81 | 35.2 | 1 | y/y |  |
| k12-t2-wrong-try | 2 | math-k5-03 | 3.0 | 0.6 | 0.0 | 0.5 | 2.4 | 0.0 | 2391 | 83 | 34.9 | 1 | y/y |  |
| k12-t3-show-answer | 2 | math-k5-03 | 3.5 | 0.7 | 0.0 | 0.6 | 2.8 | 0.0 | 2490 | 98 | 34.6 | 1 | y/y |  |
| k12-t1-new-problem | 3 | math-k5-04 | 8.4 | 4.8 | 0.0 | 4.7 | 3.6 | 0.0 | 2314 | 126 | 35.1 | 1 | y/y |  |
| k12-t2-wrong-try | 3 | math-k5-04 | 11.3 | 0.9 | 0.0 | 0.8 | 10.5 | 0.0 | 2455 | 365 | 34.8 | 1 | y/y |  |
| k12-t3-show-answer | 3 | math-k5-04 | 3.8 | 1.9 | 0.0 | 1.9 | 1.8 | 0.0 | 2836 | 63 | 34.4 | 1 | y/y |  |
| k12-t1-new-problem | 4 | math-k5-05 | 7.1 | 4.8 | 0.0 | 4.6 | 2.3 | 0.0 | 2299 | 81 | 35.1 | 1 | y/y |  |
| k12-t2-wrong-try | 4 | math-k5-05 | 5.2 | 0.6 | 0.0 | 0.6 | 4.5 | 0.0 | 2395 | 159 | 35.2 | 1 | y/y |  |
| k12-t3-show-answer | 4 | math-k5-05 | 4.3 | 1.0 | 0.0 | 0.9 | 3.3 | 0.1 | 2570 | 114 | 35.1 | 1 | y/y |  |
| k12-t1-new-problem | 5 | math-k5-06 | 7.7 | 4.8 | 0.0 | 4.7 | 2.9 | 0.0 | 2309 | 102 | 35.1 | 1 | y/y |  |
| k12-t2-wrong-try | 5 | math-k5-06 | 4.5 | 0.8 | 0.0 | 0.7 | 3.8 | 0.0 | 2426 | 131 | 34.9 | 1 | y/y |  |
| k12-t3-show-answer | 5 | math-k5-06 | 4.3 | 0.9 | 0.0 | 0.8 | 3.5 | 0.0 | 2573 | 121 | 34.9 | 1 | y/y |  |
| notes-en | 0 cold | h-pp01 | 10.4 | 8.4 | 1.6 | 6.8 | 1.9 | 0.0 | 1890 | 71 | 36.8 | 1 | n/n |  |
| notes-hi-gloss | 0 cold | h-xl-hi01 | 17.3 | 12.6 | 1.6 | 9.8 | 5.7 | 0.1 | 3307 | 214 | 37.3 | 2 | n/n | no text, 8.8 s |
| notes-en | 1 | h-pp01 | 6.5 | 4.7 | 0.0 | 4.6 | 1.8 | 0.0 | 1890 | 67 | 36.7 | 1 | y/y |  |
| notes-hi-gloss | 1 | h-xl-hi01 | 20.7 | 5.9 | 0.0 | 5.3 | 12.2 | 3.1 | 3864 | 446 | 36.4 | 3 | y/y | timed out after 3000 ms |
| notes-en | 2 | h-pp01 | 5.5 | 3.7 | 0.0 | 3.6 | 1.8 | 0.0 | 1890 | 65 | 36.8 | 1 | y/y |  |
| notes-hi-gloss | 2 | h-xl-hi01 | 18.3 | 5.9 | 0.1 | 5.5 | 9.5 | 3.1 | 5838 | 349 | 36.7 | 4 | y/y | timed out after 3000 ms |
| notes-en | 3 | h-pp01 | 5.1 | 3.7 | 0.0 | 3.6 | 1.4 | 0.0 | 1890 | 51 | 37 | 1 | y/y |  |
| notes-hi-gloss | 3 | h-xl-hi01 | 9.1 | 6.1 | 0.0 | 3.0 | 3.0 | 3.0 | 1628 | 115 | 37.8 | 2 | y/y | timed out after 3000 ms |
| notes-en | 4 | h-pp01 | 5.4 | 3.8 | 0.0 | 3.7 | 1.6 | 0.0 | 1890 | 58 | 36.8 | 1 | y/y |  |
| notes-hi-gloss | 4 | h-xl-hi01 | 12.7 | 6.0 | 0.0 | 2.9 | 6.6 | 3.0 | 1628 | 247 | 37.4 | 2 | y/y | timed out after 3000 ms |
| notes-en | 5 | h-pp01 | 5.7 | 4.1 | 0.0 | 4.1 | 1.6 | 0.0 | 1890 | 60 | 37.1 | 1 | y/y |  |
| notes-hi-gloss | 5 | h-xl-hi01 | 17.9 | 6.0 | 0.0 | 2.8 | 11.9 | 3.0 | 1628 | 438 | 36.8 | 2 | y/y | timed out after 3000 ms |

#### gemma4:e2b

| Turn | Rep | Item | Wall s | TTFT s | Load s | Prefill s | Generate s | Other s | Prompt tok | Out tok | Out tok/s | Chat calls | Resident before (chat/embed) | Gloss |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| k12-t1-new-problem | 0 cold | math-k5-01 | 14.8 | 9.0 | 4.7 | 4.2 | 5.8 | 0.1 | 2039 | 182 | 31.2 | 1 | n/n |  |
| k12-t2-wrong-try | 0 | math-k5-01 | 4.6 | 0.2 | 0.0 | 0.1 | 4.4 | 0.0 | 2237 | 154 | 35.3 | 1 | y/y |  |
| k12-t3-show-answer | 0 | math-k5-01 | 15.8 | 5.1 | 0.0 | 6.3 | 9.3 | 0.1 | 8114 | 362 | 38.8 | 3 | y/y |  |
| k12-t1-new-problem | 1 | math-k5-02 | 8.6 | 2.4 | 0.0 | 2.2 | 6.2 | 0.1 | 2051 | 223 | 36 | 1 | y/y |  |
| k12-t2-wrong-try | 1 | math-k5-02 | 5.9 | 0.2 | 0.0 | 0.1 | 5.6 | 0.0 | 2290 | 218 | 38.6 | 1 | y/y |  |
| k12-t3-show-answer | 1 | math-k5-02 | 12.3 | 2.7 | 0.0 | 2.6 | 9.6 | 0.1 | 2567 | 371 | 38.6 | 1 | y/y |  |
| k12-t1-new-problem | 2 | math-k5-03 | 7.3 | 2.3 | 0.0 | 2.2 | 5.0 | 0.1 | 2047 | 133 | 26.4 | 1 | y/y |  |
| k12-t2-wrong-try | 2 | math-k5-03 | 4.9 | 0.2 | 0.0 | 0.1 | 4.7 | 0.0 | 2196 | 162 | 34.7 | 1 | y/y |  |
| k12-t3-show-answer | 2 | math-k5-03 | 15.9 | 2.1 | 0.0 | 2.0 | 13.7 | 0.1 | 2417 | 493 | 35.9 | 1 | y/y |  |
| k12-t1-new-problem | 3 | math-k5-04 | 5.5 | 2.3 | 0.0 | 2.6 | 2.7 | 0.1 | 4251 | 93 | 34.8 | 2 | y/y |  |
| k12-t2-wrong-try | 3 | math-k5-04 | 4.4 | 0.4 | 0.0 | 0.4 | 4.0 | 0.0 | 2150 | 145 | 36.3 | 1 | y/y |  |
| k12-t3-show-answer | 3 | math-k5-04 | 12.5 | 0.2 | 0.0 | 0.1 | 12.3 | 0.0 | 2311 | 403 | 32.7 | 1 | y/y |  |
| k12-t1-new-problem | 4 | math-k5-05 | 3.5 | 0.4 | 0.0 | 0.3 | 3.2 | 0.0 | 2051 | 101 | 32 | 1 | y/y |  |
| k12-t2-wrong-try | 4 | math-k5-05 | 4.1 | 0.2 | 0.0 | 0.1 | 3.9 | 0.0 | 2168 | 115 | 29.4 | 1 | y/y |  |
| k12-t3-show-answer | 4 | math-k5-05 | 8.3 | 0.2 | 0.0 | 0.1 | 8.1 | 0.0 | 2299 | 310 | 38.5 | 1 | y/y |  |
| k12-t1-new-problem | 5 | math-k5-06 | 3.0 | 0.5 | 0.0 | 0.4 | 2.5 | 0.1 | 2058 | 69 | 28 | 1 | y/y |  |
| k12-t2-wrong-try | 5 | math-k5-06 | 2.8 | 0.2 | 0.0 | 0.1 | 2.6 | 0.0 | 2143 | 73 | 27.7 | 1 | y/y |  |
| k12-t3-show-answer | 5 | math-k5-06 | 18.4 | 1.8 | 0.0 | 2.5 | 15.8 | 0.1 | 7287 | 554 | 35.1 | 3 | y/y |  |
| notes-en | 0 cold | h-pp01 | 9.2 | 7.4 | 4.0 | 3.3 | 1.9 | 0.0 | 1673 | 50 | 27 | 1 | n/n |  |
| notes-hi-gloss | 0 cold | h-xl-hi01 | 8.7 | 8.1 | 3.7 | 3.6 | 1.3 | 0.0 | 3015 | 45 | 35.2 | 2 | n/n | ok 7.5 s |
| notes-en | 1 | h-pp01 | 1.9 | 0.7 | 0.0 | 0.6 | 1.2 | 0.0 | 1673 | 38 | 30.5 | 1 | y/y |  |
| notes-hi-gloss | 1 | h-xl-hi01 | 2.4 | 1.8 | 0.0 | 1.0 | 1.3 | 0.0 | 3015 | 45 | 35.5 | 2 | y/y | ok 1.2 s |
| notes-en | 2 | h-pp01 | 1.8 | 0.6 | 0.0 | 0.5 | 1.2 | 0.0 | 1673 | 39 | 33 | 1 | y/y |  |
| notes-hi-gloss | 2 | h-xl-hi01 | 2.4 | 1.8 | 0.0 | 1.0 | 1.3 | 0.0 | 3015 | 45 | 35.9 | 2 | y/y | ok 1.2 s |
| notes-en | 3 | h-pp01 | 2.4 | 0.7 | 0.0 | 0.6 | 1.7 | 0.0 | 1673 | 48 | 27.7 | 1 | y/y |  |
| notes-hi-gloss | 3 | h-xl-hi01 | 2.4 | 1.8 | 0.0 | 1.0 | 1.3 | 0.0 | 3015 | 45 | 35.4 | 2 | y/y | ok 1.2 s |
| notes-en | 4 | h-pp01 | 2.1 | 0.7 | 0.0 | 0.6 | 1.4 | 0.0 | 1673 | 41 | 29 | 1 | y/y |  |
| notes-hi-gloss | 4 | h-xl-hi01 | 2.4 | 1.8 | 0.0 | 1.0 | 1.2 | 0.0 | 3015 | 45 | 36.1 | 2 | y/y | ok 1.2 s |
| notes-en | 5 | h-pp01 | 2.5 | 0.6 | 0.0 | 0.5 | 1.9 | 0.0 | 1673 | 49 | 25.5 | 1 | y/y |  |
| notes-hi-gloss | 5 | h-xl-hi01 | 2.4 | 1.8 | 0.0 | 1.0 | 1.3 | -0.0 | 3015 | 45 | 35.2 | 2 | y/y | ok 1.2 s |

#### qwen3.5:4b

| Turn | Rep | Item | Wall s | TTFT s | Load s | Prefill s | Generate s | Other s | Prompt tok | Out tok | Out tok/s | Chat calls | Resident before (chat/embed) | Gloss |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| k12-t1-new-problem | 0 cold | math-k5-01 | 34.7 | 25.8 | 3.1 | 22.6 | 8.9 | 0.1 | 2287 | 103 | 11.6 | 1 | n/n |  |
| k12-t2-wrong-try | 0 | math-k5-01 | 12.4 | 1.5 | 0.0 | 1.4 | 10.9 | 0.0 | 2405 | 125 | 11.5 | 1 | y/y |  |
| k12-t3-show-answer | 0 | math-k5-01 | 16.7 | 1.8 | 0.0 | 1.8 | 14.9 | 0.0 | 2546 | 170 | 11.4 | 1 | y/y |  |
| k12-t1-new-problem | 1 | math-k5-02 | 28.4 | 11.0 | 0.0 | 10.9 | 17.4 | 0.0 | 2299 | 199 | 11.4 | 1 | y/y |  |
| k12-t2-wrong-try | 1 | math-k5-02 | 18.1 | 2.5 | 0.0 | 2.5 | 15.6 | 0.0 | 2513 | 178 | 11.4 | 1 | y/y |  |
| k12-t3-show-answer | 1 | math-k5-02 | 28.6 | 2.3 | 0.0 | 2.3 | 26.3 | 0.0 | 2707 | 298 | 11.3 | 1 | y/y |  |
| k12-t1-new-problem | 2 | math-k5-03 | 24.2 | 10.5 | 0.0 | 10.4 | 13.7 | 0.0 | 2295 | 158 | 11.5 | 1 | y/y |  |
| k12-t2-wrong-try | 2 | math-k5-03 | 27.9 | 2.1 | 0.0 | 2.0 | 25.8 | 0.0 | 2468 | 293 | 11.4 | 1 | y/y |  |
| k12-t3-show-answer | 2 | math-k5-03 | 32.6 | 3.6 | 0.0 | 3.5 | 29.0 | 0.0 | 2777 | 327 | 11.3 | 1 | y/y |  |
| k12-t1-new-problem | 3 | math-k5-04 | 16.1 | 11.0 | 0.0 | 10.8 | 5.1 | 0.0 | 2314 | 59 | 11.6 | 1 | y/y |  |
| k12-t2-wrong-try | 3 | math-k5-04 | 32.3 | 1.1 | 0.0 | 1.1 | 31.2 | 0.0 | 2388 | 355 | 11.4 | 1 | y/y |  |
| k12-t3-show-answer | 3 | math-k5-04 | 73.2 | 4.1 | 0.0 | 4.0 | 69.1 | 0.0 | 2759 | 775 | 11.2 | 1 | y/y |  |
| k12-t1-new-problem | 4 | math-k5-05 | 17.9 | 10.7 | 0.0 | 10.6 | 7.2 | 0.0 | 2299 | 83 | 11.6 | 1 | y/y |  |
| k12-t2-wrong-try | 4 | math-k5-05 | 27.3 | 1.3 | 0.0 | 1.3 | 25.9 | 0.0 | 2397 | 295 | 11.4 | 1 | y/y |  |
| k12-t3-show-answer | 4 | math-k5-05 | 21.0 | 3.6 | 0.0 | 3.5 | 17.4 | 0.0 | 2708 | 198 | 11.4 | 1 | y/y |  |
| k12-t1-new-problem | 5 | math-k5-06 | 27.6 | 10.7 | 0.0 | 10.6 | 16.9 | 0.0 | 2309 | 195 | 11.5 | 1 | y/y |  |
| k12-t2-wrong-try | 5 | math-k5-06 | 17.6 | 2.5 | 0.0 | 2.4 | 15.1 | 0.0 | 2519 | 172 | 11.4 | 1 | y/y |  |
| k12-t3-show-answer | 5 | math-k5-06 | 29.9 | 2.3 | 0.0 | 2.2 | 27.6 | 0.0 | 2707 | 312 | 11.3 | 1 | y/y |  |
| notes-en | 0 cold | h-pp01 | 29.2 | 21.8 | 2.8 | 18.9 | 7.5 | 0.0 | 1890 | 88 | 11.8 | 1 | n/n |  |
| notes-hi-gloss | 0 cold | h-xl-hi01 | 46.0 | 30.0 | 0.0 | 9.8 | 16.0 | 20.1 | 1628 | 186 | 11.7 | 2 | n/n | timed out after 20000 ms |
| notes-en | 1 | h-pp01 | 18.0 | 12.7 | 0.0 | 12.6 | 5.3 | 0.0 | 1890 | 62 | 11.8 | 1 | y/y |  |
| notes-hi-gloss | 1 | h-xl-hi01 | 38.4 | 16.0 | 0.0 | 7.7 | 22.4 | 8.2 | 1628 | 261 | 11.7 | 2 | y/y | timed out after 3000 ms |
| notes-en | 2 | h-pp01 | 16.7 | 10.5 | 0.0 | 10.4 | 6.2 | 0.0 | 1890 | 73 | 11.8 | 1 | y/y |  |
| notes-hi-gloss | 2 | h-xl-hi01 | 22.2 | 16.0 | 0.0 | 7.7 | 6.2 | 8.2 | 1628 | 74 | 11.9 | 2 | y/y | timed out after 3000 ms |
| notes-en | 3 | h-pp01 | 22.6 | 15.5 | 0.0 | 12.9 | 9.6 | 0.1 | 4000 | 112 | 11.7 | 2 | y/y |  |
| notes-hi-gloss | 3 | h-xl-hi01 | 18.7 | 15.8 | 0.0 | 7.6 | 2.9 | 8.2 | 1628 | 35 | 12.1 | 2 | y/y | timed out after 3000 ms |
| notes-en | 4 | h-pp01 | 23.3 | 10.6 | 0.0 | 10.5 | 12.8 | 0.0 | 1890 | 149 | 11.7 | 1 | y/y |  |
| notes-hi-gloss | 4 | h-xl-hi01 | 38.6 | 16.1 | 0.0 | 7.8 | 22.5 | 8.2 | 1628 | 264 | 11.8 | 2 | y/y | timed out after 3000 ms |
| notes-en | 5 | h-pp01 | 14.8 | 10.7 | 0.0 | 10.6 | 4.1 | 0.0 | 1890 | 48 | 11.8 | 1 | y/y |  |
| notes-hi-gloss | 5 | h-xl-hi01 | 35.3 | 16.0 | 0.0 | 7.6 | 19.3 | 8.4 | 1628 | 225 | 11.7 | 2 | y/y | timed out after 3000 ms |

## Limits

- One machine, one run per model, n = 5 warm turns per kind: p90 is the maximum, and one long reply
  moves it (4b T3 max 73.2 s is one 775-token answer). Not the B7 reference box (4 threads, 8 GB); this
  laptop has 8 runner threads and twice the cores, so the reference box will be slower.
- Prompt tok/s per turn counts the cached prefix; use the uncached column above for prefill speed.
- `server.threads` is null in the results files (log-format mismatch, above); the thread count here
  comes from reading the log by hand.
- During the runs the machine also ran idle MCP server processes, an idle `astro preview`, and Claude's
  own progress polling (a 10 s sleep loop). The harness's busy check read 3.4–6.3% before each run; it
  cannot see load mid-run. Nothing else was noted, so no run was voided by hand.
- One learner (`OLLAMA_NUM_PARALLEL=1`); the school profile's concurrent sessions are not measured.
  Quiz grading, a B7 turn type, is not covered by the harness.
- Raw JSON (every request with Ollama's fields) and console logs are in the run folder
  (`C:/x/oe-b7-runs/`, not committed): `b7-cpu-dev-<model>-run1.json`, `<model>-run1.console.log`,
  `snapshots.log` (free RAM, VRAM, `ollama ps` before and after each model), `ollama-cpu.log`.
