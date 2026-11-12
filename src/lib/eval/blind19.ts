// blind-19, lever 19's held-out set (docs/BENCHMARKS.md B8 "Lever 19" and row 19): the generator and
// the selection, in one file whose SHA-256 is recorded in BENCHMARKS.md before the ranker
// (src/lib/kernel/senseRank.ts) exists. The entry point is headless/blind19-generate.ts; everything it
// does is here, so a test can run it with a stand-in network and no request leaves the machine.
//
// What it does, as pre-registered:
//   1. One request to the named OpenAI model through OpenRouter, with the frozen author prompt followed
//      by B8's 184 words as a do-not-use list. No sampling parameters.
//   2. The first response that parses as a JSON array of at least 120 objects with the four keys
//      (band, kind, word, ask) counts. Anything else is saved, reported and retried, at most twice. An
//      HTTP or network error is saved and ends the run (BENCHMARKS: three tries an hour apart, then the
//      fallback model, both by hand).
//   3. Selection, in output order: the first 20 L and 10 C per band that pass every check (askedWord
//      returns the word with a context that contains it; dictionaryNote is not null; the word is none
//      of B8's 184 and is not already kept). No item is edited.
//   4. A cell left short gets one top-up request: the same prompt, the do-not-use list extended by the
//      words already kept, and a last paragraph naming the short cells. Its response is parsed and
//      retried the same way (at least one object), and its items fill the short cells only.
//   5. Every raw response is saved with its SHA-256; the items file records which response counted.
//      If an items file already exists, the result is written beside it as a rerun, never over it.
//
// Parsing reads the response text as JSON after trimming it and removing one surrounding Markdown code
// fence, if the whole text is one. Band labels are read with any dash and spacing ("K–2", "k - 2"),
// kinds in either case; nothing else about an item is changed.

import { askedWord, dictionaryNote } from "../kernel/defineWord";
import type { DictionaryEntry } from "../dictionary";
import { DEFINE_ITEMS } from "./define-items";
import type { GradeBand } from "../grade";

// ── Frozen inputs ────────────────────────────────────────────────────────────

/** BENCHMARKS.md B8 "Lever 19", "The author prompt, frozen here", word for word. */
export const AUTHOR_PROMPT =
  "Write questions a student types to a tutor to ask what one English word means in a sentence. For each grade band " +
  "(K-2, 3-5, 6-8, 9-12) write 30 of kind L and 15 of kind C. Every question uses a different word, and every word has " +
  "at least two clearly different meanings. Kind L: the sentence uses a meaning other than the one most people think " +
  "of first. Kind C: the sentence uses the meaning most people think of first. The sentence is one a student of that " +
  "band could meet in class or in a book, 6 to 16 words long, and contains the word exactly as asked, in lower case. " +
  "Nothing sexual, violent, profane or about drugs. Use these forms in turn: what does WORD mean in 'SENTENCE' / What " +
  "does the word WORD mean in this sentence: SENTENCE / SENTENCE What does WORD mean here? / I don't know what WORD " +
  "means in 'SENTENCE' / what is the meaning of WORD in 'SENTENCE'. Reply with a JSON array of {band, kind, word, ask} " +
  "and nothing else.";

/** The models the pre-registration names: the first, and the fallback after three failed tries. */
export const BLIND19_MODELS = ["openai/gpt-6.1-sol", "openai/gpt-6.1-terra"] as const;
export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export const BLIND19_BANDS: readonly GradeBand[] = ["K-2", "3-5", "6-8", "9-12"];
export type Blind19Kind = "L" | "C";
export const BLIND19_KINDS: readonly Blind19Kind[] = ["L", "C"];
/** Items kept per band and kind. */
export const BLIND19_CELL: Readonly<Record<Blind19Kind, number>> = { L: 20, C: 10 };
/** The main response counts only with at least this many four-key objects. */
export const BLIND19_MIN_OBJECTS = 120;
/** Parse failures are retried at most this many times per request. */
export const BLIND19_RETRIES = 2;
/** BENCHMARKS R7: the set runs only with at least this many items of each kind. */
export const BLIND19_MIN_RUN: Readonly<Record<Blind19Kind, number>> = { L: 60, C: 30 };

/** B8's 184 words, in item order, lower case. */
export const B8_WORDS: readonly string[] = [...new Set(DEFINE_ITEMS.map((i) => i.word.toLowerCase()))];

const BAND_SLUG: Record<GradeBand, string> = { "K-2": "k2", "3-5": "35", "6-8": "68", "9-12": "912" };

// ── Prompts and requests ─────────────────────────────────────────────────────

export interface Cell { band: GradeBand; kind: Blind19Kind; missing: number }

/** The text sent: the frozen prompt, the do-not-use list, and for a top-up the cells still needed. */
export function authorMessage(doNotUse: readonly string[], shortCells: readonly Cell[] = []): string {
  const parts = [AUTHOR_PROMPT, `Do not use any of these words: ${doNotUse.join(", ")}.`];
  if (shortCells.length) {
    parts.push(`Only these grade bands and kinds are still needed: ${shortCells.map((c) => `${c.band} kind ${c.kind} (${c.missing} more)`).join("; ")}.`);
  }
  return parts.join("\n\n");
}

export function authorRequest(model: string, message: string): Record<string, unknown> {
  return { model, messages: [{ role: "user", content: message }] };
}

// ── Parsing ──────────────────────────────────────────────────────────────────

export interface RawItem { band: string; kind: string; word: string; ask: string }

const FENCE = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/;

/** The response's array of four-key objects, or the reason it does not count. Objects without all
 *  four keys as strings stay in the array (selection rejects them) but are not counted. */
export function parseAuthorResponse(text: string, minObjects: number): { ok: true; items: unknown[]; counted: number } | { ok: false; reason: string } {
  let t = text.trim();
  const fence = FENCE.exec(t);
  if (fence) t = fence[1].trim();
  let v: unknown;
  try {
    v = JSON.parse(t);
  } catch (e) {
    return { ok: false, reason: `not JSON (${e instanceof Error ? e.message : String(e)})` };
  }
  if (!Array.isArray(v)) return { ok: false, reason: "not a JSON array" };
  const counted = v.filter(isRawItem).length;
  if (counted < minObjects) return { ok: false, reason: `${counted} objects with the four keys, fewer than ${minObjects}` };
  return { ok: true, items: v, counted };
}

function isRawItem(x: unknown): x is RawItem {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return ["band", "kind", "word", "ask"].every((k) => typeof o[k] === "string");
}

export function readBand(s: string): GradeBand | null {
  const t = s.replace(/[‐-―−]/g, "-").replace(/\s+/g, "").toUpperCase();
  return (BLIND19_BANDS as readonly string[]).includes(t) ? (t as GradeBand) : null;
}

export function readKind(s: string): Blind19Kind | null {
  const t = s.trim().toUpperCase();
  return t === "L" || t === "C" ? t : null;
}

// ── Selection ────────────────────────────────────────────────────────────────

export interface Blind19Item {
  id: string;
  band: GradeBand;
  kind: Blind19Kind;
  word: string;
  ask: string;
  /** Which response (0 = main, 1 = top-up) and its array index. */
  source: { response: number; index: number };
}

export interface Rejected { response: number; index: number; reason: string; item: unknown }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The checks that need no dictionary, or the reason an item fails one. */
export function checkShape(x: unknown, excluded: ReadonlySet<string>): { item: { band: GradeBand; kind: Blind19Kind; word: string; ask: string } } | { reason: string } {
  if (!isRawItem(x)) return { reason: "not an object with string band, kind, word and ask" };
  const band = readBand(x.band);
  if (!band) return { reason: `band "${x.band}"` };
  const kind = readKind(x.kind);
  if (!kind) return { reason: `kind "${x.kind}"` };
  const word = x.word.trim();
  if (!word) return { reason: "empty word" };
  const asked = askedWord(x.ask);
  if (!asked) return { reason: "askedWord does not fire" };
  if (asked.word.toLowerCase() !== word.toLowerCase()) return { reason: `askedWord reads "${asked.word}"` };
  if (!asked.context) return { reason: "no context" };
  if (!new RegExp(`(?<![\\p{L}])${escapeRe(word)}(?![\\p{L}])`, "iu").test(asked.context)) return { reason: "the context does not contain the word" };
  if (excluded.has(word.toLowerCase())) return { reason: "a B8 word or already kept" };
  return { item: { band, kind, word, ask: x.ask } };
}

export type Cells = Record<GradeBand, Record<Blind19Kind, Blind19Item[]>>;

export const emptyCells = (): Cells =>
  Object.fromEntries(BLIND19_BANDS.map((b) => [b, { L: [], C: [] }])) as unknown as Cells;

/**
 * Fill `cells` from one response's array, in output order: an item is kept when its cell is not full
 * and it passes every check. `hasNote(askedWord)` is the dictionary check (dictionaryNote is not null).
 * Items past a full cell are surplus, not rejected. Mutates `cells`; returns what was turned down.
 */
export async function selectFrom(
  response: number,
  raw: readonly unknown[],
  cells: Cells,
  hasNote: (word: string) => Promise<boolean>,
): Promise<Rejected[]> {
  const rejected: Rejected[] = [];
  const kept = () => new Set(BLIND19_BANDS.flatMap((b) => BLIND19_KINDS.flatMap((k) => cells[b][k].map((i) => i.word.toLowerCase()))));
  for (let index = 0; index < raw.length; index++) {
    const shape = checkShape(raw[index], new Set([...B8_WORDS, ...kept()]));
    if ("reason" in shape) { rejected.push({ response, index, reason: shape.reason, item: raw[index] }); continue; }
    const { band, kind, word, ask } = shape.item;
    const cell = cells[band][kind];
    if (cell.length >= BLIND19_CELL[kind]) continue;
    if (!(await hasNote(askedWord(ask)!.word))) { rejected.push({ response, index, reason: "dictionaryNote is null", item: raw[index] }); continue; }
    cell.push({ id: `b19-${BAND_SLUG[band]}-${kind}-${String(cell.length + 1).padStart(2, "0")}`, band, kind, word, ask, source: { response, index } });
  }
  return rejected;
}

export function shortCells(cells: Cells): Cell[] {
  return BLIND19_BANDS.flatMap((band) => BLIND19_KINDS.map((kind) => ({ band, kind, missing: BLIND19_CELL[kind] - cells[band][kind].length })))
    .filter((c) => c.missing > 0);
}

export function keptWords(cells: Cells): string[] {
  return BLIND19_BANDS.flatMap((b) => BLIND19_KINDS.flatMap((k) => cells[b][k].map((i) => i.word.toLowerCase())));
}

/** The set in a fixed order (band, then L before C, then kept order), and whether it may run (R7). */
export function finalSet(cells: Cells): { items: Blind19Item[]; counts: Record<Blind19Kind, number>; runnable: boolean } {
  const items = BLIND19_BANDS.flatMap((b) => BLIND19_KINDS.flatMap((k) => cells[b][k]));
  const counts = { L: items.filter((i) => i.kind === "L").length, C: items.filter((i) => i.kind === "C").length };
  return { items, counts, runnable: counts.L >= BLIND19_MIN_RUN.L && counts.C >= BLIND19_MIN_RUN.C };
}

// ── The run ──────────────────────────────────────────────────────────────────

export interface GeneratorDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  /** Write a UTF-8 file (creating its folder); exists() says whether a file is there. */
  write: (file: string, text: string) => Promise<void>;
  exists: (file: string) => Promise<boolean>;
  /** dictionaryNote(word, lookupWord(word)) !== null, through the real bundled dictionary. */
  hasNote: (word: string) => Promise<boolean>;
  now: () => Date;
  log: (line: string) => void;
}

/** Where the files go, relative to the working directory (the repo root). */
export const BLIND19_DIR = "src/lib/eval/blind-19";

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface RawRecord { file: string; sha256: string; request: number; attempt: number; model: string; outcome: string; usage?: unknown }

/** The model argument (the only argument after the script, "--" aside), or null. */
export function modelArg(args: readonly string[]): string | null {
  const rest = args.filter((a) => a !== "--");
  return rest.length === 1 ? rest[0] : null;
}

export const GENERATOR_USAGE = `Usage: blind19-generate.ts -- <model>, the model one of ${BLIND19_MODELS.join(" or ")}. It takes no other argument.`;

/**
 * Generate and select blind-19. Throws before any request when the model argument is missing or not a
 * pre-registered model, or the OpenRouter key is not set. Returns the path of the items file written.
 */
export async function generateBlind19(args: readonly string[], deps: GeneratorDeps): Promise<string> {
  const model = modelArg(args);
  if (!model) throw new Error(GENERATOR_USAGE);
  if (!(BLIND19_MODELS as readonly string[]).includes(model)) throw new Error(`${model} is not a pre-registered model. ${GENERATOR_USAGE}`);
  const key = deps.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set: run this through run-with-secrets.");

  const stamp = deps.now().toISOString().replace(/[:.]/g, "-");
  const raws: RawRecord[] = [];
  const ask = async (request: number, message: string, minObjects: number): Promise<{ items: unknown[]; raw: RawRecord }> => {
    for (let attempt = 1; attempt <= 1 + BLIND19_RETRIES; attempt++) {
      const file = `${BLIND19_DIR}/raw-${stamp}-r${request}-a${attempt}.txt`;
      let res: Response;
      try {
        res = await deps.fetch(OPENROUTER_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify(authorRequest(model, message)),
        });
      } catch (e) {
        const text = `network error: ${e instanceof Error ? e.message : String(e)}`;
        await deps.write(file, text);
        raws.push({ file, sha256: await sha256Hex(text), request, attempt, model, outcome: "error" });
        throw new Error(`${model}: ${text} (saved to ${file}). Try again in an hour; after three failed tries use ${BLIND19_MODELS[1]}.`);
      }
      const body = await res.text();
      if (!res.ok) {
        await deps.write(file, body);
        throw new Error(`${model}: HTTP ${res.status} (saved to ${file}). Try again in an hour; after three failed tries use ${BLIND19_MODELS[1]}.`);
      }
      let content = "";
      let usage: unknown;
      try {
        const j = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown };
        content = j.choices?.[0]?.message?.content ?? "";
        usage = j.usage;
      } catch { /* the envelope itself is not JSON: saved below as the raw text */ content = body; }
      await deps.write(file, content);
      const parsed = parseAuthorResponse(content, minObjects);
      const raw: RawRecord = { file, sha256: await sha256Hex(content), request, attempt, model, outcome: parsed.ok ? `counts (${parsed.counted} objects)` : parsed.reason, usage };
      raws.push(raw);
      deps.log(`[blind-19] request ${request} attempt ${attempt}: ${raw.outcome} · sha256 ${raw.sha256}`);
      if (parsed.ok) return { items: parsed.items, raw };
    }
    throw new Error(`${model}: no response counted after ${1 + BLIND19_RETRIES} attempts; every response is saved under ${BLIND19_DIR}.`);
  };

  const cells = emptyCells();
  const main = await ask(0, authorMessage(B8_WORDS), BLIND19_MIN_OBJECTS);
  const rejected = await selectFrom(0, main.items, cells, deps.hasNote);
  let topUp: { short: Cell[]; raw: RawRecord } | null = null;
  const short = shortCells(cells);
  if (short.length) {
    deps.log(`[blind-19] short cells: ${short.map((c) => `${c.band} ${c.kind} -${c.missing}`).join(", ")}; one top-up request`);
    const r = await ask(1, authorMessage([...B8_WORDS, ...keptWords(cells)], short), 1);
    rejected.push(...(await selectFrom(1, r.items, cells, deps.hasNote)));
    topUp = { short, raw: r.raw };
  }
  const set = finalSet(cells);
  const out = {
    generator: "src/lib/eval/blind19.ts",
    model,
    generatedAt: deps.now().toISOString(),
    counted: { main: main.raw, topUp: topUp?.raw ?? null },
    topUpCells: topUp?.short ?? [],
    raws,
    counts: set.counts,
    shortAfterTopUp: shortCells(cells),
    runnable: set.runnable,
    items: set.items,
    rejected,
  };
  const itemsFile = `${BLIND19_DIR}/items.json`;
  const file = (await deps.exists(itemsFile)) ? `${BLIND19_DIR}/rerun-${stamp}.json` : itemsFile;
  await deps.write(file, JSON.stringify(out, null, 2) + "\n");
  deps.log(`[blind-19] ${set.counts.L} L and ${set.counts.C} C kept${set.runnable ? "" : ` — fewer than ${BLIND19_MIN_RUN.L} L or ${BLIND19_MIN_RUN.C} C: not run (BENCHMARKS R7)`}; ${rejected.length} rejected. ${file}`);
  return file;
}

/** The dictionary check the run uses: the kernel's own note for the word, no sentence. */
export function noteCheck(lookup: (w: string) => Promise<DictionaryEntry[]>): (word: string) => Promise<boolean> {
  return async (word) => dictionaryNote(word, await lookup(word)) !== null;
}
