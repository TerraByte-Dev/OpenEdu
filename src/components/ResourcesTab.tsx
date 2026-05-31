import { useState, useEffect, useMemo, useCallback } from "react";
import type { Course, Syllabus, LibraryEntry } from "../types";
import { getManifest, matchResources, fetchResource, fetchAsset } from "../lib/library";
import { renderChatMarkdown } from "../lib/chat-markdown";

// Resources tab — the curated OpenEdu Library, browsable by the STUDENT (not just fuel for the
// tutor's answer). Default view recommends cards relevant to this course; the search box reaches any
// card; clicking one renders its full body. A chat 🔗 citation chip deep-links here via
// `pendingResourceId` (consumed once, mirroring ChatTab's seedTopic pattern).
interface ResourcesTabProps {
  course: Course;
  currentSyllabus: Syllabus | null;
  // Deep-link target id from a chat citation chip; opened on arrival, then `onPendingConsumed` clears it.
  pendingResourceId?: string | null;
  onPendingConsumed?: () => void;
}

// Human-facing view shows the WHOLE card — not the model-capped slice the library.search tool uses.
const FULL_CARD = 100_000;

export default function ResourcesTab({ course, currentSyllabus, pendingResourceId, onPendingConsumed }: ResourcesTabProps) {
  const [manifest, setManifest] = useState<LibraryEntry[]>([]);
  const [loadingManifest, setLoadingManifest] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LibraryEntry | null>(null);
  const [body, setBody] = useState<{ text: string; url: string } | null>(null);
  const [loadingBody, setLoadingBody] = useState(false);
  const [bodyError, setBodyError] = useState("");
  // The authored SVG "raw form" (when the card has one) + which view the reader is showing.
  const [assetSvg, setAssetSvg] = useState<string | null>(null);
  const [view, setView] = useState<"diagram" | "text">("text");

  // Load the manifest once (cached + offline-safe after main.tsx's init warm-up).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const m = await getManifest();
        if (alive) setManifest(m);
      } catch {
        if (alive) setManifest([]);
      } finally {
        if (alive) setLoadingManifest(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Relevance query for the default view = this course's topic + the viewed level's subtopics.
  const courseQuery = useMemo(() => {
    const parts = [course.topic];
    if (currentSyllabus) {
      for (const s of currentSyllabus.subtopics) {
        parts.push(s.title, ...s.key_concepts);
      }
    }
    return parts.join(" ");
  }, [course.topic, currentSyllabus]);

  // The list to render: search hits when querying, else course-recommended (fall back to all A–Z).
  const list = useMemo(() => {
    if (!manifest.length) return [];
    if (query.trim()) return matchResources(query, manifest, 20);
    const recommended = matchResources(courseQuery, manifest, 12);
    return recommended.length ? recommended : [...manifest].sort((a, b) => a.title.localeCompare(b.title));
  }, [manifest, query, courseQuery]);

  const openCard = useCallback(async (entry: LibraryEntry) => {
    setSelected(entry);
    setBody(null);
    setBodyError("");
    setAssetSvg(null);
    setView(entry.asset ? "diagram" : "text"); // lead with the visual when a card has one
    setLoadingBody(true);
    // Fetch the model-readable body (text view) and the optional SVG "raw form" (diagram view) together.
    const tasks: Promise<unknown>[] = [
      fetchResource(entry, FULL_CARD).then(setBody, (e) => setBodyError(e instanceof Error ? e.message : String(e))),
    ];
    if (entry.asset) {
      // Graceful: a missing/failed asset (e.g. partial deploy 404) just falls back to the text view.
      tasks.push(fetchAsset(entry).then(setAssetSvg, () => { setAssetSvg(null); setView("text"); }));
    }
    await Promise.all(tasks);
    setLoadingBody(false);
  }, []);

  // Deep-link: a chip in chat set pendingResourceId — open that card, then consume the request.
  useEffect(() => {
    if (!pendingResourceId || !manifest.length) return;
    const entry = manifest.find((e) => e.id === pendingResourceId);
    if (entry) void openCard(entry);
    onPendingConsumed?.();
  }, [pendingResourceId, manifest, openCard, onPendingConsumed]);

  // Same-subject siblings make a clean, clickable "Related" set in the reader.
  const related = useMemo(() => {
    if (!selected) return [];
    return manifest.filter((e) => e.subject && e.subject === selected.subject && e.id !== selected.id).slice(0, 6);
  }, [manifest, selected]);

  // ── Reader view ──
  if (selected) {
    return (
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-2xl mx-auto p-6">
          <button
            onClick={() => { setSelected(null); setBody(null); setBodyError(""); setAssetSvg(null); setView("text"); }}
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--ink-faint)] hover:text-phosphor-bright transition-colors mb-4"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            All resources
          </button>

          {selected.subject && <span className="tag mb-3">{selected.subject}</span>}
          <h2 className="font-display text-2xl text-phosphor uppercase tracking-wide mb-1">{selected.title}</h2>
          <div className="glow-line mb-4" />

          {/* Diagram | Text toggle — only when the card has an SVG that loaded; defaults to Diagram. */}
          {selected.asset && assetSvg && (
            <div className="inline-flex rounded-lg border border-[var(--rule)] overflow-hidden mb-4 text-xs font-mono">
              <button
                onClick={() => setView("diagram")}
                className={`px-3 py-1.5 transition-colors ${view === "diagram" ? "bg-phosphor/15 text-phosphor-bright" : "text-[var(--ink-faint)] hover:text-phosphor-bright"}`}
              >
                Diagram
              </button>
              <button
                onClick={() => setView("text")}
                className={`px-3 py-1.5 border-l border-[var(--rule)] transition-colors ${view === "text" ? "bg-phosphor/15 text-phosphor-bright" : "text-[var(--ink-faint)] hover:text-phosphor-bright"}`}
              >
                Text
              </button>
            </div>
          )}

          {loadingBody && !body && !assetSvg && <div className="text-sm text-[var(--ink-faint)] font-mono">Loading reference…</div>}
          {bodyError && view === "text" && <div className="text-sm text-red-400">Couldn't load this resource: {bodyError}</div>}

          {view === "diagram" && assetSvg ? (
            <div
              className="oe-svg w-full overflow-x-auto rounded-lg border border-[var(--rule)] bg-white p-3"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: assetSvg }}
            />
          ) : body ? (
            <div
              className="note-prose"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: renderChatMarkdown(body.text) }}
            />
          ) : null}

          {body && related.length > 0 && (
            <div className="mt-8 pt-4 border-t border-[var(--rule)]">
              <div className="text-[10px] uppercase tracking-wider text-[var(--ink-faint)] font-semibold mb-2">Related</div>
              <div className="flex flex-wrap gap-2">
                {related.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => void openCard(e)}
                    className="px-3 py-1.5 rounded-lg text-xs font-mono bg-lcd border border-phosphor/20 text-phosphor-ink hover:border-phosphor/50 hover:text-phosphor-bright transition-colors"
                  >
                    {e.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-4 border-b border-[var(--rule)] bg-panel shrink-0">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the library…"
          className="cf-input w-full rounded-lg max-w-2xl mx-auto block"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        <div className="max-w-2xl mx-auto">
          {loadingManifest ? (
            <div className="text-center py-12 text-sm text-[var(--ink-faint)] font-mono">Loading library…</div>
          ) : !manifest.length ? (
            <div className="text-center py-12">
              <p className="text-[var(--ink-faint)]">The OpenEdu Library isn't available right now.</p>
              <p className="text-xs text-[var(--ink-faint)] mt-1">It appears here once it's reachable (and enabled in Settings).</p>
            </div>
          ) : (
            <>
              <div className="text-[10px] uppercase tracking-wider text-[var(--ink-faint)] font-semibold mb-3">
                {query.trim() ? "Search results" : "Recommended for this course"}
              </div>
              {list.length === 0 ? (
                <div className="text-sm text-[var(--ink-faint)] py-6">No matching resources. Try a different search.</div>
              ) : (
                <div className="space-y-2">
                  {list.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => void openCard(entry)}
                      className="w-full text-left p-3 rounded-xl bg-panel-lite/50 border border-[var(--rule)] hover:border-phosphor/40 hover:bg-panel-lite transition-colors group"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-phosphor-ink group-hover:text-phosphor-bright shrink-0">🔗</span>
                        <span className="text-sm text-ink font-medium">{entry.title}</span>
                        {entry.subject && <span className="ml-auto text-[10px] font-mono text-[var(--ink-faint)] uppercase shrink-0">{entry.subject}</span>}
                      </div>
                      {entry.summary && <p className="text-xs text-[var(--ink-faint)] mt-1 pl-6">{entry.summary}</p>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
