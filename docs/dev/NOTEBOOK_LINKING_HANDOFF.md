# Notebook linking — refinement handoff

**Goal of the next session:** refine the notebook's linking UX. Make it easy to **hyperlink topics/tags
without spawning a note**. Today, linking is note-only and a clicked link to a non-existent name *creates a
note* — the major UX flaw to fix.

The app is in great shape otherwise (public, MIT, CI-gated, in-app auto-update live at v0.1.3). This is a
focused feature pass on one subsystem.

---

## The flaw, precisely

- **`src/components/NotesTab.tsx` → `handleWikiLinkNav` (~L183–191):** clicking a `[[wikilink]]` finds a note
  by title, else **`createNote(...)`** — so every clicked link to a new name materializes a phantom note.
  ```ts
  const handleWikiLinkNav = (title: string) => {
    const found = notes.find((n) => n.title.toLowerCase() === title.toLowerCase());
    if (found) { selectNote(found); return; }
    createNote(courseId, title, "", level, selectedNote?.folder_id ?? null).then(...); // ← creates a note
  };
  ```
- **`#tags` are styled but inert.** `src/components/MarkdownEditor.tsx` decorates `#tag` as `.cm-tag` (L73–76)
  but only `[[wikilinks]]` (`.cm-wikilink`) get a click handler → `onWikiLinkClick` (L148–156). Tags do
  nothing: no click, no index, no view, no graph edge.

Net: there is **no way to reference a topic/tag without creating a note.**

## Current implementation map

| File | Role |
|---|---|
| `src/components/NotesTab.tsx` | Vault UI (tree + folders + editor + graph). `WIKI_RE = /\[\[([^\]]+)\]\]/g` (L17). Wiki-link nav = `handleWikiLinkNav` (the flaw). Graph "related notes" + edges derive from `WIKI_RE` (L57, L299). Note/folder CRUD via `src/lib/db.ts`. |
| `src/components/MarkdownEditor.tsx` | CodeMirror 6 live-preview editor. `WIKI` + a tag regex → decorations `cm-wikilink` (clickable) and `cm-tag` (styled only). Click → `onWikiLinkClick(title)` (L148–156). Theme/styles ~L100–110. |
| `src/lib/notebook.ts` | RAG (chunk/embed/search), `importTextAsNote`, and the vault-graph build (note↔note edges from `[[links]]`). |
| `src/lib/db.ts` | `notes` + `notebook_folders` + `notebook_documents/chunks/embeddings` CRUD. `createNote`, `createFolder`, etc. **No `tags` column** — tags are content-derived only. |
| `src/index.css` | `.wiki-link--exists` / `.wiki-link--missing` (read/preview render path), `.cm-wikilink` / `.cm-tag` (editor). The "missing" style already exists but the click still creates. |
| DB migrations | `src-tauri/src/lib.rs` (v1–v9). v8 = unified vault/folders, v9 = sprite_id. **Migrations 1–9 are shipped — never edit; append v10 if a schema change is truly needed.** |

## Recommended direction

Two changes fully resolve the flaw:

1. **Make `#tags` a first-class, note-free primitive** (the syntax + styling already exist — lowest friction):
   - Parse `#tags` across all notes into a derived index (no migration needed — derive from `note.content`).
   - Make `#tag` **clickable** in the editor (extend the `onWikiLinkClick` mechanism, or add `onTagClick`) →
     opens a **tag view**: a filtered list of all notes containing that tag. **Never creates a note.**
   - Surface tags in the **vault graph** as a distinct node type (different shape/color from notes), with
     note→tag edges. Tags connect the graph without being notes.
   - Nice-to-haves: a tag browser/sidebar, `#` autocomplete in the editor.
2. **Stop auto-creating notes for missing `[[links]]`.** Render an unresolved `[[X]]` as "missing" (the
   `.wiki-link--missing` dashed style already exists) and only create the note via an **explicit** affordance
   (e.g. a small "＋ create note" action), matching Obsidian. Change `handleWikiLinkNav` so a missing link
   does NOT silently create.

Optional, if useful: a **topic link** that resolves to a *curriculum* subtopic (from the course outline /
syllabus) rather than a note — opens the lesson/topic, not a note. (`src/lib/curriculum.ts` has the outline.)

## Constraints / DON'Ts

- **Don't edit shipped migrations.** Prefer deriving tags from content (zero schema change). If you want a
  persisted tag index, add **migration v10** (append-only) in `src-tauri/src/lib.rs`.
- Don't touch the agent harness, the RAG/embedding path, or `evaluate.ts`/permissions.
- Follow the **CRT design system** (CSS-var tokens; `.cm-tag` / `.wiki-link` already exist to build on).
- Add **vitest** unit tests for any pure logic (tag parsing/extraction, link resolution) — `npm test`.

## Verify (in `npm run tauri dev`)

- Type `#topic` in a note → it's clickable → opens a tag view listing every note with `#topic`; **no note is
  created**. Type `[[Nonexistent]]` and click it → it does **not** create a phantom note (shows missing +
  explicit create). The vault graph shows tag nodes distinct from note nodes. `__runEvals()` shows no new
  failure (notebook changes shouldn't touch it, but confirm).

## Process

Issue-first → branch `feat/<issue>-notebook-tags` → PR → green CI (`Typecheck · test · build`) → merge. If you
want it in the installed app, **bump the version** (`src-tauri/tauri.conf.json` + `package.json` + `Cargo.toml`)
and `git tag v0.1.4 && git push origin v0.1.4` → the Release workflow builds, signs, and publishes; installed
apps auto-update. (See `project_openedu` memory / the auto-update setup for the full release loop.)
