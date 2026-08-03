// OpenEdu Library — a curated educational corpus the live tutor can consult mid-lesson (periodic table,
// unit circle, formulas, definitions…) and the student can browse in the Resources tab. It replaces
// "scrape the open web" with "read a clean, pre-formatted reference card we author and control": no HTML
// noise, no prompt-injection surface, no per-search cost.
//
// SOURCE: the library is BUNDLED with the app (public/library/ → /library/* at the app origin), so it
// works fully offline with zero deploy. A Settings `library_url` override points at a remote static host
// (e.g. https://library.openedu.app) to fetch a larger/updated corpus when desired. Bundled assets use
// the standard same-origin fetch (CSP is null); the remote override uses @tauri-apps/plugin-http (the
// host must be allow-listed in src-tauri/capabilities/default.json).
//
// Retrieval is CLIENT-SIDE and LEXICAL for v1 (deterministic, no embedding coupling): score a query
// against curated titles/aliases/tags/summary. Availability is an in-memory manifest cache loaded at app
// init; isLibraryAvailable() === false ⇒ the library.search tool is hidden ⇒ the app is unchanged.

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { LibraryEntry } from "../types";
import { getLibraryEnabled, getLibraryUrl, getLibraryManifestCache, setLibraryManifestCache } from "./store";

// Canonical remote host for the optional Settings `library_url` override (must also be allow-listed in
// src-tauri/capabilities/default.json). NOT the default source — the bundled copy below is.
export const LIBRARY_DEFAULT_BASE = "https://library.openedu.app";

// The bundled library, served at the app origin (Vite copies public/ → dist root). BASE_URL is "/" by
// default, so this resolves to "/library".
const BUNDLED_BASE = `${import.meta.env.BASE_URL}library`.replace(/\/+$/, "");

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

// Shared with library-datasets.ts so the lookup layer honors the SAME eval-suppression flag — one
// setLibraryEnabledForTesting(false) in the eval runner hides both library.search and library.lookup.
export function isLibraryTestingDisabled(): boolean {
  return disabledForTesting;
}

// Where the library loads from: the bundled copy by default; a Settings `library_url` override switches
// to a remote host. `remote` selects the transport (plugin-http cross-origin vs same-origin fetch).
export async function resolveSource(): Promise<{ base: string; remote: boolean }> {
  const override = await getLibraryUrl();
  if (override) return { base: override.replace(/\/+$/, ""), remote: true };
  return { base: BUNDLED_BASE, remote: false };
}

// Fetch a library file as text. Bundled = same-origin app asset (standard fetch; no capability needed,
// CSP is null). Remote override = plugin-http (cross-origin; the Origin:"" header mirrors llm.ts).
export async function fetchLibText(url: string, remote: boolean): Promise<string> {
  const res = remote
    ? await tauriFetch(url, { method: "GET", headers: { "Origin": "" } })
    : await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`library fetch failed (${res.status}): ${url}`);
  return res.text();
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
      asset: typeof r.asset === "string" ? r.asset : undefined,
    });
  }
  return out;
}

// Load the manifest from the active source (bundled by default; remote override otherwise) into memory.
async function loadManifest(): Promise<LibraryEntry[]> {
  const { base, remote } = await resolveSource();
  const entries = normalizeManifest(JSON.parse(await fetchLibText(`${base}/index.json`, remote)));
  memManifest = entries;
  // Persist only for the remote override (offline survival). The bundled copy is always reachable, so its
  // cache is never read back — skip the redundant per-launch disk write.
  if (remote) await setLibraryManifestCache(entries).catch(() => {});
  return entries;
}

// Return the manifest, preferring the warm in-memory copy. Bundled loads succeed immediately; a remote
// override that's offline falls back to the last-good persisted copy.
export async function getManifest(): Promise<LibraryEntry[]> {
  if (memManifest) return memManifest;
  try {
    return await loadManifest();
  } catch {
    const cached = normalizeManifest((await getLibraryManifestCache().catch(() => null)) ?? []);
    if (cached.length) { memManifest = cached; return cached; }
    throw new Error("library manifest unavailable");
  }
}

// App-init warm-up (called from main.tsx). Loads the bundled manifest (always present) or, with a remote
// override, fetches it — falling back to the last-good persisted copy if the remote is offline.
export async function refreshManifest(): Promise<void> {
  if (!(await getLibraryEnabled())) return;
  try {
    await loadManifest();
  } catch {
    if (!memManifest) {
      const cached = normalizeManifest((await getLibraryManifestCache().catch(() => null)) ?? []);
      if (cached.length) memManifest = cached;
    }
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
  return matchResourcesScored(query, manifest, topN).map((x) => x.entry);
}

// Same ranking, but WITH the scores. `matchResources` filters on `score > 0`, which means the best
// match always wins however bad it is — fine for a tool the model chose to call about a topic it had
// in mind, wrong for automatic grounding, where "the least-bad card in the library" gets injected
// into every unrelated question. Callers that retrieve without being asked need to see the number so
// they can set a floor. (#90 — the eval caught "boiling point of ethanol" pulling in
// "Types of Economic Systems".)
export function matchResourcesScored(
  query: string,
  manifest: LibraryEntry[],
  topN = 3,
): Array<{ entry: LibraryEntry; score: number }> {
  const qTokens = tokenize(query);
  const qPhrase = normalizePhrase(query);
  if (qTokens.length === 0 && !qPhrase) return [];
  return manifest
    .map((e) => ({ entry: e, score: scoreEntry(qTokens, qPhrase, e) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
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
  const { base, remote } = await resolveSource();
  const url = resourceUrl(base, entry);
  let text = stripFrontmatter(await fetchLibText(url, remote)).trim();
  if (text.length > maxChars) text = text.slice(0, maxChars).trimEnd() + "\n\n…(truncated — ask for more if needed)";
  return { text, url };
}

export function assetUrl(base: string, asset: string): string {
  return `${base}/${asset.replace(/^\/+/, "")}`;
}

// Minimal, additive SVG sanitizer. These SVGs are first-party (our repo, our generator, our host) — the
// same trust level as the markdown bodies we already inline — but strip the obvious script vectors as
// cheap defense-in-depth before inlining via dangerouslySetInnerHTML. Regex, not a parser: it can miss
// exotic vectors (javascript: in xlink:href, CSS url() in <style>); acceptable only because the content
// is first-party + deterministically generated. Swap to DOMPurify if third-party SVGs ever arrive.
// <style> is intentionally kept — the generator uses it for (future) theming.
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "");
}

// Fetch a card's authored SVG "raw form" (human-facing, Resources tab). Unlike fetchResource: no
// frontmatter strip, no length cap (the SVG is a whole document), returns sanitized markup. null when
// the card has no asset. Same source + fetch path as the body.
export async function fetchAsset(entry: LibraryEntry): Promise<string | null> {
  if (!entry.asset) return null;
  const { base, remote } = await resolveSource();
  const url = assetUrl(base, entry.asset);
  return sanitizeSvg(await fetchLibText(url, remote));
}
