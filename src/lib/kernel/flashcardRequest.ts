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
// Any other turn is untouched: no call, no note, byte-identical requests. A failed card call leaves the
// turn exactly as it was before this stage existed (the tool stays offered to the model).

import { callLLMStructured } from "../llm";
import type { LLMConfig, ModelTier } from "../../types";

export const FLASHCARD_TOOL = "flashcard.create";

// A request verb, then (in the same sentence, within a few words) one flashcard. Plural "flashcards" is
// left to the model: one structured card cannot answer "make flashcards for all of these".
const REQUEST = /\b(?:make|create|save|add|write|turn|put)\b[^.?!\n]{0,40}?\bflash[ -]?card\b(?!s)/i;
// A message that opens as a question about flashcards, not a request for one: "should I make a
// flashcard?", "how do I add a flashcard?", "did you save the flashcard?". Only the opening is read,
// so a card's own content ("... what do you call a baby cat?") does not block it.
const NOT_A_REQUEST = /^\s*(?:should i|how (?:do|can|would) i|how to|did you|have you|do you|why)\b/i;

/** True when the student's message asks for one flashcard to be made. */
export function asksForFlashcard(text: string): boolean {
  return REQUEST.test(text) && !NOT_A_REQUEST.test(text);
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

/**
 * The card for this request, or null when the call failed or its answer did not validate. Never
 * throws: a failed card leaves the turn as it was before this stage.
 */
export async function cardFromRequest(
  request: string,
  lastReply: string,
  config: LLMConfig,
  opts: { tier?: ModelTier; signal?: AbortSignal },
): Promise<Card | null> {
  try {
    const out = await callLLMStructured<Card>(flashcardMessages(request, lastReply), config, {
      schema: FLASHCARD_SCHEMA,
      toolName: "Flashcard",
      maxRepairAttempts: 1,
      tier: opts.tier,
      signal: opts.signal,
      validate: validateCard,
    });
    const card = { front: out.front.trim(), back: out.back.trim() };
    return validateCard(card).length ? null : card;
  } catch {
    return null;
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
