import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SettingsContext, matchText } from "./primitives";
import { SECTIONS } from "./registry";

// Professional, tabbed Settings view. Left-rail navigation + per-row search, autosave for non-secret
// controls (the sections call ctx.markSaved after they persist), explicit Save/Verify for secrets, and a
// footer "saved" indicator. The actual settings live in the declarative SECTIONS registry.
export default function Settings({ onSaved }: { onSaved?: () => void }) {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const [query, setQuery] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const markSaved = useCallback(() => {
    setSavedFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSavedFlash(false), 1600);
  }, []);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // Sections visible in the rail given the search query (label + keyword match).
  const matchingSections = useMemo(
    () => (query.trim() ? SECTIONS.filter((s) => matchText(`${s.label} ${s.keywords}`, query)) : SECTIONS),
    [query],
  );

  // When a search hides the active tab, jump to the first matching one.
  useEffect(() => {
    if (query.trim() && matchingSections.length && !matchingSections.some((s) => s.id === activeId)) {
      setActiveId(matchingSections[0].id);
    }
  }, [query, matchingSections, activeId]);

  // Reset scroll when switching tabs.
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }); }, [activeId]);

  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0];
  const ActiveComponent = active.Component;
  const ctx = useMemo(() => ({ query, markSaved }), [query, markSaved]);

  return (
    <SettingsContext.Provider value={ctx}>
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Header */}
        <div className="px-8 pt-6 pb-4 border-b border-[var(--rule)] shrink-0">
          <div className="max-w-5xl mx-auto w-full flex items-center gap-4 flex-wrap">
            <h1 className="text-xl font-bold text-ink tracking-tight">Settings</h1>
            <div className="relative ml-auto w-full sm:w-72">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search settings…"
                className="w-full pl-9 pr-8 py-2 rounded-lg bg-panel-lite border border-[var(--rule)] text-ink text-sm focus:outline-none focus:border-phosphor transition-colors placeholder-[var(--ink-faint)]"
                spellCheck={false}
              />
              {query && (
                <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--ink-faint)] hover:text-ink" title="Clear">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Body: rail + content */}
        <div className="flex-1 min-h-0 flex">
          <nav className="w-56 shrink-0 border-r border-[var(--rule)] bg-panel py-4 px-3 overflow-y-auto">
            {matchingSections.length === 0 && (
              <p className="text-xs text-[var(--ink-faint)] px-3 py-2">No settings match “{query}”.</p>
            )}
            {matchingSections.map((s) => {
              const isActive = s.id === activeId;
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveId(s.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${
                    isActive ? "bg-[rgb(var(--phosphor-rgb)/0.10)] text-phosphor-bright border border-[rgb(var(--phosphor-rgb)/0.30)]" : "text-[var(--ink-dim)] hover:text-ink hover:bg-panel-lite border border-transparent"
                  }`}
                >
                  <span className={isActive ? "text-phosphor" : "text-[var(--ink-faint)]"}>{s.icon}</span>
                  <span className="text-left leading-tight">{s.label}</span>
                </button>
              );
            })}
          </nav>

          <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-8 py-7">
              <ActiveComponent onProviderChanged={onSaved} />
            </div>
          </div>
        </div>

        {/* Footer: save status */}
        <div className="px-8 py-2.5 border-t border-[var(--rule)] bg-panel shrink-0">
          <div className="max-w-5xl mx-auto w-full flex items-center">
            <span className={`flex items-center gap-2 text-xs transition-colors ${savedFlash ? "text-phosphor-bright" : "text-[var(--ink-faint)]"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${savedFlash ? "bg-phosphor shadow-[0_0_8px_var(--phosphor)]" : "bg-[var(--ink-faint)]"}`} />
              {savedFlash ? "Saved ✓" : "Changes save automatically · secrets need an explicit Save"}
            </span>
          </div>
        </div>
      </div>
    </SettingsContext.Provider>
  );
}
