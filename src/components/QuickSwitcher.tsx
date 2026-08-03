// Quick switcher — Ctrl/Cmd+O, the way you actually move around a vault once it has more than a screen
// of notes. Subsequence matching (see lib/fuzzy.ts), so "cvc" finds "Calvin cycle".
//
// Deliberately does NOT create notes. Every other create path in the vault is explicit, and a switcher
// that quietly makes a note when you mistype a title is how vaults fill up with empty files.

import { useState, useEffect, useRef, useMemo } from "react";
import type { Note } from "../types";
import { fuzzyFilter, highlightRuns } from "../lib/fuzzy";

const MAX_RESULTS = 50; // the list is keyboard-driven; past this nobody is arrowing down anyway

export interface QuickSwitcherProps {
  open: boolean;
  notes: readonly Note[];
  onClose: () => void;
  onSelect: (noteId: string) => void;
}

export default function QuickSwitcher({ open, notes, onClose, onSelect }: QuickSwitcherProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () => fuzzyFilter(query, notes, (n) => n.title || "Untitled").slice(0, MAX_RESULTS),
    [query, notes],
  );

  // Reset on every open — reopening with the last query still typed is disorienting.
  useEffect(() => {
    if (open) { setQuery(""); setActive(0); inputRef.current?.focus(); }
  }, [open]);

  // Clamp rather than reset when the result set shrinks under the cursor, so narrowing a query keeps
  // your selection near where it was instead of jumping back to the top.
  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, results.length - 1))); }, [results.length]);

  // Keep the active row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const commit = (i: number) => {
    const hit = results[i];
    if (hit) { onSelect(hit.item.id); onClose(); }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      setActive((a) => (results.length ? (a + 1) % results.length : 0));
    } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/50"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick switcher"
        className="w-[min(540px,92vw)] rounded-xl border border-[var(--rule)] bg-panel shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Jump to a note…"
          aria-label="Search notes"
          className="w-full px-4 py-3 bg-transparent text-ink text-sm border-b border-[var(--rule)]
                     focus:outline-none placeholder-[var(--ink-faint)]"
        />

        <div ref={listRef} className="max-h-[46vh] overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-[var(--ink-faint)]">
              {notes.length === 0 ? "No notes yet." : `Nothing matches “${query}”.`}
            </p>
          ) : (
            results.map((r, i) => (
              <button
                key={r.item.id}
                data-active={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(i)}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  i === active ? "bg-[rgb(var(--phosphor-rgb)/0.10)] text-phosphor-bright" : "text-[var(--ink-dim)]"
                }`}
              >
                {highlightRuns(r.item.title || "Untitled", r.positions).map((run, j) =>
                  run.hit
                    ? <mark key={j} className="bg-transparent text-phosphor font-semibold">{run.text}</mark>
                    : <span key={j}>{run.text}</span>,
                )}
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-t border-[var(--rule)] bg-panel-lite/50
                        text-[10px] font-mono text-[var(--ink-faint)]">
          <span>↑↓ navigate</span><span>⏎ open</span><span>esc close</span>
          <span className="ml-auto">{results.length}{results.length === MAX_RESULTS ? "+" : ""}</span>
        </div>
      </div>
    </div>
  );
}
