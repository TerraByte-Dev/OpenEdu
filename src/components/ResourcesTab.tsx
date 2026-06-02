import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import type { Course, Syllabus, LibraryEntry } from "../types";
import { getManifest, matchResources, fetchResource, fetchAsset } from "../lib/library";
import { renderChatMarkdown } from "../lib/chat-markdown";

// Resources tab — the curated OpenEdu Library, browsable by the STUDENT (not just fuel for the
// tutor's answer). The list view is a paginated grid: it defaults to cards recommended for this
// course, but a subject-filter chip bar + numbered pagination let the reader walk the WHOLE corpus
// (every subject, every page). The search box reaches any card; clicking one renders its full body.
// A chat 🔗 citation chip deep-links here via `pendingResourceId` (consumed once, mirroring
// ChatTab's seedTopic pattern).
interface ResourcesTabProps {
  course: Course;
  currentSyllabus: Syllabus | null;
  // Deep-link target id from a chat citation chip; opened on arrival, then `onPendingConsumed` clears it.
  pendingResourceId?: string | null;
  onPendingConsumed?: () => void;
}

// Human-facing view shows the WHOLE card — not the model-capped slice the library.search tool uses.
const FULL_CARD = 100_000;

// Browse-grid tuning.
const PAGE_SIZE = 24;        // tiles per page (fills a 3-col grid × 8 rows)
const ALL = "__all__";       // browse pseudo-filter: the whole library, A–Z (vs. a specific subject)

// Pretty names for the coarse `subject` slugs used as category chips. Unknown slugs fall back to a
// title-cased form, so new subjects (batch 4/5: economics, world-history…) surface automatically.
const SUBJECT_LABELS: Record<string, string> = {
  math: "Mathematics",
  chemistry: "Chemistry",
  biology: "Biology",
  "earth-space": "Earth & Space",
  ela: "English / ELA",
  physics: "Physics",
  "us-history-civics": "History & Civics",
  geography: "Geography",
  economics: "Economics",
  "world-history": "World History",
  music: "Music",
  "arts-music-cs": "Arts & CS",
  reference: "Reference",
};
const subjectLabel = (s: string) =>
  SUBJECT_LABELS[s] ?? (s || "Other").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const byTitle = (a: LibraryEntry, b: LibraryEntry) => a.title.localeCompare(b.title);

export default function ResourcesTab({ course, currentSyllabus, pendingResourceId, onPendingConsumed }: ResourcesTabProps) {
  const [manifest, setManifest] = useState<LibraryEntry[]>([]);
  const [loadingManifest, setLoadingManifest] = useState(true);
  const [query, setQuery] = useState("");
  // Home shows the course-recommended grid; "View library" flips `browsing` on to reveal the full
  // corpus with subject-filter chips. `activeSubject` (ALL | <subject>) only matters while browsing.
  const [browsing, setBrowsing] = useState(false);
  const [activeSubject, setActiveSubject] = useState<string>(ALL);
  const [page, setPage] = useState(1);
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

  // Subject buckets (the category chips), with counts, most-stocked first.
  const subjects = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of manifest) counts.set(e.subject || "other", (counts.get(e.subject || "other") ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([id, count]) => ({ id, count, label: subjectLabel(id) }));
  }, [manifest]);

  // Course-recommended shortlist (the default landing). Empty ⇒ the ★ chip hides and we fall to ALL.
  const recommended = useMemo(
    () => (manifest.length ? matchResources(courseQuery, manifest, 36) : []),
    [manifest, courseQuery],
  );

  // The result set for the current mode + search — NOT capped to a handful, so it paginates.
  const results = useMemo(() => {
    if (!manifest.length) return [];
    const q = query.trim();
    if (q) {
      // Search composes with the active subject while browsing; otherwise it spans the whole library.
      const scope = browsing && activeSubject !== ALL ? manifest.filter((e) => e.subject === activeSubject) : manifest;
      return matchResources(q, scope, scope.length);
    }
    if (!browsing) return recommended.length ? recommended : [...manifest].sort(byTitle);
    if (activeSubject === ALL) return [...manifest].sort(byTitle);
    return manifest.filter((e) => e.subject === activeSubject).sort(byTitle);
  }, [manifest, query, browsing, activeSubject, recommended]);

  // Reset to page 1 whenever the filtered set changes under us.
  useEffect(() => { setPage(1); }, [query, browsing, activeSubject]);

  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = results.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Compact, scalable page window: first, last, and a ±2 band around the current page (gaps → "…").
  const pageNumbers = useMemo(() => {
    const set = new Set<number>([1, pageCount]);
    for (let p = safePage - 2; p <= safePage + 2; p++) if (p >= 1 && p <= pageCount) set.add(p);
    return [...set].sort((a, b) => a - b);
  }, [pageCount, safePage]);

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

  // Category chip — shared style for the ★ Recommended / All / per-subject filters.
  const chip = (key: string, label: string, count: number | null, active: boolean) => (
    <button
      key={key}
      onClick={() => setActiveSubject(key)}
      aria-pressed={active}
      className={`px-2.5 py-1 rounded-lg text-xs font-mono whitespace-nowrap border transition-colors ${
        active
          ? "bg-phosphor/15 border-phosphor/60 text-phosphor-bright"
          : "bg-lcd border-[var(--rule)] text-phosphor-ink hover:border-phosphor/40 hover:text-phosphor-bright"
      }`}
    >
      {label}
      {count != null && <span className="ml-1.5 opacity-60">{count}</span>}
    </button>
  );

  // Result-count caption above the grid.
  const q = query.trim();
  const countLabel = q
    ? `${results.length} result${results.length === 1 ? "" : "s"} for “${q}”`
    : !browsing
      ? recommended.length
        ? `${results.length} recommended for this course`
        : `${results.length} resources`
      : activeSubject === ALL
        ? `${results.length} resources`
        : `${results.length} in ${subjectLabel(activeSubject)}`;

  // ── List / browse view ──
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-4 border-b border-[var(--rule)] bg-panel shrink-0">
        <div className="max-w-5xl mx-auto space-y-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={browsing ? "Search the library…" : "Search all resources…"}
            className="cf-input w-full max-w-xl rounded-lg block"
          />
          {/* Subject-filter chips appear only in library-browse mode; the leading chip returns home. */}
          {manifest.length > 0 && browsing && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <button
                onClick={() => { setBrowsing(false); setActiveSubject(ALL); }}
                className="px-2.5 py-1 rounded-lg text-xs font-mono whitespace-nowrap border border-[var(--rule)] text-[var(--ink-faint)] hover:border-phosphor/40 hover:text-phosphor-bright transition-colors"
              >
                ← Recommended
              </button>
              {chip(ALL, "All", manifest.length, activeSubject === ALL)}
              {subjects.map((s) => chip(s.id, s.label, s.count, activeSubject === s.id))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        <div className="max-w-5xl mx-auto">
          {loadingManifest ? (
            <div className="text-center py-12 text-sm text-[var(--ink-faint)] font-mono">Loading library…</div>
          ) : !manifest.length ? (
            <div className="text-center py-12">
              <p className="text-[var(--ink-faint)]">The OpenEdu Library isn't available right now.</p>
              <p className="text-xs text-[var(--ink-faint)] mt-1">It appears here once it's reachable (and enabled in Settings).</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-[10px] uppercase tracking-wider text-[var(--ink-faint)] font-semibold">{countLabel}</div>
                {!browsing && (
                  <button
                    onClick={() => { setBrowsing(true); setActiveSubject(ALL); }}
                    className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono border border-phosphor/30 bg-lcd text-phosphor-ink hover:border-phosphor/60 hover:text-phosphor-bright transition-colors"
                    title="Browse every resource by subject"
                  >
                    View library
                    <span className="opacity-60">{manifest.length}</span>
                    <span aria-hidden>→</span>
                  </button>
                )}
              </div>

              {results.length === 0 ? (
                <div className="text-sm text-[var(--ink-faint)] py-6">No matching resources. Try a different search or category.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {pageItems.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => void openCard(entry)}
                      className="flex flex-col text-left h-full p-3.5 rounded-xl bg-panel-lite/50 border border-[var(--rule)] hover:border-phosphor/50 hover:bg-panel-lite transition-colors group"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] font-mono text-[var(--ink-faint)] uppercase tracking-wider truncate">
                          {subjectLabel(entry.subject)}
                        </span>
                        {entry.asset && (
                          <span
                            className="ml-auto shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider border border-phosphor/30 text-phosphor-ink/80 group-hover:text-phosphor-bright group-hover:border-phosphor/50 transition-colors"
                            title="This card has a diagram"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 15l5-5 4 4 5-6 4 5" /></svg>
                            Diagram
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-ink font-medium leading-snug group-hover:text-phosphor-bright transition-colors line-clamp-2">
                        {entry.title}
                      </div>
                      {entry.summary && <p className="text-xs text-[var(--ink-faint)] mt-1.5 line-clamp-3">{entry.summary}</p>}
                    </button>
                  ))}
                </div>
              )}

              {pageCount > 1 && (
                <div className="flex items-center justify-center flex-wrap gap-1.5 mt-6 pt-4 border-t border-[var(--rule)]">
                  <button
                    onClick={() => setPage(safePage - 1)}
                    disabled={safePage <= 1}
                    className="px-3 py-1.5 rounded-lg text-xs font-mono border border-[var(--rule)] text-phosphor-ink enabled:hover:border-phosphor/50 enabled:hover:text-phosphor-bright disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    ‹ Prev
                  </button>
                  {pageNumbers.map((p, i) => (
                    <Fragment key={p}>
                      {i > 0 && p - pageNumbers[i - 1] > 1 && <span className="px-1 text-[var(--ink-faint)]">…</span>}
                      <button
                        onClick={() => setPage(p)}
                        aria-current={p === safePage}
                        className={`min-w-[2rem] px-2 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                          p === safePage
                            ? "bg-phosphor/15 border-phosphor/60 text-phosphor-bright"
                            : "border-[var(--rule)] text-phosphor-ink hover:border-phosphor/50 hover:text-phosphor-bright"
                        }`}
                      >
                        {p}
                      </button>
                    </Fragment>
                  ))}
                  <button
                    onClick={() => setPage(safePage + 1)}
                    disabled={safePage >= pageCount}
                    className="px-3 py-1.5 rounded-lg text-xs font-mono border border-[var(--rule)] text-phosphor-ink enabled:hover:border-phosphor/50 enabled:hover:text-phosphor-bright disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Next ›
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
