import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import MarkdownEditor from "./MarkdownEditor";
import type { Note, NotebookFolder, NotebookSearchResult } from "../types";
import {
  getNotes, createNote, updateNote, deleteNote,
  getFolders, createFolder, renameFolder, deleteFolder, moveNoteToFolder,
} from "../lib/db";
import { indexNote, importTextAsNote, searchNotebook } from "../lib/notebook";

// Phosphor palette for the canvas graph (hex — the canvas API can't read CSS vars).
const G = { node: "#00C6FF", nodeDim: "#0a4654", stroke: "#44D8FF", label: "#6DD4EE", link: "#14323a", linkHot: "#44D8FF" };

const WIKI_RE = /\[\[([^\]]+)\]\]/g;
const TAG_RE = /(?:^|\s)#([A-Za-z][\w-]*)/g;

function extractTags(content: string): string[] {
  const tags: string[] = [];
  for (const m of content.matchAll(TAG_RE)) if (!tags.includes(m[1])) tags.push(m[1]);
  return tags;
}

// ── Graph ───────────────────────────────────────────────────────────────────
interface GraphNode { id: string; title: string; degree: number; x?: number; y?: number }
interface GraphLink { source: string; target: string }

function buildGraph(notes: Note[]): { nodes: GraphNode[]; links: GraphLink[]; adjacency: Map<string, Set<string>> } {
  const titleToId = new Map(notes.map((n) => [n.title.toLowerCase(), n.id]));
  const degree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();
  const links: GraphLink[] = [];
  const link = (a: string, b: string) => {
    (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
    (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
  };
  for (const note of notes) {
    const refs = [...note.content.matchAll(WIKI_RE)].map((m) => m[1]);
    for (const ref of refs) {
      const targetId = titleToId.get(ref.toLowerCase());
      if (targetId && targetId !== note.id) {
        links.push({ source: note.id, target: targetId });
        degree.set(note.id, (degree.get(note.id) ?? 0) + 1);
        degree.set(targetId, (degree.get(targetId) ?? 0) + 1);
        link(note.id, targetId);
      }
    }
  }
  const nodes: GraphNode[] = notes.map((n) => ({ id: n.id, title: n.title, degree: degree.get(n.id) ?? 0 }));
  return { nodes, links, adjacency };
}

// Line-art folder glyphs — monochrome (stroke=currentColor) so they sit on the phosphor theme like
// the note file icon, instead of the off-theme 📁 emoji.
function FolderGlyph({ open = false, size = 13, className = "text-phosphor-ink" }: { open?: boolean; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
      {open ? (
        <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
      ) : (
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      )}
    </svg>
  );
}

function FolderPlusGlyph({ size = 13, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      <path d="M12 11v6M9 14h6" />
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
// Course-wide Obsidian-like vault (Phase 3): one note tree per course, organized into nested
// folders. Every note is searchable — imported files become notes, and notes re-index on save.
interface NotesTabProps { courseId: string; level: number }
type PanelView = "note" | "graph";

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
  const [docResults, setDocResults] = useState<NotebookSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

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

  const loadAll = async () => { setNotes(await getNotes(courseId)); setFolders(await getFolders(courseId)); };
  const loadNotes = async () => setNotes(await getNotes(courseId));
  const loadFolders = async () => setFolders(await getFolders(courseId));

  // ── Note selection / editing ──
  const selectNote = (note: Note) => {
    saveIfDirty();
    setSelectedNote(note);
    setEditTitle(note.title);
    setEditContent(note.content);
    setPanelView("note");
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

  // Clicking a [[wikilink]] in the editor: open the note, or create it (in the current folder) if new.
  const handleWikiLinkNav = (title: string) => {
    const found = notes.find((n) => n.title.toLowerCase() === title.toLowerCase());
    if (found) { selectNote(found); return; }
    createNote(courseId, title, "", level, selectedNote?.folder_id ?? null).then((n) => {
      setNotes((prev) => [...prev, n]);
      selectNote(n);
    });
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
    try {
      const target = folderId ?? (await ensureImportedFolder());
      for (const f of accepted) {
        const text = await f.text();
        const sourceType = /\.(md|markdown)$/i.test(f.name) ? "md" : "text";
        await importTextAsNote({ courseId, title: f.name.replace(/\.(md|markdown|txt)$/i, ""), text, sourceType, folderId: target });
      }
      if (target) setExpanded((s) => new Set(s).add(target));
      await loadAll();
    } catch (e) {
      setIngestError(e instanceof Error ? e.message : String(e));
    } finally {
      setIngesting(false);
    }
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
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) for (const t of extractTags(n.content)) set.add(t);
    return [...set].sort();
  }, [notes]);

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((n) => {
      if (activeTag && !extractTags(n.content).includes(activeTag)) return false;
      if (q && !(n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [notes, query, activeTag]);

  const backlinks = useMemo(() => {
    if (!selectedNote) return [];
    const title = selectedNote.title.toLowerCase();
    return notes.filter((n) => n.id !== selectedNote.id && [...n.content.matchAll(WIKI_RE)].some((m) => m[1].toLowerCase() === title));
  }, [notes, selectedNote]);

  const graph = useMemo(() => buildGraph(notes), [notes]);

  const childFolders = (parentId: string | null) => folders.filter((f) => (f.parent_id ?? null) === parentId);
  const childNotes = (folderId: string | null) => notes.filter((n) => (n.folder_id ?? null) === folderId);
  const filtering = query.trim() !== "" || activeTag !== null;

  // ── Tree renderers ──
  const renderNoteItem = (note: Note, depth: number) => (
    <button
      key={note.id}
      draggable
      onDragStart={() => setDraggedNoteId(note.id)}
      onDragEnd={() => setDraggedNoteId(null)}
      onClick={() => selectNote(note)}
      style={{ paddingLeft: 8 + depth * 14 }}
      className={`w-full text-left pr-2 py-1.5 flex items-center gap-1.5 hover:bg-panel-lite transition-colors ${
        selectedNote?.id === note.id && panelView === "note" ? "bg-panel-lite border-l-2 border-l-phosphor" : "border-l-2 border-l-transparent"
      }`}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-[var(--ink-faint)] shrink-0">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
      </svg>
      <span className="text-[13px] text-ink truncate">{note.title}</span>
    </button>
  );

  const renderFolder = (folder: NotebookFolder, depth: number): React.ReactNode => {
    const isOpen = expanded.has(folder.id);
    return (
      <div key={folder.id}>
        <div
          onDragOver={(e) => { e.preventDefault(); setDropTarget(folder.id); }}
          onDragLeave={() => setDropTarget((t) => (t === folder.id ? null : t))}
          onDrop={(e) => handleDropOn(folder.id, e)}
          style={{ paddingLeft: 6 + depth * 14 }}
          className={`group flex items-center gap-1 pr-1.5 py-1.5 cursor-pointer hover:bg-panel-lite ${dropTarget === folder.id ? "bg-[rgb(var(--phosphor-rgb)/0.12)]" : ""}`}
          onClick={() => toggleExpand(folder.id)}
        >
          <span className="text-[var(--ink-faint)] text-[10px] w-3 shrink-0">{isOpen ? "▾" : "▸"}</span>
          <FolderGlyph open={isOpen} />
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
            <span className="flex-1 text-[13px] text-phosphor-ink truncate" onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(folder.id); setRenameValue(folder.name); }}>
              {folder.name}
            </span>
          )}
          <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
            <button title="New note here" onClick={() => handleNewNote(folder.id)} className="px-1 text-[var(--ink-faint)] hover:text-phosphor-bright text-xs">＋</button>
            <button title="New subfolder" onClick={() => handleNewFolder(folder.id)} className="px-1 text-[var(--ink-faint)] hover:text-phosphor-bright flex items-center"><FolderPlusGlyph size={12} /></button>
            <button title="Rename" onClick={() => { setRenamingId(folder.id); setRenameValue(folder.name); }} className="px-1 text-[var(--ink-faint)] hover:text-phosphor-bright text-[11px]">✎</button>
            <button title="Delete folder (keeps notes)" onClick={() => handleDeleteFolder(folder.id)} className="px-1 text-[var(--ink-faint)] hover:text-red-400 text-[11px]">✕</button>
          </span>
        </div>
        {isOpen && (
          <div>
            {childFolders(folder.id).map((cf) => renderFolder(cf, depth + 1))}
            {childNotes(folder.id).map((n) => renderNoteItem(n, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0">
      {/* ── Sidebar ── */}
      <div className="w-64 border-r border-[var(--rule)] bg-panel flex flex-col shrink-0">
        <div className="p-2.5 border-b border-[var(--rule)] flex gap-1.5">
          <button onClick={() => handleNewNote(null)} className="flex-1 px-2 py-1.5 rounded-lg btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-white text-xs font-medium transition-colors flex items-center justify-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
            Note
          </button>
          <button onClick={() => handleNewFolder(null)} title="New folder" className="px-2 py-1.5 rounded-lg bg-lcd hover:bg-panel text-[var(--ink-faint)] hover:text-phosphor-ink transition-colors flex items-center"><FolderPlusGlyph size={15} /></button>
          <button onClick={() => fileInputRef.current?.click()} disabled={ingesting} title="Import .md/.txt as notes" className="px-2 py-1.5 rounded-lg bg-lcd hover:bg-panel text-[var(--ink-faint)] text-xs font-medium transition-colors disabled:opacity-50">{ingesting ? "…" : "⬆"}</button>
          <button
            onClick={() => { saveIfDirty(); setPanelView(panelView === "graph" ? "note" : "graph"); }}
            title="Toggle graph view"
            className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${panelView === "graph" ? "btn-primary text-white" : "bg-lcd hover:bg-panel text-[var(--ink-faint)]"}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="5" cy="12" r="2.5" /><circle cx="19" cy="5" r="2.5" /><circle cx="19" cy="19" r="2.5" /><line x1="7.5" y1="12" x2="16.5" y2="6.5" /><line x1="7.5" y1="12" x2="16.5" y2="17.5" /></svg>
          </button>
          <input ref={fileInputRef} type="file" accept=".md,.markdown,.txt" multiple onChange={handleFileInput} className="hidden" />
        </div>

        {/* Search + tags */}
        <div className="p-2.5 border-b border-[var(--rule)]">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSemanticSearch(); }}
              placeholder="Search notes…  ↵ docs"
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-lcd border border-[var(--rule)] text-ink text-xs focus:outline-none focus:border-phosphor"
            />
            {(query || docResults) && <button onClick={() => { setQuery(""); setDocResults(null); }} title="Clear" className="px-2 rounded-lg bg-lcd text-[var(--ink-faint)] hover:text-ink text-xs">✕</button>}
          </div>
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {allTags.map((t) => (
                <button key={t} onClick={() => setActiveTag(activeTag === t ? null : t)} className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${activeTag === t ? "bg-phosphor-ink/25 text-phosphor-bright" : "bg-lcd text-[var(--ink-faint)] hover:text-phosphor-ink"}`}>#{t}</button>
              ))}
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
          {notes.length < 2 ? (
            <div className="flex items-center justify-center h-full text-[var(--ink-faint)] text-sm">
              Create at least 2 notes and link them with <code className="mx-1 px-1 bg-panel-lite rounded text-phosphor-bright">[[Note Title]]</code> to see the graph
            </div>
          ) : (
            <ForceGraph2D
              graphData={graph}
              width={graphSize.w || 600}
              height={graphSize.h || 400}
              backgroundColor="transparent"
              nodeLabel="title"
              nodeRelSize={5}
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
              onNodeClick={(node) => { const n = notes.find((x) => x.id === (node as GraphNode).id); if (n) selectNote(n); }}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const gn = node as GraphNode & { x: number; y: number };
                const active = hoverId === null || gn.id === hoverId || (graph.adjacency.get(hoverId)?.has(gn.id) ?? false);
                const r = 4 + Math.min(gn.degree, 6);
                ctx.beginPath();
                ctx.arc(gn.x, gn.y, r, 0, 2 * Math.PI);
                ctx.fillStyle = active ? G.node : G.nodeDim;
                ctx.fill();
                ctx.strokeStyle = G.stroke;
                ctx.lineWidth = gn.id === hoverId ? 2 : 1;
                ctx.globalAlpha = active ? 1 : 0.4;
                ctx.stroke();
                ctx.font = `${Math.max(10, 12 / globalScale)}px Inter, system-ui, sans-serif`;
                ctx.fillStyle = G.label;
                ctx.textAlign = "center";
                ctx.fillText(gn.title, gn.x, gn.y + r + 6);
                ctx.globalAlpha = 1;
              }}
            />
          )}
          <div className="absolute top-3 right-3 text-[10px] text-[var(--ink-faint)]">{graph.nodes.length} notes · {graph.links.length} links</div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {selectedNote ? (
            <>
              <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--rule)] shrink-0">
                <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} onBlur={handleBlur} className="flex-1 bg-transparent text-ink font-semibold focus:outline-none min-w-0" placeholder="Note title..." />
                {saving && <span className="text-[10px] text-[var(--ink-faint)] shrink-0">Saving…</span>}
                {indexing && !saving && <span className="text-[10px] text-[var(--ink-faint)] shrink-0">Indexing…</span>}
                <button onClick={handleDeleteNote} className="p-1.5 rounded hover:bg-red-500/20 text-[var(--ink-faint)] hover:text-red-400 transition-colors shrink-0" title="Delete note">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>
                </button>
              </div>

              <MarkdownEditor
                doc={editContent}
                noteId={selectedNote.id}
                onChange={setEditContent}
                onBlur={handleBlur}
                onWikiLinkClick={handleWikiLinkNav}
              />
              {backlinks.length > 0 && (
                <div className="border-t border-[var(--rule)] px-5 py-3 shrink-0">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--ink-faint)] mb-1.5">{backlinks.length} linked mention{backlinks.length === 1 ? "" : "s"}</div>
                  <div className="flex flex-col gap-1">
                    {backlinks.map((b) => (<button key={b.id} onClick={() => selectNote(b)} className="text-left text-xs text-phosphor-ink hover:text-phosphor-bright truncate">← {b.title}</button>))}
                  </div>
                </div>
              )}
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
