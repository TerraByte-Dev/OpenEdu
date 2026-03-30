import { useState, useEffect } from "react";
import type { Note } from "../types";
import { getNotes, createNote, updateNote, deleteNote } from "../lib/db";

interface NotesTabProps {
  courseId: string;
}

export default function NotesTab({ courseId }: NotesTabProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadNotes();
  }, [courseId]);

  const loadNotes = async () => {
    const n = await getNotes(courseId);
    setNotes(n);
  };

  const handleCreate = async () => {
    const note = await createNote(courseId, "Untitled Note", "");
    setNotes((prev) => [...prev, note]);
    selectNote(note);
  };

  const selectNote = (note: Note) => {
    setSelectedNote(note);
    setEditTitle(note.title);
    setEditContent(note.content);
  };

  const handleSave = async () => {
    if (!selectedNote) return;
    setSaving(true);
    await updateNote(selectedNote.id, editTitle, editContent);
    setNotes((prev) =>
      prev.map((n) =>
        n.id === selectedNote.id ? { ...n, title: editTitle, content: editContent } : n
      )
    );
    setSelectedNote({ ...selectedNote, title: editTitle, content: editContent });
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!selectedNote) return;
    await deleteNote(selectedNote.id);
    setNotes((prev) => prev.filter((n) => n.id !== selectedNote.id));
    setSelectedNote(null);
  };

  // Auto-save on blur
  const handleBlur = () => {
    if (selectedNote && (editTitle !== selectedNote.title || editContent !== selectedNote.content)) {
      handleSave();
    }
  };

  return (
    <div className="flex h-full min-h-0">
      {/* Note list */}
      <div className="w-56 border-r border-surface-600 bg-surface-800 flex flex-col">
        <div className="p-3 border-b border-surface-600">
          <button
            onClick={handleCreate}
            className="w-full px-3 py-2 rounded-lg bg-terra-600 hover:bg-terra-500 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Note
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {notes.map((note) => (
            <button
              key={note.id}
              onClick={() => selectNote(note)}
              className={`w-full text-left px-3 py-2.5 border-b border-surface-700 hover:bg-surface-700 transition-colors ${
                selectedNote?.id === note.id ? "bg-surface-700" : ""
              }`}
            >
              <div className="text-sm text-zinc-200 truncate">{note.title}</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">
                {new Date(note.updated_at).toLocaleDateString()}
              </div>
            </button>
          ))}
          {notes.length === 0 && (
            <div className="p-4 text-xs text-zinc-500 text-center">
              No notes yet
            </div>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col">
        {selectedNote ? (
          <>
            <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-600">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleBlur}
                className="flex-1 bg-transparent text-zinc-100 font-semibold focus:outline-none"
                placeholder="Note title..."
              />
              <span className="text-[10px] text-zinc-500">
                {saving ? "Saving..." : ""}
              </span>
              <button
                onClick={handleDelete}
                className="p-1.5 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-colors"
                title="Delete note"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                </svg>
              </button>
            </div>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onBlur={handleBlur}
              className="flex-1 p-4 bg-transparent text-zinc-200 text-sm resize-none focus:outline-none font-mono leading-relaxed"
              placeholder="Start writing... (Markdown supported)"
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
            Select a note or create a new one
          </div>
        )}
      </div>
    </div>
  );
}
