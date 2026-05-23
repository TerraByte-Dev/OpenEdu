# OpenEdu

TerraByte's AI-powered tutoring app. Tauri v2 + React 19 + TypeScript + SQLite. Bring-your-own-key — runs offline-first on local Ollama, with cloud (OpenAI / Anthropic) as alternates. Target floor model: `gemma4:e4b` (~4B effective params).

The repo is on GitHub under `TerraByte-Dev`.

**Dev:** `npm run tauri dev` from project root.

For current work-in-progress, see `HANDOFF.md`.

---

## Architecture orientation

- `src/lib/db.ts` — SQLite CRUD for every table (`courses`, `syllabuses`, `tutor_instructions`, `notes`, `chat_messages`, `quiz_attempts`, `quiz_questions`, `user_progress`).
- `src/lib/llm.ts` — provider abstraction (Ollama / OpenAI / Anthropic), streaming chat, schema-enforced structured output, tier detection, preflight check.
- `src/lib/curriculum.ts` — the agent harness. Research → outline → tutor instructions → 6 syllabuses. All schema-enforced. Entry point: `runGenerationPipeline`.
- `src/lib/knowledge.ts` — persistent per-course knowledge files (`knowledge_map`, `misconceptions`, `study_log`, `learning_profile`) used as tutor context.
- `src/lib/progress.ts` — subtopic mastery tracking and progress-context generation for the tutor.
- `src/views/` — top-level views (Dashboard, CourseView, Settings, full-screen quiz / promotion-test).
- `src/components/` — shared widgets, including `terminal/*` primitives.
- `src-tauri/` — Rust backend, SQLite migrations, plugin config.

DB lives at `%APPDATA%/com.terrabyte.openedu/openedu.db` on Windows. No per-course files — everything is in SQL.

---

## Curriculum architecture

Every course has **6 levels**:
- **L1–L5**: learning levels (LLM-generated syllabuses, each with 3–6 subtopics)
- **L6**: mastery exam (code-assembled from the outline's `mastery_exam` field — zero LLM calls)

Level values are integers. The earlier 0.5-increment scheme (0.0, 0.5, 1.0…5.0) is fully removed; legacy course rows with fractional `current_level` still exist but can't progress under the new promotion logic — they're effectively view-only.

Each L1–L5 syllabus is a two-stage generation:
1. **Topic list** — one structured call returns subtopic titles + level metadata
2. **Per-subtopic expansion** — one structured call per subtopic returns concepts + practice type

---

## The agent harness — what makes generation reliable

Verified working on `gemma4:e4b` (local Ollama, ~4B effective). The lessons that stuck:

1. **Decompose, don't dump.** Research is 5 small structured sub-calls (`subject_overview`, `knowledge_domains`, `progression`, `obstacles`, `prerequisites`) code-assembled into the markdown brief downstream consumers slice. A single free-text dump was unreliable on e4b.

2. **Schema-enforced everywhere.** Provider-native enforcement (Ollama format-schema, OpenAI json_schema strict, Anthropic forced tool_use) + local validator + repair-retry up to 2 times. See `callLLMStructured` in `llm.ts`.

3. **Auto-detected model tier.** `detectModelTier` reads Ollama `/api/show` parameter_size and maps to `tiny | small | medium | large`. Cloud models use a static name map. Tier drives:
   - Prompt compression (research snippet halved, older-levels ledger digest dropped)
   - Schema relaxation (`minLength` / `minItems` halved via `scaleSchemaMinima`)
   - Few-shot examples (worked example injected for outline + topic-list)
   - Per-call timeout (90–180s for Ollama, 45–90s for cloud)

4. **Name override for Matformer models.** `gemma3n:e4b` / `gemma4:e4b` report ~7–8B *actual* params via `/api/show` but behave like 4B at inference. `ollamaNameTierOverride` pattern-matches `e2b` / `e4b` suffixes and forces the correct tier. Without this, e4b mis-tiers as `medium` and hits a tight timeout.

5. **Preflight before pipeline.** Step 0 of course generation is a 1-shot probe (`preflightStructuredOutput`) asking the model to emit `{name, age}` matching a tiny schema. Fails fast on incompatible models so users don't burn 5–20 minutes on a doomed run.

6. **Checkpoint + resume.** `runGenerationPipeline` writes `courses.generation_state` after each step. On failure, the row stays in DB and the Sidebar shows an amber pulse badge — clicking resumes from the failed step. State values: `"researching" | "outlining" | "instructions" | "syllabus_L1".."syllabus_L6" | "completed"`. `null` = legacy or fully complete.

7. **Concept ledger.** Each generated level appends to a per-course ledger (`tutor_instructions[concept_ledger]`). Future levels' prompts include a snapshot so small models know what's already been covered. Tier-aware compaction: tiny/small tier sees only the most recent level, not the last two.

8. **Code-assemble what doesn't need an LLM.** L6 mastery is built directly from the outline. Zero LLM calls = perfect reliability for the final step.

---

## Critical DON'Ts

- **Don't modify a `tauri-plugin-sql` migration that's already shipped.** The plugin hashes each migration's SQL and refuses to re-apply if the text changed (error: "migration X was previously applied but has been modified"). Add a new migration version, or move the change into application code. Migrations 1–5 are now load-bearing.

- **Don't `deleteCourse` on pipeline error.** State is persisted; the user can resume. Only delete on explicit user action.

- **Don't reintroduce 0.5-increment levels.** Integers 1–6 only.

- **Don't run builds while the user is away.** No `npm run tauri dev` / `cargo build` runs when the user is stepping out — wait for them to be at the keyboard.

---

## Tauri specifics

- Window is frameless (`decorations: false` in `tauri.conf.json`), background `#000000`. Drag region is `data-tauri-drag-region` on the Titlebar center div.
- Window controls (min / max / close) call `getCurrentWindow()` from `@tauri-apps/api/window`.
- API keys / model config persist via `@tauri-apps/plugin-store`.
- Capabilities in `src-tauri/capabilities/default.json` include `http`, `shell` (for Ollama), `fs`, `store`, `sql`.

---

## Design system

Lives in `src/index.css`. Blue phosphor CRT aesthetic.

| CSS var | Use |
|---|---|
| `--phosphor` (`#00C6FF`) | Primary accent, glows, active elements |
| `--phosphor-bright` (`#44D8FF`) | Highlights, hover text |
| `--phosphor-ink` (`#6DD4EE`) | Body text, labels |
| `--bg` (`#000000`) | Page background |
| `--panel` (`#020409`) | Sidebar, header bars |
| `--panel-lite` (`#040709`) | Card surfaces, hover rows |
| `--lcd` (`#020508`) | Code blocks, LCD readouts |
| `--rule` | All borders |

Key classes: `.window`, `.btn`, `.btn-primary`, `.cf-input`, `.lcd`, `.tag`, `.glow-line`, `.readout-val`, `.phosphor-glow`, `.crt-aberrate`.

Fonts: VT323 (display headings), IBM Plex Mono (UI), Share Tech Mono (LCD / inputs), Inter (prose body).
