// OpenEdu Library — the LOOKUP layer behind the `library.lookup` tool. Where library.ts serves whole
// prose CARDS, this serves a single deterministic RECORD (or a computed value) from a structured
// dataset that is too big for an ~1800-char card: every president, country, currency, chemical formula,
// a base conversion, a verb conjugation. Two kinds of dataset:
//   • DATA     — bundled record sets under public/library/datasets/*.json (from the openedu-library repo),
//                matched lexically by a tiny scorer and rendered through the dataset's {field} template.
//   • COMPUTED — pure functions in THIS file (number-base conversion, ASCII, regular-verb conjugation),
//                deterministic by construction, no network, no model call.
//
// It reuses library.ts's transport (resolveSource/fetchLibText) so bundled-vs-remote + offline behave
// identically, and the SAME eval-suppression flag (isLibraryTestingDisabled) so one switch hides both
// library tools during the golden run.

import { resolveSource, fetchLibText, isLibraryTestingDisabled } from "./library";
import { getLibraryEnabled } from "./store";
import type { LibraryLookupResult } from "../types";

// A bundled dataset file (datasets/<id>.json) — the shape build-datasets.mjs validates + emits.
interface Dataset {
  id: string;
  title: string;
  summary: string;
  source: string;
  verified: string;
  license: string;
  aliases?: string[];
  searchFields: string[];
  numericKey?: string;
  template: string;
  rows: Record<string, unknown>[];
}
interface DatasetManifestEntry { id: string; title: string; summary: string; file: string; rows: number; verified: string }

// The 12 `dataset` enum values the tool exposes → how each is served. COMPUTED ones have no file.
// `files` lists the bundled dataset id(s); `card_id` deep-links the chat chip to a companion prose card.
const DATA_SOURCES: Record<string, { files: string[]; card_id?: string }> = {
  us_presidents: { files: ["us-presidents"] },
  scotus_cases: { files: ["scotus-cases"] },
  us_states: { files: ["us-states"] },
  country_profiles: { files: ["country-profiles"], card_id: "geography/countries-capitals" },
  currencies: { files: ["currencies"] },
  rulers_dynasties: { files: ["rulers-dynasties"] },
  wars_treaties: { files: ["wars-treaties"] },
  nomenclature: { files: ["nomenclature"] },
  vocabulary: { files: ["vocabulary.es", "vocabulary.fr"] },
};
export const COMPUTED_DATASETS = ["verb_conjugation", "ascii_table", "number_base"] as const;
export const LOOKUP_DATASETS = [...Object.keys(DATA_SOURCES), ...COMPUTED_DATASETS];

// ── manifest + dataset caches (module-level, survive across turns; mirror library.ts) ──
let datasetManifest: DatasetManifestEntry[] | null = null;
const datasetCache = new Map<string, Dataset>();

function normalizeManifest(data: unknown): DatasetManifestEntry[] {
  const arr = Array.isArray(data) ? data : [];
  const out: DatasetManifestEntry[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.file !== "string") continue;
    out.push({
      id: r.id, file: r.file,
      title: typeof r.title === "string" ? r.title : "",
      summary: typeof r.summary === "string" ? r.summary : "",
      rows: typeof r.rows === "number" ? r.rows : 0,
      verified: typeof r.verified === "string" ? r.verified : "",
    });
  }
  return out;
}

// App-init warm-up (called from main.tsx beside refreshManifest). Loads the dataset manifest; silent on
// failure (e.g. an older bundle without datasets/) so the tool just stays unavailable.
export async function refreshDatasetManifest(): Promise<void> {
  if (!(await getLibraryEnabled())) return;
  try {
    const { base, remote } = await resolveSource();
    datasetManifest = normalizeManifest(JSON.parse(await fetchLibText(`${base}/datasets/_manifest.json`, remote)));
  } catch {
    /* leave datasetManifest as-is; areDatasetsAvailable() stays false */
  }
}

// Synchronous availability for the tool's isEnabled — true only when ≥1 dataset is bundled and we're not
// suppressed for eval. Combined with getLibraryEnabled() + isLibraryAvailable() by the tool.
export function areDatasetsAvailable(): boolean {
  return !isLibraryTestingDisabled() && datasetManifest !== null && datasetManifest.length > 0;
}

// Fetch + cache one dataset file (id === filename, per build-datasets.mjs).
async function getDataset(id: string): Promise<Dataset> {
  const cached = datasetCache.get(id);
  if (cached) return cached;
  const { base, remote } = await resolveSource();
  const ds = JSON.parse(await fetchLibText(`${base}/datasets/${id}.json`, remote)) as Dataset;
  datasetCache.set(id, ds);
  return ds;
}

// ── lexical matcher (mirrors library.ts's scorer, scoped to dataset rows) ──
const STOP = new Set(["the", "a", "an", "of", "for", "to", "in", "on", "is", "are", "what", "whats", "show",
  "me", "my", "tell", "about", "give", "list", "and", "or", "how", "do", "i", "you", "can", "with", "was", "who", "which"]);
const tokenize = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOP.has(t));
const normPhrase = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function scoreRow(row: Record<string, unknown>, ds: Dataset, qTokens: string[], qPhrase: string, qNum: number | null): number {
  let score = 0;
  for (const f of ds.searchFields) {
    const val = row[f];
    if (val == null) continue;
    const v = normPhrase(String(val));
    if (v) {
      if (qPhrase === v) score += 14;
      else if (qPhrase && (qPhrase.includes(v) || v.includes(qPhrase))) score += 6;
    }
    const ftoks = new Set(tokenize(String(val)));
    for (const qt of qTokens) if (ftoks.has(qt)) score += 3;
  }
  if (ds.numericKey != null && qNum != null && Number(row[ds.numericKey]) === qNum) score += 20;
  return score;
}

function renderRow(template: string, row: Record<string, unknown>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, k) => (row[k] == null ? "" : String(row[k])))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\(\s*\)/g, "")
    .trim();
}

// Build the tool result from a matched DATA row.
function dataResult(dataset: string, ds: Dataset, row: Record<string, unknown>, related: Record<string, unknown>[], card_id?: string): LibraryLookupResult {
  const labelField = ds.searchFields[0];
  return {
    found: true,
    dataset,
    title: String(row[labelField] ?? ds.title),
    text: renderRow(ds.template, row),
    computed: false,
    source: `${ds.title} dataset, OpenEdu Library`,
    verified: ds.verified || undefined,
    card_id,
    related: related.map((r) => String(r[labelField] ?? "")).filter(Boolean),
  };
}

const notFound = (dataset: string): LibraryLookupResult => ({ found: false, dataset, title: "", text: "", computed: false, source: "", related: [] });

// ── DATA lookup: score every row across the dataset's file(s), return the best + near-misses ──
async function lookupData(dataset: string, query: string): Promise<LibraryLookupResult> {
  const meta = DATA_SOURCES[dataset];
  if (!meta) return notFound(dataset);
  let files = meta.files;
  // Vocabulary holds both languages — narrow by an explicit language cue when present.
  if (dataset === "vocabulary") {
    if (/\b(french|français|francais|en français)\b/i.test(query)) files = ["vocabulary.fr"];
    else if (/\b(spanish|español|espanol|en español)\b/i.test(query)) files = ["vocabulary.es"];
  }
  const qTokens = tokenize(query);
  const qPhrase = normPhrase(query);
  const numMatch = query.match(/\d+/);
  const qNum = numMatch ? Number(numMatch[0]) : null;
  let best: { ds: Dataset; row: Record<string, unknown>; score: number } | null = null;
  const scored: { ds: Dataset; row: Record<string, unknown>; score: number }[] = [];
  for (const fid of files) {
    let ds: Dataset;
    try { ds = await getDataset(fid); } catch { continue; }
    for (const row of ds.rows) {
      const score = scoreRow(row, ds, qTokens, qPhrase, qNum);
      if (score > 0) scored.push({ ds, row, score });
    }
  }
  if (!scored.length) return notFound(dataset);
  scored.sort((a, b) => b.score - a.score);
  best = scored[0];
  const related = scored.slice(1, 4).map((s) => s.row);
  return dataResult(dataset, best.ds, best.row, related, meta.card_id);
}

// ── COMPUTED: number-base conversion (binary / decimal / hex / octal) ──
function numberBase(query: string): LibraryLookupResult {
  const q = query.toLowerCase();
  // Tokenize by whitespace and match WHOLE tokens — never substrings, so "hexadecimal" can't yield a
  // spurious "adec" value. Strip surrounding punctuation from each token first.
  const toks = q.split(/\s+/).map((t) => t.replace(/[^0-9a-z]/g, "")).filter(Boolean);
  let base = 10, raw: string | null = null;
  for (const t of toks) {
    if (/^0x[0-9a-f]+$/.test(t)) { raw = t.slice(2); base = 16; break; }
    if (/^0b[01]+$/.test(t)) { raw = t.slice(2); base = 2; break; }
    if (/^0o[0-7]+$/.test(t)) { raw = t.slice(2); base = 8; break; }
  }
  if (!raw) {
    // base keywords + filler that are coincidentally valid hex (dec, bin, a, …) must not be read as the value
    const KW = new Set(["hex", "hexadecimal", "binary", "bin", "octal", "oct", "decimal", "dec", "to", "in", "as", "base", "convert", "what", "is", "the", "of", "number", "value", "a", "and", "into"]);
    const cands = toks.filter((t) => /^[0-9a-f]+$/.test(t) && !KW.has(t));
    const withDigit = cands.filter((t) => /[0-9]/.test(t));
    raw = (withDigit.length ? withDigit : cands).sort((a, b) => b.length - a.length)[0] || null;
    // Source base from the value's OWN form only: hex letters ⇒ hex, else decimal. A base keyword in
    // the query names the TARGET ("64 to octal"), never the source — so it can't be read two ways.
    if (raw) base = /[a-f]/.test(raw) ? 16 : 10;
  }
  if (!raw) return notFound("number_base");
  const value = parseInt(raw, base);
  if (!Number.isFinite(value) || Number.isNaN(value)) return notFound("number_base");
  const target = /\b(hex|hexadecimal|base ?16)\b/.test(q) ? "hex"
    : /\b(binary|base ?2)\b/.test(q) ? "bin"
    : /\b(octal|base ?8)\b/.test(q) ? "oct"
    : /\b(decimal|base ?10)\b/.test(q) ? "dec" : null;
  const reps: Record<string, string> = {
    dec: `${value} (decimal)`, bin: `0b${value.toString(2)} (binary)`,
    oct: `0o${value.toString(8)} (octal)`, hex: `0x${value.toString(16).toUpperCase()} (hex)`,
  };
  const order = target ? [target, ...["dec", "bin", "oct", "hex"].filter((k) => k !== target)] : ["dec", "bin", "oct", "hex"];
  return {
    found: true, dataset: "number_base",
    title: `${raw} (base ${base}) → ${target ?? "all bases"}`,
    text: order.map((k) => reps[k]).join("  =  "),
    computed: true, source: "computed locally", related: [],
  };
}

// ── COMPUTED: ASCII table (printable 32–126 + key control codes) ──
const CONTROL: Record<number, string> = { 0: "NUL (null)", 8: "BS (backspace)", 9: "TAB (horizontal tab)", 10: "LF (line feed / newline)", 13: "CR (carriage return)", 27: "ESC (escape)", 127: "DEL (delete)" };
function asciiInfo(code: number): string | null {
  if (code < 0 || code > 127) return null;
  const ch = code >= 32 && code <= 126 ? `'${String.fromCharCode(code)}'` : (CONTROL[code] || "(non-printable control code)");
  return `${ch} = ${code} (decimal) = 0x${code.toString(16).toUpperCase().padStart(2, "0")} (hex) = 0b${code.toString(2).padStart(8, "0")} (binary)`;
}
function asciiTable(query: string): LibraryLookupResult {
  const numM = query.match(/\b(\d{1,3})\b/);
  let code: number | null = null;
  if (numM) {
    // a number → look up the character at that code
    code = Number(numM[1]);
  } else {
    // a quoted char, else the LAST single-character printable token ("…the letter A" → "A").
    const qm = query.match(/'(\S)'|"(\S)"/);
    let ch: string | undefined = qm ? (qm[1] || qm[2]) : undefined;
    if (!ch) {
      const singles = query.split(/\s+/).filter((t) => t.length === 1 && t.charCodeAt(0) >= 33 && t.charCodeAt(0) <= 126);
      ch = singles[singles.length - 1];
    }
    if (ch) code = ch.charCodeAt(0);
  }
  if (code == null) return notFound("ascii_table");
  const info = asciiInfo(code);
  if (!info) return notFound("ascii_table");
  return { found: true, dataset: "ascii_table", title: `ASCII ${code}`, text: info, computed: true, source: "computed locally (US-ASCII / ISO 646)", related: [] };
}

// ── COMPUTED (hybrid): verb conjugation — irregular tables override the regular-rule engine ──
const ES_REG: Record<string, string[]> = { ar: ["o", "as", "a", "amos", "áis", "an"], er: ["o", "es", "e", "emos", "éis", "en"], ir: ["o", "es", "e", "imos", "ís", "en"] };
const FR_REG: Record<string, string[]> = { er: ["e", "es", "e", "ons", "ez", "ent"], ir: ["is", "is", "it", "issons", "issez", "issent"], re: ["s", "s", "", "ons", "ez", "ent"] };
function conjugateRegular(inf: string, lang: "es" | "fr"): string | null {
  const stem = inf.slice(0, -2), end = inf.slice(-2);
  if (lang === "es") {
    const e = ES_REG[end]; if (!e) return null;
    const f = e.map((s) => stem + s);
    return `${inf} (regular -${end} verb), present indicative: yo ${f[0]}, tú ${f[1]}, él/ella/usted ${f[2]}, nosotros ${f[3]}, vosotros ${f[4]}, ellos/ellas/ustedes ${f[5]}.`;
  }
  const e = FR_REG[end]; if (!e) return null;
  const f = e.map((s) => stem + s);
  return `${inf} (regular -${end} verb), présent: je ${f[0]}, tu ${f[1]}, il/elle ${f[2]}, nous ${f[3]}, vous ${f[4]}, ils/elles ${f[5]}.`;
}
async function conjugate(query: string): Promise<LibraryLookupResult> {
  const tokens = (query.toLowerCase().match(/[a-záéíóúñüàâäèêëïîôöùûçœ]+/gi) || []).map((t) => t.toLowerCase());
  // 1) exact match against the bundled irregular/common-verb tables (this also pins the language)
  for (const fid of ["verbs.es", "verbs.fr"]) {
    let ds: Dataset; try { ds = await getDataset(fid); } catch { continue; }
    const row = ds.rows.find((r) => tokens.includes(String(r.infinitive).toLowerCase()));
    if (row) return dataResult("verb_conjugation", ds, row, []);
  }
  // 2) regular-rule fallback for an unseen infinitive
  const cand = tokens.find((t) => /(ar|er|ir|re)$/.test(t) && t.length >= 4 && !STOP.has(t));
  if (cand) {
    const lang: "es" | "fr" = /\b(french|français|francais)\b/i.test(query) ? "fr"
      : /\b(spanish|español|espanol)\b/i.test(query) ? "es"
      : cand.endsWith("re") ? "fr" : "es";
    const text = conjugateRegular(cand, lang);
    if (text) return { found: true, dataset: "verb_conjugation", title: `${cand} (present tense)`, text, computed: true, source: "computed locally (regular conjugation rules)", related: [] };
  }
  return notFound("verb_conjugation");
}

// ── the single entry point the tool calls ──
export async function lookup(dataset: string, query: string): Promise<LibraryLookupResult> {
  switch (dataset) {
    case "number_base": return numberBase(query);
    case "ascii_table": return asciiTable(query);
    case "verb_conjugation": return await conjugate(query);
    default: return await lookupData(dataset, query);
  }
}
