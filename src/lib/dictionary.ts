// OpenEdu Dictionary: deterministic word lookup over the bundled Open English WordNet (issue #251).
//
// The design: the dictionary is the source of truth for what a word means, and the model only restates
// an entry at the learner's reading level. Nothing here calls a model. Data comes from
// scripts/build-dictionary.mjs, which writes public/dictionary/<xx>.json shards keyed by the first two
// characters of the lowercased headword, plus exceptions.json (irregular forms: went -> go, mice -> mouse).
//
// Lookup = candidate headwords (the word itself, its listed irregular base forms, then WordNet's suffix
// rules: "running" is listed, "jumped" -> "jump" by rule) filtered to the ones the dictionary holds. A
// word can resolve to more than one headword, and that is kept on purpose: "saw" is a tool and the past
// of "see", and the right one depends on the sentence, which is the model's call, not this module's.
//
// Everything above lookupWord is pure and Tauri-free. lookupWord fetches bundled shards with a plain
// same-origin fetch (no capability needed; works offline) and caches them for the session.

export type Pos = "n" | "v" | "a" | "r";
/** One sense as stored in a shard: [form, pos, definition, example ("" if none), one-word synonyms]. */
export type SenseRow = [string, Pos, string, string, string[]];
export type Shard = Record<string, SenseRow[]>;
export type Exceptions = Record<Pos, Record<string, string[]>>;

export interface Sense {
  /** The headword as the dictionary spells it ("May", "may"). */
  form: string;
  pos: Pos;
  definition: string;
  example: string;
  synonyms: string[];
}
export interface DictionaryEntry {
  /** The lowercased headword that matched, e.g. "go" for a query of "went". */
  headword: string;
  /** "exact" when the query itself is the headword, "form" when it is an inflected or irregular form. */
  via: "exact" | "form";
  senses: Sense[];
}

export const POS_NAMES: Record<Pos, string> = { n: "noun", v: "verb", a: "adjective", r: "adverb" };

/** Most headwords returned for one query. "leaves" -> leaves? leaf, leave; more is noise. */
export const MAX_HEADWORDS = 3;

// WordNet's morphy detachment rules (Princeton morph.c), tried only when the result is a headword.
const RULES: Record<Exclude<Pos, "r">, Array<[string, string]>> = {
  n: [["s", ""], ["ses", "s"], ["xes", "x"], ["zes", "z"], ["ches", "ch"], ["shes", "sh"], ["men", "man"], ["ies", "y"]],
  v: [["s", ""], ["ies", "y"], ["es", "e"], ["es", ""], ["ed", "e"], ["ed", ""], ["ing", "e"], ["ing", ""]],
  a: [["er", ""], ["est", ""], ["er", "e"], ["est", "e"]],
};
const POS_ORDER: Pos[] = ["n", "v", "a", "r"];
/** Own keys only: a word such as "constructor" or "__proto__" must not read Object.prototype. */
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Shard file key for a lowercased headword. The build script uses the same rule; a test checks every
 *  shipped shard's keys against this function. */
export function shardKey(headword: string): string {
  const c = (i: number) => (/[a-z0-9]/.test(headword[i] ?? "") ? headword[i] : "_");
  return c(0) + c(1);
}

/** Turn what a learner typed into a lookup key: lowercase, curly quotes straightened, surrounding quotes
 *  and punctuation dropped, a possessive 's removed, inner spaces collapsed. Empty if nothing is left. */
export function normalizeQuery(raw: string): string {
  let w = raw
    .normalize("NFKC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  w = w.replace(/^[\s"'`([{<.,;:!?¿¡*_-]+/, "").replace(/[\s"'`)\]}>.,;:!?*_-]+$/, "");
  w = w.replace(/'s$/, "");
  return w;
}

/** A headword to try. `pos` is the part of speech whose exception list or suffix rule produced it; the
 *  headword only counts if it has a sense in that part of speech, as in Princeton's morphy (otherwise
 *  "mother" would come back as a form of "moth"). null for the query itself, which counts in any. */
export interface Candidate {
  word: string;
  pos: Pos | null;
}

/** Candidate headwords for a normalized query, most direct first, before checking the dictionary: the
 *  query (and, for an abbreviation such as "a.m", the same with its final dot, which normalizeQuery
 *  strips), then irregular base forms from the exception lists, then suffix-rule bases. For a phrase
 *  ("looked up") the same steps also run on its first word, keeping the rest. */
export function candidateHeadwords(word: string, exc: Exceptions, opts: { trailingDot?: boolean } = {}): Candidate[] {
  const out: Candidate[] = [];
  const add = (w: string, pos: Pos | null) => {
    if (w && !out.some((c) => c.word === w && c.pos === pos)) out.push({ word: w, pos });
  };
  const bases = (w: string): Array<[string, Pos]> => {
    const found: Array<[string, Pos]> = [];
    for (const pos of POS_ORDER) for (const lemma of own(exc[pos], w) ? exc[pos][w] : []) found.push([lemma, pos]);
    for (const pos of ["n", "v", "a"] as const) {
      for (const [suffix, ending] of RULES[pos]) {
        if (w.length > suffix.length && w.endsWith(suffix)) found.push([w.slice(0, w.length - suffix.length) + ending, pos]);
      }
    }
    return found;
  };
  add(word, null);
  if (!word.endsWith(".") && (opts.trailingDot || /\p{L}\.\p{L}/u.test(word))) add(`${word}.`, null);
  for (const [b, pos] of bases(word)) add(b, pos);
  const space = word.indexOf(" ");
  if (space > 0) {
    const head = word.slice(0, space);
    const rest = word.slice(space);
    for (const [b, pos] of bases(head)) add(b + rest, pos);
  }
  return out;
}

/** Shard keys a lookup of these candidates needs. */
export function shardsFor(candidates: Candidate[]): string[] {
  return [...new Set(candidates.map((c) => shardKey(c.word)))];
}

/** Resolve a normalized query against already-loaded shards. Returns up to MAX_HEADWORDS entries in
 *  candidate order; empty when the dictionary has none of them. */
export function resolveEntries(
  word: string,
  exc: Exceptions,
  getShard: (key: string) => Shard | undefined,
  opts: { trailingDot?: boolean } = {},
): DictionaryEntry[] {
  if (!word) return [];
  const entries: DictionaryEntry[] = [];
  for (const cand of candidateHeadwords(word, exc, opts)) {
    if (entries.some((e) => e.headword === cand.word)) continue;
    const shard = getShard(shardKey(cand.word));
    const rows = shard && own(shard, cand.word) ? shard[cand.word] : undefined;
    if (!rows || rows.length === 0) continue;
    if (cand.pos !== null && !rows.some((r) => r[1] === cand.pos)) continue;
    entries.push({
      headword: cand.word,
      via: cand.pos === null ? "exact" : "form",
      senses: rows.map(([form, pos, definition, example, synonyms]) => ({ form, pos, definition, example, synonyms })),
    });
    if (entries.length >= MAX_HEADWORDS) break;
  }
  return entries;
}

// ── Bundled-data shell (the only impure part) ───────────────────────────────────────────────────────

const BASE = `${import.meta.env.BASE_URL}dictionary`.replace(/\/+$/, "");

interface Index {
  exc: Exceptions;
  /** Shard files that exist (meta.json). Fetching any other name gets index.html with a 200 from both
   *  the Vite dev server and Tauri's asset resolver, never a 404, so the list decides, not the server. */
  shards: Set<string>;
}
let indexPromise: Promise<Index> | null = null;
const shardCache = new Map<string, Promise<Shard>>();

/** A bundled file that has not answered in this long is given up on: its fetch is aborted and dropped
 *  from the cache, so a hung request is not kept for the next lookup. The load is shared by every
 *  lookup and is not tied to any one turn, so a caller that stops waiting sooner (the tutor turn's 2 s
 *  deadline) leaves a slow first load running, and it still warms the cache. */
export const DICTIONARY_FETCH_TIMEOUT_MS = 15_000;

async function fetchJson<T>(name: string): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), DICTIONARY_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${name}`, { method: "GET", signal: ctl.signal });
    if (!res.ok) throw new Error(`dictionary fetch failed (${res.status}): ${name}`);
    if (!(res.headers.get("content-type") ?? "").includes("json")) throw new Error(`dictionary fetch got a non-JSON reply: ${name}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function loadIndex(): Promise<Index> {
  indexPromise ??= Promise.all([
    fetchJson<Exceptions>("exceptions.json"),
    fetchJson<{ shardKeys: string[] }>("meta.json"),
  ]).then(([exc, meta]) => ({ exc, shards: new Set(meta.shardKeys) }));
  // A failed load is not cached: the next lookup tries again.
  indexPromise.catch(() => { indexPromise = null; });
  return indexPromise;
}

function loadShard(key: string): Promise<Shard> {
  let p = shardCache.get(key);
  if (!p) {
    p = fetchJson<Shard>(`${key}.json`);
    shardCache.set(key, p);
    p.catch(() => shardCache.delete(key));
  }
  return p;
}

/** Look a word or phrase up in the bundled dictionary. Empty when it isn't there or the input is blank.
 *  Throws only if the bundled files can't be read (or a file hangs past DICTIONARY_FETCH_TIMEOUT_MS),
 *  which the caller treats as "no entry". */
export async function lookupWord(raw: string): Promise<DictionaryEntry[]> {
  const word = normalizeQuery(raw);
  if (!word) return [];
  const trailingDot = /\p{L}\.["'’”)\]]*\s*$/u.test(raw);
  const { exc, shards } = await loadIndex();
  const keys = shardsFor(candidateHeadwords(word, exc, { trailingDot })).filter((k) => shards.has(k));
  const loaded = new Map<string, Shard>();
  await Promise.all(keys.map(async (k) => loaded.set(k, await loadShard(k))));
  return resolveEntries(word, exc, (k) => loaded.get(k), { trailingDot });
}

/** Test hook: forget cached files so a test's fetch stub is used. */
export function resetDictionaryCache(): void {
  shardCache.clear();
  indexPromise = null;
}
