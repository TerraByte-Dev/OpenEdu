// Obsidian-style "live preview" markdown editor (Phase 3). A single editable CodeMirror 6 pane —
// no Edit/Preview toggle. Headings render at heading size, bold/italic/code/quote style inline, and
// syntax markers (##, **, `, >) hide on lines the cursor isn't on (reveal-on-active-line, like
// Obsidian). [[wikilinks]] are styled + clickable (dashed when the target note is missing); #tags
// are styled + clickable (open a note-free tag view). The document stays plain markdown, so the
// notes table, graph, #tag parsing, and RAG indexing are all unchanged.

import { useEffect, useRef } from "react";
import { EditorView, keymap, ViewPlugin, Decoration, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { EditorState, StateEffect, type Range } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { findWikiLinks, findTags, linkKey } from "../lib/notebook-links";

// Dispatched when the set of existing note titles changes so missing/exists link styling refreshes.
const refreshLinks = StateEffect.define<null>();

// Syntax markers we hide on inactive lines (revealed when the cursor is on that line).
const HIDE_MARKS = new Set(["HeaderMark", "EmphasisMark", "CodeMark", "QuoteMark", "StrikethroughMark", "LinkMark"]);

// Inline emphasis styling (block/heading sizing is done with line decorations + theme below).
const mdHighlight = HighlightStyle.define([
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.monospace, fontFamily: "'Share Tech Mono', monospace", color: "var(--phosphor-ink)" },
  { tag: tags.link, color: "var(--phosphor-bright)" },
  { tag: tags.url, color: "var(--ink-dim)" },
  { tag: tags.quote, color: "var(--ink-dim)", fontStyle: "italic" },
  { tag: tags.list, color: "var(--phosphor-ink)" },
]);

function buildDecorations(view: EditorView, existingTitles: Set<string>): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const { state } = view;

  const activeLines = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let l = a; l <= b; l++) activeLines.add(l);
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const h = /^ATXHeading(\d)$/.exec(node.name);
        if (h) {
          const line = state.doc.lineAt(node.from);
          decos.push(Decoration.line({ class: `cm-h${h[1]}` }).range(line.from));
          return;
        }
        if (HIDE_MARKS.has(node.name)) {
          const line = state.doc.lineAt(node.from);
          if (activeLines.has(line.number)) return; // editing this line → show raw markers
          let end = node.to;
          // For headings, also swallow the space(s) after "##" so the text isn't left-indented.
          if (node.name === "HeaderMark") {
            while (end < line.to && state.doc.sliceString(end, end + 1) === " ") end++;
          }
          if (end > node.from) decos.push(Decoration.replace({}).range(node.from, end));
        }
      },
    });

    const text = state.doc.sliceString(from, to);
    for (const { title, start, end } of findWikiLinks(text)) {
      // Dashed/faint when the target note doesn't exist yet (clicking offers an explicit create).
      const missing = existingTitles.size > 0 && !existingTitles.has(linkKey(title));
      decos.push(Decoration.mark({ class: missing ? "cm-wikilink cm-wikilink--missing" : "cm-wikilink" }).range(from + start, from + end));
    }
    for (const { start, end } of findTags(text)) {
      decos.push(Decoration.mark({ class: "cm-tag" }).range(from + start, from + end));
    }
  }

  return Decoration.set(decos, true); // true = sort (line + mark + replace can interleave)
}

// The plugin closes over a ref so it always reads the latest existing-title set (and so a
// refreshLinks effect — dispatched when that set changes — re-runs the decorations).
function makeLivePreview(titlesRef: { current: Set<string> }) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = buildDecorations(view, titlesRef.current); }
      update(u: ViewUpdate) {
        const linksChanged = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLinks)));
        if (u.docChanged || u.selectionSet || u.viewportChanged || linksChanged) {
          this.decorations = buildDecorations(u.view, titlesRef.current);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--ink)", height: "100%", fontSize: "14px" },
  "&.cm-focused": { outline: "none" },
  // --font-body (Lexend), not a hardcoded Inter. Notes are the most-read surface in the app, and
  // Lexend is the face that was picked for reading comprehension in the first place; the editor was
  // the one place still opting out of it.
  ".cm-scroller": { fontFamily: "var(--font-body)", lineHeight: "1.65", overflow: "auto" },
  ".cm-content": { padding: "16px 20px", caretColor: "var(--phosphor)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--phosphor)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "rgb(var(--phosphor-rgb)/0.20)" },
  ".cm-h1": { fontSize: "1.7em", fontWeight: "700", color: "var(--phosphor-bright)", lineHeight: "1.35" },
  ".cm-h2": { fontSize: "1.45em", fontWeight: "700", color: "var(--phosphor-bright)", lineHeight: "1.35" },
  ".cm-h3": { fontSize: "1.25em", fontWeight: "600", color: "var(--phosphor-ink)" },
  ".cm-h4": { fontSize: "1.1em", fontWeight: "600", color: "var(--phosphor-ink)" },
  ".cm-h5": { fontSize: "1em", fontWeight: "600", color: "var(--phosphor-ink)" },
  ".cm-h6": { fontSize: "0.9em", fontWeight: "600", color: "var(--ink-dim)" },
  ".cm-wikilink": { color: "var(--phosphor-bright)", textDecoration: "underline", cursor: "pointer" },
  ".cm-wikilink--missing": { color: "var(--ink-faint)", textDecoration: "underline dashed", textUnderlineOffset: "2px" },
  ".cm-wikilink--missing:hover": { color: "var(--ink-dim)" },
  ".cm-tag": { color: "var(--phosphor-ink)", backgroundColor: "rgb(var(--phosphor-rgb)/0.12)", borderRadius: "4px", padding: "0 4px", cursor: "pointer" },
  ".cm-tag:hover": { color: "var(--phosphor-bright)", backgroundColor: "rgb(var(--phosphor-rgb)/0.22)" },
});

interface Props {
  doc: string;
  noteId: string;                       // resets the editor's content when the selected note changes
  onChange: (value: string) => void;
  onBlur?: () => void;
  onWikiLinkClick: (title: string) => void;
  onTagClick?: (tag: string) => void;
  existingTitles?: Set<string>;         // normalized (linkKey) titles of every note — drives missing-link styling
  /** Scroll a 0-based line to the top of the viewport. `nonce` re-fires the same line on a repeat click. */
  revealLine?: { line: number; nonce: number } | null;
}

export default function MarkdownEditor({ doc, noteId, onChange, onBlur, onWikiLinkClick, onTagClick, existingTitles, revealLine }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Latest callbacks in a ref so the editor (created once) always calls the current ones.
  const cb = useRef({ onChange, onBlur, onWikiLinkClick, onTagClick });
  cb.current = { onChange, onBlur, onWikiLinkClick, onTagClick };
  // The plugin reads this ref so it always styles links against the current vault.
  const titlesRef = useRef<Set<string>>(existingTitles ?? new Set());
  titlesRef.current = existingTitles ?? new Set();

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        syntaxHighlighting(mdHighlight),
        makeLivePreview(titlesRef),
        EditorView.lineWrapping,
        theme,
        EditorView.updateListener.of((u) => { if (u.docChanged) cb.current.onChange(u.state.doc.toString()); }),
        EditorView.domEventHandlers({
          blur: () => { cb.current.onBlur?.(); },
          mousedown: (e, v) => {
            const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
            if (pos == null) return false;
            const line = v.state.doc.lineAt(pos);
            // Don't hijack clicks on the line you're already editing (cursor there = raw text).
            if (v.state.selection.ranges.some((r) => v.state.doc.lineAt(r.from).number === line.number)) return false;
            const rel = pos - line.from;
            for (const { title, start, end } of findWikiLinks(line.text)) {
              if (rel >= start && rel <= end) { e.preventDefault(); cb.current.onWikiLinkClick(title); return true; }
            }
            if (cb.current.onTagClick) {
              for (const { tag, start, end } of findTags(line.text)) {
                if (rel >= start && rel <= end) { e.preventDefault(); cb.current.onTagClick(tag); return true; }
              }
            }
            return false;
          },
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-run link decorations when the set of existing note titles changes (note added/renamed/deleted).
  useEffect(() => {
    view.current?.dispatch({ effects: refreshLinks.of(null) });
  }, [existingTitles]);

  // Outline click → put the cursor on that heading and scroll it to the top. Guarded against a stale
  // line number, which is easy to hit: the outline is derived from `doc`, and a fast edit can shrink
  // the document between render and click.
  useEffect(() => {
    const v = view.current;
    if (!v || !revealLine) return;
    const lineNo = Math.min(revealLine.line + 1, v.state.doc.lines);
    const line = v.state.doc.line(lineNo);
    v.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "start" }) });
    v.focus();
  }, [revealLine]);

  // Switching notes → swap the document (typing changes `doc` too, but noteId stays, so no churn).
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== doc) v.dispatch({ changes: { from: 0, to: cur.length, insert: doc }, selection: { anchor: 0 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  return <div ref={host} className="flex-1 min-h-0 overflow-hidden" />;
}
