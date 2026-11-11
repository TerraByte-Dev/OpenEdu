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

/** Candidate headwords for a normalized query, most direct first, before checking the dictionary:
 *  the query, then irregular base forms from the exception lists, then suffix-rule bases. For a phrase
 *  ("looked up") the same steps run on its first word, keeping the rest. */
export function candidateHeadwords(word: string, exc: Exceptions): string[] {
  const out: string[] = [];
  const add = (w: string) => {
    if (w && !out.includes(w)) out.push(w);
  };
  const bases = (w: string): string[] => {
    const found: string[] = [];
    for (const pos of POS_ORDER) for (const lemma of exc[pos][w] ?? []) found.push(lemma);
    for (const pos of ["n", "v", "a"] as const) {
      for (const [suffix, ending] of RULES[pos]) {
        if (w.length > suffix.length && w.endsWith(suffix)) found.push(w.slice(0, w.length - suffix.length) + ending);
      }
    }
    return found;
  };
  add(word);
  for (const b of bases(word)) add(b);
  const space = word.indexOf(" ");
  if (space > 0) {
    const head = word.slice(0, space);
    const rest = word.slice(space);
    for (const b of bases(head)) add(b + rest);
  }
  return out;
}

/** Shard keys a lookup of these candidates needs. */
export function shardsFor(candidates: string[]): string[] {
  return [...new Set(candidates.map(shardKey))];
}

/** Resolve a normalized query against already-loaded shards. Returns up to MAX_HEADWORDS entries in
 *  candidate order; empty when the dictionary has none of them. */
export function resolveEntries(
  word: string,
  exc: Exceptions,
  getShard: (key: string) => Shard | undefined,
): DictionaryEntry[] {
  if (!word) return [];
  const entries: DictionaryEntry[] = [];
  for (const cand of candidateHeadwords(word, exc)) {
    const rows = getShard(shardKey(cand))?.[cand];
    if (!rows || rows.length === 0) continue;
    entries.push({
      headword: cand,
      via: cand === word ? "exact" : "form",
      senses: rows.map(([form, pos, definition, example, synonyms]) => ({ form, pos, definition, example, synonyms })),
    });
    if (entries.length >= MAX_HEADWORDS) break;
  }
  return entries;
}

// ── Bundled-data shell (the only impure part) ───────────────────────────────────────────────────────

const BASE = `${import.meta.env.BASE_URL}dictionary`.replace(/\/+$/, "");
const shardCache = new Map<string, Shard>();
let excCache: Exceptions | null = null;

async function fetchJson<T>(name: string): Promise<T | null> {
  const res = await fetch(`${BASE}/${name}`, { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`dictionary fetch failed (${res.status}): ${name}`);
  return (await res.json()) as T;
}

async function loadExceptions(): Promise<Exceptions> {
  if (!excCache) excCache = (await fetchJson<Exceptions>("exceptions.json")) ?? { n: {}, v: {}, a: {}, r: {} };
  return excCache;
}

/** Look a word or phrase up in the bundled dictionary. Empty when it isn't there (or the input is
 *  blank). A prefix no headword starts with has no shard file; that is cached as an empty shard. */
export async function lookupWord(raw: string): Promise<DictionaryEntry[]> {
  const word = normalizeQuery(raw);
  if (!word) return [];
  const exc = await loadExceptions();
  const keys = shardsFor(candidateHeadwords(word, exc)).filter((k) => !shardCache.has(k));
  await Promise.all(
    keys.map(async (k) => {
      shardCache.set(k, (await fetchJson<Shard>(`${k}.json`)) ?? {});
    }),
  );
  return resolveEntries(word, exc, (k) => shardCache.get(k));
}

/** Test hook: forget cached shards so a test's fetch stub is used. */
export function resetDictionaryCache(): void {
  shardCache.clear();
  excCache = null;
}
