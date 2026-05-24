import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { marked } from "marked";
import ForceGraph2D from "react-force-graph-2d";
import type { Note, NotebookDocument, NotebookSearchResult } from "../types";
import { getNotes, createNote, updateNote, deleteNote, getNotebookDocuments, deleteNotebookDocument } from "../lib/db";
import { ingestDocument, searchNotebook } from "../lib/notebook";

// ── Markdown config ───────────────────────────────────────────────────────────
marked.setOptions({ gfm: true, breaks: true });

// Phosphor palette for the canvas graph (hex — the canvas API can't read CSS vars).
const G = { node: "#00C6FF", nodeDim: "#0a4654", stroke: "#44D8FF", label: "#6DD4EE", link: "#14323a", linkHot: "#44D8FF" };

const WIKI_RE = /\[\[([^\]]+)\]\]/g;
const TAG_RE = /(?:^|\s)#([A-Za-z][\w-]*)/g;

function renderMarkdown(content: string, notes: Note[]): string {
  // Pre-process [[wiki links]] into HTML spans before passing to marked. marked passes raw HTML
  // through (no sanitize), fine for a local desktop app with user-generated content.
  const noteTitles = new Set(notes.map((n) => n.title.toLowerCase()));
  const withWikiLinks = content.replace(WIKI_RE, (_, title: string) => {
    const exists = noteTitles.has(title.toLowerCase());
    const cls = exists ? "wiki-link wiki-link--exists" : "wiki-link wiki-link--missing";
    const escaped = title.replace(/"/g, "&quot;");
    return `<span class="${cls}" data-wiki-title="${escaped}">${title}</span>`;
  });
  return marked.parse(withWikiLinks) as string;
}

function extractTags(content: string): string[] {
  const tags: string[] = [];
  for (const m of content.matchAll(TAG_RE)) if (!tags.includes(m[1])) tags.push(m[1]);
  return tags;
}

// ── Graph ───────────────────────────────────────────────────────────────────
interface GraphNode { id: string; title: string; degree: number; x?: number; y?: number }
interface GraphLink { source: string; target: string }

function buildGraph(notes: Note[]): { nodes: GraphNode[]; links: GraphLink[] } {
  const titleToId = new Map(notes.map((n) => [n.title.toLowerCase(), n.id]));
  const degree = new Map<string, number>();
  const links: GraphLink[] = [];
  for (const note of notes) {
    const refs = [...note.content.matchAll(WIKI_RE)].map((m) => m[1]);
    for (const ref of refs) {
      const targetId = titleToId.get(ref.toLowerCase());
      if (targetId && targetId !== note.id) {
        links.push({ source: note.id, target: targetId });
        degree.set(note.id, (degree.get(note.id) ?? 0) + 1);
        degree.set(targetId, (degree.get(targetId) ?? 0) + 1);
      }
    }
  }
  const nodes: GraphNode[] = notes.map((n) => ({ id: n.id, title: n.title, degree: degree.get(n.id) ?? 0 }));
  return { nodes, links };
}

// ── Component ─────────────────────────────────────────────────────────────────
// Vault is course-wide (Phase 3): all of a course's notes share one graph + link space. `level`
// is kept only to tag newly-created notes; it no longer scopes what's shown.
interface NotesTabProps { courseId: string; level: number }
type PanelView = "note" | "graph";

export default function NotesTab({ courseId, level }: NotesTabProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [panelView, setPanelView] = useState<PanelView>("note");

  // Vault search + filtering
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [docResults, setDocResults] = useState<NotebookSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Ingested documents
  const [docs, setDocs] = useState<Array<NotebookDocument & { chunk_count: number }>>([]);
  const [ingesting, setIngesting] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Graph
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const [graphSize, setGraphSize] = useState({ w: 600, h: 400 });
  const [hoverId, setHoverId] = useState<string | null>(null);

  useEffect(() => { loadNotes(); loadDocs(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [courseId]);

  useEffect(() => {
    if (!graphContainerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const el = entries[0]?.contentRect;
      if (el) setGraphSize({ w: el.width, h: el.height });
    });
    ro.observe(graphContainerRef.current);
    return () => ro.disconnect();
  }, [panelView]);

  const loadNotes = async () => setNotes(await getNotes(courseId));
  const loadDocs = async () => setDocs(await getNotebookDocuments(courseId));

  const handleCreate = async () => {
    const note = await createNote(courseId, "Untitled Note", "", level);
    const updated = [...notes, note];
    setNotes(updated);
    selectNote(note);
    setMode("edit");
    setPanelView("note");
  };

  const selectNote = (note: Note) => {
    saveIfDirty();
    setSelectedNote(note);
    setEditTitle(note.title);
    setEditContent(note.content);
    setMode(note.content.trim() ? "preview" : "edit");
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
    const updatedNote = { ...selectedNote, title: editTitle, content: editContent };
    setNotes((prev) => prev.map((n) => (n.id === selectedNote.id ? updatedNote : n)));
    setSelectedNote(updatedNote);
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!selectedNote) return;
    await deleteNote(selectedNote.id);
    setNotes((prev) => prev.filter((n) => n.id !== selectedNote.id));
    setSelectedNote(null);
  };

  const handleBlur = () => saveIfDirty();

  // Wiki-link navigation inside rendered markdown.
  const handlePreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest("[data-wiki-title]") as HTMLElement | null;
    if (!target) return;
    const title = target.dataset.wikiTitle ?? "";
    const found = notes.find((n) => n.title.toLowerCase() === title.toLowerCase());
    if (found) {
      selectNote(found);
    } else {
      createNote(courseId, title, "", level).then((newNote) => {
        setNotes((prev) => [...prev, newNote]);
        selectNote(newNote);
        setMode("edit");
      });
    }
  };

  const handleSwitchToPreview = () => { saveIfDirty(); setMode("preview"); };

  // ── Documents: ingestion ──
  const ingestFiles = async (files: File[]) => {
    const accepted = files.filter((f) => /\.(md|markdown|txt)$/i.test(f.name));
    if (accepted.length === 0) { setIngestError("Only .md, .markdown, and .txt files are supported."); return; }
    setIngesting(true);
    setIngestError(null);
    try {
      for (const f of accepted) {
        const text = await f.text();
        const sourceType = /\.(md|markdown)$/i.test(f.name) ? "md" : "text";
        await ingestDocument({ courseId, title: f.name.replace(/\.(md|markdown|txt)$/i, ""), sourceType, text });
      }
      await loadDocs();
    } catch (e) {
      setIngestError(e instanceof Error ? e.message : String(e));
    } finally {
      setIngesting(false);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) ingestFiles([...e.target.files]);
    e.target.value = ""; // allow re-selecting the same file
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) ingestFiles([...e.dataTransfer.files]);
  };

  const handleDeleteDoc = async (id: string) => {
    await deleteNotebookDocument(id);
    await loadDocs();
  };

  // ── Search ──
  const runSemanticSearch = async () => {
    const q = query.trim();
    if (!q) { setDocResults(null); return; }
    setSearching(true);
    try {
      setDocResults(await searchNotebook({ courseId, query: q, topK: 5 }));
    } catch (e) {
      setIngestError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
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

  // Notes that [[link]] to the selected note (backlinks / linked mentions).
  const backlinks = useMemo(() => {
    if (!selectedNote) return [];
    const title = selectedNote.title.toLowerCase();
    return notes.filter(
      (n) => n.id !== selectedNote.id && [...n.content.matchAll(WIKI_RE)].some((m) => m[1].toLowerCase() === title),
    );
  }, [notes, selectedNote]);

  const graph = useMemo(() => buildGraph(notes), [notes]);
  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    for (const l of graph.links) {
      (adj.get(l.source) ?? adj.set(l.source, new Set()).get(l.source)!).add(l.target);
      (adj.get(l.target) ?? adj.set(l.target, new Set()).get(l.target)!).add(l.source);
    }
    return adj;
  }, [graph]);

  return (
    <div className="flex h-full min-h-0">
      {/* ── Sidebar ── */}
      <div className="w-60 border-r border-[var(--rule)] bg-panel flex flex-col shrink-0">
        <div className="p-2.5 border-b border-[var(--rule)] flex gap-2">
          <button
            onClick={handleCreate}
            className="flex-1 px-2.5 py-1.5 rounded-lg btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-white text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
            New Note
          </button>
          <button
            onClick={() => { saveIfDirty(); setPanelView(panelView === "graph" ? "note" : "graph"); }}
            title="Toggle graph view"
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${panelView === "graph" ? "btn-primary text-white" : "bg-lcd hover:bg-panel text-[var(--ink-faint)]"}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="5" cy="12" r="2.5" /><circle cx="19" cy="5" r="2.5" /><circle cx="19" cy="19" r="2.5" />
              <line x1="7.5" y1="12" x2="16.5" y2="6.5" /><line x1="7.5" y1="12" x2="16.5" y2="17.5" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="p-2.5 border-b border-[var(--rule)]">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSemanticSearch(); }}
              placeholder="Search notes…  ↵ for docs"
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-lcd border border-[var(--rule)] text-ink text-xs focus:outline-none focus:border-phosphor"
            />
            {query && (
              <button onClick={() => { setQuery(""); setDocResults(null); }} title="Clear" className="px-2 rounded-lg bg-lcd text-[var(--ink-faint)] hover:text-ink text-xs">✕</button>
            )}
          </div>
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {allTags.map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveTag(activeTag === t ? null : t)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${activeTag === t ? "bg-phosphor-ink/25 text-phosphor-bright" : "bg-lcd text-[var(--ink-faint)] hover:text-phosphor-ink"}`}
                >#{t}</button>
              ))}
            </div>
          )}
        </div>

        {/* Note list + semantic doc results */}
        <div className="flex-1 overflow-y-auto">
          {filteredNotes.map((note) => (
            <button
              key={note.id}
              onClick={() => selectNote(note)}
              className={`w-full text-left px-3 py-2.5 border-b border-[var(--rule)] hover:bg-panel-lite transition-colors ${selectedNote?.id === note.id && panelView === "note" ? "bg-panel-lite border-l-2 border-l-phosphor" : ""}`}
            >
              <div className="text-sm text-ink truncate">{note.title}</div>
              <div className="text-[10px] text-[var(--ink-faint)] mt-0.5">{new Date(note.updated_at).toLocaleDateString()}</div>
            </button>
          ))}
          {filteredNotes.length === 0 && <div className="p-4 text-xs text-[var(--ink-faint)] text-center">{notes.length === 0 ? "No notes yet" : "No notes match"}</div>}

          {docResults && (
            <div className="border-t border-[var(--rule)]">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--ink-faint)]">
                {searching ? "Searching…" : `${docResults.length} matching passage${docResults.length === 1 ? "" : "s"}`}
              </div>
              {docResults.map((r) => (
                <div key={r.chunk_id} className="px-3 py-2 border-b border-[var(--rule)]">
                  <div className="text-[11px] text-phosphor-ink truncate">📓 {r.document_title}</div>
                  <div className="text-[11px] text-[var(--ink-dim)] line-clamp-2 mt-0.5">{r.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Documents */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-t border-[var(--rule)] ${dragOver ? "bg-[rgb(var(--phosphor-rgb)/0.08)]" : ""}`}
        >
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[10px] uppercase tracking-wider text-[var(--ink-faint)]">Documents</span>
            <button onClick={() => fileInputRef.current?.click()} disabled={ingesting} className="text-[10px] text-phosphor-ink hover:text-phosphor-bright disabled:opacity-50">
              {ingesting ? "adding…" : "+ Add"}
            </button>
            <input ref={fileInputRef} type="file" accept=".md,.markdown,.txt" multiple onChange={handleFileInput} className="hidden" />
          </div>
          <div className="max-h-32 overflow-y-auto">
            {docs.map((d) => (
              <div key={d.id} className="group flex items-center gap-2 px-3 py-1.5 hover:bg-panel-lite">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-ink truncate">{d.title}</div>
                  <div className="text-[10px] text-[var(--ink-faint)]">{d.chunk_count} chunk{d.chunk_count === 1 ? "" : "s"}</div>
                </div>
                <button onClick={() => handleDeleteDoc(d.id)} title="Remove" className="opacity-0 group-hover:opacity-100 text-[var(--ink-faint)] hover:text-red-400 text-xs">✕</button>
              </div>
            ))}
            {docs.length === 0 && (
              <div className="px-3 pb-2 text-[10px] text-[var(--ink-faint)]">Drop or add .md/.txt files for the tutor to cite.</div>
            )}
          </div>
          {ingestError && <div className="px-3 py-1.5 text-[10px] text-red-400">{ingestError}</div>}
        </div>
      </div>

      {/* ── Main panel ── */}
      {panelView === "graph" ? (
        <div ref={graphContainerRef} className="flex-1 min-h-0 bg-bg relative overflow-hidden">
          {notes.length < 2 ? (
            <div className="flex items-center justify-center h-full text-[var(--ink-faint)] text-sm">
              Create at least 2 notes and link them with{" "}
              <code className="mx-1 px-1 bg-panel-lite rounded text-phosphor-bright">[[Note Title]]</code> to see the graph
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
                const active = hoverId === null || gn.id === hoverId || adjacency.get(hoverId)?.has(gn.id);
                const r = 4 + Math.min(gn.degree, 6); // size by link count
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
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={handleBlur}
                  className="flex-1 bg-transparent text-ink font-semibold focus:outline-none min-w-0"
                  placeholder="Note title..."
                />
                {saving && <span className="text-[10px] text-[var(--ink-faint)] shrink-0">Saving...</span>}
                <div className="flex rounded-lg overflow-hidden border border-[var(--rule)] shrink-0">
                  <button onClick={() => setMode("edit")} className={`px-3 py-1 text-xs font-medium transition-colors ${mode === "edit" ? "btn-primary text-white" : "bg-panel-lite text-[var(--ink-faint)] hover:text-ink"}`}>Edit</button>
                  <button onClick={handleSwitchToPreview} className={`px-3 py-1 text-xs font-medium transition-colors ${mode === "preview" ? "btn-primary text-white" : "bg-panel-lite text-[var(--ink-faint)] hover:text-ink"}`}>Preview</button>
                </div>
                <button onClick={handleDelete} className="p-1.5 rounded hover:bg-red-500/20 text-[var(--ink-faint)] hover:text-red-400 transition-colors shrink-0" title="Delete note">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>
                </button>
              </div>

              {mode === "edit" ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onBlur={handleBlur}
                  className="flex-1 p-4 bg-transparent text-ink text-sm resize-none focus:outline-none font-mono leading-relaxed"
                  placeholder={"Start writing in Markdown...\n\nUse [[Note Title]] to link notes, #tags to organize."}
                />
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <div
                    className="p-5 note-prose"
                    onClick={handlePreviewClick}
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: editContent.trim() ? renderMarkdown(editContent, notes) : '<p style="color:#52525b;font-style:italic">Nothing here yet — switch to Edit to start writing.</p>' }}
                  />
                  {backlinks.length > 0 && (
                    <div className="border-t border-[var(--rule)] px-5 py-3">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--ink-faint)] mb-1.5">{backlinks.length} linked mention{backlinks.length === 1 ? "" : "s"}</div>
                      <div className="flex flex-col gap-1">
                        {backlinks.map((b) => (
                          <button key={b.id} onClick={() => selectNote(b)} className="text-left text-xs text-phosphor-ink hover:text-phosphor-bright truncate">← {b.title}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--ink-faint)]">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
              <span className="text-sm">Select a note or create a new one</span>
              <p className="text-xs text-[var(--ink-faint)] text-center max-w-xs">
                Use <code className="px-1 bg-panel-lite rounded text-phosphor-bright">[[Note Title]]</code> to link notes, and drop docs below for the tutor to cite.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
