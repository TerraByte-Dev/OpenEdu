import { useState, useEffect, useRef, useCallback } from "react";
import { marked } from "marked";
import ForceGraph2D from "react-force-graph-2d";
import type { Note } from "../types";
import { getNotes, createNote, updateNote, deleteNote } from "../lib/db";

// ── Markdown config ───────────────────────────────────────────────────────────
marked.setOptions({ gfm: true, breaks: true });

function renderMarkdown(content: string, notes: Note[]): string {
  // Pre-process [[wiki links]] into HTML spans before passing to marked.
  // marked passes raw HTML through by default (no sanitize), which is fine
  // for a local desktop app with user-generated content.
  const noteTitles = new Set(notes.map((n) => n.title.toLowerCase()));
  const withWikiLinks = content.replace(/\[\[([^\]]+)\]\]/g, (_, title: string) => {
    const exists = noteTitles.has(title.toLowerCase());
    const cls = exists ? "wiki-link wiki-link--exists" : "wiki-link wiki-link--missing";
    const escaped = title.replace(/"/g, "&quot;");
    return `<span class="${cls}" data-wiki-title="${escaped}">${title}</span>`;
  });
  return marked.parse(withWikiLinks) as string;
}

// ── Graph types ───────────────────────────────────────────────────────────────
interface GraphNode { id: string; title: string; x?: number; y?: number }
interface GraphLink { source: string; target: string }

function buildGraph(notes: Note[]): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = notes.map((n) => ({ id: n.id, title: n.title }));
  const links: GraphLink[] = [];
  const titleToId = new Map(notes.map((n) => [n.title.toLowerCase(), n.id]));

  for (const note of notes) {
    const wikiRefs = [...note.content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
    for (const ref of wikiRefs) {
      const targetId = titleToId.get(ref.toLowerCase());
      if (targetId && targetId !== note.id) {
        links.push({ source: note.id, target: targetId });
      }
    }
  }
  return { nodes, links };
}

// ── Component ─────────────────────────────────────────────────────────────────
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
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const [graphSize, setGraphSize] = useState({ w: 600, h: 400 });

  useEffect(() => { loadNotes(); }, [courseId, level]);

  // Resize observer for the graph container
  useEffect(() => {
    if (!graphContainerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const el = entries[0]?.contentRect;
      if (el) setGraphSize({ w: el.width, h: el.height });
    });
    ro.observe(graphContainerRef.current);
    return () => ro.disconnect();
  }, [panelView]); // re-attach when switching to graph

  const loadNotes = async () => {
    const n = await getNotes(courseId, level);
    setNotes(n);
  };

  const handleCreate = async () => {
    const note = await createNote(courseId, "Untitled Note", "", level);
    const updated = [...notes, note];
    setNotes(updated);
    selectNote(note, updated);
    setMode("edit");
    setPanelView("note");
  };

  const selectNote = (note: Note, noteList: Note[] = notes) => {
    saveIfDirty();
    setSelectedNote(note);
    setEditTitle(note.title);
    setEditContent(note.content);
    // Auto-switch to preview if note has content, edit if brand new
    setMode(note.content.trim() ? "preview" : "edit");
    setPanelView("note");
    // Suppress the unused param lint — noteList used for wiki-link rendering context
    void noteList;
  };

  const saveIfDirty = useCallback(() => {
    if (!selectedNote) return;
    if (editTitle !== selectedNote.title || editContent !== selectedNote.content) {
      handleSave();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNote, editTitle, editContent]);

  const handleSave = async () => {
    if (!selectedNote) return;
    setSaving(true);
    await updateNote(selectedNote.id, editTitle, editContent);
    const updatedNote = { ...selectedNote, title: editTitle, content: editContent };
    setNotes((prev) => prev.map((n) => n.id === selectedNote.id ? updatedNote : n));
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

  // Handle clicks inside the rendered markdown — wiki-link navigation
  const handlePreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest("[data-wiki-title]") as HTMLElement | null;
    if (!target) return;
    const title = target.dataset.wikiTitle ?? "";
    const found = notes.find((n) => n.title.toLowerCase() === title.toLowerCase());
    if (found) {
      selectNote(found);
    } else {
      // Create a new note with that title
      createNote(courseId, title, "", level).then((newNote) => {
        setNotes((prev) => [...prev, newNote]);
        selectNote(newNote, [...notes, newNote]);
        setMode("edit");
      });
    }
  };

  const handleSwitchToPreview = () => {
    saveIfDirty();
    setMode("preview");
  };

  const graph = buildGraph(notes);

  return (
    <div className="flex h-full min-h-0">
      {/* ── Note list sidebar ── */}
      <div className="w-52 border-r border-surface-600 bg-surface-800 flex flex-col shrink-0">
        <div className="p-2.5 border-b border-surface-600 flex gap-2">
          <button
            onClick={handleCreate}
            className="flex-1 px-2.5 py-1.5 rounded-lg bg-terra-600 hover:bg-terra-500 text-white text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Note
          </button>
          <button
            onClick={() => { saveIfDirty(); setPanelView(panelView === "graph" ? "note" : "graph"); }}
            title="Toggle graph view"
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              panelView === "graph"
                ? "bg-terra-600 text-white"
                : "bg-surface-600 hover:bg-surface-500 text-zinc-400"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="5" cy="12" r="2.5" />
              <circle cx="19" cy="5" r="2.5" />
              <circle cx="19" cy="19" r="2.5" />
              <line x1="7.5" y1="12" x2="16.5" y2="6.5" />
              <line x1="7.5" y1="12" x2="16.5" y2="17.5" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {notes.map((note) => (
            <button
              key={note.id}
              onClick={() => selectNote(note)}
              className={`w-full text-left px-3 py-2.5 border-b border-surface-700 hover:bg-surface-700 transition-colors ${
                selectedNote?.id === note.id && panelView === "note" ? "bg-surface-700 border-l-2 border-l-terra-500" : ""
              }`}
            >
              <div className="text-sm text-zinc-200 truncate">{note.title}</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">
                {new Date(note.updated_at).toLocaleDateString()}
              </div>
            </button>
          ))}
          {notes.length === 0 && (
            <div className="p-4 text-xs text-zinc-500 text-center">No notes yet</div>
          )}
        </div>
      </div>

      {/* ── Main panel ── */}
      {panelView === "graph" ? (
        /* Graph view */
        <div ref={graphContainerRef} className="flex-1 min-h-0 bg-surface-900 relative overflow-hidden">
          {notes.length < 2 ? (
            <div className="flex-1 flex items-center justify-center h-full text-zinc-500 text-sm">
              Create at least 2 notes and link them with{" "}
              <code className="mx-1 px-1 bg-surface-700 rounded text-terra-300">[[Note Title]]</code>{" "}
              to see the graph
            </div>
          ) : (
            <ForceGraph2D
              graphData={graph}
              width={graphSize.w || 600}
              height={graphSize.h || 400}
              backgroundColor="transparent"
              nodeLabel="title"
              nodeColor={() => "#6d28d9"}
              nodeRelSize={5}
              linkColor={() => "#3d3858"}
              linkWidth={1.5}
              onNodeClick={(node) => {
                const n = notes.find((note) => note.id === (node as GraphNode).id);
                if (n) selectNote(n);
              }}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const gn = node as GraphNode & { x: number; y: number };
                const label = gn.title;
                const fontSize = Math.max(10, 12 / globalScale);
                ctx.beginPath();
                ctx.arc(gn.x, gn.y, 5, 0, 2 * Math.PI);
                ctx.fillStyle = "#6d28d9";
                ctx.fill();
                ctx.strokeStyle = "#a78bfa";
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
                ctx.fillStyle = "#a1a1aa";
                ctx.textAlign = "center";
                ctx.fillText(label, gn.x, gn.y + 10);
              }}
            />
          )}
          <div className="absolute top-3 right-3 text-[10px] text-zinc-600">
            {graph.nodes.length} notes · {graph.links.length} links
          </div>
        </div>
      ) : (
        /* Note editor / preview */
        <div className="flex-1 flex flex-col min-h-0">
          {selectedNote ? (
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-surface-600 shrink-0">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={handleBlur}
                  className="flex-1 bg-transparent text-zinc-100 font-semibold focus:outline-none min-w-0"
                  placeholder="Note title..."
                />
                {saving && <span className="text-[10px] text-zinc-500 shrink-0">Saving...</span>}
                {/* Edit / Preview toggle */}
                <div className="flex rounded-lg overflow-hidden border border-surface-500 shrink-0">
                  <button
                    onClick={() => setMode("edit")}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      mode === "edit" ? "bg-terra-600 text-white" : "bg-surface-700 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Edit
                  </button>
                  <button
                    onClick={handleSwitchToPreview}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      mode === "preview" ? "bg-terra-600 text-white" : "bg-surface-700 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Preview
                  </button>
                </div>
                <button
                  onClick={handleDelete}
                  className="p-1.5 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-colors shrink-0"
                  title="Delete note"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                  </svg>
                </button>
              </div>

              {/* Content */}
              {mode === "edit" ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onBlur={handleBlur}
                  className="flex-1 p-4 bg-transparent text-zinc-200 text-sm resize-none focus:outline-none font-mono leading-relaxed"
                  placeholder={"Start writing in Markdown...\n\nUse [[Note Title]] to link to another note."}
                />
              ) : (
                <div
                  className="flex-1 overflow-y-auto p-5 note-prose"
                  onClick={handlePreviewClick}
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{
                    __html: editContent.trim()
                      ? renderMarkdown(editContent, notes)
                      : '<p style="color:#52525b;font-style:italic">Nothing here yet — switch to Edit to start writing.</p>',
                  }}
                />
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-500">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="text-sm">Select a note or create a new one</span>
              <p className="text-xs text-zinc-600 text-center max-w-xs">
                Use <code className="px-1 bg-surface-700 rounded text-terra-300">[[Note Title]]</code> to link notes together
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
