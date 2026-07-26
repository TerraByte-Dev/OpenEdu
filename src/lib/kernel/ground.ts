// Grounding — retrieval as a PIPELINE STAGE, not a model decision (docs/ARCHITECTURE.md, #90).
//
// The problem this solves, in one line: asking a 4B model to *choose* to retrieve makes grounding the
// product of five independent probabilities — notice the need, pick the right tool from the 3–5
// offered, emit valid arguments, survive reinjection, then cite. A pipeline stage is 1.0 by
// construction. We embed the student's question, retrieve, and put the passages in front of the model
// BEFORE it runs, so "will it decide correctly?" stops being a question we have to answer.
//
// This is NOT a small-model branch. A capable model gets the same injected context AND keeps
// notebook.search for a second hop when the first pass missed. That is what makes it a quality
// improvement everywhere rather than a fork that only the floor model walks.
//
// Everything except `ground()` itself is pure and unit-tested. `ground()` is the thin I/O shell.

import { estTokens, capText, type Budget } from "./budget";
import { searchNotebook } from "../notebook";
import { getManifest, matchResourcesScored, fetchResource, isLibraryAvailable } from "../library";
import { getLibraryEnabled } from "../store";
import type { ToolContext } from "../tools/EduTool";

// ── Types ────────────────────────────────────────────────────────────────────

export interface GroundingHit {
  source: "note" | "library";
  title: string;
  text: string;
  score: number;
  /** Stable id for dedupe/diversity: the document for a note, the card id for the library. */
  ref: string;
}

export interface RetrievalTrace {
  /** Non-null when retrieval was deliberately skipped, naming the reason. */
  skipped: "short-query" | "no-corpus" | "below-floor" | "disabled" | null;
  candidates: number;
  /** Note-sourced candidates BEFORE the score floor. Distinct from how many survived: zero survivors
   *  is the healthy answer to a question the vault cannot answer, whereas zero CANDIDATES means the
   *  notebook returned nothing at all — an empty vault, a dead embedder, the wrong course id. Only
   *  the pre-floor count can tell those apart, which the eval's integrity check depends on. */
  noteCandidates: number;
  topScore: number;
  hitTitles: string[];
  blockTokens: number;
  error?: string;
}

export interface Grounding {
  /** The text to prepend to the user's turn. Empty string when nothing was retrieved. */
  block: string;
  hits: GroundingHit[];
  trace: RetrievalTrace;
}

export const EMPTY_GROUNDING: Grounding = {
  block: "",
  hits: [],
  trace: { skipped: null, candidates: 0, noteCandidates: 0, topScore: 0, hitTitles: [], blockTokens: 0 },
};

export type RetrievalMode = "always" | "auto" | "off";

// ── Tuning ───────────────────────────────────────────────────────────────────

/** Cosine floor for a note chunk to be worth showing. Calibrated against nomic-embed-text; below
 *  this, hits are topically adjacent noise — a biology vault answering "what is a for loop?". */
export const MIN_NOTE_SCORE = 0.45;

/** Minimum LEXICAL score for a library card to be injected automatically.
 *
 *  `matchResources` keeps anything scoring above zero, which is right for a tool the model chose to
 *  call — it already had the topic in mind — and wrong for automatic grounding, where the least-bad
 *  card in a 154-card library gets injected into every unrelated question. The eval caught exactly
 *  that: "What is the boiling point of ethanol?" retrieved "Types of Economic Systems".
 *
 *  6 is the first score that requires real evidence under `scoreEntry`: a title/alias substring match
 *  (+6), or two title tokens (3+3), or a title token plus two tags. A single incidental summary token
 *  scores 1 and no longer survives. */
export const MIN_LIBRARY_SCORE = 6;

/** At most this many chunks from any one document, so five hits cannot all be one note's ord 0..4. */
const MAX_PER_DOC = 2;

/** How many passages reach the model. Three is a deliberate ceiling: the cost of a fourth is paid on
 *  every turn, and the marginal passage is almost always the one that dilutes attention. */
const MAX_HITS = 3;

/** Per-passage cap. Long enough to carry a fact with its sentence, short enough that three of them
 *  plus the question still leave the model room to answer inside a 4096-token window. */
const MAX_HIT_TOKENS = 250;

/** Below this many content words the turn is an acknowledgement, not a question.
 *
 *  Started at 4. The eval caught it rejecting "How high is Ashcombe Ridge?" (3 words) — the single
 *  positive failure in an otherwise clean run. Dropping to 2 then rejected "What is photosynthesis?"
 *  (1 word, since the stopword list eats "what" and "is"), which is the archetypal student question.
 *
 *  The lesson: this gate was never the thing keeping irrelevant hits out — the SCORE FLOOR is. All
 *  this does is avoid a pointless ~20ms embed on small talk, so it should be as generous as possible.
 *  One content word is the floor: "thanks" and "ok got it" reduce to zero (see the stopword list),
 *  while any question naming any thing survives. If an acknowledgement does slip through, it retrieves
 *  nothing above the floor and costs one embed. That is the correct direction to be wrong in. */
const MIN_CONTENT_WORDS = 1;

// Mirrors library.ts's stopword list; kept local so this module stays independent of it. The trailing
// group is acknowledgement vocabulary — the words that make up a turn carrying no question at all
// ("ok got it", "sure thanks", "cool"). They are what lets MIN_CONTENT_WORDS sit at 1 without
// retrieving on every "yeah makes sense".
const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "to", "in", "on", "is", "are", "was", "were", "what", "whats",
  "show", "me", "my", "tell", "about", "give", "list", "and", "or", "how", "do", "does", "did",
  "i", "you", "can", "could", "with", "this", "that", "it", "its", "be", "been", "have", "has",
  "if", "then", "so", "but", "not", "no", "yes", "please", "thanks", "thank", "ok", "okay",
  "got", "get", "sure", "great", "cool", "nice", "right", "yeah", "yep", "sense", "makes", "wow",
]);

export function contentWords(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// ── Pure stage 1: should we retrieve at all? ─────────────────────────────────

export function shouldRetrieve(question: string, mode: RetrievalMode): { retrieve: boolean; reason: RetrievalTrace["skipped"] } {
  if (mode === "off") return { retrieve: false, reason: "disabled" };
  if (contentWords(question).length < MIN_CONTENT_WORDS) return { retrieve: false, reason: "short-query" };
  return { retrieve: true, reason: null };
}

// ── Pure stage 2: rank, floor, diversify, cap ────────────────────────────────

/**
 * Select which candidates reach the model.
 *
 * Order matters: floor first (drop noise), then diversity (so one chatty document cannot crowd out a
 * better one from elsewhere), then the hit cap. Doing diversity after the cap would let a document
 * consume the budget and then get trimmed, wasting the slot.
 */
export function selectHits(candidates: GroundingHit[], opts: { minScore?: number; maxPerDoc?: number; maxHits?: number } = {}): GroundingHit[] {
  const minScore = opts.minScore ?? MIN_NOTE_SCORE;
  const maxPerDoc = opts.maxPerDoc ?? MAX_PER_DOC;
  const maxHits = opts.maxHits ?? MAX_HITS;

  const ranked = candidates
    .filter((h) => h.score >= minScore)
    .sort((a, b) => b.score - a.score);

  const perDoc = new Map<string, number>();
  const out: GroundingHit[] = [];
  for (const hit of ranked) {
    if (out.length >= maxHits) break;
    const seen = perDoc.get(hit.ref) ?? 0;
    if (seen >= maxPerDoc) continue;
    perDoc.set(hit.ref, seen + 1);
    out.push(hit);
  }
  return out;
}

// ── Pure stage 3: format ─────────────────────────────────────────────────────

/**
 * Render the passages as plain labelled text — deliberately NOT JSON.
 *
 * The tool path hands the model `JSON.stringify({results:[...]})`, complete with two 36-char UUIDs
 * and a float score per hit that it cannot act on (there is no notebook.read tool to use an id with).
 * That is a large fraction of a small window spent on punctuation and identifiers. Prose costs a
 * fraction of it and reads like something to answer FROM rather than a payload to parse.
 *
 * The instruction rides WITH the evidence rather than four sections up the system prompt: on a small
 * model an instruction adjacent to the thing it governs is followed far more reliably.
 */
export function formatGroundingBlock(hits: GroundingHit[], maxTokens: number): string {
  if (hits.length === 0) return "";

  const header =
    "Here are passages from the student's own material that may be relevant. " +
    "If you use one, say which title it came from. " +
    "If none of them answer the question, ignore them and say you are answering from general knowledge.";

  const parts: string[] = [];
  let used = estTokens(header) + 8; // + framing tags
  for (const hit of hits) {
    const label = hit.source === "note" ? "From the student's notes" : "From the OpenEdu Library";
    const body = capText(hit.text.trim(), MAX_HIT_TOKENS);
    const piece = `[${label}: ${hit.title}]\n${body}`;
    const cost = estTokens(piece) + 2;
    if (used + cost > maxTokens) break;
    used += cost;
    parts.push(piece);
  }
  if (parts.length === 0) return "";
  return `<context>\n${header}\n\n${parts.join("\n\n")}\n</context>`;
}

// ── Pure stage 4: did the answer actually USE any of it? ─────────────────────

/**
 * Return the hits the answer demonstrably reused, by shared content-word n-gram.
 *
 * This is the honesty mechanism, and it is the one thing in this module that must not be cut
 * (Tate's Q2: "just need to update some sorta terms/instructions and be like 'oh by the way, it's
 * not perfect'"). A citation chip driven by `groundedIn` cannot be fabricated: it appears only when
 * the answer literally reuses retrieved language. Everything else — "I read your notes" — is the
 * model's word for it, which on a 4B model is worth nothing.
 *
 * n=6 content words is deliberately strict. Shorter windows match on generic phrasing; this is
 * effectively "quoted or closely paraphrased".
 *
 * Zero LLM calls, so it can gate every turn and every eval assertion without cost.
 */
export function groundedIn(answer: string, hits: GroundingHit[], n = 6): GroundingHit[] {
  const answerWords = contentWords(answer);
  if (answerWords.length < n) return [];
  const grams = new Set<string>();
  for (let i = 0; i + n <= answerWords.length; i++) grams.add(answerWords.slice(i, i + n).join(" "));
  if (grams.size === 0) return [];

  return hits.filter((hit) => {
    const hitWords = contentWords(hit.text);
    for (let i = 0; i + n <= hitWords.length; i++) {
      if (grams.has(hitWords.slice(i, i + n).join(" "))) return true;
    }
    return false;
  });
}

// ── The I/O shell ────────────────────────────────────────────────────────────

/**
 * Retrieve context for one turn. Never throws: a dead embedder, a missing model, an unreachable
 * library — all degrade to "no grounding" with the reason recorded in the trace. A tutoring turn
 * must never fail because retrieval failed; that is the difference between a feature and a
 * dependency.
 */
export async function ground(
  question: string,
  ctx: ToolContext,
  budget: Budget,
  mode: RetrievalMode = "always",
): Promise<Grounding> {
  const gate = shouldRetrieve(question, mode);
  if (!gate.retrieve) {
    return { ...EMPTY_GROUNDING, trace: { ...EMPTY_GROUNDING.trace, skipped: gate.reason } };
  }

  const candidates: GroundingHit[] = [];
  let noteCandidates = 0;
  let error: string | undefined;

  // Notes and library are fetched concurrently and fail independently. The library half needs no
  // model at all, so on the install a school actually ends up with — chat model only, no embedder —
  // grounding still fires.
  const [notes, library] = await Promise.allSettled([
    searchNotebook({ courseId: ctx.courseId, query: question, topK: 6 }),
    groundFromLibrary(question),
  ]);

  if (notes.status === "fulfilled") {
    noteCandidates = notes.value.length;
    for (const r of notes.value) {
      candidates.push({ source: "note", title: r.document_title, text: r.text, score: r.score, ref: r.document_id });
    }
  } else {
    // Most often: no embedding model pulled. Recorded, never surfaced as a turn failure.
    error = notes.reason instanceof Error ? notes.reason.message : String(notes.reason);
  }
  if (library.status === "fulfilled") candidates.push(...library.value);

  const topScore = candidates.reduce((m, h) => Math.max(m, h.score), 0);
  const hits = selectHits(candidates);
  const block = formatGroundingBlock(hits, budget.grounding);

  const skipped: RetrievalTrace["skipped"] =
    candidates.length === 0 ? "no-corpus" : hits.length === 0 ? "below-floor" : null;

  return {
    block,
    hits,
    trace: {
      skipped,
      candidates: candidates.length,
      noteCandidates,
      topScore,
      hitTitles: hits.map((h) => h.title),
      blockTokens: estTokens(block),
      error,
    },
  };
}

// The library half: lexical match over the bundled manifest, then fetch the best card's body.
// Scores are normalized into the same 0..1 space as cosine so one floor governs both corpora.
async function groundFromLibrary(question: string): Promise<GroundingHit[]> {
  try {
    if (!(await getLibraryEnabled()) || !isLibraryAvailable()) return [];
    const manifest = await getManifest();
    const matches = matchResourcesScored(question, manifest, 1);
    // The floor is the whole point here — see MIN_LIBRARY_SCORE. Without it the library half fires on
    // every single question, which is indistinguishable from a bug in the logs and actively harmful
    // when the notebook half returns nothing: the model is handed one irrelevant card and no notes.
    if (matches.length === 0 || matches[0].score < MIN_LIBRARY_SCORE) return [];
    const { entry } = matches[0];
    const { text } = await fetchResource(entry, 1800);
    if (!text.trim()) return [];
    // Pinned just above the note floor rather than mapped from the lexical score: the two scales are
    // not comparable (cosine is bounded 0..1, scoreEntry is unbounded ints), so any mapping would be
    // invented precision. The gate above is what decides admission; this only orders it among notes.
    return [{ source: "library", title: entry.title, text, score: MIN_NOTE_SCORE + 0.05, ref: `lib:${entry.id}` }];
  } catch {
    return []; // library is a bonus corpus; never let it break a turn
  }
}
