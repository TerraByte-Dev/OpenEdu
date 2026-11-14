# Architecture

A tour of how OpenEdu is built, for contributors. The [README](../README.md) covers what it is and how
to use it; [CONTRIBUTING](../CONTRIBUTING.md) covers the dev workflow. This document is the "why it's
shaped this way."

## At a glance

OpenEdu is a **Tauri v2** desktop app: a **React 19 + TypeScript** frontend over a small **Rust** backend,
with **SQLite** for all persistence. It is **local-first and bring-your-own-key** — the tutor runs on a
local [Ollama](https://ollama.com/) model by default, with OpenAI and Anthropic as drop-in alternates.
The guiding constraint is **reliability on small models**. The smallest one verified end to end
(generation + tutoring) is `gemma4:e4b` (~4B effective at inference, 9.6GB on disk). The harness also
runs on `qwen3.5:0.8b` (1.0GB, with `think: false`), but its tutoring failed the held-out RAG eval
(`src/lib/eval/results/2026-11-06-heldout-dev.md`); smaller
models are untested rather than ruled out, and no hardware floor has been measured. Everything follows
from that constraint: everything the model produces is schema-enforced and validated.

## Data & storage

All state lives in **one SQLite database** — no per-course files:

```
%APPDATA%/com.terrabytesolutions.openedu/openedu.db   (Windows)
```

Tables: `courses`, `syllabuses`, `tutor_instructions`, `notes`, `notebook_folders`,
`notebook_documents` / `chunks` / `embeddings`, `chat_messages`, `quiz_questions`, `quiz_attempts`,
`user_progress`, `lessons`, `flashcards`, `learners`, and the tables kept from removed features (below). The schema evolves through **append-only versioned migrations** (`tauri-plugin-sql`, in
`src-tauri/`). The plugin hashes each migration's SQL — **never edit a shipped migration**; add a new
version, or move the change into application code. API keys and app settings persist separately via
`@tauri-apps/plugin-store`.

**Power loss.** `getDb()` switches the file to WAL on open (`PRAGMA journal_mode=WAL`; the mode is stored
in the file, so it covers every pooled connection). Other connection settings come from sqlx on every
connection: `foreign_keys=ON`, `busy_timeout` 5 s, and `synchronous` left at SQLite's default, FULL, which
keeps each commit durable in WAL mode. Per-connection PRAGMAs sent from JS are not reliable: the plugin's
sqlx pool holds up to 10 connections and recycles them. At boot `checkDatabaseHealth()` runs
`PRAGMA quick_check` and the app shows a plain-words warning if it reports damage. **Settings → Learner
data** writes a full copy with `VACUUM INTO` through the sql plugin (no `fs` capability) and explains how to
restore it by hand. The logic is in `src/lib/db-resilience.ts` (pure, tested).

**One learner (migration 13).** OpenEdu is a solo-learner app. Each course carries a `learner_id`, and
every other table hangs off `courses(id)`, so scoping courses scopes everything. `db.ts` holds the active
learner: `getCourses` lists only that learner's courses, `createCourse` stamps them, and `getCourse`
refuses another learner's course (the guard is `canAccessCourse` in `learners.ts`). Migration 13 creates
one default learner and gives it every existing course; one learner with no PIN means no picker, so a new
install, and any install that never added a learner, opens straight into that learner. The app never
adds a learner. Store keys that remember one learner (the tour flag, the daily goal, read-aloud) go
through `learnerStoreKey` in `store-keys.ts`; the default learner keeps the bare key.

**Installs with several learners.** Earlier versions could add learners (learner profiles, then a class
or school mode with a teacher PIN). Those installs keep every learner and every course. At launch
`App.tsx` runs `learners.ts autoPickLearner`: one learner with no PIN goes straight in; anything else
shows the picker (`LearnerPicker.tsx`), which lists every learner whatever their old group, and a learner
with a PIN (`needsPin`) is entered only after `PinScreen` verifies it (PBKDF2-SHA256, `learner-pin.ts`).
That keeps learners out of each other's courses; it does not protect the database file. The titlebar
chip opens the signed-in learner's menu; `learners.ts learnerMenuActions` decides what it offers. Every
learner can switch, rename themselves, and change or remove a PIN they already have (typing it first).
Adding a first PIN and deleting yourself (while another learner is left, so a family install can come
down to one learner and then opens like any solo install) are offered only where the old
`app_config usage_mode` is not `class` or `school`: there a teacher set the learners up and nobody can
undo either any more. `db.ts getLegacyUsageMode` reads that row and nothing writes or deletes it. A
forgotten learner PIN cannot be cleared inside OpenEdu: that learner's courses stay in the file and in
every backup but can't be opened in OpenEdu (PIN resets are a TerraTutor feature).
`db-learners.test.ts` runs a class-mode database from migration 19 through these paths: every course
reachable, the PIN learner only with their PIN, the old teacher PIN opening nobody, no learner offered
delete or a new PIN (a Just me install still is), and no row changed but `last_active_at`. A data file
with no learner at all (only by hand) shows an explanation and the restore steps instead of an empty
picker. If the learner list cannot be read at launch, a
full screen says so and shows the restore steps.

**Grade (migration 15).** Each learner has `learners.grade`: 0 for kindergarten, 1-12, or NULL for not
set (every learner from before it). It is set in Settings › Name & grade for the signed-in learner, beside their name. That section
has no PIN control: a solo learner has nobody to keep out, and no reset exists. `grade.ts`
decides everything from the band (K-2, 3-5, 6-8, 9-12) in code:
`readingLevelLayer` is one `## Reading level` section that `buildSystemPrompt` puts just before the output
rules, and it is nothing when no grade is set, so that prompt is byte-identical to the one before grades
(`kernel/systemPrompt-master.test.ts` pins it against a fixture). K-2 learners get larger chat text
(`.chat-text-large` in `index.css`) and replies that read themselves aloud, a per-learner store choice
that defaults to on. Every tutor reply has a speaker button: `speech.ts` turns the saved markdown into
plain words (the same marked + math tokenizer the chat renders with; LaTeX read as words, a code block as
"Code") and picks an on-device voice, and `useReadAloud.ts` plays it through `speechSynthesis`, one reply
at a time, so it works offline with the Windows voices.

**Tables kept from removed features.** The family, class and school features (usage modes, the teacher
view and its CSV, learner groups, the K-1 early-learner screens and the learning record) now live only
in TerraTutor, a separate commercial edition by TerraByte Solutions. Their migrations stay exactly as
shipped, and so do their tables and rows: `app_config` (`usage_mode`, the teacher PIN,
`record_capture_since`, `record_saved_through`), `learner_groups` and `learners.group_id` (14),
`early_attempts` (16-17), `learner_days`, `learners.record_voice` / `record_year_start` and
`courses.subject` (18) and `monthly_records` (19). OpenEdu no longer reads or writes them, except that
deleting a learner still removes their rows (ON DELETE CASCADE). Migration 18's other columns ride on
what the learner does, so OpenEdu keeps writing them: `quiz_questions.graded_by` (also read by the
review pool and the accuracy heatmap, which leave out a timed-out test's unanswered questions),
`quiz_attempts.passed` / `review_score`, `flashcard_reviews`, `subtopic_events` and `notes.origin`. Each
is one insert or one more column beside a write the app makes anyway, and it keeps a learner's history
complete if they later take their data elsewhere. Counted active minutes (`learner_days`) are no longer
written: they came from a once-a-minute timer whose only reader was the learning record.

## Repo layout

| Path | What lives there |
|---|---|
| `src/lib/` | The non-UI core (see below). The Tauri-free modules have `*.test.ts` next to them. |
| `src/components/` | Shared widgets (chat, notebook editor + graph, markdown/math/diagram blocks). |
| `src/views/` | Top-level views (Home, the learner's landing screen; Dashboard, the new-course flow behind its "Start a new course" button; CourseView; Settings; full-screen quiz / promotion test). |
| `src/skills/` | Built-in tutor **skill** bundles (`*.md` with frontmatter) — loaded at runtime. |
| `public/library/` | The bundled, offline **Library** (curated K-12 reference cards + assets + `index.json`). |
| `src-tauri/` | Rust backend, SQLite migrations, capabilities, bundler + updater config. |
| `docs/` | This doc + README assets. |

## The core (`src/lib/`)

- **`curriculum.ts`** — the generation pipeline (entry point `runGenerationPipeline`). See below.
- **`llm.ts`** — the provider abstraction (Ollama / OpenAI / Anthropic): streaming chat, schema-enforced
  structured output (`callLLMStructured`), embeddings, model-tier detection, and a preflight probe.
- **`db.ts`** — SQLite CRUD for every table, plus the WAL switch, boot health check and backup.
  `db-resilience.ts` holds their pure logic.
- **`knowledge.ts` / `progress.ts`** — persistent per-course knowledge files and subtopic mastery tracking;
  both feed context back into the tutor.
- **`quiz.ts` / `quiz-grading.ts` / `quiz-review.ts`** — quiz & promotion-test generation (schema-enforced,
  topped up to a target count, with answer↔explanation self-consistency checks that also read clock
  times, money and fractions, rejection of explanations that correct themselves and of repeated options,
  near-duplicate dedupe, letter references in explanations renamed after the option shuffle, and an
  independent verify pass on capable tiers) and the end-of-test batched grader (deterministic match first,
  one model call for the rest). The `-grading` / `-review` helpers are pure and unit-tested.
- **`notebook.ts` / `notebook-links.ts`** — the notebook layer (retrieval + linking). See below.
- **`kernel/`, `tools/`, `skills/`, `permissions/`** — the tutoring runtime. See below.
- **`store.ts` / `store-keys.ts` / `models.ts` / `theme.ts` / `settings-schema.ts`** — settings, the model
  catalog, the Light / Dark / Match my computer switch, and pure import/export helpers. `store-keys.ts` is the single source of
  truth for setting keys + the secret/import allow-list.

The pure, Tauri-free modules (`store-keys`, `models`, `version`, `text-match`, `settings-schema`,
`theme` helpers, `permissions/presets`, `notebook-links`, `quiz-grading`, `quiz-review`, `mastery`, …) are
unit-tested with Vitest.

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
tool. Behavior is composed from **skills** (`src/skills/*.md`; user-sideloaded bundles are not implemented yet):
markdown files with frontmatter that gate on subject/tier. A per-tool **permission** policy
(allow / ask / deny, with Standard · Cautious · Trusting presets) governs what the tutor may do on its
own.

When Ollama cannot parse a tool call the model wrote, it fails the whole request (HTTP 500, or an error
line in the stream). If nothing from that model call had reached the student yet, the kernel answers that turn with one call
that offers no tools and drops the tools manifest from the system prompt, and records it in the turn
result (`toolCallRecovery`). Any other provider error fails the turn as before.

Two write actions do not wait for the model to choose a tool, because small models rarely do (on
`gemma4:e2b`, `flashcard.create` 0/20 and `ask_user.question` 2/20 in TerraTutor's B9 readiness run):
- **A flashcard the student asks for** (`kernel/flashcardRequest.ts`). Code decides the message asks for
  one card (a request verb and a singular "flashcard" in one sentence, with no negation before the verb,
  no question opener such as what/how/"can you show", and no "for each"/"all of"). Unless the permission
  rules deny `flashcard.create` (then nothing runs), a "Making a flashcard…" chip shows and one
  structured, validated call writes the two sides from the request and the tutor's last message (no
  repair attempt, 45 s deadline). The card goes through `flashcard.create`'s own dispatch (permission
  rules, the confirm card, the "Card minted" chip), in any mode; the reply call gets a note saying it is
  saved and is not offered the tool again that turn. The call shows in `toolCalls` with `byApp: true`;
  the eval runners count only the model's calls (`kernel/modelToolCalls.ts`), and the tool goldens turn
  the stage off (`flashcardStage: "off"`). A failed or timed-out card call clears the chip and leaves the
  request as it was. Cost: on Ollama the card call is its own short prompt, not a continuation of the
  turn's prefix, so on a card turn the reply misses the prefix cache and re-prefills the system prompt
  and tools manifest once.
- **Choices written as a list** (`kernel/replyChoices.ts`). A completed reply that made no
  `ask_user.question` call and ends with a short numbered or lettered list next to a question that asks
  for one pick (which / choose / pick, and not order, two of, all, each, why, explain, notice, another)
  carries those choices in `replyChoices`. Labels with LaTeX, a blank (`__`) or a trailing `=` don't
  count; a lettered list needs its question before it. Anything in doubt gets no buttons. The chat shows
  them as the ask_user buttons, with only the stuck chips and "Review due cards" beside them
  (`chipsBesideChoices`), and a pick is sent as the student's next message. The reply text is unchanged.

Mastery is not one of them: it is decided in code from quiz and promotion-test results
(`updateSubtopicMastery`, ≥ 90% per subtopic). `progress.mark_mastered` is a secondary path, and a
model's praise alone never marks anything.

A model can also write a tool call as plain reply text that Ollama never parses (gemma4:e2b writes
`progress.mark_mastered{status:<|"|>mastered<|"|>,...}<tool_call|>` without its opening frame). Every
model call's text goes through `ReplyTextFilter` (`kernel/textToolCalls.ts`) before the student sees it
or it is saved: text that could still become such a call is held back mid-stream, a complete one is
removed, and gemma4's own control tokens are dropped (look-alikes such as `<|y|` are kept). Nothing
inside an open code fence is read as a call. A call that does not close (1,500 characters outside its
strings, 20,000 in all, a blank line outside a string, or the end of the stream) is given up on. Text
inside one of its strings is never shown: an unclosed `<|"|>` string is removed to the end of the
stream (unless, after the last `<|"|>`, a `}` is followed by a blank line or `<tool_call|>`: one stray
quote token, and the call ends there), an unclosed `"` string to the blank line that ends it. Otherwise only the call's first line is
removed and the rest is shown. Some calls then run, dispatched exactly like a
native call (zod validation, the permission gate, the result back to the model, `fromText: true` in the
turn's `toolCalls`), and the text after them is not shown. Which ones: the tool must be offered this
turn; `progress.mark_mastered` never runs from text (quiz and test scores decide mastery); a tool that
writes runs only when gemma4's own `<|tool_call>` or `<tool_call|>` token frames it, since bare
`name{...}` text can be an echoed note; a read-only tool may run from bare text. Every other call is
only removed. Saved replies are shown through the same filter (`displayReplyText`), so a reply saved
before it existed shows clean too.
A turn that ends with nothing to show and ran no tool (the model wrote nothing, or only a call the
filter removed) is never left blank: the kernel shows and saves `MIXED_UP_REPLY` from
`plain-language.ts` ("Sorry, I got mixed up. Can you ask that again?"). A turn the student stopped, or
one that stalled, keeps its own handling.

In the chat, a ```` ```mermaid ```` fence in a reply is drawn by the same `MermaidBlock` a
`diagram.render` result uses (`mermaid-source.ts`), and read aloud as "A drawing". Source Mermaid cannot
parse is retried with its node labels quoted inside their shapes (a circle stays a circle); if that
fails too, the child sees a plain sentence and the diagram's labels, never the source.

## Notebook & retrieval (`notebook.ts`, `notebook-links.ts`)

The notebook is an Obsidian-style vault: notes in nested folders, a live-preview CodeMirror editor, and a
force-directed vault graph. **`notebook-links.ts`** is the pure source of truth for `[[wiki link]]` /
`#tag` parsing, link resolution, the tag index, and the graph builder (note / folder / tag nodes). Tags
are **derived from note content** — no DB column. **`notebook.ts`** handles RAG: notes are chunked,
embedded on save, and searched by **brute-force cosine** over the course's vectors (fine for a single
student's vault; vectors are stored as base64 f32 TEXT in `vec_b64`, with pre-migration-12 rows read back
from JSON-array TEXT, schema kept `sqlite-vec`-compatible for later).

Linking is bidirectional. `buildBacklinkIndex` maps a note to everything holding a `[[link]]` that
resolves to it, with the surrounding line as context; `findUnlinkedMentions` finds notes that say the
title in prose without linking it. **These two are reported separately and must stay that way** — a
linked mention is a fact about the vault, an unlinked one is only a suggestion, and merging the counts
would assert a relationship that doesn't exist. Unlinked matching is deliberately conservative
(whole-word, titles under 3 characters skipped) because a suggestion that fires constantly is worse than
one that never fires.

`extractOutline` gives the heading tree, skipping fenced code blocks. `wikiLinkPrefix` backs the `[[`
autocomplete and lives here rather than in the editor so the matching rule is testable without a
CodeMirror instance. `NotesTab` renders outline + both mention kinds in a toggleable right rail;
`lib/fuzzy.ts` powers the Ctrl/Cmd+O quick switcher with subsequence (not edit-distance) matching.

Two invariants worth not breaking:

- **`WIKI_LINK_RE` must exclude newlines.** Without that, one stray unclosed `[[` swallows everything up
  to the next `]]` later in the document, inventing a link whose title spans paragraphs — which then
  becomes a real edge in the graph and a row in backlinks.
- **A missing `[[link]]` never auto-creates.** It renders dashed, and creating is an explicit action.
  Autocomplete offers existing titles only, and the quick switcher can't create at all.

## Design system

The UI is the **Notebook** look (warm paper, navy ink, one blue accent, Lexend throughout) defined
entirely with CSS variables in `src/index.css`. The variable names are still the CRT-era ones
(`--phosphor` is the accent, `--ink` body text, `--rule`, `--panel`, …) so components didn't need edits;
renaming them is a later change. Two modes: light is the bare `:root`, dark is `html[data-theme="dark"]`.
`src/lib/theme.ts` stores the user's choice (Light / Dark / Match my computer, which follows
`prefers-color-scheme` live) and applies it pre-paint in `main.tsx`. CRT-era theme ids still sitting in
localStorage or in exported settings files are mapped by `normalizeThemeChoice`: unset, `openedu` or
anything unknown → light; every recolor (`amber`, `synthwave`, …) → dark. The CRT overlay and the
"CRT off" preference are gone. **Use the tokens, not hardcoded colors**, so everything works in both
modes. Settings has its own [architecture README](../src/views/settings/README.md).

`design/` holds a browsable version of the same system, built by `npm run design` into self-contained
HTML cards and pushed to Claude Design, which then generates new work using these colours, type, and
components. `design/authored/` is committed source; `design/dist/` is generated and gitignored. The
generator inlines `index.css` verbatim rather than parsing it for values, so a parse bug produces a
wrong label beside a correct swatch instead of a wrong design.

Two things to know if you touch it:

- **`data-theme` on a descendant is not the same as on `<html>`.** Derived tokens (`--rule`,
  `--ink-dim`, `--phosphor-faint`) are declared on `:root`, so their `var()` resolves there and is
  inherited already-computed. The app never hits this because `data-theme` lives on `<html>` — the same
  element as `:root` — but any preview that scopes a theme to a `<div>` must re-emit the derived tokens.
- **Tailwind utilities lose to unlayered CSS.** `.btn-primary` in `index.css` is unlayered; utilities
  live in `@layer utilities`. So `class="btn-primary text-white"` renders the accent, not white. This
  bit us once — 24 `text-white` classes that had never done anything.

## Testing & CI

- `npm test` — Vitest over the pure logic modules (no DOM/Tauri). Add a `*.test.ts` for new pure logic.
- `npm run build` — `tsc` typecheck + Vite bundle.
- CI (`.github/workflows/ci.yml`) runs both on every PR **regardless of what it targets** — PRs here are
  commonly stacked, and filtering on the base branch would leave every PR above the bottom of a stack
  unchecked. DOM-coupled UI is verified live in `npm run tauri dev`.

## Releases & updates

Pushing a `vX.Y.Z` tag triggers `.github/workflows/release.yml`, which builds, **signs**, and publishes a
GitHub Release with the installers and the updater manifest (`latest.json`). Installed apps update **only
when the user presses Check for updates** in Settings → About — offline-first means no check at launch.
The release notes (shown beside that button) are extracted from that version's section in
[`CHANGELOG.md`](../CHANGELOG.md) — so keep the changelog current and bump the version in `package.json`,
`src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` together.
