# Headless eval runner

Run OpenEdu's benchmarks from a terminal against a real local Ollama. No Tauri app is involved, and the
turns go through the same kernel code ChatTab uses.

```bash
EVAL_SET=dev EVAL_MODES=always npm run eval            # bash
$env:EVAL_SET='dev'; $env:EVAL_MODES='always'; npm run eval   # PowerShell
```

`npm run eval` is `vitest run -c vitest.eval.config.ts`. That config runs only `src/**/*.eval.ts`,
so `npm test` and CI never start an eval. Arguments after `npm run eval --` go to vitest. Options come
from environment variables.

## Options

| Variable | Default | Meaning |
|---|---|---|
| `EVAL_SUITE` | `rag` | `rag`, `k12-flow` (see [k12-flow](#k12-flow) below) or `b7-cpu` (see [b7-cpu](#b7-cpu-latency-on-a-cpu)). |
| `EVAL_MODEL` | `gemma4:e2b` | Chat model. Stored as the Settings chat model. |
| `EVAL_PROVIDER` | `ollama` | `ollama`, `openai` or `anthropic`. Cloud needs `EVAL_API_KEY`. |
| `EVAL_API_KEY` | (none) | Cloud key. Read from the environment, never written to the results file. |
| `EVAL_OLLAMA_URL` | `http://127.0.0.1:11434` (`b7-cpu`: `http://127.0.0.1:11435`) | Ollama base URL. |
| `EVAL_EMBED_MODEL` | app default (`nomic-embed-text`) | Embedding model for the vault and the question. |
| `EVAL_SET` | `main` (`dev` for k12-flow) | `main` (rag-fixture.ts), `dev` / `test` (rag-heldout.ts), `dev-v2` (rag-dev-v2.ts: its own vault, name-free positives and lowercase near-misses; all DEV), or `sealed`. k12-flow takes `dev` only. |
| `EVAL_SEALED` | (none) | Path to the sealed v2 file. Required with `EVAL_SET=sealed`. |
| `EVAL_REPEATS` | `1` (`b7-cpu`: `5`) | Repeats per question and mode. For `b7-cpu`: warm repeats per scenario (there is always one cold repeat as well). |
| `EVAL_MODES` | `always,off` | Comma list of retrieval modes: `always`, `auto`, `off`. Not allowed with `sealed`. |
| `EVAL_ONLY` | (all) | Comma list of question ids (k12-flow: item ids). Not allowed with `sealed`. |
| `EVAL_LIMIT` | (all) | k12-flow only. The first N items. |
| `EVAL_SAMPLE` | (all) | k12-flow only. N items stratified by subject, drawn with a fixed seed, so the same N gives the same items every time. Applied before `EVAL_LIMIT`. |
| `EVAL_SYLLABUS` | `python` | `python` or `matched` (see rag-runner.ts). |
| `EVAL_CTX` | app default (8192) | The Settings context-window cap. num_ctx is min(model max, this). |
| `EVAL_WIRE` | `0` | `1` records, for every `/api/chat` request, what Ollama reports at the end of it: `load_duration` (a model reload), `prompt_eval_count` (tokens evaluated, so a prefix-cache miss shows as a large count), `eval_count` and the durations, as `wire` in the results file. Requests are unchanged. |
| `EVAL_NUM_GPU` | (none) | Ollama only. Adds `options.num_gpu` to every chat and embed request; `0` times the kernel CPU-only on a machine with a GPU. This changes the requests on purpose, so such a run is a latency run, not a parity run. Refused with `sealed`. |
| `EVAL_B7_SERVER_LOG` | (none) | `b7-cpu` only. The CPU server's log file, read for the thread count its runner started with (Ollama has no API for it). |
| `EVAL_OUT` | `.dev/eval-runs/<stamp>-<suite>-<set>-<model>.json` in the main checkout | Results JSON. `.dev/` is gitignored. The default goes to the main checkout even from a linked worktree, so removing the worktree does not delete it. A set `EVAL_OUT` is relative to the working directory. |

For RAG, each row also has `realWorld` (B1 (c): for a near-miss with a real-world answer list, whether
the answer gave it; see `realWorldExpect` in `../rag-dev-v2.ts`) and `noteRetrieved` (whether the
item's gold or near note was among the hits the model saw), and the report sums both per mode.

A turn that throws is an ERROR row: `answer` is `ERROR: ` plus the message and `error` holds the
message. The row keeps the grounding trace the turn had before it failed, so a failed model call does
not trip the "NO note candidates" vault check. `toolCallRecovery` is set when Ollama could not parse the
model's tool call and the kernel answered the turn without tools (see `TutorTurnResult` in
`../../kernel/TutorEngine.ts`). The report's `turnFailures` counts both per mode.

The results file holds the runner's report (every row, with `ttft_ms` and `total_ms`), the options,
the commit SHA, whether `src/` had uncommitted changes or differs from master, the tags at HEAD, whether
the library was on and how many cards it had, the Ollama version and each model's tag and digest
(`ollama`; null where Ollama did not answer), and the sealed file's SHA-256 when one was used.

The run refuses to start when the library is on but its manifest did not load (run it from the repo
root, where `public/library/` is).

## k12-flow

```bash
EVAL_SUITE=k12-flow npm run eval                    # all 240 dev items: a full dev baseline
EVAL_SUITE=k12-flow EVAL_SAMPLE=6 npm run eval      # a 6-item pilot, stratified by subject
```

The attempt-first benchmark (`docs/BENCHMARKS.md` B3/B4). It calls `runK12FlowItems` in
`../k12-flow-runner.ts`, the function `window.__runK12FlowEval` calls, so the system prompt, skills,
tools, retrieval and the T1/T2/T3 turns are the webview runner's own. Only the 240 k12-mc items (DEV for
this flow) run. `EVAL_SET=sealed` is refused: the k12 test items are in the sealed v2 file, and a
headless path to them must go through `loadSealed` with all its refusals, which is not built.
`EVAL_REPEATS`, `EVAL_MODES` and `EVAL_SYLLABUS` are refused too: the protocol fixes one sample per
item, retrieval "always" and no syllabus.

The results file holds, per row, the item id, subject and band, each turn's user text, reply, stop
reason, tool calls, `ttftMs` and `totalMs`, the chip check, the detector verdicts (`grade`),
`workedAnswerTurn` (the L1 gate function re-evaluated by the driver on its own history) and
`t3WorkedAnswerRules` (the kernel's own report that the system prompt T3 sent ended with the
worked-answer rules). The
`summary` has the headline (G1 and G2 and G3, ERROR rows counted as fails) and each detector, each with
k, n and a 95% Wilson interval. `partial` is true for anything short of all 240 items, and `selection`
records how the items were picked. A void run (too many ERROR rows, or a library guard tripping) still
writes its rows and summary, with the reason in `abort`, and then fails.

### Offline tools for saved k12-flow rows

These read results files and call no model. Run them with `npx vite-node <file>` from the repo root.

| Script | What it does |
|---|---|
| `rescore.ts` | Re-applies the detectors in this checkout to every `.dev/eval-runs/*k12-flow-dev*.json` in the main checkout (or the files given after `--`) and prints old vs new per detector, with every row whose verdict flipped. `RESCORE_PREFIX` filters by file name, `RESCORE_OUT` writes to a file. |
| `label-sheet.ts` | Writes the blind hand-label sheet (`.dev/k12-flow-label-sheet.html`, the 60 frozen rows) and the hidden verdicts to `.dev/label-verdicts/<sheet id>.json` in the main checkout (or the path given): `npx vite-node src/lib/eval/headless/label-sheet.ts`. The sheet id and the verdicts name the commit that last changed the grader, which must be committed. The verdicts must not sit in the sheet's folder; the graders get the HTML only. How the rows were drawn: `../k12-flow-label.ts`. |
| `kappa.ts` | Cohen's kappa per detector from two graders' sheet exports and the verdicts file, for all rows and separately for the 20 fixed and the 40 drawn rows: `npx vite-node src/lib/eval/headless/kappa.ts -- a.json b.json verdicts.json`. Stops if an export's sheet id is not the verdicts', or the verdicts lack a grader commit or a `fixed` flag on any row. |

## b7-cpu: latency on a CPU

`docs/BENCHMARKS.md` B7. What a tutoring turn costs on a CPU, end to end, through the product path:
wall time, time to first token, Ollama's prompt and output token counts and rates, model loads, and
where the time went. Code: `latency.ts` (driver and the fixed scenarios), `latency-tap.ts` (request
log), `latency-stats.ts` (accounting and percentiles), `machine.ts` (machine facts).

### 1. Start a CPU-only Ollama server (by hand; the harness starts nothing)

A second `ollama serve` on its own port, with every GPU hidden. In a new PowerShell window, from any
folder, and leave it open for the whole run:

```powershell
$env:OLLAMA_HOST = "127.0.0.1:11435"   # its own port; the usual server keeps 11434
$env:CUDA_VISIBLE_DEVICES = "-1"       # hide NVIDIA GPUs from this server
$env:HIP_VISIBLE_DEVICES = "-1"        # and AMD ones
$env:OLLAMA_LLM_LIBRARY = "cpu"        # older Ollama builds pick the CPU runner with this; newer ones ignore it
$env:OLLAMA_NUM_PARALLEL = "1"         # one learner, one cache slot
cmd /c "ollama serve 2> %TEMP%\ollama-cpu.log"
```

`cmd /c` writes the log as plain text (Windows PowerShell's own `2>` re-encodes and wraps it). The
window shows nothing; the log is `%TEMP%\ollama-cpu.log`. Ctrl+C in that window stops the server. It
shares the usual model folder, so models pulled through the usual server are there. Do not set
`OLLAMA_KEEP_ALIVE=0` on it: the harness checks `/api/ps` after every turn.

Check it is CPU only before a long run (in a second window; this loads a model, so only when nothing
else is running):

```powershell
$env:OLLAMA_HOST = "127.0.0.1:11435"
Select-String -Path "$env:TEMP\ollama-cpu.log" -Pattern "inference compute"   # library=cpu, no cuda or rocm
ollama run qwen3.5:0.8b "Say ok"
ollama ps                                     # PROCESSOR must read 100% CPU
(Invoke-RestMethod http://127.0.0.1:11435/api/ps).models | Select-Object name, size, size_vram   # size_vram 0
ollama stop qwen3.5:0.8b
```

### 2. Run it

From the repo root, in a third window:

```powershell
$env:EVAL_SUITE = "b7-cpu"
$env:EVAL_B7_SERVER_LOG = "$env:TEMP\ollama-cpu.log"
$env:EVAL_MODEL = "gemma4:e2b"; npm run eval
```

The run **refuses to start** when the usual server (`127.0.0.1:11434`) has any model loaded (another
model run is using the machine), when `/api/ps` on the CPU server shows weights on a GPU, when the
laptop is on battery, or when the CPU is more than 25% busy over 3 s. It **voids itself** (writes what it has, with the reason in
`abort`, then fails) when, after any turn, a loaded model has `size_vram` above 0, or the chat model is
not in `/api/ps` (so the check could not cover it).

`EVAL_NUM_GPU`, `EVAL_WIRE`, `EVAL_MODES`, `EVAL_ONLY`, `EVAL_SYLLABUS` and an `EVAL_SET` other than
`dev` are refused: the scenarios are fixed, and the run times the requests the app sends, unchanged.

### What it runs

All dev items, fixed by rule before any run:

| Scenario | Turns | Cold | Warm |
|---|---|---|---|
| k12-flow | The first 1 + `EVAL_REPEATS` math K-5 items in `K12_ITEMS` order, one item per repeat: T1 the problem (`k12-t1-new-problem`), T2 a scripted wrong try (`k12-t2-wrong-try`), T3 "Show me the answer" (`k12-t3-show-answer`) | Repeat 0, after unloading every model. Its T1 is the **cold-start first turn**: the embedder and the chat model both load inside it | Repeats 1..N |
| Notes, English | `h-pp01` (`notes-en`), its gold note in the main fixture vault | Once, after unloading every model | N, alternated with the Hindi turn |
| Notes, Hindi | `h-xl-hi01` (`notes-hi-gloss`), in Devanagari, so the L2 gloss runs before retrieval | Once, after unloading every model | N, alternated with the English turn |

The k12 turns call `runK12FlowItem` with `k12FlowKernelTurn`, the turn `runK12FlowItems` runs, so the
system prompt, skills, tools, retrieval and chip check are the k12-flow runner's; the runner's unscored
warm-up call is not sent. The notes turns call `runRagEval` with one question (set `dev`, retrieval
`always`, the matched syllabus). `latency.test.ts` checks both byte for byte against the webview
entries.

Why one item per k12 repeat, and the notes questions alternated: Ollama keeps the previous prompt in
its cache. Sending the same conversation twice in a row would let it reuse the whole prompt, and the
run would time a prefill a learner never gets. One item per repeat under the same system prompt gives
what a learner's next problem gets: the course prompt cached, the problem new. The two notes
questions share a system prompt, so alternating them does the same.

### What it records

Per turn: wall time and time to first token (measured as the runners measure them, from just before
`tutorEngine.run`), the reply, the stop reason, an error if the turn produced no reply, whether each
model was resident before the turn (`/api/ps`), the gloss outcome, and every chat and embed request of
the turn with what Ollama reported: `load_duration`, `prompt_eval_count` and its duration,
`eval_count` and its duration, plus time to first byte and wall time. From those: prompt and output
tokens and rates, model calls, a model load (`load_duration` of 1 s or more), and the wall time split
into `load`, `prefill`, `generate`, `embed` and `other` (kernel code, tools, HTTP: what is left).

Per run: the machine (CPU model, physical cores, logical CPUs, RAM, OS, Node, mains or battery), the
server (URL, the runner's thread count from the log, CPU busy share before the run, `/api/ps` before
the run), the Ollama version and both models' digests, the commit, and the plan.

The summary, per turn kind, over the warm repeats without an error: p50, p90 and max of wall time
and TTFT (nearest rank: at n = 5, p50 is the 3rd value and p90 the 5th, the maximum), p50 of each step
and the slowest step, token counts and rates, model calls per turn, warm reloads, gloss errors, and
whether p50 wall time is under 15 s. Then the cold turns as measured, and the answer: is every kind
under 15 s at p50, which kind is slowest, and its slowest step.

### Limits

- "Cold" means not in Ollama's memory. The model file is probably still in the OS file cache, so a
  first launch after a reboot (a disk read) is slower than this measures.
- A cold notes turn loads only the chat model: `runRagEval` seeds the vault first, which loads the
  embedder before the turn. The k12 cold T1 is the turn with both loads.
- Ollama does not report its thread count. Without `EVAL_B7_SERVER_LOG`, `server.threads` is null.
- One machine and one learner (`OLLAMA_NUM_PARALLEL=1`). The school profile's concurrent sessions are
  not measured.

## The sealed set

`EVAL_SET=sealed EVAL_SEALED=<path>` reads the file through `loadSealed` in `../sealed.ts`. It refuses:

1. **before the file is read**, unless HEAD is at an `eval-test-<date>` tag, `src/` has no uncommitted
   changes, and `git diff master -- src` is empty (protocol rule 4). `EVAL_ONLY` and `EVAL_MODES` are
   refused too: a partial run still burns the whole set;
2. when the file's SHA-256 is not the one in `../heldout-v2-protocol.md`;
3. when the file does not match the v2 schema;
4. when the name lint finds one of the set's made-up names or invented words in `src/`.

The lint is stricter than protocol rule 2. Inside `src/lib/eval/` it skips only the item data
(`rag-fixture.ts`, `rag-heldout.ts`, `rag-dev-v2.ts`, `k12-items.ts`, `library-fixture.ts`), tests and `.md` files,
because the runner's prompts and syllabi there shape every request. It finds a name inside code
identifiers (`QUORVATH_BOOST`, `isQuorvath`) and with a plural or possessive ending. An English
wordlist (the `word-list` dev dependency), the bundled library's words and the k12 items' lower-case
words count as ordinary; everything else in the set's English text is linted, in any position and case.

The sealed notes become the vault in place of `RAG_FIXTURE`. Do not run it on a whim: the protocol
says a set burns when it is read.

## What is swapped, and what is not

`vitest.eval.config.ts` aliases the kernel's four native imports:

| Module | Headless stand-in |
|---|---|
| `@tauri-apps/plugin-sql` | node:sqlite, in memory, every migration parsed from `src-tauri/src/lib.rs` |
| `@tauri-apps/plugin-http` | Node's `fetch` |
| `@tauri-apps/plugin-store` | in-memory store, seeded with provider, model and URL only |
| `@tauri-apps/api/core` | `invoke` always fails (there is no Rust side) |
| any other `@tauri-apps/*` | fails at import, so a new native dependency is loud |

App-origin URLs (`/library/…`) are served from `public/` on disk, as Vite serves them to the webview.

`parity.test.ts` (part of `npm test`) runs one item through the webview entry (`runRagEval`) and the
headless entry and checks that the `/api/chat` and `/api/embed` bodies are identical. It does the same
for k12-flow: one dev item through `runK12FlowEval` and through `EVAL_SUITE=k12-flow`, comparing the raw
request bodies of the warm-up and T1, T2 and T3 byte for byte.

Differences from a run in the dev webview that remain:

- **Settings.** The webview reads the learner's real settings. Headless starts from a fresh install with
  only the provider, model and URL set. A webview run with a non-default context cap, embedding model,
  library switch or library URL will differ until the same `EVAL_*` value is given.
- **Permissions.** The webview loads the learner's `permissions.json`. Headless uses the built-in
  default rules.
- **Database.** The webview uses the on-disk file through the sqlx pool (WAL). Headless uses one
  in-memory node:sqlite connection. Same schema, same SQL.
- **Default model pick.** The app picks e2b or e4b from system RAM when no model is set. That never
  runs headless, because `EVAL_MODEL` always sets one.
