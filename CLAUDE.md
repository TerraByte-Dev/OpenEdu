# OpenEdu

TerraByte's open-source AI tutor for one learner. Tauri v2 + React 19 + TypeScript + SQLite. Bring-your-own-key — runs offline-first on local Ollama, with cloud (OpenAI / Anthropic) as alternates.
Family, class and school features (usage modes, the teacher view, learner groups, the K-1 early-learner
screens, the learning record) are not part of OpenEdu: they live in TerraTutor, a separate commercial
edition by TerraByte Solutions. Don't add them back here.
Smallest model **verified end to end (generation + tutoring)**: `gemma4:e4b`. It behaves like ~4B at
inference (Matformer), but the Ollama tag is **9.6GB on disk** (`ollama list`, Q4_K_M) — size a machine
from the download, not the effective parameter count. (Google publishes a much smaller official QAT
Q4_0 GGUF; that is a different artifact from the Ollama tag, so don't quote one figure for the other.)

Smallest model the **harness** is verified on: `qwen3.5:0.8b`, **1.0GB** — it passes
`preflightStructuredOutput` and tool-calls cleanly, but **only with `think: false`** (see
`OLLAMA_THINK_OFF` in `llm.ts`; without it the model burns its whole window reasoning and returns an
empty string). The plumbing works at 1.0GB; the **tutoring does not hold up**. On the held-out
near-miss questions (`src/lib/eval/results/2026-11-06-heldout-dev.md`) 38 of 54 answers misused a
note or invented a fact. Do not call it verified or recommend it for tutoring.

Best measured fit for an 8 GB machine so far: `gemma4:e2b` (4.6GB): 0 of 54 harmful near-miss answers,
78% of positives (bar: 80%). Same results file.

Anything below is *untested*, not unsupported: the harness is built to degrade. There is no measured
hardware floor — every number in this repo was taken on an RTX 3070 laptop.

The repo is on GitHub under `TerraByte-Dev`.

**Dev:** `npm run tauri dev` from project root.
**Test:** `npm test` (vitest) — fast unit tests over the pure logic modules (no DOM/Tauri). DOM-coupled UI is verified live in the dev app.
**Eval:** `npm run eval` — benchmarks from a terminal against local Ollama, through the real kernel, no Tauri app. Options are `EVAL_*` env vars: [`src/lib/eval/headless/README.md`](src/lib/eval/headless/README.md).

**Outside contributors and their agents: the rules in @AGENTS.md apply to you** (branching, draft PRs, what not to touch).

Full architecture tour: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Contributor workflow: [`CONTRIBUTING.md`](CONTRIBUTING.md). (Local-only scratch notes live under `.dev/`, gitignored — not part of the repo.)

---

## Architecture orientation

- `src/lib/db.ts` — SQLite CRUD for every table the app uses (`courses`, `syllabuses`, `tutor_instructions`, `notes`, `chat_messages`, `quiz_attempts`, `quiz_questions`, `user_progress`, `lessons`, `flashcards`, `learners`). Holds the active learner: course listing, creation and `getCourse` are scoped to it, and nothing reads across learners. Tables from removed features (`app_config`, `learner_groups`, `early_attempts`, `learner_days`, `monthly_records`) stay in the schema, unread; see `docs/ARCHITECTURE.md` › Data & storage for which migration-18 writes the app still makes. `getDb()` switches the file to WAL on open; `checkDatabaseHealth()` (boot `quick_check`) and `backupLearnerData()` (`VACUUM INTO`) sit on the pure `src/lib/db-resilience.ts`. Per-connection PRAGMAs from JS are unreliable (sqlx pool of up to 10, recycled); sqlx already sets `foreign_keys=ON` and `busy_timeout` 5 s on every connection.
- `src/lib/learners.ts` / `learner-pin.ts` — one learner, plus the installs that added several in an earlier version: the picker-visibility rule (one learner with no PIN goes straight in), `needsPin`, `learnerMenuActions` (a former class or school install, read from the old `app_config usage_mode`, offers no delete-yourself and no new PIN), the course-ownership guard, name rules, PBKDF2 PINs. The app never adds a learner and never drops one or their PIN. Pure and tested; `db-learners.test.ts` runs a class-mode database from migration 19 through the launch and picker paths. See `docs/ARCHITECTURE.md` › Data & storage.
- `src/lib/grade.ts` / `speech.ts` — a learner's grade (K-12 or not set, migration 15): the band, the system prompt's reading-level line (none when not set, so the prompt is byte-identical), K-2 text size and auto read-aloud. `speech.ts` turns a reply's markdown/LaTeX into speakable text and picks an on-device voice; `useReadAloud.ts` is the thin `speechSynthesis` shell.
- `src/lib/dictionary.ts` — offline word lookup (#251) over `public/dictionary/`, which `scripts/build-dictionary.mjs` builds from Open English WordNet 2025 (CC BY 4.0, pinned archive hashes). 667 shards by two-letter prefix plus `exceptions.json`; candidates are the word, its irregular bases (went → go) and WordNet's suffix rules, kept only if they're headwords. A form can return several headwords ("saw" → saw, see); choosing between them is left to the caller. Nothing calls a model. The tutor turn reads it through `src/lib/kernel/defineWord.ts`: when the student's newest message asks what a word means, the kernel appends the entry and a short note after the student's text (no model call, system prompt unchanged; `docs/BENCHMARKS.md` lever 18). Before that, a deterministic child-safety filter in the same file (`childSafeSense`, `blockedWord`) leaves out sexual, slur, drug and profanity senses, or the whole note; `src/lib/eval/headless/define-safety.test.ts` sweeps every headword through it and pins the counts. When the message quotes a sentence that contains the word, `src/lib/kernel/senseRank.ts` first orders each headword's senses by word overlap with that sentence (lever 19, simplified Lesk; stored order otherwise, and the request is then byte-identical); the caps and the filter apply after it. The turn result carries the entry exactly as the tutor got it (`dictionaryShown`); `src/lib/dictionary-card.ts` lays it out and `src/components/DictionaryCard.tsx` shows it under the reply (open for grade 3+ and no grade, closed behind "Show the dictionary entry" for K-2), kept in memory for the app session only, never saved or sent. Settings › About carries the WordNet credit (`DICTIONARY_CREDIT`) and shows the shipped licence texts in place (`readLicence`).
- `src/lib/llm.ts` — provider abstraction (Ollama / OpenAI / Anthropic), streaming chat, schema-enforced structured output, tier detection, preflight check.
- `src/lib/curriculum.ts` — the agent harness. Research → outline → tutor instructions → 6 syllabuses. All schema-enforced. Entry point: `runGenerationPipeline`.
- `src/lib/knowledge.ts` — persistent per-course knowledge files (`knowledge_map`, `misconceptions`, `study_log`, `learning_profile`) used as tutor context.
- `src/lib/progress.ts` — subtopic mastery tracking and progress-context generation for the tutor.
- `src/lib/notebook.ts` — notebook RAG (chunk/embed/cosine search) + `importTextAsNote`. `src/lib/notebook-links.ts` — pure `[[wiki link]]` / `#tag` parsing, resolution, tag index, vault-graph builder (note/folder/tag nodes), **backlinks + unlinked mentions, the heading outline, and the `[[` autocomplete prefix matcher**; the source of truth for `NotesTab.tsx` + `MarkdownEditor.tsx`. Tags are content-derived (no DB column); `#tags` are a note-free link primitive (click → filtered tag view, distinct graph node); missing `[[links]]` never auto-create. `src/lib/fuzzy.ts` — subsequence matching for the Ctrl/Cmd+O quick switcher.
- `src/views/settings/` — the Settings view (tabbed left-rail shell + declarative section registry + primitives). See `src/views/settings/README.md`.
- `src/lib/store.ts` / `store-keys.ts` — settings persistence (plugin-store). `store-keys.ts` is the single source of truth for key names + the secret/import-allow-list (also consumed by `settings-io.ts`).
- `src/lib/models.ts` — model catalog + recommended-derived defaults (one source for the Settings pickers AND the store defaults; closes issue #2's drift).
- `src/lib/theme.ts` (+ `useTheme.ts`) — Light / Dark / Match my computer: `applyTheme`, `normalizeThemeChoice` (maps CRT-era stored ids), `resolveTheme`, `watchSystemTheme`; applied pre-paint in `main.tsx`.
- `src/lib/settings-schema.ts` / `settings-io.ts` — pure parse/validate for the settings export/import + the Tauri-side gather/apply. `version.ts` (`compareVersions` for the update check) and `text-match.ts` (search filter) are the other pure helpers.
- `src/views/` — other top-level views. `Home.tsx` is the learner's landing screen (Continue = the most recent course and its next step, a daily goal with today's minutes, course cards); `Dashboard.tsx` is the new-course flow behind its "Start a new course" button; `CourseView`, full-screen quiz / promotion-test. `src/lib/next-step.ts` is the one next-step ranking (shared by Home and the in-course Next step card); `src/lib/daily-goal.ts` the goal/minutes math. Both pure and tested.
- `src/components/` — shared widgets, including `terminal/*` primitives.
- `src-tauri/` — Rust backend, SQLite migrations, plugin config.

The pure modules above (`store-keys`, `learners`, `learner-pin`, `models`, `version`, `text-match`, `settings-schema`, `theme` helpers, `permissions/presets`, `notebook-links`, `fuzzy`, `db-resilience`, `plain-language`, `next-step`, `daily-goal`, `grade`, `speech`, `dictionary`, `dictionary-card`) are Tauri-free and unit-tested in `*.test.ts` next to them.

DB lives at `%APPDATA%/com.terrabytesolutions.openedu/openedu.db` on Windows. No per-course files — everything is in SQL.

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

Verified working end to end on `gemma4:e4b` (local Ollama, ~4B effective at inference). That is the
smallest configuration verified end to end, not a floor anyone established; the harness alone has run
on `qwen3.5:0.8b` (see the top of this file). The lessons that stuck:

1. **Decompose, don't dump.** Research is 5 small structured sub-calls (`subject_overview`, `knowledge_domains`, `progression`, `obstacles`, `prerequisites`) code-assembled into the markdown brief downstream consumers slice. A single free-text dump was unreliable on e4b.

2. **Schema-enforced everywhere.** Provider-native enforcement (Ollama format-schema, OpenAI json_schema strict, Anthropic forced tool_use) + local validator + repair-retry up to 2 times. See `callLLMStructured` in `llm.ts`.

3. **Auto-detected model tier.** `detectModelTier` reads Ollama `/api/show` parameter_size and maps to `tiny | small | medium | large`. Cloud models use a static name map. Tier drives:
   - Prompt compression (research snippet halved, older-levels ledger digest dropped)
   - Schema relaxation (`minLength` / `minItems` halved via `scaleSchemaMinima`)
   - Few-shot examples (worked example injected for outline + topic-list)
   - Per-call timeout (90–180s for Ollama, 45–90s for cloud)

4. **Name override for Matformer models.** `gemma3n:e4b` / `gemma4:e4b` report ~7–8B *actual* params via `/api/show` but behave like 4B at inference. `ollamaNameTierOverride` pattern-matches `e2b` / `e4b` suffixes and forces the correct tier. Without this, e4b mis-tiers as `medium` and hits a tight timeout.

5. **Preflight before pipeline.** Step 0 of course generation is a 1-shot probe (`preflightStructuredOutput`) asking the model to emit `{name, age}` matching a tiny schema. Fails fast on incompatible models so users don't burn 5–20 minutes on a doomed run. A cold Ollama model is loaded before it (and before every structured call and chat turn) by `warmOllamaModel` in `llm.ts`, under its own 5-minute budget, so the probe's 90 s times the answer, not the load (88 s for `gemma4:e2b` on a CPU-only 8 GB box). The app starts that load in the background once setup is ready.

6. **Checkpoint + resume.** `runGenerationPipeline` writes `courses.generation_state` after each step. On failure, the row stays in DB and the Sidebar shows an amber pulse badge — clicking resumes from the failed step. State values: `"researching" | "outlining" | "instructions" | "syllabus_L1".."syllabus_L6" | "completed"`. `null` = legacy or fully complete.

7. **Concept ledger.** Each generated level appends to a per-course ledger (`tutor_instructions[concept_ledger]`). Future levels' prompts include a snapshot so small models know what's already been covered. Tier-aware compaction: tiny/small tier sees only the most recent level, not the last two.

8. **Code-assemble what doesn't need an LLM.** L6 mastery is built directly from the outline. Zero LLM calls = perfect reliability for the final step.

---

## Critical DON'Ts

- **Don't modify a `tauri-plugin-sql` migration that's already shipped.** The plugin hashes each migration's SQL and refuses to re-apply if the text changed (error: "migration X was previously applied but has been modified"). Add a new migration version, or move the change into application code. Migrations 1–5 are now load-bearing.

- **Don't `deleteCourse` on pipeline error.** State is persisted; the user can resume. Only delete on explicit user action.

- **Don't reintroduce 0.5-increment levels.** Integers 1–6 only.

---

## Tauri specifics

- Window is frameless (`decorations: false` in `tauri.conf.json`), background `#FBFAF6` (the light `--bg`). Drag region is `data-tauri-drag-region` on the Titlebar center div.
- Window controls (min / max / close) call `getCurrentWindow()` from `@tauri-apps/api/window`.
- API keys / model config persist via `@tauri-apps/plugin-store`.
- Capabilities in `src-tauri/capabilities/default.json` are `core`, `sql`, `dialog`, `store`, `updater`, `process`,
  and `http` (allow-listed to Ollama on loopback plus OpenAI / Anthropic / Tavily /
  api.github.com). **There is no `fs` and no `shell` capability.** `src-tauri/src/lib.rs` registers six
  `#[tauri::command]`s. The first, `system_memory_bytes` in `system.rs`, returns total physical RAM (or
  null) so `store.ts` can default Ollama to `gemma4:e2b` below 16 GB and `gemma4:e4b` at or above it (threshold in `models.ts`)
  when the user has not picked a model, unless that one is not pulled and the other default is (so an
  upgrade never strands an install on a model it lacks); `navigator.deviceMemory` caps at 8 and cannot
  draw that line. e2b tiers as `tiny`, so `quiz-grading.ts` `runsVerifyPass` keeps the quiz verify pass
  on for both defaults. The other five are offline setup (#275, [`docs/OFFLINE-KIT.md`](docs/OFFLINE-KIT.md)):
  `ollama_installed` and `ollama_installer_pick` in `ollama_setup.rs` (does Ollama's program exist; find its
  installer on a picked stick and show the folder as text, never run or open it), and `model_import_pick`,
  `model_import_start`, `model_import_cancel` in `model_import.rs` (Rust opens the folder picker, scans it
  read-only without entering symlinks/junctions, SHA-256s each file, checks free space, then pushes blobs to
  `http://127.0.0.1:11434` and calls `/api/create`; an import may name only files the scan listed). That
  Rust-side traffic is loopback-only by construction and does not go through the `http` allow-list. Pure
  halves: `src/lib/model-kit.ts`, `src/lib/ollama-guide.ts`. No command writes a file; the webview never
  names a path.
  The Rust side is migrations, six `.plugin()` calls, and those commands. There is no general folder-read
  command (the unused `corpus_*` commands, which trusted any path the webview sent to `corpus_grant`, were
  removed), so the only way a file's content enters is the notebook import (file picker or drag-and-drop),
  filtered to `.md,.markdown,.txt` and read via `File.text()` (`NotesTab.tsx:367,380,605`). Folder access
  for anything archive-shaped should follow `model_import.rs`: Rust opens the picker, the webview never
  names a path.
- Every string inlined with `dangerouslySetInnerHTML` (chat/lesson/resource markdown via
  `renderChatMarkdown`, `MathBlock`'s KaTeX, library card SVGs) goes through `src/lib/sanitize-html.ts`
  (DOMPurify) first. Mermaid SVG is sanitized by Mermaid itself (`securityLevel: "strict"`). On top of
  DOMPurify's defaults it forbids `<style>`, `<form>`, form controls and `<base>`/`<meta>`/`<link>`; the
  only `<input>` allowed is GFM's disabled task-list checkbox. Inline `position` other than
  `relative`/`static` is stripped, so a reply can't lay a fixed/absolute overlay over the app. Nothing
  in the output may load from another host (#284): a `src`/`poster`/`background`, a non-link
  `href`/`xlink:href`, or a CSS `url()` in a style attribute, SVG attribute or card `<style>` that is not
  `data:`, `blob:` or same-origin is removed (the `<style>` whole); `srcset`, `image-set()`, `src()` and
  `@import` always are. `<a href>` stays: that is a navigation, not a load.

---

## Design system

Lives in `src/index.css`. The **Notebook** look: warm paper, navy ink, one blue accent, calm. Two modes,
light (default, the bare `:root`) and dark (`html[data-theme="dark"]`), plus "Match my computer". No
scanlines, glows, blinking carets, uppercase letter-spaced labels or monospace chrome. The variable names
are CRT-era (`--phosphor` = accent) and are kept so components didn't change; a later PR renames them.

| CSS var | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FBFAF6` | `#0E1626` | Page background |
| `--panel` | `#FFFFFF` | `#16213A` | Cards, header bars |
| `--panel-lite` | `#F3F0E8` | `#1A2742` | Hover rows, subtle fills |
| `--panel-tint` | `#EEF3FB` | `#1B2A47` | Secondary tinted card |
| `--lcd` | `#F4F6FA` | `#0B1220` | Code blocks, readouts |
| `--rule` / `--rule-dim` | `#E8E4DA` / `#F0ECE3` | `#24324F` / `#1F2B44` | Borders |
| `--rule-strong` | `#C9D3E6` | `#2A3A5C` | Input and button outlines |
| `--ink` / `--ink-em` | `#1B2440` / `#0F1730` | `#E6ECF5` / `#FFFFFF` | Body text / emphasis |
| `--ink-dim` / `--ink-faint` | `#3D465E` / `#5E6577` | `#C3CEDD` / `#A3B1C6` | Secondary text / captions (all ≥ 4.5:1; don't add lighter greys) |
| `--phosphor` | `#1E3A8A` | `#5B9BFF` | Accent: links, primary buttons, active state |
| `--phosphor-bright` | `#172C6B` | `#7FB0FF` | Accent hover / pressed |
| `--phosphor-dim` | `#E4EBF8` | `#1F2D4B` | Accent tint: selected nav pill, progress track |
| `--on-accent` | `#FFFFFF` | `#0B1220` | Text on a filled accent or filled status colour |
| `--danger` / `--danger-tint` | `#B42318` / `#FDECEA` | `#FF8A80` / `#3A1F26` | Errors, destructive actions |
| `--success` / `--success-tint` | `#146C43` / `#E3F5EC` | `#6FD6A0` / `#15332A` | Correct, done, connected |
| `--warning` / `--warning-tint` | `#8A4B00` / `#FDF0DD` | `#F5C26B` / `#3A2E17` | Caution, partial, health notices |

Status colours are Tailwind colours too (`text-danger`, `bg-success-tint`, `border-warning/30`). Don't use
Tailwind's `red-*`/`emerald-*`/`amber-*` shades: they were tuned for a black screen and fail contrast on
paper. Canvas and Mermaid can't read CSS vars, so `NotesTab` (graph) and `MermaidBlock` carry per-mode hex
copies of these tokens; change them together.

Shape: cards 20px radius (`--radius-card`), inputs and small surfaces 12px (`--radius-control`), buttons
are 44px-tall pills, 1px `--rule` borders, `--shadow-soft` at most. Key classes: `.window`, `.btn`,
`.btn-primary`, `.cf-input`, `.lcd`, `.tag`, `.glow-line` (a short accent bar now), `.readout-val`,
`.note-prose`.

Fonts: Lexend for display, body and UI chrome (chosen for reading comprehension; variable weight).
`--font-mono` is the CRT-era name for the chrome font and resolves to Lexend too, so the `font-mono`
utility is NOT monospace. Code uses `--font-lcd` (IBM Plex Mono): the `font-lcd` utility, `code`/`pre`
inside `.lcd`, and `.note-prose code`/`pre`. Inter is the sans fallback. Learner-facing copy is plain
English (`src/lib/plain-language.ts` turns pipeline/tool ids into sentences); status and body text is 14 px
or larger; a `:focus-visible` ring is global (`index.css`). The app chrome is OpenEdu's alone; TerraByte
appears only in the Settings › About credit.

A browsable version of the same system lives in `design/` — `npm run design` builds self-contained HTML
cards that get pushed to Claude Design, which then generates new work using these colours, type, and
components. `design/authored/` is committed; `design/dist/` is generated and gitignored.

Two traps this codebase has already hit, both documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md):
**derived tokens don't re-resolve** when `data-theme` is scoped to a descendant instead of `<html>`, and
**Tailwind utilities lose to unlayered CSS**, so `class="btn-primary text-white"` renders the accent
rather than white.
