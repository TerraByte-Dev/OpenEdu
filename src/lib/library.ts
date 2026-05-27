// OpenEdu Library — a curated, self-hosted educational corpus the live tutor can consult mid-lesson
// (periodic table, unit circle, formulas, definitions…). It replaces "scrape the open web" with
// "fetch a clean, pre-formatted reference card we author and control": no HTML noise, no prompt-
// injection surface, no per-search cost. The library is hosted as a static site (Cloudflare Pages):
// an `index.json` manifest the app fetches once, plus resource bodies fetched on demand by path.
//
// Retrieval is CLIENT-SIDE and LEXICAL for v1 (no embedding-model coupling, deterministic): the app
// scores a query against curated titles/aliases/tags/summary. Semantic rerank (reusing embed() +
// cosineSim) is a deferred upgrade.
//
// Offline-first: availability is driven by an in-memory manifest cache that `refreshManifest()`
// hydrates at app init (from the persisted last-good copy first, then a network update). No manifest
// cached ⇒ `isLibraryAvailable()` is false ⇒ the library.search tool is hidden ⇒ the app is unchanged.

import { fetch } from "@tauri-apps/plugin-http";
import type { LibraryEntry } from "../types";
import { getLibraryEnabled, getLibraryUrl, getLibraryManifestCache, setLibraryManifestCache } from "./store";

// Baked-in default host (also allow-listed in src-tauri/capabilities/default.json). A Settings
// override (getLibraryUrl) wins when set — but it must be allow-listed too, or fetch is blocked.
export const LIBRARY_DEFAULT_BASE = "https://library.openedu.app";

// In-memory manifest cache. Populated by refreshManifest()/getManifest(); the single source of truth
// for isLibraryAvailable(). Module-level so it survives across turns within a session.
let memManifest: LibraryEntry[] | null = null;

// Eval guard: when true, the library reports unavailable regardless of cache, so the golden harness
// runs apples-to-apples with the library off (it predates this capability). Scoped + restored by the
// eval runner — never flipped in normal app flow.
let disabledForTesting = false;

export function setLibraryEnabledForTesting(enabled: boolean): void {
  disabledForTesting = !enabled;
}

async function resolveBase(): Promise<string> {
  const override = await getLibraryUrl();
  return (override || LIBRARY_DEFAULT_BASE).replace(/\/+$/, "");
}

// Defensive: the manifest is our own, but coerce/validate so a malformed deploy can't crash the tutor.
function normalizeManifest(data: unknown): LibraryEntry[] {
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { resources?: unknown })?.resources)
      ? (data as { resources: unknown[] }).resources
      : [];
  const out: LibraryEntry[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.title !== "string" || typeof r.path !== "string") continue;
    out.push({
      id: r.id,
      title: r.title,
      path: r.path,
      aliases: Array.isArray(r.aliases) ? r.aliases.filter((a): a is string => typeof a === "string") : [],
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : [],
      subject: typeof r.subject === "string" ? r.subject : "",
      summary: typeof r.summary === "string" ? r.summary : "",
    });
  }
  return out;
}

async function fetchManifestFromNetwork(): Promise<LibraryEntry[]> {
  const base = await resolveBase();
  const res = await fetch(`${base}/index.json`, { method: "GET", headers: { "Origin": "" } });
  if (!res.ok) throw new Error(`library manifest fetch failed: ${res.status}`);
  const entries = normalizeManifest(await res.json());
  memManifest = entries;
  await setLibraryManifestCache(entries).catch(() => {}); // persistence is best-effort
  return entries;
}

// Return the manifest, preferring the warm in-memory copy, then the persisted last-good copy, then a
// live fetch. The tool path uses this so a lookup never blocks on the network when already synced.
export async function getManifest(): Promise<LibraryEntry[]> {
  if (memManifest) return memManifest;
  const cached = await getLibraryManifestCache().catch(() => null);
  if (cached) {
    const e = normalizeManifest(cached);
    if (e.length) { memManifest = e; return e; }
  }
  return fetchManifestFromNetwork();
}

// App-init warm-up (called from main.tsx). Hydrate from the persisted cache first so the library is
// available offline after one prior sync, then try a network update. Swallows network failure (not
// deployed yet / offline) — the cached copy, if any, stands.
export async function refreshManifest(): Promise<void> {
  if (!(await getLibraryEnabled())) return;
  if (!memManifest) {
    const cached = await getLibraryManifestCache().catch(() => null);
    if (cached) {
      const e = normalizeManifest(cached);
      if (e.length) memManifest = e;
    }
  }
  try {
    await fetchManifestFromNetwork();
  } catch {
    /* offline or library not deployed — keep whatever cached copy we have */
  }
}

// Synchronous availability check for the tool's isEnabled. True only when a manifest is cached in
// memory (and not suppressed for eval). Combined with the getLibraryEnabled() setting by the tool.
export function isLibraryAvailable(): boolean {
  return !disabledForTesting && memManifest !== null && memManifest.length > 0;
}

// ── lexical matching (pure, unit-testable) ──
const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "to", "in", "on", "is", "are", "what", "whats", "show", "me", "my",
  "tell", "about", "give", "list", "and", "or", "how", "do", "i", "you", "can", "with", "this", "that",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function normalizePhrase(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreEntry(qTokens: string[], qPhrase: string, entry: LibraryEntry): number {
  let score = 0;
  // Phrase bonus: a curated title/alias that the query contains (or vice-versa) is a near-certain
  // hit — this is what makes "periodic table" / "table of elements" land cleanly.
  for (const name of [entry.title, ...entry.aliases]) {
    const n = normalizePhrase(name);
    if (!n) continue;
    if (qPhrase === n) score += 12;
    else if (qPhrase.includes(n) || n.includes(qPhrase)) score += 6;
  }
  // Weighted token overlap.
  const fields: Array<[string, number]> = [
    [entry.title, 3],
    [entry.aliases.join(" "), 3],
    [entry.tags.join(" "), 2],
    [entry.summary, 1],
  ];
  for (const [text, weight] of fields) {
    const fieldTokens = new Set(tokenize(text));
    for (const qt of qTokens) if (fieldTokens.has(qt)) score += weight;
  }
  return score;
}

// Score every entry against the query; return the top-N above zero, best first. Pure — no I/O.
export function matchResources(query: string, manifest: LibraryEntry[], topN = 3): LibraryEntry[] {
  const qTokens = tokenize(query);
  const qPhrase = normalizePhrase(query);
  if (qTokens.length === 0 && !qPhrase) return [];
  return manifest
    .map((e) => ({ e, score: scoreEntry(qTokens, qPhrase, e) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((x) => x.e);
}

function stripFrontmatter(text: string): string {
  // Remove a leading YAML frontmatter block (---\n … \n---) if present.
  const m = text.match(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? text.slice(m[0].length) : text;
}

export function resourceUrl(base: string, entry: LibraryEntry): string {
  return `${base}/${entry.path.replace(/^\/+/, "")}`;
}

// Fetch a resource body, strip frontmatter, hard-cap the length to protect a small model's context.
export async function fetchResource(entry: LibraryEntry, maxChars = 2500): Promise<{ text: string; url: string }> {
  const base = await resolveBase();
  const url = resourceUrl(base, entry);
  const res = await fetch(url, { method: "GET", headers: { "Origin": "" } });
  if (!res.ok) throw new Error(`library resource fetch failed: ${res.status}`);
  let text = stripFrontmatter(await res.text()).trim();
  if (text.length > maxChars) text = text.slice(0, maxChars).trimEnd() + "\n\n…(truncated — ask for more if needed)";
  return { text, url };
}
