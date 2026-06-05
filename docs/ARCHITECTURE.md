# Architecture

A tour of how OpenEdu is built, for contributors. The [README](../README.md) covers what it is and how
to use it; [CONTRIBUTING](../CONTRIBUTING.md) covers the dev workflow. This document is the "why it's
shaped this way."

## At a glance

OpenEdu is a **Tauri v2** desktop app: a **React 19 + TypeScript** frontend over a small **Rust** backend,
with **SQLite** for all persistence. It is **local-first and bring-your-own-key** — the tutor runs on a
local [Ollama](https://ollama.com/) model by default, with OpenAI and Anthropic as drop-in alternates.
The guiding constraint is **reliability on small models** (verified on `gemma4:e4b`, ~4B effective params):
everything the model produces is schema-enforced and validated.

## Data & storage

All state lives in **one SQLite database** — no per-course files:

```
%APPDATA%/com.terrabytesolutions.openedu/openedu.db   (Windows)
```

Tables: `courses`, `syllabuses`, `tutor_instructions`, `notes`, `notebook_folders`,
`notebook_documents` / `chunks` / `embeddings`, `chat_messages`, `quiz_questions`, `quiz_attempts`,
`user_progress`. The schema evolves through **append-only versioned migrations** (`tauri-plugin-sql`, in
`src-tauri/`). The plugin hashes each migration's SQL — **never edit a shipped migration**; add a new
version, or move the change into application code. API keys and app settings persist separately via
`@tauri-apps/plugin-store`.

## Repo layout

| Path | What lives there |
|---|---|
| `src/lib/` | The non-UI core (see below). The Tauri-free modules have `*.test.ts` next to them. |
| `src/components/` | Shared widgets (chat, notebook editor + graph, markdown/math/diagram blocks). |
| `src/views/` | Top-level views (Dashboard, CourseView, Settings, full-screen quiz / promotion test). |
| `src/skills/` | Built-in tutor **skill** bundles (`*.md` with frontmatter) — loaded at runtime. |
| `public/library/` | The bundled, offline **Library** (curated K-12 reference cards + assets + `index.json`). |
| `src-tauri/` | Rust backend, SQLite migrations, capabilities, bundler + updater config. |
| `docs/` | This doc + README assets. |

## The core (`src/lib/`)

- **`curriculum.ts`** — the generation pipeline (entry point `runGenerationPipeline`). See below.
- **`llm.ts`** — the provider abstraction (Ollama / OpenAI / Anthropic): streaming chat, schema-enforced
  structured output (`callLLMStructured`), embeddings, model-tier detection, and a preflight probe.
- **`db.ts`** — SQLite CRUD for every table.
- **`knowledge.ts` / `progress.ts`** — persistent per-course knowledge files and subtopic mastery tracking;
  both feed context back into the tutor.
- **`notebook.ts` / `notebook-links.ts`** — the notebook layer (retrieval + linking). See below.
- **`kernel/`, `tools/`, `skills/`, `permissions/`** — the tutoring runtime. See below.
- **`store.ts` / `store-keys.ts` / `models.ts` / `theme.ts` / `settings-schema.ts`** — settings, the model
  catalog, the theme registry, and pure import/export helpers. `store-keys.ts` is the single source of
  truth for setting keys + the secret/import allow-list.

The pure, Tauri-free modules (`store-keys`, `models`, `version`, `text-match`, `settings-schema`,
`theme` helpers, `permissions/presets`, `notebook-links`, …) are unit-tested with Vitest.

## The generation pipeline (`curriculum.ts`)

Every course has **6 levels**: L1–L5 are LLM-generated syllabuses (3–6 subtopics each); **L6 is a mastery
exam assembled directly from the outline with zero LLM calls**. The pipeline is
**research → outline → tutor instructions → six syllabuses**, and the lessons that make it reliable on a
4B model are baked in:

1. **Decompose, don't dump.** Research is five small structured sub-calls, code-assembled into a brief —
   a single free-text dump was unreliable on small models.
2. **Schema-enforced everywhere.** Provider-native enforcement + a local validator + repair-retry.
3. **Auto-detected model tier** (`tiny | small | medium | large`) drives prompt compression, schema
   relaxation, few-shot injection, and per-call timeouts. Matformer models (`gemma3n:e4b` / `gemma4:e4b`)
   get a name-based tier override so they don't mis-tier.
4. **Preflight before pipeline.** A one-shot probe fails fast on incompatible models.
5. **Checkpoint + resume.** `courses.generation_state` is written after each step; a failed run resumes
   from where it stopped (never delete the row on error).
6. **Code-assemble what doesn't need an LLM** (e.g. the L6 exam) for perfect reliability.

## The tutoring runtime (`kernel/`, `tools/`, `skills/`, `permissions/`)

A tutoring turn is owned by the **kernel** (`TutorEngine`): it assembles a layered system prompt, runs the
model, dispatches **tools**, and applies **stop hooks** to decide when the turn ends. Capabilities the
tutor can invoke are **EduTools** (zod-schema'd, modeled on Claude Code's tool shape) — e.g. notebook
search/ingest, math/diagram render, knowledge-map updates, mastery marking, and a mid-turn "ask the user"
tool. Behavior is composed from **skills** (`src/skills/*.md` + user-sideloaded bundles in APPDATA):
markdown files with frontmatter that gate on subject/tier. A per-mode **permission** policy
(allow / ask / deny, with Standard · Cautious · Trusting presets) governs what the tutor may do on its
own; exam mode locks model help.

## Notebook & retrieval (`notebook.ts`, `notebook-links.ts`)

The notebook is an Obsidian-style vault: notes in nested folders, a live-preview CodeMirror editor, and a
force-directed vault graph. **`notebook-links.ts`** is the pure source of truth for `[[wiki link]]` /
`#tag` parsing, link resolution, the tag index, and the graph builder (note / folder / tag nodes). Tags
are **derived from note content** — no DB column. **`notebook.ts`** handles RAG: notes are chunked,
embedded on save, and searched by **brute-force cosine** over the course's vectors (fine for a single
student's vault; vectors are stored as JSON-array TEXT, schema kept `sqlite-vec`-compatible for later).

## Design system

The UI is a **blue-phosphor CRT** aesthetic defined entirely with CSS variables in `src/index.css`
(`--phosphor`, `--ink`, `--rule`, `--panel`, …). Color themes (recolors + clean Dark/Light) live in
`src/lib/theme.ts` and are applied pre-paint in `main.tsx` via `html[data-theme="…"]`. **Use the tokens,
not hardcoded colors**, so everything stays theme-aware. Settings has its own
[architecture README](../src/views/settings/README.md).

## Testing & CI

- `npm test` — Vitest over the pure logic modules (no DOM/Tauri). Add a `*.test.ts` for new pure logic.
- `npm run build` — `tsc` typecheck + Vite bundle.
- CI (`.github/workflows/ci.yml`) runs both on every PR. DOM-coupled UI is verified live in
  `npm run tauri dev`.

## Releases & auto-update

Pushing a `vX.Y.Z` tag triggers `.github/workflows/release.yml`, which builds, **signs**, and publishes a
GitHub Release with the installers and the updater manifest (`latest.json`). Installed apps poll the
latest release and **auto-update**. The release notes (and the in-app update prompt) are extracted from
that version's section in [`CHANGELOG.md`](../CHANGELOG.md) — so keep the changelog current and bump the
version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` together.
