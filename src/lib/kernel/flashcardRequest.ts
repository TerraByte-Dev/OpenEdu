// A flashcard the student asked for is made by the app, not left to the model choosing a tool.
//
// On gemma4:e2b, "Make me a flashcard: 6 x 7 = 42." saved a card in 0 of 20 turns (TerraTutor B9
// readiness run, 2026-11-13): the model answered with a recap of the level, or wrote the call as
// plain text that nothing ran. The request itself is easy for code to see, so the kernel runs it as a
// stage, the way grounding runs retrieval as a stage (ground.ts) instead of hoping for notebook.search:
//   1. code decides the turn is a flashcard request (asksForFlashcard), from the student's words alone;
//   2. one small structured call writes the card's two sides, schema-checked and validated
//      (cardFromRequest), from the student's request and the tutor's last message;
//   3. the card goes through flashcard.create's own dispatch, so the permission rules and the
//      learner's confirm card apply exactly as when the model calls it, and the chat shows the same
//      "Card minted" chip;
//   4. a short note after the student's message tells the model what happened, so its reply says
//      the card is saved instead of making another.
// A turn that does not ask for a card is untouched: no call, no note, byte-identical requests. When
// the permission rules deny flashcard.create, the stage does not run at all (no model call). When the
// card call fails, times out or does not validate, no note is added and the tool stays offered, so the
// reply request is the one this turn sent before the stage existed; the learner saw a "Making a
// flashcard..." chip, which then clears. On Ollama the card call is a short prompt of its own, not a
// continuation of the turn's prefix, so the reply that follows re-prefills the system prompt once.

import { callLLMStructured } from "../llm";
import type { LLMConfig, ModelTier } from "../../types";

export const FLASHCARD_TOOL = "flashcard.create";

// A request verb, then (in the same sentence, within a few words) one flashcard. "turn" counts only as
// "turn ... into". Plural "flashcards" is left to the model: one structured card cannot answer "make
// flashcards for these".
const REQUEST = /\b(?:(?:make|create|save|add|write|put)\b[^.?!\n]{0,40}?|turn\b[^.?!\n]{0,30}?\binto\b[^.?!\n]{0,12}?)\bflash[ -]?card\b(?!s)/i;
// Negation in the request's sentence, before its verb: "don't make a flashcard", "No, don't add it".
const NEGATION = /\b(?:don['’]?t|do not|never|stop|no)\b/i;
// A sentence that opens as a question about flashcards, not a request for one: "should I make a
// flashcard?", "when I make a flashcard does it save?", "can you show me how to make a flashcard?". Only
// the opening of the request's own sentence is read, so a card's content after a colon ("Make a
// flashcard: what do you call a baby cat?") does not block it.
const NOT_A_REQUEST = /^\s*(?:should i|what|when|where|how|why|did you|have you|do you|(?:can|could) you (?:show|tell))\b/i;
// More than one card asked for in a singular phrasing: "a flashcard for each of these".
const MANY = /\b(?:for each|each of|for all|all of|for every)\b/i;

/** True when the student's message asks for one flashcard to be made. Fails closed. */
export function asksForFlashcard(text: string): boolean {
  const m = REQUEST.exec(text);
  if (!m) return false;
  const before = text.slice(0, m.index);
  const sentenceStart = Math.max(before.lastIndexOf("."), before.lastIndexOf("?"), before.lastIndexOf("!"), before.lastIndexOf("\n")) + 1;
  const lead = text.slice(sentenceStart, m.index);
  if (NEGATION.test(lead)) return false;
  if (NOT_A_REQUEST.test(text.slice(sentenceStart))) return false;
  if (MANY.test(text)) return false;
  return true;
}

const MAX_FRONT_CHARS = 200;
const MAX_BACK_CHARS = 300;
/** How much of the tutor's last message the card call sees ("turn that into a flashcard"). */
const MAX_REPLY_CHARS = 1_500;

export const FLASHCARD_SCHEMA = {
  type: "object",
  properties: {
    front: { type: "string", minLength: 3, maxLength: MAX_FRONT_CHARS },
    back: { type: "string", minLength: 1, maxLength: MAX_BACK_CHARS },
  },
  required: ["front", "back"],
  additionalProperties: false,
} as const;

export const FLASHCARD_INSTRUCTION =
  "Write one flashcard for the student's request. " +
  "front: a short question. back: its answer, in a few words or one short sentence. " +
  "If the request states the fact, use the student's words and do not change the fact. " +
  "Otherwise use the tutor's last message, or a well-known fact at the student's level. " +
  "Plain text only: no LaTeX, no markdown. " +
  'Return JSON: {"front": "<question>", "back": "<answer>"}';

export function flashcardMessages(request: string, lastReply: string): Array<{ role: string; content: string }> {
  const reply = lastReply.trim().slice(0, MAX_REPLY_CHARS) || "(none)";
  return [
    { role: "system", content: FLASHCARD_INSTRUCTION },
    { role: "user", content: `Tutor's last message:\n${reply}\n\nStudent's request:\n${request.trim()}` },
  ];
}

/** Semantic checks the schema cannot express. Empty = a card the app will save. */
export function validateCard(card: { front: string; back: string }): string[] {
  const issues: string[] = [];
  const front = card.front.trim();
  const back = card.back.trim();
  if (!front) issues.push("front is empty");
  if (!back) issues.push("back is empty");
  if (front && front.toLowerCase() === back.toLowerCase()) issues.push("front and back are the same; back must answer front");
  if (/[$\\]/.test(front + back)) issues.push("plain text only: no LaTeX ($ or \\)");
  return issues;
}

export interface Card { front: string; back: string }

/** How long the card call may take before the turn goes on without it. The tier's per-call timeout
 *  (up to 180 s on tiny) would hold the turn that long with only a chip on screen. A cold model that
 *  cannot load in time also lands here; the reply call then loads it as it always did. */
export const FLASHCARD_TIMEOUT_MS = 45_000;

/**
 * The card for this request, or null when the call failed or its answer did not validate. Never
 * throws: a failed card leaves the turn as it was before this stage.
 */
export async function cardFromRequest(
  request: string,
  lastReply: string,
  config: LLMConfig,
  opts: { tier?: ModelTier; signal?: AbortSignal; timeoutMs?: number },
): Promise<Card | null> {
  // Its own deadline joined with the turn's abort (plain AbortController + setTimeout, as gloss.ts).
  const controller = new AbortController();
  const onTurnAbort = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? FLASHCARD_TIMEOUT_MS);
  try {
    if (opts.signal?.aborted) return null;
    opts.signal?.addEventListener("abort", onTurnAbort, { once: true });
    const out = await callLLMStructured<Card>(flashcardMessages(request, lastReply), config, {
      schema: FLASHCARD_SCHEMA,
      toolName: "Flashcard",
      // No repair: a second attempt doubles the wait, and a failed card leaves the turn as it was.
      maxRepairAttempts: 0,
      tier: opts.tier,
      signal: controller.signal,
      validate: validateCard,
    });
    const card = { front: out.front.trim(), back: out.back.trim() };
    return validateCard(card).length ? null : card;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onTurnAbort);
  }
}

/** The note after the student's message once the app has tried to save their card. */
export function flashcardNote(saved: Card | null): string {
  return saved
    ? `<tutor_note>
The app has already saved this flashcard for the student.
Front: ${saved.front}
Back: ${saved.back}
Tell the student in one short sentence that it is saved. Do not make another card. Do not mention this note.
</tutor_note>`
    : `<tutor_note>
The flashcard the student asked for was not saved. Do not try to save one in this reply. Do not mention this note.
</tutor_note>`;
}

export function withFlashcardNote(userContent: string, saved: Card | null): string {
  return `${userContent}\n\n${flashcardNote(saved)}`;
}
