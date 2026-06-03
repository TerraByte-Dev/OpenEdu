# Notebook linking — refinement handoff

**Status: ✅ RESOLVED in v0.1.4** (issue #63, branch `feat/63-notebook-tags`). `#tags` are now a
first-class, note-FREE linking primitive and missing `[[links]]` no longer auto-create. This file is
kept as the design record for the subsystem.

---

## What was broken (the original flaw)

- **`NotesTab.handleWikiLinkNav`** opened a note by title, else **`createNote(...)`** — so every
  clicked `[[wikilink]]` to a new name materialized a phantom note.
- **`#tags` were styled but inert** — decorated `.cm-tag` in the editor, but no click, index, view,
  or graph edge. There was **no way to reference a topic/tag without creating a note.**

## What shipped

1. **`src/lib/notebook-links.ts`** — a pure, Tauri-free module that is now the single source of truth
   for both `NotesTab.tsx` and `MarkdownEditor.tsx`:
   - `WIKI_LINK_RE` / `TAG_RE`, plus `findWikiLinks` / `findTags` (offset-aware spans for the editor),
     `extractTags`, `extractWikiTitles`, `linkKey`, `resolveWikiLink`, `buildTagIndex`.
   - `buildVaultGraph(notes, folders)` — moved out of `NotesTab` and extended with **tag hub nodes**
     (`kind: "tag"`, one per distinct tag) and note→tag edges. Tags connect the graph without being notes.
   - Fully unit-tested in `src/lib/notebook-links.test.ts` (22 cases — tag/link parsing edge cases,
     resolution, tag index, graph shape). `npm test`.
2. **`#tags` are clickable + first-class** (note-free):
   - Clickable in the live-preview editor (`MarkdownEditor` `onTagClick`) → opens a **tag view**:
     a main-panel list of every note carrying that tag (title + snippet + its other tags). It never
     creates a note.
   - Sidebar tag chips open the same tag view (active chip toggles it closed); each chip shows a count.
   - The vault graph renders tags as a **distinct node kind** — an amber **diamond** (vs. blue note
     circles / folder squares) — with note→tag edges; clicking a tag node opens the tag view.
3. **Missing `[[links]]` no longer auto-create.** A clicked link to a non-existent note shows an
   explicit **"Create note / Dismiss"** strip above the editor; only the explicit action creates it.
   In the editor, links to missing notes render dashed/faint (`.cm-wikilink--missing`); links that
   resolve render solid. Existence is recomputed from the live vault (`existingTitles`) and the editor
   re-decorates when notes are added/renamed/deleted.

No DB migration — tags are derived from `note.content`. The agent harness, RAG/embedding path, and
migrations 1–9 were untouched.

## Where it lives

| File | Role |
|---|---|
| `src/lib/notebook-links.ts` | **Pure** parsing/resolution/graph (the source of truth). Unit-tested. |
| `src/components/MarkdownEditor.tsx` | CM6 editor: `cm-wikilink` / `cm-wikilink--missing` / `cm-tag` decorations + click routing (`onWikiLinkClick`, `onTagClick`); re-decorates on `existingTitles` change. |
| `src/components/NotesTab.tsx` | Vault UI: tag view (`panelView: "tag"`), `openTagView` / `clearTag`, `pendingLink` create affordance, tag nodes in the graph, sidebar chips. |
| `src/index.css` | `.wiki-link--exists/--missing` chip tokens (legacy read-render styles). Editor styling is inline in `MarkdownEditor`'s theme. |

## Possible follow-ups (not built)

- `#`/`[[` autocomplete in the editor (CM6 autocompletion source over the existing tag set + note titles).
- A **topic link** that resolves to a *curriculum* subtopic (course outline / syllabus) and opens the
  lesson rather than a note. (`src/lib/curriculum.ts` has the outline.)
- Tag rename / merge across the vault (content rewrite).
