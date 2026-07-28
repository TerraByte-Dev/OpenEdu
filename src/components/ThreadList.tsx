// The conversation list, as it appears in the course rail.
//
// This lived in a header dropdown for exactly as long as there was no column to put it in. A list you
// consult while working belongs beside the work, not behind a click — the dropdown made switching
// conversations a deliberate act rather than a glance.

import type { ChatThread } from "../lib/db";

export interface ThreadListProps {
  threads: ChatThread[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

// "3h ago" beats a timestamp in a list you scan — the useful question is how recent, not when.
function relativeDate(iso: string): string {
  const then = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z").getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export default function ThreadList({ threads, activeId, onOpen, onNew, onDelete }: ThreadListProps) {
  return (
    <>
      <div className="flex items-center justify-between px-2.5 py-1.5 shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-[var(--ink-faint)]">Conversations</span>
        <button
          type="button"
          onClick={onNew}
          title="Start a new conversation"
          className="px-1.5 py-0.5 rounded text-[11px] text-[var(--ink-faint)] hover:text-phosphor-bright hover:bg-panel-lite transition-colors"
        >
          ＋
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-1.5 flex flex-col gap-0.5">
        {threads.length === 0 && (
          <p className="px-1.5 py-2 text-[11px] text-[var(--ink-faint)] leading-snug">
            Nothing yet at this level. Ask something to start one.
          </p>
        )}
        {threads.map((t) => {
          const active = t.id === activeId;
          return (
            <div
              key={t.id}
              className={`group flex items-center rounded-md ${active ? "bg-lcd" : "hover:bg-panel-lite"}`}
            >
              <button
                type="button"
                onClick={() => onOpen(t.id)}
                className="flex-1 min-w-0 text-left px-2 py-1.5"
              >
                <span className={`block text-[12px] truncate ${active ? "text-phosphor-bright" : "text-[var(--ink-dim)]"}`}>
                  {t.title || "Untitled"}
                </span>
                <span className="block text-[10px] text-[var(--ink-faint)]">{relativeDate(t.updated_at)}</span>
              </button>
              {/* Only on hover: a delete affordance permanently visible next to every row invites the
                  mis-click it exists to enable. */}
              <button
                type="button"
                onClick={() => onDelete(t.id)}
                title="Delete this conversation"
                className="px-1.5 py-1.5 text-[var(--ink-faint)] opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
