import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense, type ReactNode } from "react";
// Heavy, view-gated components are lazy-loaded so they leave the eager main bundle: ForceGraph2D
// (react-force-graph-2d) mounts only in the vault-graph view; MarkdownEditor (CodeMirror) only when
// a note is open. Both are code-split into their own chunks fetched on first use.
const ForceGraph2D = lazy(() => import("react-force-graph-2d"));
const MarkdownEditor = lazy(() => import("./MarkdownEditor"));
import { forceCollide } from "d3-force";
import type { Note, NotebookFolder, NotebookSearchResult } from "../types";
import {
  getNotes, createNote, updateNote, deleteNote,
  getFolders, createFolder, renameFolder, deleteFolder, moveNoteToFolder,
} from "../lib/db";
import { indexNote, importTextAsNote, searchNotebook } from "../lib/notebook";
import { ingestResultSummary } from "../lib/ingest-format";
import QuickSwitcher from "./QuickSwitcher";
import NotesAssistant from "./NotesAssistant";
import { anchorAnnotations, appendSummary, type AnchoredAnnotation } from "../lib/notebook-assistant";
import {
  extractTags, resolveWikiLink, linkKey,
  buildVaultGraph, buildTagIndex,
  buildBacklinkIndex, findUnlinkedMentions, extractOutline,
  type GraphNode, type GraphNodeKind, type Mention,
} from "../lib/notebook-links";

// Phosphor palette for the canvas graph (hex — the canvas API can't read CSS vars). Tag nodes use a
// warm amber so they read as a distinct, note-free node kind across all color themes.
const G = {
  node: "#00C6FF", nodeDim: "#0a4654", stroke: "#44D8FF", label: "#6DD4EE",
  link: "#14323a", linkHot: "#44D8FF", folder: "#44D8FF",
  tag: "#FFB454", tagDim: "#5a4326", tagStroke: "#FFCF87",
};

// A one-line plain-text preview of a note's body for the tag-view cards (strips light markdown).
const snippet = (content: string) =>
  content.replace(/^#{1,6}\s+/gm, "").replace(/[#>*`_~[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);

// Graph node radius (world units) — small, with a gentle degree-driven bump so hubs read bigger
// without dominating. Shared by the canvas painter and the collision spacing so they agree.
function nodeRadius(gn: { kind: GraphNodeKind; degree: number }): number {
  const base = gn.kind === "folder" ? 3.5 : gn.kind === "tag" ? 3 : 2.6;
  const cap = gn.kind === "folder" ? 7 : gn.kind === "tag" ? 6 : 4;
  return base + Math.min(gn.degree, cap) * 0.6;
}

// The only folder glyph left. The tree itself uses a chevron alone — the open/closed folder icon was
// redundant next to it, and dropping it is most of what separates a file tree from a toolbar.
function FolderPlusGlyph({ size = 13, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      <path d="M12 11v6M9 14h6" />
    </svg>
  );
}

// Visibility of the context panel, remembered across mounts. Mirrors the `oe-` prefix theme.ts uses.
const CONTEXT_PANEL_KEY = "oe-notes-context";

// Ghost icon button — no fill, no border, 24px hit target. Used for every action in the vault chrome
// (sidebar header and folder row hovers) so the tree has exactly one button shape instead of four.
const GHOST_ICON =
  "w-6 h-6 inline-flex items-center justify-center rounded-md text-[var(--ink-faint)] " +
  "hover:bg-[rgb(var(--phosphor-rgb)/0.10)] hover:text-phosphor-bright transition-colors shrink-0 " +
  "disabled:opacity-40 disabled:hover:bg-transparent";
// Same thing at row scale, for the actions that only appear on folder hover.
const ROW_ICON =
  "w-5 h-5 inline-flex items-center justify-center rounded text-[var(--ink-faint)] " +
  "hover:text-phosphor-bright transition-colors";

// A collapsible section in the right-hand context panel. Count lives in the header so the panel can be
// read at a glance while collapsed.
function ContextSection({ title, count, open, onToggle, children }: {
  title: string; count: number; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <div className="border-b border-[var(--rule)] last:border-b-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-left hover:bg-panel-lite/60 transition-colors"
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
          className={`shrink-0 text-[var(--ink-faint)] transition-transform ${open ? "rotate-90" : ""}`}>
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)] flex-1 min-w-0 truncate">{title}</span>
        <span className="text-[10px] font-mono text-[var(--ink-faint)] shrink-0">{count}</span>
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

// One note's mentions: its title, then a line of context per occurrence. Context is plain text on
// purpose — rendering the markdown here would make the panel compete with the editor for attention.
function MentionGroup({ mention, onOpen }: { mention: Mention; onOpen: (id: string) => void }) {
  return (
    <div className="px-3 py-1.5">
      <button
        onClick={() => onOpen(mention.note.id)}
        className="text-left text-[12px] text-phosphor-ink hover:text-phosphor-bright transition-colors truncate w-full"
      >
        {mention.note.title || "Untitled"}
      </button>
      {mention.contexts.map((c, i) => (
        <button
          key={i}
          onClick={() => onOpen(mention.note.id)}
          className="mt-1 block w-full text-left text-[11px] leading-snug text-[var(--ink-dim)] hover:text-ink
                     border-l-2 border-[var(--rule)] hover:border-phosphor/50 pl-2 transition-colors"
        >
          {c}
        </button>
      ))}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
// Course-wide Obsidian-like vault (Phase 3): one note tree per course, organized into nested
// folders. Every note is searchable — imported files become notes, and notes re-index on save.
interface NotesTabProps { courseId: string; level: number }
type PanelView = "note" | "graph" | "tag";

export default function NotesTab({ courseId, level }: NotesTabProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<NotebookFolder[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [panelView, setPanelView] = useState<PanelView>("note");

  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null); // missing [[link]] awaiting explicit create
  const [docResults, setDocResults] = useState<NotebookSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [switcherOpen, setSwitcherOpen] = useState(false);

  // Right-hand context panel (outline + backlinks), the Obsidian right-sidebar pattern.
  //
  // Persisted, because NotesTab unmounts whenever you leave the Notes tab — without this, closing the
  // panel lasted until the next tab switch and then silently came back. localStorage rather than the
  // Tauri store: it is a per-machine view preference, it must be readable synchronously during the
  // first render to avoid a visible flash, and it has no business travelling in a settings export.
  const [showContext, setShowContext] = useState(() => {
    try { return localStorage.getItem(CONTEXT_PANEL_KEY) !== "0"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(CONTEXT_PANEL_KEY, showContext ? "1" : "0"); } catch { /* ignore */ }
  }, [showContext]);

  const [openSections, setOpenSections] = useState({ outline: true, linked: true, unlinked: false });
  const toggleSection = (k: keyof typeof openSections) => setOpenSections((s) => ({ ...s, [k]: !s[k] }));

  // Which tab of the right rail is showing. Not persisted — unlike visibility, this is a
  // what-am-I-doing-right-now choice, and reopening on Context is the right default every time.
  const [rail, setRail] = useState<"context" | "assistant">("context");

  // Review marks. Kept in memory only, and cleared whenever the note changes underneath them: an
  // annotation is a claim about specific characters, and once those characters move it is a claim
  // about nothing. Re-running a review is one click, so stale ink is never worth keeping.
  const [annotations, setAnnotations] = useState<AnchoredAnnotation[]>([]);
  // Bumped on every outline click so clicking the same heading twice still scrolls to it.
  const [reveal, setReveal] = useState<{ line: number; nonce: number } | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null); // folder id, or "root"

  const [ingesting, setIngesting] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const graphContainerRef = useRef<HTMLDivElement>(null);
  const [graphSize, setGraphSize] = useState({ w: 600, h: 400 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);        // react-force-graph instance (imperative handle)
  const didFitRef = useRef(false);        // zoom-to-fit only once per time the graph opens

  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [courseId]);

  useEffect(() => {
    if (!graphContainerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const el = entries[0]?.contentRect;
      if (el) setGraphSize({ w: el.width, h: el.height });
    });
    ro.observe(graphContainerRef.current);
    return () => ro.disconnect();
  }, [panelView]);

  // Airy, Obsidian-style layout: strong charge repulsion + roomy links + collision so notes float
  // apart and the connections are legible. The graph component is lazy-loaded, so poll (rAF) for its
  // imperative handle before configuring the d3 forces, then reheat. Re-fit the view once it settles.
  useEffect(() => {
    if (panelView !== "graph") return;
    didFitRef.current = false;
    let raf = 0;
    let tries = 0;
    const apply = () => {
      const fg = fgRef.current;
      const charge = fg?.d3Force?.("charge");
      if (charge?.strength) {
        charge.strength(-260).distanceMax?.(420);
        const link = fg.d3Force("link");
        if (link?.distance) link.distance(58).strength(0.45);
        const center = fg.d3Force("center");
        if (center?.strength) center.strength(0.02);
        // Collision keeps even dense hubs from overlapping, so labels and links stay legible.
        fg.d3Force("collide", forceCollide((n: GraphNode) => nodeRadius(n) + 7).strength(0.9));
        fg.d3ReheatSimulation?.();
        return;
      }
      if (tries++ < 90) raf = requestAnimationFrame(apply);
    };
    apply();
    return () => cancelAnimationFrame(raf);
  }, [panelView, notes, folders]);

  const loadAll = async () => { setNotes(await getNotes(courseId)); setFolders(await getFolders(courseId)); };
  const loadNotes = async () => setNotes(await getNotes(courseId));
  const loadFolders = async () => setFolders(await getFolders(courseId));

  // ── Note selection / editing ──
  const selectNote = (note: Note) => {
    saveIfDirty();
    setSelectedNote(note);
    setEditTitle(note.title);
    setEditContent(note.content);
    setPendingLink(null);
    setPanelView("note");
  };

  // Jump to a note by id — what the backlink, unlinked-mention, and quick-switcher entries call.
  // Silently no-ops on an id that has since been deleted rather than clearing the panel out from under
  // the reader.
  const openNoteById = (id: string) => {
    const target = notes.find((n) => n.id === id);
    if (target) selectNote(target);
  };

  // Ctrl/Cmd+O opens the quick switcher, matching Obsidian. A window listener rather than a handler on
  // the container: a container handler only fires when focus is already inside it, so it would miss the
  // common case of nothing being focused. Scoped by mount instead — NotesTab is only mounted while the
  // Notes tab is showing, so the binding can't leak into the rest of the course view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        setSwitcherOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Open the note-free tag view: every note carrying #tag, listed (never creates a note).
  const openTagView = (tag: string) => {
    saveIfDirty();
    setPendingLink(null);
    setActiveTag(tag);
    setPanelView("tag");
  };

  // Leave the tag view / clear the sidebar tag filter, back to the normal note panel + full tree.
  const clearTag = () => {
    setActiveTag(null);
    if (panelView === "tag") setPanelView("note");
  };

  const saveIfDirty = useCallback(() => {
    if (!selectedNote) return;
    if (editTitle !== selectedNote.title || editContent !== selectedNote.content) handleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNote, editTitle, editContent]);

  const handleSave = async () => {
    if (!selectedNote) return;
    setSaving(true);
    await updateNote(selectedNote.id, editTitle, editContent);
    const updated = { ...selectedNote, title: editTitle, content: editContent };
    setNotes((prev) => prev.map((n) => (n.id === selectedNote.id ? updated : n)));
    setSelectedNote(updated);
    setSaving(false);
    // Embed-on-save: re-index so the note is searchable. Best-effort + background — a missing/offline
    // embedder must never block saving (errors swallowed). sha-skips internally when unchanged.
    setIndexing(true);
    indexNote({ courseId, noteId: selectedNote.id, title: editTitle, text: editContent })
      .catch(() => {})
      .finally(() => setIndexing(false));
  };

  const handleDeleteNote = async () => {
    if (!selectedNote) return;
    await deleteNote(selectedNote.id);
    setNotes((prev) => prev.filter((n) => n.id !== selectedNote.id));
    setSelectedNote(null);
  };

  const handleBlur = () => saveIfDirty();

  // Clicking a [[wikilink]] in the editor: open the note if it exists; if it's missing, surface an
  // explicit "create note" affordance instead of silently materializing a phantom note (Obsidian-like).
  const handleWikiLinkNav = (title: string) => {
    const found = resolveWikiLink(title, notes);
    if (found) { selectNote(found); return; }
    setPendingLink(title);
  };

  // Explicit create for a missing [[link]] — only ever called from the create affordance.
  const createPendingNote = async () => {
    const title = pendingLink;
    if (!title) return;
    const n = await createNote(courseId, title, "", level, selectedNote?.folder_id ?? null);
    setNotes((prev) => [...prev, n]);
    selectNote(n);
  };

  // ── Folder ops ──
  const toggleExpand = (id: string) =>
    setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleNewFolder = async (parentId: string | null) => {
    const f = await createFolder(courseId, "New Folder", parentId);
    await loadFolders();
    if (parentId) setExpanded((s) => new Set(s).add(parentId));
    setRenamingId(f.id);
    setRenameValue("New Folder");
  };

  const commitRename = async () => {
    if (!renamingId) return;
    await renameFolder(renamingId, renameValue.trim() || "Untitled");
    setRenamingId(null);
    await loadFolders();
  };

  const handleDeleteFolder = async (id: string) => {
    await deleteFolder(id); // reparents children + notes; never deletes notes
    await loadAll();
  };

  const handleNewNote = async (folderId: string | null) => {
    const n = await createNote(courseId, "Untitled Note", "", level, folderId);
    await loadNotes();
    if (folderId) setExpanded((s) => new Set(s).add(folderId));
    selectNote(n);
  };

  // ── Import (files → notes) ──
  const ensureImportedFolder = async (): Promise<string> => {
    const existing = folders.find((f) => f.name === "Imported" && !f.parent_id);
    if (existing) return existing.id;
    const f = await createFolder(courseId, "Imported", null);
    await loadFolders();
    return f.id;
  };

  const ingestFiles = async (files: File[], folderId: string | null) => {
    const accepted = files.filter((f) => /\.(md|markdown|txt)$/i.test(f.name));
    if (accepted.length === 0) { setIngestError("Only .md, .markdown, and .txt files are supported."); return; }
    setIngesting(true);
    setIngestError(null);
    // Per-file resilience: one bad/offline embed must not drop the rest of the batch. The note is
    // always created (embedding is best-effort); we tally and report honestly.
    const target = folderId ?? (await ensureImportedFolder());
    let imported = 0;
    let pending = 0; // created but not embedded (embedder offline) — embed-on-save will retry
    let failed = 0;  // couldn't even create the note
    for (const f of accepted) {
      try {
        const text = await f.text();
        const sourceType = /\.(md|markdown)$/i.test(f.name) ? "md" : "text";
        const res = await importTextAsNote({ courseId, title: f.name.replace(/\.(md|markdown|txt)$/i, ""), text, sourceType, folderId: target });
        imported++;
        if (!res.embedded) pending++;
      } catch {
        failed++;
      }
    }
    if (target) setExpanded((s) => new Set(s).add(target));
    await loadAll();
    setIngesting(false);
    setIngestError(ingestResultSummary({ imported, pending, failed }).message);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) ingestFiles([...e.target.files], null);
    e.target.value = "";
  };

  // ── Drag & drop (move note into folder, or import dropped files there) ──
  const handleDropOn = (folderId: string | null, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    if (e.dataTransfer.files?.length) { ingestFiles([...e.dataTransfer.files], folderId); return; }
    if (draggedNoteId) {
      moveNoteToFolder(draggedNoteId, folderId).then(loadNotes);
      setDraggedNoteId(null);
    }
  };

  const handleSemanticSearch = async () => {
    const q = query.trim();
    if (!q) { setDocResults(null); return; }
    setSearching(true);
    try { setDocResults(await searchNotebook({ courseId, query: q, topK: 5 })); }
    catch (e) { setIngestError(e instanceof Error ? e.message : String(e)); }
    finally { setSearching(false); }
  };

  // ── Derived ──
  // tag → notes carrying it (content-derived; no DB column). Drives the chips, the tag view, and counts.
  const tagIndex = useMemo(() => buildTagIndex(notes), [notes]);
  const allTags = useMemo(() => [...tagIndex.keys()].sort((a, b) => a.localeCompare(b)), [tagIndex]);
  const taggedNotes = useMemo(() => (activeTag ? tagIndex.get(activeTag) ?? [] : []), [tagIndex, activeTag]);

  // Normalized titles of every note — lets the editor style [[links]] to missing notes as "missing".
  const existingTitles = useMemo(() => new Set(notes.map((n) => linkKey(n.title))), [notes]);
  // Display titles for [[ autocomplete. Excludes the open note (linking a note to itself is noise)
  // and anything untitled, which would offer a blank row.
  const noteTitles = useMemo(
    () => notes.filter((n) => n.id !== selectedNote?.id && n.title.trim()).map((n) => n.title),
    [notes, selectedNote],
  );

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((n) => {
      if (activeTag && !extractTags(n.content).includes(activeTag)) return false;
      if (q && !(n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [notes, query, activeTag]);

  // Bidirectional linking, the half the UI was missing. Linked = someone wrote [[this]]; unlinked =
  // someone said the title in prose. The first is a fact about the vault, the second a suggestion, so
  // they are counted and shown separately rather than merged.
  const backlinkIndex = useMemo(() => buildBacklinkIndex(notes), [notes]);
  const linkedMentions = useMemo(
    () => (selectedNote ? backlinkIndex.get(selectedNote.id) ?? [] : []),
    [backlinkIndex, selectedNote],
  );
  const unlinkedMentions = useMemo(
    () => (selectedNote ? findUnlinkedMentions(selectedNote, notes) : []),
    [notes, selectedNote],
  );
  // Derived from the live buffer, not the saved note, so the outline tracks what you are typing.
  const outline = useMemo(() => extractOutline(editContent), [editContent]);

  // Re-anchor the review marks against the live buffer on every edit rather than holding the offsets
  // the review returned. Two things fall out of this for free: offsets stay correct as text above them
  // shifts, and fixing something the reviewer flagged makes its mark disappear, because the quote no
  // longer matches. A memo, not an effect — deriving this avoids a setState-in-effect loop entirely.
  const anchoredAnnotations = useMemo(
    () => anchorAnnotations(editContent, annotations),
    [editContent, annotations],
  );

  // Marks belong to the note they were made on. Re-anchoring would drop most of them on a note switch
  // anyway, but a phrase common to both notes would survive and point at the wrong thing.
  useEffect(() => { setAnnotations([]); }, [selectedNote?.id]);

  const graph = useMemo(() => buildVaultGraph(notes, folders), [notes, folders]);

  const childFolders = (parentId: string | null) => folders.filter((f) => (f.parent_id ?? null) === parentId);
  const childNotes = (folderId: string | null) => notes.filter((n) => (n.folder_id ?? null) === folderId);
  const filtering = query.trim() !== "" || activeTag !== null;

  // ── Tree renderers ──
  // A note row. No file icon: in a tree where every leaf is a note, an icon on every leaf carries zero
  // information and doubles the visual weight of the list. The name is the content.
  const renderNoteItem = (note: Note, depth: number) => {
    const active = selectedNote?.id === note.id && panelView === "note";
    return (
      <button
        key={note.id}
        draggable
        onDragStart={() => setDraggedNoteId(note.id)}
        onDragEnd={() => setDraggedNoteId(null)}
        onClick={() => selectNote(note)}
        style={{ paddingLeft: 21 + depth * 14 }}
        className={`w-full text-left pr-2 h-6 flex items-center rounded-md text-[13px] truncate transition-colors ${
          active
            ? "bg-[rgb(var(--phosphor-rgb)/0.13)] text-phosphor-bright"
            : "text-[var(--ink-dim)] hover:bg-[rgb(var(--ink-rgb)/0.05)] hover:text-ink"
        }`}
      >
        {note.title || "Untitled"}
      </button>
    );
  };

  const renderFolder = (folder: NotebookFolder, depth: number): React.ReactNode => {
    const isOpen = expanded.has(folder.id);
    return (
      <div key={folder.id}>
        <div
          onDragOver={(e) => { e.preventDefault(); setDropTarget(folder.id); }}
          onDragLeave={() => setDropTarget((t) => (t === folder.id ? null : t))}
          onDrop={(e) => handleDropOn(folder.id, e)}
          style={{ paddingLeft: 5 + depth * 14 }}
          className={`group flex items-center gap-1 pr-1 h-6 rounded-md cursor-pointer transition-colors ${
            dropTarget === folder.id ? "bg-[rgb(var(--phosphor-rgb)/0.13)]" : "hover:bg-[rgb(var(--ink-rgb)/0.05)]"
          }`}
          onClick={() => toggleExpand(folder.id)}
        >
          {/* Chevron only — no folder glyph. The chevron already says "container", and dropping the
              second icon is most of what separates a file tree from a toolbar. */}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
               className={`shrink-0 text-[var(--ink-faint)] transition-transform ${isOpen ? "rotate-90" : ""}`}>
            <path d="M9 18l6-6-6-6" />
          </svg>
          {renamingId === folder.id ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }}
              className="flex-1 min-w-0 bg-lcd border border-phosphor/40 rounded px-1 text-[13px] text-ink focus:outline-none"
            />
          ) : (
            <span className="flex-1 text-[13px] text-ink truncate" onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(folder.id); setRenameValue(folder.name); }}>
              {folder.name}
            </span>
          )}
          {/* Row actions — all line-art at one weight. These used to be ＋ ✎ ✕ text glyphs sitting
              next to SVGs, which is most of why the tree read as assembled from spare parts. */}
          <span className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
            <button title="New note here" onClick={() => handleNewNote(folder.id)} className={ROW_ICON}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <button title="New subfolder" onClick={() => handleNewFolder(folder.id)} className={ROW_ICON}>
              <FolderPlusGlyph size={12} />
            </button>
            <button title="Rename" onClick={() => { setRenamingId(folder.id); setRenameValue(folder.name); }} className={ROW_ICON}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
            </button>
            <button title="Delete folder (keeps notes)" onClick={() => handleDeleteFolder(folder.id)} className={`${ROW_ICON} hover:!text-red-400`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </span>
        </div>
        {isOpen && (
          /* Indent guide — one hairline per nesting level. Without it the varying left padding reads
             as arbitrary rather than as depth. */
          <div className="relative">
            <span aria-hidden className="absolute top-0 bottom-0 w-px bg-[rgb(var(--ink-rgb)/0.13)]"
                  style={{ left: 11 + depth * 14 }} />
            {childFolders(folder.id).map((cf) => renderFolder(cf, depth + 1))}
            {childNotes(folder.id).map((n) => renderNoteItem(n, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0">
      <QuickSwitcher
        open={switcherOpen}
        notes={notes}
        onClose={() => setSwitcherOpen(false)}
        onSelect={openNoteById}
      />

      {/* ── Sidebar ── */}
      <div className="w-64 border-r border-[var(--rule)] bg-panel flex flex-col shrink-0">
        {/* Header — a label and four ghost icons. This was a solid accent pill plus three filled
            boxes, which put more visual weight in the toolbar than in the notes underneath it. */}
        <div className="flex items-center gap-px pl-2.5 pr-1.5 py-1.5">
          <span className="flex-1 text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)] select-none">Notes</span>
          <button onClick={() => handleNewNote(null)} title="New note" className={GHOST_ICON}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <button onClick={() => handleNewFolder(null)} title="New folder" className={GHOST_ICON}>
            <FolderPlusGlyph size={14} />
          </button>
          <button onClick={() => fileInputRef.current?.click()} disabled={ingesting} title="Import .md/.txt as notes" className={GHOST_ICON}>
            {/* Was a bare ⬆ character among line-art SVGs. */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                 className={ingesting ? "animate-pulse" : ""}>
              <path d="M12 15V3M7 8l5-5 5 5M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
            </svg>
          </button>
          <button
            onClick={() => { saveIfDirty(); setPendingLink(null); setPanelView(panelView === "graph" ? "note" : "graph"); }}
            title="Toggle graph view"
            aria-pressed={panelView === "graph"}
            className={`${GHOST_ICON} ${panelView === "graph" ? "!text-phosphor-bright bg-[rgb(var(--phosphor-rgb)/0.13)]" : ""}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="5" cy="12" r="2.2" /><circle cx="19" cy="5" r="2.2" /><circle cx="19" cy="19" r="2.2" /><line x1="7.2" y1="12" x2="16.8" y2="6.6" /><line x1="7.2" y1="12" x2="16.8" y2="17.4" /></svg>
          </button>
          <input ref={fileInputRef} type="file" accept=".md,.markdown,.txt" multiple onChange={handleFileInput} className="hidden" />
        </div>

        {/* Search + tags */}
        <div className="px-2 pb-2">
          <div className="flex gap-1 items-center">
            {/* Recessed rather than boxed: a bordered field at the top of a tree competes with the
                tree. The border only appears on focus, where it means something. */}
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSemanticSearch(); }}
              placeholder="Search…"
              title="Search titles and content — press Enter to also search imported documents"
              className="flex-1 min-w-0 px-2 h-7 rounded-md bg-bg border border-transparent text-[var(--ink-dim)] text-xs
                         placeholder-[var(--ink-faint)] focus:outline-none focus:border-phosphor focus:text-ink transition-colors"
            />
            {(query || docResults) && (
              <button onClick={() => { setQuery(""); setDocResults(null); }} title="Clear search" className={ROW_ICON}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            )}
          </div>
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {allTags.map((t) => {
                const isActive = activeTag === t;
                return (
                  <button
                    key={t}
                    onClick={() => (isActive ? clearTag() : openTagView(t))}
                    title={`${tagIndex.get(t)?.length ?? 0} note${tagIndex.get(t)?.length === 1 ? "" : "s"}`}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${isActive ? "bg-phosphor-ink/25 text-phosphor-bright" : "bg-lcd text-[var(--ink-faint)] hover:text-phosphor-ink"}`}
                  >
                    #{t}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Tree (or flat filtered list) + semantic results — also the root drop target */}
        <div
          className={`flex-1 overflow-y-auto ${dropTarget === "root" ? "bg-[rgb(var(--phosphor-rgb)/0.06)]" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDropTarget("root"); }}
          onDragLeave={() => setDropTarget((t) => (t === "root" ? null : t))}
          onDrop={(e) => handleDropOn(null, e)}
        >
          {filtering ? (
            <>
              {filteredNotes.map((n) => renderNoteItem(n, 0))}
              {filteredNotes.length === 0 && <div className="p-4 text-xs text-[var(--ink-faint)] text-center">No notes match</div>}
            </>
          ) : (
            <>
              {childFolders(null).map((f) => renderFolder(f, 0))}
              {childNotes(null).map((n) => renderNoteItem(n, 0))}
              {notes.length === 0 && folders.length === 0 && (
                <div className="p-4 text-xs text-[var(--ink-faint)] text-center">Empty vault — add a note, a folder, or drop a .md/.txt file.</div>
              )}
            </>
          )}

          {docResults && (
            <div className="border-t border-[var(--rule)] mt-1">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--ink-faint)]">{searching ? "Searching…" : `${docResults.length} matching passage${docResults.length === 1 ? "" : "s"}`}</div>
              {docResults.map((r) => (
                <div key={r.chunk_id} className="px-3 py-2 border-b border-[var(--rule)]">
                  <div className="text-[11px] text-phosphor-ink truncate">📓 {r.document_title}</div>
                  <div className="text-[11px] text-[var(--ink-dim)] line-clamp-2 mt-0.5">{r.text}</div>
                </div>
              ))}
            </div>
          )}
          {ingestError && <div className="px-3 py-1.5 text-[10px] text-red-400">{ingestError}</div>}
        </div>
      </div>

      {/* ── Main panel ── */}
      {panelView === "graph" ? (
        <div ref={graphContainerRef} className="flex-1 min-h-0 bg-bg relative overflow-hidden">
          {graph.nodes.length < 2 ? (
            <div className="flex items-center justify-center h-full text-[var(--ink-faint)] text-sm px-6 text-center">
              Add a few notes and folders (link notes with <code className="mx-1 px-1 bg-panel-lite rounded text-phosphor-bright">[[Note Title]]</code> or label them with <code className="mx-1 px-1 bg-panel-lite rounded text-[#FFB454]">#tags</code>) to see your vault graph
            </div>
          ) : (
            <Suspense fallback={<div className="flex items-center justify-center h-full text-[var(--ink-faint)] text-sm">Loading graph…</div>}>
            <ForceGraph2D
              ref={fgRef}
              graphData={graph}
              width={graphSize.w || 600}
              height={graphSize.h || 400}
              backgroundColor="transparent"
              nodeLabel="title"
              nodeRelSize={5}
              d3VelocityDecay={0.3}
              d3AlphaDecay={0.018}
              cooldownTicks={140}
              onEngineStop={() => {
                if (didFitRef.current) return;
                didFitRef.current = true;
                fgRef.current?.zoomToFit(450, 60);
              }}
              linkColor={(l) => {
                const s = typeof l.source === "object" ? (l.source as GraphNode).id : l.source;
                const t = typeof l.target === "object" ? (l.target as GraphNode).id : l.target;
                return hoverId && (s === hoverId || t === hoverId) ? G.linkHot : G.link;
              }}
              linkWidth={(l) => {
                const s = typeof l.source === "object" ? (l.source as GraphNode).id : l.source;
                const t = typeof l.target === "object" ? (l.target as GraphNode).id : l.target;
                return hoverId && (s === hoverId || t === hoverId) ? 2.5 : 1.5;
              }}
              onNodeHover={(node) => setHoverId(node ? (node as GraphNode).id : null)}
              onNodeClick={(node) => {
                const gn = node as GraphNode;
                if (gn.kind === "folder") { setExpanded((s) => new Set(s).add(gn.id.replace(/^folder:/, ""))); setPanelView("note"); return; }
                if (gn.kind === "tag") { openTagView(gn.title.replace(/^#/, "")); return; }
                const n = notes.find((x) => x.id === gn.id);
                if (n) selectNote(n);
              }}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const gn = node as GraphNode & { x: number; y: number };
                const active = hoverId === null || gn.id === hoverId || (graph.adjacency.get(hoverId)?.has(gn.id) ?? false);
                const isFolder = gn.kind === "folder";
                const isTag = gn.kind === "tag";
                const r = nodeRadius(gn);
                ctx.globalAlpha = active ? 1 : 0.35;
                ctx.lineWidth = gn.id === hoverId ? 2 : 1;
                if (isFolder) {
                  ctx.fillStyle = active ? G.folder : G.nodeDim;
                  ctx.strokeStyle = G.folder;
                  ctx.beginPath();
                  ctx.rect(gn.x - r, gn.y - r, r * 2, r * 2);
                  ctx.fill();
                  ctx.stroke();
                } else if (isTag) {
                  // Diamond — a distinct, note-free node kind (warm amber, set apart from blue notes).
                  ctx.fillStyle = active ? G.tag : G.tagDim;
                  ctx.strokeStyle = G.tagStroke;
                  ctx.beginPath();
                  ctx.moveTo(gn.x, gn.y - r);
                  ctx.lineTo(gn.x + r, gn.y);
                  ctx.lineTo(gn.x, gn.y + r);
                  ctx.lineTo(gn.x - r, gn.y);
                  ctx.closePath();
                  ctx.fill();
                  ctx.stroke();
                } else {
                  ctx.fillStyle = active ? G.node : G.nodeDim;
                  ctx.strokeStyle = G.stroke;
                  ctx.beginPath();
                  ctx.arc(gn.x, gn.y, r, 0, 2 * Math.PI);
                  ctx.fill();
                  ctx.stroke();
                }
                // Labels stay a constant ~size on screen (no min-clamp that ballooned them when zoomed
                // in), and fade out when zoomed far out so the airy overview reads as dots + links.
                if (globalScale > 0.5) {
                  const fontSize = 11 / globalScale;
                  ctx.font = `${isFolder ? "700 " : ""}${fontSize}px Inter, system-ui, sans-serif`;
                  ctx.fillStyle = isFolder ? G.folder : isTag ? G.tag : G.label;
                  ctx.textAlign = "center";
                  ctx.textBaseline = "top";
                  ctx.fillText(gn.title, gn.x, gn.y + r + fontSize * 0.5);
                }
                ctx.globalAlpha = 1;
              }}
            />
            </Suspense>
          )}
          <div className="absolute top-3 right-3 text-[10px] text-[var(--ink-faint)]">{graph.nodes.filter((n) => n.kind === "note").length} notes · {graph.nodes.filter((n) => n.kind === "tag").length} tags · {folders.length} folders · {graph.links.length} links</div>
        </div>
      ) : panelView === "tag" ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--rule)] shrink-0">
            <span className="px-2 py-0.5 rounded text-sm font-mono bg-[rgb(var(--phosphor-rgb)/0.18)] text-phosphor-bright">#{activeTag}</span>
            <span className="text-[11px] text-[var(--ink-faint)]">{taggedNotes.length} note{taggedNotes.length === 1 ? "" : "s"}</span>
            <div className="flex-1" />
            <button onClick={clearTag} title="Close tag view" className="px-2 py-1 rounded bg-lcd text-[var(--ink-faint)] hover:text-ink text-[11px]">✕ Close</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {taggedNotes.length === 0 ? (
              <div className="p-8 text-center text-[var(--ink-faint)] text-sm">
                No notes carry <span className="font-mono text-[#FFB454]">#{activeTag}</span> anymore.
              </div>
            ) : (
              taggedNotes.map((n) => (
                <button key={n.id} onClick={() => selectNote(n)} className="w-full text-left px-4 py-3 border-b border-[var(--rule)] hover:bg-panel-lite transition-colors">
                  <div className="text-sm text-ink font-medium truncate">{n.title}</div>
                  {snippet(n.content) && <div className="text-xs text-[var(--ink-dim)] line-clamp-2 mt-0.5">{snippet(n.content)}</div>}
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {extractTags(n.content).map((t) => (
                      <span
                        key={t}
                        onClick={(e) => { e.stopPropagation(); openTagView(t); }}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer transition-colors ${t === activeTag ? "bg-phosphor-ink/25 text-phosphor-bright" : "bg-lcd text-[var(--ink-faint)] hover:text-phosphor-ink"}`}
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {selectedNote ? (
            <>
              <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--rule)] shrink-0">
                <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} onBlur={handleBlur} className="flex-1 bg-transparent text-ink font-semibold focus:outline-none min-w-0" placeholder="Note title..." />
                {saving && <span className="text-[10px] text-[var(--ink-faint)] shrink-0">Saving…</span>}
                {indexing && !saving && <span className="text-[10px] text-[var(--ink-faint)] shrink-0">Indexing…</span>}
                <button
                  onClick={() => setShowContext((v) => !v)}
                  aria-pressed={showContext}
                  className={`p-1.5 rounded transition-colors shrink-0 ${showContext ? "text-phosphor-bright bg-[rgb(var(--phosphor-rgb)/0.10)]" : "text-[var(--ink-faint)] hover:text-ink hover:bg-lcd"}`}
                  title={showContext ? "Hide outline & backlinks" : "Show outline & backlinks"}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" />
                  </svg>
                </button>
                <button onClick={handleDeleteNote} className="p-1.5 rounded hover:bg-red-500/20 text-[var(--ink-faint)] hover:text-red-400 transition-colors shrink-0" title="Delete note">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>
                </button>
              </div>

              {/* Explicit create affordance for a clicked [[link]] whose note doesn't exist — never auto-creates. */}
              {pendingLink && (
                <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--rule)] bg-[rgb(var(--phosphor-rgb)/0.06)] shrink-0">
                  <span className="text-xs text-[var(--ink-dim)] min-w-0 truncate">
                    No note titled <span className="font-mono text-phosphor-ink">“{pendingLink}”</span> yet.
                  </span>
                  <div className="flex-1" />
                  <button onClick={createPendingNote} className="px-2 py-1 rounded btn-primary text-[11px] font-medium shrink-0 flex items-center gap-1">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
                    Create note
                  </button>
                  <button onClick={() => setPendingLink(null)} className="px-2 py-1 rounded bg-lcd text-[var(--ink-faint)] hover:text-ink text-[11px] shrink-0">Dismiss</button>
                </div>
              )}

              <div className="flex-1 flex min-h-0">
                <Suspense fallback={<div className="flex-1 flex items-center justify-center text-[var(--ink-faint)] text-sm">Loading editor…</div>}>
                  <MarkdownEditor
                    doc={editContent}
                    noteId={selectedNote.id}
                    onChange={setEditContent}
                    onBlur={handleBlur}
                    onWikiLinkClick={handleWikiLinkNav}
                    onTagClick={openTagView}
                    existingTitles={existingTitles}
                    noteTitles={noteTitles}
                    annotations={anchoredAnnotations}
                    revealLine={reveal}
                  />
                </Suspense>

                {showContext && (
                  <aside className="w-60 shrink-0 border-l border-[var(--rule)] bg-panel/40 flex flex-col min-h-0">
                    <div className="flex shrink-0 border-b border-[var(--rule)]">
                      {(["context", "assistant"] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setRail(t)}
                          className={`flex-1 px-2 py-2 text-[10px] uppercase tracking-[0.14em] transition-colors ${
                            rail === t
                              ? "text-phosphor-bright bg-[rgb(var(--phosphor-rgb)/0.08)]"
                              : "text-[var(--ink-faint)] hover:text-ink hover:bg-panel-lite/60"
                          }`}
                        >
                          {t}
                          {t === "assistant" && anchoredAnnotations.length > 0 && (
                            <span className="ml-1.5 font-mono" style={{ color: "#FF4060" }}>
                              {anchoredAnnotations.length}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>

                    {rail === "assistant" ? (
                      <NotesAssistant
                        courseId={courseId}
                        level={level}
                        noteTitle={editTitle}
                        noteContent={editContent}
                        annotations={anchoredAnnotations}
                        onAnnotations={setAnnotations}
                        onInsertSummary={(md) => setEditContent((c) => appendSummary(c, md))}
                        onRevealOffset={(offset) => setReveal({
                          line: editContent.slice(0, offset).split("\n").length - 1,
                          nonce: Date.now(),
                        })}
                      />
                    ) : (
                    <div className="flex-1 min-h-0 overflow-y-auto">
                    <ContextSection title="Outline" count={outline.length} open={openSections.outline} onToggle={() => toggleSection("outline")}>
                      {outline.length === 0 ? (
                        <p className="px-3 text-[11px] text-[var(--ink-faint)] leading-snug">
                          No headings yet. Start a line with <code className="text-phosphor-ink">#</code>.
                        </p>
                      ) : (
                        outline.map((h, i) => (
                          <button
                            key={`${h.line}-${i}`}
                            onClick={() => setReveal({ line: h.line, nonce: Date.now() })}
                            style={{ paddingLeft: `${12 + (h.level - 1) * 10}px` }}
                            className="w-full text-left pr-3 py-[3px] text-[11.5px] leading-snug text-[var(--ink-dim)]
                                       hover:text-phosphor-bright hover:bg-panel-lite/60 transition-colors truncate"
                          >
                            {h.text}
                          </button>
                        ))
                      )}
                    </ContextSection>

                    <ContextSection title="Linked mentions" count={linkedMentions.length} open={openSections.linked} onToggle={() => toggleSection("linked")}>
                      {linkedMentions.length === 0 ? (
                        <p className="px-3 text-[11px] text-[var(--ink-faint)] leading-snug">
                          Nothing links here yet. Write <code className="text-phosphor-ink">[[{selectedNote.title || "…"}]]</code> in another note.
                        </p>
                      ) : (
                        linkedMentions.map((m) => <MentionGroup key={m.note.id} mention={m} onOpen={openNoteById} />)
                      )}
                    </ContextSection>

                    <ContextSection title="Unlinked mentions" count={unlinkedMentions.length} open={openSections.unlinked} onToggle={() => toggleSection("unlinked")}>
                      {unlinkedMentions.length === 0 ? (
                        <p className="px-3 text-[11px] text-[var(--ink-faint)] leading-snug">
                          No note mentions this title in prose.
                        </p>
                      ) : (
                        unlinkedMentions.map((m) => <MentionGroup key={m.note.id} mention={m} onOpen={openNoteById} />)
                      )}
                    </ContextSection>
                    </div>
                    )}
                  </aside>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--ink-faint)]">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
              <span className="text-sm">Select a note or create one</span>
              <p className="text-xs text-[var(--ink-faint)] text-center max-w-xs">Organize with folders, link with <code className="px-1 bg-panel-lite rounded text-phosphor-bright">[[Note Title]]</code>, and drop <code className="px-1 bg-panel-lite rounded text-phosphor-bright">.md</code>/<code className="px-1 bg-panel-lite rounded text-phosphor-bright">.txt</code> files to import them as notes the tutor can cite.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
