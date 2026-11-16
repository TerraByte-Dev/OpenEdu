// The bundled English word list: is a word a real English word? WordNet (dictionary.ts) lacks many real
// words (chalcogens, voltammeter, granivore), so the written-answer grader asks this list too before it
// tells the model an answer may be a misspelling (quiz.ts misspellingNotes).
//
// Data comes from scripts/build-wordlist.mjs, which writes public/wordlist/<xx>.json (the words with that
// two-letter prefix, joined by spaces) and meta.json (the shard keys) from the word-list package (MIT,
// public/wordlist/LICENSE). Shards are fetched same-origin, only when asked for, and kept for the
// session. Throws if the bundled files can't be read; the caller then gives no note.

const BASE = `${import.meta.env.BASE_URL}wordlist`.replace(/\/+$/, "");

/** A bundled file that has not answered in this long is given up on. */
const FETCH_TIMEOUT_MS = 15_000;

async function fetchJson<T>(name: string): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${name}`, { method: "GET", signal: ctl.signal });
    if (!res.ok) throw new Error(`word list fetch failed (${res.status}): ${name}`);
    // The dev server and Tauri answer a missing file with index.html and a 200.
    if (!(res.headers.get("content-type") ?? "").includes("json")) throw new Error(`word list fetch got a non-JSON reply: ${name}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

let keysPromise: Promise<Set<string>> | null = null;
const shards = new Map<string, Promise<Set<string>>>();

function shardKeys(): Promise<Set<string>> {
  keysPromise ??= fetchJson<{ shardKeys: string[] }>("meta.json").then((m) => new Set(m.shardKeys));
  keysPromise.catch(() => { keysPromise = null; });
  return keysPromise;
}

function shard(key: string): Promise<Set<string>> {
  let p = shards.get(key);
  if (!p) {
    p = fetchJson<string>(`${key}.json`).then((s) => new Set(s.split(" ")));
    shards.set(key, p);
    p.catch(() => shards.delete(key));
  }
  return p;
}

/** True when a lower-case word is in the English word list. Throws if the bundled files can't be read. */
export async function inWordList(word: string): Promise<boolean> {
  if (!/^[a-z]{2,}$/.test(word)) return false;
  const key = word.slice(0, 2);
  if (!(await shardKeys()).has(key)) return false;
  return (await shard(key)).has(word);
}

/** Test hook: forget cached files so a test's fetch stub is used. */
export function resetWordListCache(): void {
  keysPromise = null;
  shards.clear();
}
