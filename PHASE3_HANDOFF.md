# Phase 3 Handoff — Notebook 2.0: an Obsidian-like vault + RAG retrieval

**Written:** 2026-05-24 · **For:** the next session, which will **plan Phase 3** (start in plan mode).
**Status going in:** Phases 0–2 shipped and merged to `master`. Phase 2 (skills + permission layer + `assess`)
landed via PR #10 (`070f174`); `__runEvals()` = 6/7 on `gemma4:e4b`.

> Planning brief, not a spec. Read the canonical docs, then plan. Line numbers are from 2026-05-24 — verify before relying on them.

---

## Read first (in order)

1. **This file.**
2. `V2_ARCHITECTURE.md` — §6.3 (Notebook 2.0 — RAG layer), §9 Phase 3, §3 (EduTool contract — the two new tools), §11.2 (embedding-model floor open question).
3. `CLAUDE.md` — invariants and DON'Ts (esp. the migration rule).
4. Memory: `openedu_v2_harness_migration`, `project_openedu_vision`, `openedu_premade_tutors_vision` (and `MEMORY.md`).

---

## The framing — "our own version of Obsidian," wired into the tutor

Tate's steer for Phase 3: make the Notebook **our own version of Obsidian**. Crucially, **half of that already exists** — the V2 doc's "the Notebook tab is dead weight" (§1.3) is **stale**. Today's `src/components/NotesTab.tsx` already is an Obsidian-lite:

- Markdown notes with **edit/preview** (`marked`, GFM).
- **`[[wiki links]]`** with exists/missing styling, click-to-navigate, and click-to-**create** a missing note (`renderMarkdown`, `handlePreviewClick`).
- A **force-directed graph view** of note↔note links (`react-force-graph-2d` → `buildGraph`, `ForceGraph2D`).
- Storage: `notes` table (`id, course_id, level, title, content, sort_order, updated_at`); CRUD in `src/lib/db.ts` (`getNotes(courseId, level)`, `createNote`, `updateNote`, `deleteNote`).

So Phase 3 is **two tracks**:

1. **Round out the vault (Obsidian UX).** Backlinks, tags, global search, note scope (see open questions), graph polish. Incremental on top of what's there.
2. **Wire the vault into the agent (the real harness work, V2 §6.3).** A RAG layer — ingestion + embeddings + retrieval — plus `notebook.ingest` / `notebook.search` **EduTools** so the tutor can read, search, and **cite the student's own material**. This is what the v1 "Notebook" never did and what makes it part of the harness. Phase 2's skill-gated tools are the slot these plug into.

---

## Where things stand — what exists vs. what Phase 3 adds

| File / area | What's there now | Phase 3 does |
|---|---|---|
| `src/components/NotesTab.tsx` | Markdown notes, `[[wikilinks]]`, force-graph view, edit/preview, per-course+level | Add backlinks/tags/search; drag-drop file import; "ask tutor about this doc" CTA; graph polish |
| `src/lib/db.ts` + `notes` table | Note CRUD, level-scoped | (Maybe) widen note scope; add document/chunk/embedding tables (migration v7) |
| `src-tauri/src/lib.rs` | Migrations **1–6** (max = 6); `tauri-plugin-sql` | **Migration v7**: `notebook_documents`, `notebook_chunks`, `notebook_embeddings`; load **`sqlite-vec`** (extension hook or a Rust command) |
| `src/lib/tools/` (Phase 1/2) | `EduTool` contract, registry, skill-gated `selectTools` | Add `notebook.search` + `notebook.ingest` tools; gate into skills via `tools_required` |
| `src/lib/knowledge.ts` | Per-course knowledge files (`knowledge_map` etc.) as tutor context | Decide: stay separate from notes, or converge (open question) |
| `src/views/Settings.tsx` | Provider/model/permissions config | Add `embedding_model` setting (default `nomic-embed-text`) |
| `src/lib/eval/` | 7 goldens, 6/7 | Add a retrieval-citation golden; hold ≥ 6/7 |

---

## Phase 3 scope (to be planned — from V2 §6.3 / §9 + the Obsidian reframing)

1. **RAG storage (migration v7).** `notebook_documents (id, course_id, title, source_type [pdf|md|text|url], source_uri, sha256, ingested_at)`, `notebook_chunks (id, document_id, ord, text, token_count)`, `notebook_embeddings (chunk_id, vec)` backed by **`sqlite-vec`**. Loading the extension through `tauri-plugin-sql` on **Windows** (Tate's platform) + mac + Linux is the biggest unknown — de-risk it first.
2. **`notebook.ingest` tool.** Chunk (~512 tokens, sentence-boundary), embed (Ollama `nomic-embed-text` floor; OpenAI `text-embedding-3-small` cloud fallback), write rows. Surface a chat indicator ("📓 3 chunks added from …"). **Start text/markdown-only**; PDF extraction can follow (V2 notes text-only ~halves the effort).
3. **`notebook.search` tool.** `{ query, top_k }` → top-k chunks with document titles/citations; kernel reinjects as a tool result; ChatTab renders inline `📓 Source: …` chips. Decide whether it's an always-on read tool or gated to specific skills (Phase 2 gating).
4. **NotebookTab upgrade.** Drag-and-drop import (Tauri `dragDropEnabled`), document/source list with chunk counts, a search box that runs the same `notebook.search`, "ask tutor about this document" CTA. Keep the existing notes + wikilinks + graph.
5. **Obsidian polish (pick a v1 subset).** Backlinks panel, tags + tag search, global full-text search, folders/organization, note templates. Reuse `react-force-graph-2d` (already wired) for graph improvements.
6. **`embedding_model` setting** in `Settings.tsx` (default `nomic-embed-text`).
7. **Eval.** Add a golden: ingest a known note, ask the tutor a question it can only answer from that note, assert it retrieves + cites. Hold ≥ **6/7**.

---

## Open questions to resolve while planning

- **Note scope.** Notes are currently per-course **and** per-level (`getNotes(courseId, level)`). Obsidian is one vault. Keep level-scoping, widen to **course-wide**, or a **global** cross-course vault? Affects the schema, the graph (cross-note links), and `NotesTab`.
- **`sqlite-vec` loading on Windows.** `tauri-plugin-sql` extension hook vs. a dedicated Rust command vs. bundling the extension binary — which works cross-platform? (V2 §6.3 / §9 flagged this as the long pole. Test on the `gemma4:e4b` floor machine.)
- **Embedding-model floor (V2 §11.2).** Does `nomic-embed-text` (~270MB) clear the bar on the target machine, or is a smaller model needed?
- **Notes vs. knowledge files.** Do the student's `notes` (Obsidian) and the per-course `knowledge.ts` files (`knowledge_map`, `misconceptions`, …) converge, or stay separate concerns (student-authored vs. tutor-maintained)?
- **PDF ingestion now or later?** Text/markdown-only first (≈5 days) vs. include PDF extraction (≈10–12 days). Recommend: text-first.
- **`notebook.search` exposure.** Always-on read tool for every skill, or gated to specific skills' `tools_required` (e.g. an `explainer`/research skill)? Ties into the Phase 2 permission table.
- **Obsidian-feature cut for v1.** Which of backlinks / tags / global search / folders / templates ship in Phase 3 vs. a follow-up?

---

## Gotchas

- **Branch off `master`** (current at `070f174`, Phases 0–2 merged).
- **Current max migration is v6** — Phase 3 adds **v7**. Never modify shipped migrations 1–6 (the plugin hashes each; changing one bricks startup). New tables = new migration only.
- The Notebook is **not** a greenfield — reuse `NotesTab.tsx`, the `notes` table, `marked`, and `react-force-graph-2d`. Don't rebuild what already works.
- Plug retrieval into the **kernel as EduTools** (Phase 1/2), don't bypass it with ad-hoc calls. Gate via skills (Phase 2 `tools_required`) + the permission table (`notebook.ingest` defaults to `ask`, `notebook.search` to `allow` — already seeded in `src/lib/permissions/rules.ts`).
- Don't run `npm run tauri dev` / `cargo build` while the user is away.
- No LaTeX in chat strings still holds; citations are plain text + chips.

---

## GitHub flow for Phase 3

New issue ("Phase 3: Notebook 2.0 — Obsidian-like vault + RAG retrieval") → branch `feat/<n>-v2-phase3-notebook` off `master` → PR → `Closes #<n>`. **Merge style is being switched to normal GitHub best practices — confirm squash vs. merge-commit with Tate before merging** (Phase 0–2 used squash; see the note in `MEMORY.md`).

## Verification target

`tsc` + `npm run build` green · `window.__runEvals()` ≥ **6/7** (+ a retrieval-citation golden) · existing notes/wikilinks/graph still work · manual: drop a `.md`/`.txt` file into the Notebook, confirm chunks ingested, ask the tutor about it and see cited source chips · `sqlite-vec` loads on Windows.

## Rough estimate (from V2 §9)

~10–12 dev-days with PDF ingestion; ~5 if text/markdown-only first (recommended). The `sqlite-vec` cross-platform load is the main schedule risk.
