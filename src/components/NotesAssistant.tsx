// The notebook assistant panel — the second tab of the note's right rail.
//
// Shaped as named ACTIONS, not a chat box. The app already has chat; the point of this surface is that
// it already knows which note you are looking at, so you never stop working to describe your own note
// to a model. One click, current note is implicit, result lands where you are.
//
// Nothing here writes to a note on its own. A review is an overlay you can dismiss; a summary is a
// preview with an explicit Insert.

import { useState } from "react";
import { callLLMStructured } from "../lib/llm";
import { getChatConfig } from "../lib/store";
import { listChatThreads, getChatMessages } from "../lib/db";
import {
  anchorAnnotations, unanchorable, validateReview,
  buildReviewMessages, buildSummaryMessages, formatTranscript,
  REVIEW_SCHEMA, SUMMARY_SCHEMA,
  type Annotation, type AnchoredAnnotation, type AnnotationKind,
} from "../lib/notebook-assistant";

const KIND_META: Record<AnnotationKind, { label: string; color: string; glyph: string }> = {
  error:    { label: "Wrong",   color: "#FF4060", glyph: "M18 6L6 18M6 6l12 12" },
  gap:      { label: "Missing", color: "#FFB000", glyph: "M12 5v14M5 12h14" },
  question: { label: "Check",   color: "var(--phosphor)", glyph: "M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01" },
  correct:  { label: "Right",   color: "#2BFF88", glyph: "M20 6L9 17l-5-5" },
};

export interface NotesAssistantProps {
  courseId: string;
  level: number;
  noteTitle: string;
  noteContent: string;
  annotations: readonly AnchoredAnnotation[];
  onAnnotations: (next: AnchoredAnnotation[]) => void;
  onInsertSummary: (markdown: string) => void;
  onRevealOffset: (offset: number) => void;
}

export default function NotesAssistant({
  courseId, level, noteTitle, noteContent,
  annotations, onAnnotations, onInsertSummary, onRevealOffset,
}: NotesAssistantProps) {
  const [busy, setBusy] = useState<null | "review" | "summary">(null);
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);

  const runReview = async () => {
    if (!noteContent.trim()) { setError("Nothing to review yet — write something first."); return; }
    setBusy("review"); setError(null); setSummary(null); setDropped(0);
    try {
      const cfg = await getChatConfig();
      const { annotations: raw } = await callLLMStructured<{ annotations: Annotation[] }>(
        buildReviewMessages(noteTitle, noteContent),
        cfg,
        {
          schema: REVIEW_SCHEMA,
          toolName: "ReviewNote",
          temperature: 0.1,
          // Forces a repair-retry when the model paraphrases instead of quoting. Without this a small
          // model's remarks are mostly unanchorable and the whole feature reads as broken.
          validate: validateReview(noteContent),
        },
      );
      const anchored = anchorAnnotations(noteContent, raw);
      setDropped(unanchorable(noteContent, raw).length);
      onAnnotations(anchored);
      if (!anchored.length) setError("No remarks came back that could be placed in the note.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runSummary = async () => {
    setBusy("summary"); setError(null); setSummary(null);
    try {
      const threads = await listChatThreads(courseId, level);
      if (!threads.length) { setError("No conversation on this level yet."); return; }
      const messages = await getChatMessages(threads[0].id);
      const transcript = formatTranscript(messages);
      if (!transcript.trim()) { setError(`“${threads[0].title || "Untitled"}” has no messages yet.`); return; }

      const cfg = await getChatConfig();
      const { markdown } = await callLLMStructured<{ markdown: string }>(
        buildSummaryMessages(transcript), cfg,
        { schema: SUMMARY_SCHEMA, toolName: "SummariseConversation", temperature: 0.2 },
      );
      setSummary(markdown);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const counts = annotations.reduce<Record<string, number>>((acc, a) => {
    acc[a.kind] = (acc[a.kind] ?? 0) + 1; return acc;
  }, {});

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 flex flex-col gap-2 border-b border-[var(--rule)] shrink-0">
        <button
          onClick={runReview}
          disabled={busy !== null}
          className="btn w-full justify-center text-[11px] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy === "review" ? "Reading your note…" : "Review this note"}
        </button>
        <button
          onClick={runSummary}
          disabled={busy !== null}
          className="btn w-full justify-center text-[11px] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy === "summary" ? "Reading the conversation…" : "Notes from last chat"}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {error && (
          <p className="m-3 px-3 py-2 rounded-lg text-[11px] leading-snug"
             style={{ background: "rgb(255 64 96 / .1)", border: "1px solid rgb(255 64 96 / .4)", color: "#FF4060" }}>
            {error}
          </p>
        )}

        {/* ── Review marks ── */}
        {annotations.length > 0 && (
          <div className="pb-2">
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)] flex-1">
                {annotations.length} mark{annotations.length === 1 ? "" : "s"}
              </span>
              <button
                onClick={() => { onAnnotations([]); setDropped(0); }}
                className="text-[10px] text-[var(--ink-faint)] hover:text-phosphor-bright transition-colors"
              >
                clear
              </button>
            </div>

            <div className="flex gap-2 px-3 pb-2 flex-wrap">
              {(Object.keys(KIND_META) as AnnotationKind[]).filter((k) => counts[k]).map((k) => (
                <span key={k} className="inline-flex items-center gap-1 text-[10px] font-mono"
                      style={{ color: KIND_META[k].color }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d={KIND_META[k].glyph} />
                  </svg>
                  {counts[k]} {KIND_META[k].label.toLowerCase()}
                </span>
              ))}
            </div>

            {annotations.map((a, i) => (
              <button
                key={`${a.from}-${a.kind}-${i}`}
                onClick={() => onRevealOffset(a.from)}
                className="w-full text-left px-3 py-2 hover:bg-panel-lite/60 transition-colors border-l-2"
                style={{ borderLeftColor: KIND_META[a.kind].color }}
              >
                <span className="block text-[11px] font-mono truncate" style={{ color: KIND_META[a.kind].color }}>
                  “{a.quote}”
                </span>
                <span className="block text-[11px] leading-snug text-[var(--ink-dim)] mt-0.5">{a.note}</span>
              </button>
            ))}

            {dropped > 0 && (
              <p className="px-3 pt-2 text-[10px] leading-snug text-[var(--ink-faint)]">
                {dropped} more remark{dropped === 1 ? "" : "s"} were dropped — the model didn't quote the
                note exactly, so they couldn't be placed.
              </p>
            )}
          </div>
        )}

        {/* ── Summary preview ── */}
        {summary && (
          <div className="p-3">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)] mb-2">
              From your last conversation
            </div>
            <pre className="text-[11px] leading-relaxed text-[var(--ink-dim)] whitespace-pre-wrap font-sans
                            bg-lcd border border-[var(--rule)] rounded-lg p-2.5 max-h-64 overflow-y-auto">
              {summary}
            </pre>
            <div className="flex gap-2 mt-2">
              <button onClick={() => { onInsertSummary(summary); setSummary(null); }}
                      className="btn btn-primary flex-1 justify-center text-[11px]">
                Insert into note
              </button>
              <button onClick={() => setSummary(null)} className="btn text-[11px]">Discard</button>
            </div>
          </div>
        )}

        {!error && !summary && annotations.length === 0 && busy === null && (
          <p className="px-3 py-4 text-[11px] leading-relaxed text-[var(--ink-faint)]">
            <strong className="text-[var(--ink-dim)]">Review</strong> marks up this note in place —
            what's wrong, what's missing, what to double-check, and what you got right. Marks are an
            overlay; your note isn't touched.
            <br /><br />
            <strong className="text-[var(--ink-dim)]">Notes from last chat</strong> turns your most
            recent tutor conversation on this level into something you can keep.
          </p>
        )}
      </div>
    </div>
  );
}
