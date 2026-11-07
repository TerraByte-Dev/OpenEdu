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
| `EVAL_SUITE` | `rag` | Only `rag` runs headless so far. |
| `EVAL_MODEL` | `gemma4:e2b` | Chat model. Stored as the Settings chat model. |
| `EVAL_PROVIDER` | `ollama` | `ollama`, `openai` or `anthropic`. Cloud needs `EVAL_API_KEY`. |
| `EVAL_API_KEY` | (none) | Cloud key. Read from the environment, never written to the results file. |
| `EVAL_OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama base URL. |
| `EVAL_EMBED_MODEL` | app default (`nomic-embed-text`) | Embedding model for the vault and the question. |
| `EVAL_SET` | `main` | `main` (rag-fixture.ts), `dev` / `test` (rag-heldout.ts), or `sealed`. |
| `EVAL_SEALED` | (none) | Path to the sealed v2 file. Required with `EVAL_SET=sealed`. |
| `EVAL_REPEATS` | `1` | Repeats per question and mode. |
| `EVAL_MODES` | `always,off` | Comma list of retrieval modes: `always`, `auto`, `off`. |
| `EVAL_ONLY` | (all) | Comma list of question ids. |
| `EVAL_SYLLABUS` | `python` | `python` or `matched` (see rag-runner.ts). |
| `EVAL_CTX` | app default (8192) | The Settings context-window cap. num_ctx is min(model max, this). |
| `EVAL_OUT` | `.dev/eval-runs/<stamp>-rag-<set>-<model>.json` | Results JSON. `.dev/` is gitignored. |

The results file holds the runner's report (every row, with `ttft_ms` and `total_ms`), the options,
the commit SHA, whether `src/` had uncommitted changes, and the sealed file's SHA-256 when one was used.

## The sealed set

`EVAL_SET=sealed EVAL_SEALED=<path>` reads the file through `loadSealed` in `../sealed.ts`. Before any
model call it refuses when:

1. the file's SHA-256 is not the one in `../heldout-v2-protocol.md`;
2. the file does not match the v2 schema;
3. the name lint finds one of the set's made-up names in `src/` outside `src/lib/eval/`.

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
headless entry and checks that the `/api/chat` and `/api/embed` bodies are identical.

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
