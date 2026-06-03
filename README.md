<p align="center">
  <img src="docs/assets/terrabyte-logo.png" alt="TerraByte Solutions" width="120" />
</p>

<h1 align="center">OpenEdu</h1>

<p align="center">
  <strong>An AI tutor that runs on your machine.</strong><br/>
  Bring-your-own-key, offline-first personalized learning — local on Ollama, with OpenAI / Anthropic as alternates.
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#features">Features</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#development">Development</a> ·
  <a href="LICENSE">License</a>
</p>

---

OpenEdu generates a focused, 6-level curriculum for **any** topic, then tutors you through it — chat, quizzes,
a notebook with retrieval, and promotion tests — entirely on a local model if you want. It's built to be
**reliable on small models** (verified on `gemma4:e4b`, ~4B effective params) and to work with **no account
and no network**: your data lives in a local SQLite database, and the only outbound calls are to the model
provider you choose.

> Desktop app: **Tauri v2 + React 19 + TypeScript + SQLite**.

## Features

- **Generate a course for anything** — a research → outline → tutor-instructions → 6 syllabuses pipeline, fully schema-enforced so it holds up on tiny local models.
- **Bring your own key, or none** — runs free on local **Ollama**; OpenAI and Anthropic are drop-in alternates. Separate model choices for generation vs. chat vs. embeddings.
- **Offline curated Library** — a 150+ card K-12 reference set (periodic table, formulas, definitions, maps…) bundled in the app; the tutor can cite it mid-lesson with zero network.
- **Notebook with retrieval** — an Obsidian-style vault with a live-preview editor; documents are embedded locally so the tutor can search and cite your notes.
- **Quizzes & promotion tests** — per-level practice plus a code-assembled mastery exam.
- **Tutor permissions** — a per-mode allow / ask / deny policy (Standard · Cautious · Trusting presets) governing what the tutor may do on its own; exam mode locks model help.
- **Themes** — a CRT "blue phosphor" aesthetic with recolors (Amber, Green, Crimson, Synthwave, Ultraviolet…) plus clean **Dark / Light** themes — all CSS-variable driven.

## Quickstart

**Prerequisites**

- [Node.js](https://nodejs.org/) 20.19+ or 22.12+
- [Rust](https://www.rust-lang.org/tools/install) + the [Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS
- (For the free local path) [Ollama](https://ollama.com/) with a model pulled, e.g. `ollama run llama3`

**Run**

```bash
git clone https://github.com/TerraByte-Dev/OpenEdu.git
cd OpenEdu
npm install
npm run tauri dev      # launches the desktop app
```

On first run, open **Settings** (the gear) to pick your provider/model. With Ollama running locally you're
ready to generate your first course — no key required.

## Development

```bash
npm run tauri dev      # dev app with HMR
npm test               # unit tests (vitest)
npm run build          # typecheck (tsc) + frontend bundle (vite)
```

CI runs typecheck + tests + build on every pull request (`.github/workflows/ci.yml`).

## Architecture

The data lives entirely in SQLite (`%APPDATA%/com.terrabyte.openedu/openedu.db` on Windows) — no per-course
files. A few orientation points:

- `src/lib/curriculum.ts` — the generation agent harness (`runGenerationPipeline`).
- `src/lib/llm.ts` — provider abstraction, streaming, schema-enforced structured output, model-tier detection.
- `src/lib/db.ts` — SQLite CRUD; `src-tauri/` — Rust backend + migrations.
- `src/views/settings/` — the themed Settings system ([its README](src/views/settings/README.md)).

Deeper notes: [`CLAUDE.md`](CLAUDE.md) (dev guide), [`V2_ARCHITECTURE.md`](V2_ARCHITECTURE.md), and
[`docs/dev/`](docs/dev/) (development handoffs).

## License

[MIT](LICENSE) © TerraByte Solutions LLC.

<p align="center"><sub>Built by <strong>TerraByte Solutions LLC</strong></sub></p>
