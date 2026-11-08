// The sealed held-out set (v2): the only reader of the file, and the two guards in front of it.
//
// heldout-v2-protocol.md is the rulebook. This module enforces its rules 1 and 2:
//   1. Refuse unless the file's SHA-256 equals the one committed in the protocol.
//   2. Before any model call, take the set's made-up names and distinctive tokens and search src/
//      (excluding src/lib/eval/). A match means a lever may have been tuned on the test set: refuse.
//
// Nobody tuning the harness opens the file. Code here is written against the schema only, and its
// tests use synthetic sets created in a temp folder.

import protocolMd from "./heldout-v2-protocol.md?raw";
import type { HeldoutGroup, HeldoutLang, HeldoutQuestion } from "./rag-heldout";
import type { FixtureNote } from "./rag-fixture";
import type { K12Item } from "./k12-items";
import { fs, path, listFiles, cwd } from "./headless/node-io";

// ── The expected hash ────────────────────────────────────────────────────────

/** The SHA-256 in the protocol's table row ("| SHA-256 | `…` |"). Throws when there is not exactly one. */
export function protocolSha256(md: string): string {
  const found = [...md.matchAll(/^\|\s*SHA-256\s*\|\s*`?([0-9a-fA-F]{64})`?\s*\|/gm)].map((m) => m[1].toLowerCase());
  if (found.length !== 1) throw new Error(`Expected one SHA-256 row in the protocol, found ${found.length}.`);
  return found[0];
}

export const HELDOUT_V2_SHA256 = protocolSha256(protocolMd);

// ── Schema ───────────────────────────────────────────────────────────────────

/** A v2 RAG item: a HeldoutQuestion plus two fields only v2 has. */
export interface SealedRagItem extends HeldoutQuestion {
  /** The decoy the item was written against (descriptive; not scored). */
  lookalike?: string;
  /** Whether the near-miss changes the entity's name or the kind of fact asked (descriptive). */
  variant?: "name" | "kind";
}

export interface SealedSet {
  schema: "openedu-heldout-v2";
  created: string;
  sealed: true;
  rag: { notes: FixtureNote[]; items: SealedRagItem[] };
  k12: { items: K12Item[] };
}

const GROUPS: readonly HeldoutGroup[] = ["near-miss", "far", "crosslingual", "paraphrase"];
const LANGS: readonly HeldoutLang[] = ["es", "fr", "sw", "pt", "hi", "ar"];
const SUBJECTS = ["math", "science", "ela", "social-studies"] as const;
const BANDS = ["K-5", "6-8", "9-12"] as const;
const KEYS = ["A", "B", "C", "D"] as const;

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const optStr = (v: unknown) => v === undefined || isStr(v);
const oneOf = <T>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

/** Validate a parsed v2 file. Throws with every problem found (first 20), so one run fixes them all. */
export function parseSealed(raw: unknown): SealedSet {
  const errs: string[] = [];
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.schema !== "openedu-heldout-v2") errs.push(`schema is ${JSON.stringify(o.schema)}, expected "openedu-heldout-v2"`);
  if (o.sealed !== true) errs.push("sealed is not true");
  if (!isStr(o.created)) errs.push("created is missing");

  const rag = (o.rag ?? {}) as Record<string, unknown>;
  const notes = Array.isArray(rag.notes) ? rag.notes : (errs.push("rag.notes is not an array"), []);
  notes.forEach((n: Record<string, unknown>, i) => {
    if (!isStr(n?.title) || !isStr(n?.text)) errs.push(`rag.notes[${i}] needs a title and a text`);
  });
  const ragItems = Array.isArray(rag.items) ? rag.items : (errs.push("rag.items is not an array"), []);
  const seen = new Set<string>();
  ragItems.forEach((x: Record<string, unknown>, i) => {
    const at = `rag.items[${i}]${isStr(x?.id) ? ` (${x.id})` : ""}`;
    if (!isStr(x?.id)) errs.push(`${at}: id is missing`);
    else if (seen.has(x.id)) errs.push(`${at}: duplicate id`);
    else seen.add(x.id);
    if (!oneOf(GROUPS, x?.group)) errs.push(`${at}: group ${JSON.stringify(x?.group)}`);
    if (x?.kind !== "negative" && x?.kind !== "positive") errs.push(`${at}: kind ${JSON.stringify(x?.kind)}`);
    if (x?.split !== "test") errs.push(`${at}: split ${JSON.stringify(x?.split)}, expected "test"`);
    if (!isStr(x?.note)) errs.push(`${at}: note is missing`);
    if (!isStr(x?.ask)) errs.push(`${at}: ask is missing`);
    if (x?.kind === "positive" && !isStr(x?.expect)) errs.push(`${at}: a positive needs expect`);
    if (!optStr(x?.expect) || !optStr(x?.poison) || !optStr(x?.lookalike)) errs.push(`${at}: expect, poison and lookalike must be strings`);
    if (x?.lang !== undefined && !oneOf(LANGS, x.lang)) errs.push(`${at}: lang ${JSON.stringify(x.lang)}`);
    if (x?.variant !== undefined && x.variant !== "name" && x.variant !== "kind") errs.push(`${at}: variant ${JSON.stringify(x.variant)}`);
  });

  const k12 = (o.k12 ?? {}) as Record<string, unknown>;
  const k12Items = Array.isArray(k12.items) ? k12.items : (errs.push("k12.items is not an array"), []);
  const seenK = new Set<string>();
  k12Items.forEach((x: Record<string, unknown>, i) => {
    const at = `k12.items[${i}]${isStr(x?.id) ? ` (${x.id})` : ""}`;
    if (!isStr(x?.id)) errs.push(`${at}: id is missing`);
    else if (seenK.has(x.id)) errs.push(`${at}: duplicate id`);
    else seenK.add(x.id);
    if (!oneOf(SUBJECTS, x?.subject)) errs.push(`${at}: subject ${JSON.stringify(x?.subject)}`);
    if (!oneOf(BANDS, x?.band)) errs.push(`${at}: band ${JSON.stringify(x?.band)}`);
    if (x?.demand !== "recall" && x?.demand !== "apply") errs.push(`${at}: demand ${JSON.stringify(x?.demand)}`);
    if (!optStr(x?.strand)) errs.push(`${at}: strand must be a string`);
    if (!isStr(x?.stem)) errs.push(`${at}: stem is missing`);
    if (!Array.isArray(x?.options) || x.options.length !== 4 || !x.options.every(isStr)) errs.push(`${at}: options must be 4 strings`);
    if (!oneOf(KEYS, x?.key)) errs.push(`${at}: key ${JSON.stringify(x?.key)}`);
    if (!isStr(x?.basis)) errs.push(`${at}: basis is missing`);
  });

  if (errs.length) {
    throw new Error(`Sealed set does not match the v2 schema (${errs.length} problem(s)):\n  ${errs.slice(0, 20).join("\n  ")}`);
  }
  return raw as SealedSet;
}

// ── Name lint ────────────────────────────────────────────────────────────────

// Capitalised words that are ordinary English (sentence starters, question words, words that turn up
// inside real-world names such as "Social Security" or "Mayflower Compact") or real-world names common
// in school material, so a match in src/ says nothing about leakage. More sources count as ordinary
// (see extractNames): English words, any word the k12 items use in lower case, and any word in the
// bundled library (public/library), a real-world reference corpus that predates the set and is not
// under src/.
const COMMON = new Set(`
a about above across after again against all almost along also although always am among an and another
any are around as at away back be because been before being below between both but by can could did do
does done down during each either enough even ever every few for from further had has have having he her
here hers him his how however i if in into is it its just least less let like many may me might more most
much must my near neither never next no nor not now of off often on once one only or other our out over
own per perhaps please quite rather same she should since so some still such than that the their them
then there these they this those though through thus to too toward towards under until up upon us very
was we were what whatever when where whether which while who whom whose why will with within without would
yes yet you your yours
add answer ask choose compare complete describe determine estimate explain find give identify imagine list
look make name read show solve suppose think use write
first second third last new old big small great good best better many most other same different own
mr mrs ms dr st mt
monday tuesday wednesday thursday friday saturday sunday
january february march april may june july august september october november december
spring summer autumn fall winter
north south east west northern southern eastern western
earth sun moon mercury venus mars jupiter saturn uranus neptune pluto
africa america americas antarctica asia australia europe arctic atlantic pacific indian ocean
english spanish french portuguese swahili hindi arabic chinese german latin greek roman
united states kingdom nations america american british europe european
celsius fahrenheit kelvin newton newtons
act age article bill board book case chapter church city class club company compact court day deal
department district empire fair family free government group hall history house island lake law league
library line market movement office order park party people plan power program project river road room
rule school security service society spirit state station street system team time town trade union war
week world year
`.split(/\s+/).filter(Boolean));

// Ordinary words in non-Latin scripts: function words and question words in the set's languages,
// plus everyday vocabulary that src/ already carries in its own multilingual tests (ground.test.ts,
// library-rank*.ts: water, sun, plant, light, class…). None of them is a name, so a match on one says
// nothing about leakage, and without this list every Hindi or Arabic item would void the run.
const NATIVE_COMMON = new Set(`
है हैं था थी थे हो होता होती होते क्या कौन कब कहाँ कहां किस किसे किसको कैसे कितना कितनी कितने क्यों
का की के को में से पर और या भी तो ने लिए बारे एक यह वह ये वे इस उस इसका उसका नहीं जो जब तक साथ बाद पहले
सबसे बहुत कुछ सकता सकती सकते चाहिए जाता जाती जाते करता करती करते किया गया गई
पानी सूर्य पौधे पौधों प्रकाश संश्लेषण कार्बन डाइऑक्साइड ग्लूकोज मिट्टी धूप हरे घर जल चक्र कक्षा हिन्दी
बदलते बढ़ने नियमित आवश्यकता हाँ बताइए
ما هو هي في من على إلى عن كم متى أين كيف هل لماذا التي الذي الذين أي مع أن إن هذا هذه ذلك تلك كان كانت لا
لم لن قد كل بعض أو ثم بين عند منذ حتى غير
التمثيل الضوئي ماءٌ ماء هواء الصف
`.split(/\s+/).filter(Boolean));

const TOKEN = /[\p{L}\p{M}]+/gu;
const LATIN = /^[\p{Script=Latin}\p{M}]+$/u;
const UPPER_START = /^\p{Lu}/u;
// What can sit between a sentence break and the next word: spaces, quotes, brackets.
const LEAD = /[\s"'“”‘’«»()[\]]*$/u;
const BREAK = /[.!?¿¡:;…—–]$/u;

/** True when the word at `index` starts a sentence (or the string), so a capital there means nothing. */
function sentenceInitial(text: string, index: number): boolean {
  const before = text.slice(0, index).replace(LEAD, "");
  return before === "" || BREAK.test(before);
}

/**
 * The set's made-up names and distinctive tokens, lower-cased, in NFC, de-duplicated and sorted.
 * `ordinary` is known vocabulary, lower-cased: the loader passes English words (englishWords) and the
 * bundled library's words. A word is ordinary when it, or its singular, is in COMMON, in `ordinary`,
 * or written in lower case in the k12 items (real-world school text).
 *  - Latin script, English text (note titles and texts, English asks, k12 text, expect / poison /
 *    lookalike): every word that is not ordinary. Capitalised words count from 2 letters ("Ix") and in
 *    any position, sentence starts and titles included; lower-case words from 4 letters ("florbic").
 *  - Latin script, a question in another language (an item with `lang`): only capitalised words that
 *    do not start a sentence ("¿Qual…" is a question word, "…nascente Quorvath" a name), since English
 *    vocabulary cannot tell a Portuguese word from a made-up one.
 *  - Non-Latin script (Devanagari, Arabic, …): words of 3+ characters not in NATIVE_COMMON: a
 *    native-script name a learner might type, such as a transliterated nonce.
 */
export function extractNames(set: SealedSet, ordinary: ReadonlySet<string> = new Set()): string[] {
  const english: string[] = [];
  const foreignAsks: string[] = [];
  const foreignFields: string[] = [];
  for (const n of set.rag.notes) english.push(n.title, n.text);
  for (const x of set.rag.items) {
    english.push(x.note);
    (x.lang ? foreignAsks : english).push(x.ask);
    (x.lang ? foreignFields : english).push(x.expect ?? "", x.poison ?? "", x.lookalike ?? "");
  }
  const k12 = set.k12.items.flatMap((x) => [x.stem, ...x.options, x.basis, x.strand ?? ""]);
  english.push(...k12);

  const nfc = (t: string) => t.normalize("NFC");
  const k12Lower = new Set(k12.flatMap((t) => nfc(t).match(TOKEN) ?? []).filter((w) => !UPPER_START.test(w)));
  const isKnown = (lower: string) => COMMON.has(lower) || ordinary.has(lower) || k12Lower.has(lower);
  // "Fridays", "Pilgrims": a plural of an ordinary word is ordinary.
  const known = (lower: string) => isKnown(lower) || (lower.endsWith("s") && isKnown(lower.slice(0, -1)));
  const out = new Set<string>();

  const scan = (text: string, latin: (w: string, index: number, text: string) => boolean) => {
    const t = nfc(text);
    for (const m of t.matchAll(TOKEN)) {
      const w = m[0];
      const lower = w.toLowerCase();
      if (!LATIN.test(w)) {
        if ([...w].length >= 3 && !NATIVE_COMMON.has(w) && !ordinary.has(lower)) out.add(lower);
      } else if (!known(lower) && latin(w, m.index!, t)) {
        out.add(lower);
      }
    }
  };
  const capital = (w: string) => UPPER_START.test(w) && [...w].length >= 2;
  for (const text of english) scan(text, (w) => capital(w) || [...w].length >= 4);
  for (const text of foreignAsks) scan(text, (w, i, t) => capital(w) && !sentenceInitial(t, i));
  for (const text of foreignFields) scan(text, capital);
  return [...out].sort();
}

export interface NameHit { token: string; files: string[] }

// Code joins words: isQuorvath, quorvathFix, HTTPQuorvath. A space at each camelCase step lets the
// name stand alone; "_", "-" and digits already count as breaks (QUORVATH_BOOST, quorvath2).
const splitCamel = (text: string) => text.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2");

/**
 * Which tokens occur in which files. Case-insensitive, in NFC, as a whole word: letters on either side
 * make it a different word, but a plural or possessive ending ("Quorvaths", "Quorvath's") still counts,
 * and so does a name inside a code identifier. Pure.
 */
export function findNameHits(tokens: string[], files: Array<{ path: string; text: string }>): NameHit[] {
  if (tokens.length === 0) return [];
  const alt = [...new Set(tokens.map((t) => t.normalize("NFC")))].sort((a, b) => b.length - a.length).join("|");
  const re = new RegExp(`(?<![\\p{L}\\p{M}])(${alt})(?:['’]s|es|s)?(?![\\p{L}\\p{M}])`, "giu");
  const hits = new Map<string, Set<string>>();
  for (const f of files) {
    const text = f.text.normalize("NFC");
    for (const variant of [text, splitCamel(text)]) {
      for (const m of variant.matchAll(re)) {
        const token = m[1].toLowerCase();
        if (!hits.has(token)) hits.set(token, new Set());
        hits.get(token)!.add(f.path);
      }
    }
  }
  return [...hits].map(([token, paths]) => ({ token, files: [...paths].sort() })).sort((a, b) => a.token.localeCompare(b.token));
}

// The protocol excludes all of src/lib/eval/, but code there shapes every eval request (the runner's
// instructions, the matched syllabus, the tool syllabus). Only the eval's item data (RAG and k12 items,
// the library-retrieval queries), its tests and its docs are excluded. Stricter than the protocol, so
// it can only void more runs, never fewer.
const EVAL_EXEMPT = /^lib\/eval\/(?:(?:rag-fixture|rag-heldout|rag-dev-v2|k12-items|library-fixture)\.ts$|.*\.test\.ts$|.*\.md$)/;

/** Every text file under `srcRoot` but EVAL_EXEMPT, as { path relative to srcRoot's parent, text }. */
async function lintCorpus(srcRoot: string): Promise<Array<{ path: string; text: string }>> {
  const [f, p] = await Promise.all([fs(), path()]);
  const root = p.resolve(srcRoot);
  const out: Array<{ path: string; text: string }> = [];
  for (const file of await listFiles(root)) {
    const rel = p.relative(root, file).replace(/\\/g, "/");
    if (EVAL_EXEMPT.test(rel)) continue;
    const bytes = await f.readFile(file);
    if (bytes.subarray(0, 8000).includes(0)) continue; // binary (images, fonts): no words to match
    out.push({ path: `${p.relative(p.dirname(root), file).replace(/\\/g, "/")}`, text: new TextDecoder().decode(bytes) });
  }
  return out;
}

/** Every word in the bundled library's cards and datasets, lower-cased. Empty if the folder is absent. */
export async function libraryVocabulary(libraryRoot: string): Promise<Set<string>> {
  const f = await fs();
  const vocab = new Set<string>();
  let files: string[] = [];
  try { files = await listFiles(libraryRoot); } catch { return vocab; }
  for (const file of files) {
    if (!/\.(md|json)$/i.test(file)) continue;
    for (const w of (await f.readFile(file, "utf8")).match(TOKEN) ?? []) vocab.add(w.toLowerCase());
  }
  return vocab;
}

/**
 * English words, lower-cased, inflections included (the word-list package, ~274k words, no proper
 * nouns). Tells an ordinary word ("beaker", "Triple Alliance") from an invented one ("florbic").
 */
export async function englishWords(): Promise<Set<string>> {
  const file = (await import("word-list")).default;
  return new Set((await (await fs()).readFile(file, "utf8")).split("\n").map((w) => w.trim()).filter(Boolean));
}

export class SealedLintError extends Error {
  constructor(readonly hits: NameHit[]) {
    super(
      `Name lint failed: ${hits.length} token(s) from the sealed set occur in src/ outside src/lib/eval/. ` +
      `Per heldout-v2-protocol.md rule 2 this run is void.\n  ` +
      hits.map((h) => `${h.token}: ${h.files.join(", ")}`).join("\n  "),
    );
    this.name = "SealedLintError";
  }
}

// ── The loader ───────────────────────────────────────────────────────────────

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface LoadedSealed {
  set: SealedSet;
  sha256: string;
  /** How many names the lint searched for (the names themselves are not returned). */
  lintedTokens: number;
}

/**
 * Read the sealed set. Refuses (throws) on a hash mismatch, a schema mismatch, or any name-lint hit,
 * in that order, and before anything is handed to a model.
 */
export async function loadSealed(
  file: string,
  expectedSha256: string,
  opts?: { srcRoot?: string; libraryRoot?: string },
): Promise<LoadedSealed> {
  const [f, p] = await Promise.all([fs(), path()]);
  const bytes = await f.readFile(file);
  const sha256 = await sha256Hex(bytes);
  if (sha256 !== expectedSha256.toLowerCase()) {
    throw new Error(`Sealed set hash mismatch: expected ${expectedSha256.toLowerCase()}, got ${sha256}. Refusing to run (heldout-v2-protocol.md rule 1).`);
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  const set = parseSealed(JSON.parse(text));
  const ordinary = await libraryVocabulary(opts?.libraryRoot ?? p.resolve(cwd(), "public", "library"));
  for (const w of await englishWords()) ordinary.add(w);
  const tokens = extractNames(set, ordinary);
  const hits = findNameHits(tokens, await lintCorpus(opts?.srcRoot ?? p.resolve(cwd(), "src")));
  if (hits.length) throw new SealedLintError(hits);
  return { set, sha256, lintedTokens: tokens.length };
}
