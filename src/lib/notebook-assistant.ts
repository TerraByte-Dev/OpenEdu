// The notebook assistant — pure, Tauri-free, unit-tested (notebook-assistant.test.ts).
//
// Two jobs, both shaped as one-click ACTIONS rather than another chat box. The app already has chat;
// what the notebook needs is something that already knows what you're looking at, so you never have to
// describe your own note back to a model in order to get help with it.
//
//   review    read the open note and mark it up — wrong, missing, unclear, correct.
//   summarize turn the last tutor conversation into note-shaped markdown you can drop in.
//
// THE HARD PART is anchoring. A review is only useful if each remark points at the exact words it is
// about, and a 4B model asked to quote will happily paraphrase. So the model is required to return
// VERBATIM quotes, that requirement is enforced as a `validate` hook (which triggers repair-retry), and
// anything still unanchorable after that is dropped rather than shown floating. A remark you can't
// locate is worse than no remark.
//
// Nothing here mutates a note. Annotations are an overlay; applying one is an explicit, separate act.

import { estTokens, capText } from "./kernel/budget";
import { arithmeticClaims } from "./arithmetic-claims";
import { isSafetyDisclosure } from "./child-safety";
import type { Grade } from "./grade";
import type { ModelTier } from "../types";

export type AnnotationKind = "error" | "gap" | "question" | "correct";

export interface Annotation {
  /** Verbatim span from the note. The anchor — must match exactly or the annotation is dropped. */
  quote: string;
  kind: AnnotationKind;
  /** The remark itself. One sentence. */
  note: string;
}

/** An annotation resolved to a character range in the current document. */
export interface AnchoredAnnotation extends Annotation {
  from: number;
  to: number;
}

// Kinds, in the order a reader wants them: problems first, praise last. Also the render order, so a
// correction drawn over a "correct" wins the overlap.
export const KIND_ORDER: readonly AnnotationKind[] = ["error", "gap", "question", "correct"];

/** How much of a note we send for review. Beyond this the local model's answers degrade badly. */
export const MAX_REVIEW_TOKENS = 1400;
/** How much transcript we send for a summary. */
export const MAX_TRANSCRIPT_TOKENS = 2200;
/** Ceiling on remarks per pass — past this the note is wallpaper and nothing stands out. */
export const MAX_ANNOTATIONS = 12;

export const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["annotations"],
  properties: {
    annotations: {
      type: "array",
      maxItems: MAX_ANNOTATIONS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quote", "kind", "note"],
        properties: {
          quote: { type: "string", minLength: 4 },
          kind: { type: "string", enum: ["error", "gap", "question", "correct"] },
          note: { type: "string", minLength: 4, maxLength: 220 },
        },
      },
    },
  },
} as const;

export const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["markdown"],
  properties: { markdown: { type: "string", minLength: 20 } },
} as const;

/**
 * Resolve each annotation's quote to a range in `content`, in document order.
 *
 * Drops anything that doesn't appear verbatim — that is the whole point of the quote contract, and a
 * remark pinned to the wrong words is actively misleading. Repeated quotes anchor to their first
 * occurrence; the same (quote, kind) twice is deduped, since a model asked for several remarks will
 * sometimes restate one.
 */
export function anchorAnnotations(content: string, annotations: readonly Annotation[]): AnchoredAnnotation[] {
  const out: AnchoredAnnotation[] = [];
  const seen = new Set<string>();

  for (const a of annotations) {
    const quote = a.quote.trim();
    if (!quote) continue;

    const key = `${a.kind}\u0000${quote.toLowerCase()}`;
    if (seen.has(key)) continue;

    const from = content.indexOf(quote);
    if (from === -1) continue; // paraphrased — unanchorable, so it doesn't get shown

    seen.add(key);
    out.push({ ...a, quote, from, to: from + quote.length });
  }

  // Document order, then kind, so overlapping marks layer predictably instead of by model whim.
  return out.sort((x, y) => x.from - y.from || KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind));
}

/**
 * Which annotations no longer match the document — the ones anchoring just dropped. Surfaced so the
 * UI can say "3 remarks couldn't be placed" instead of quietly showing fewer than the model produced.
 */
export function unanchorable(content: string, annotations: readonly Annotation[]): Annotation[] {
  return annotations.filter((a) => a.quote.trim() && content.indexOf(a.quote.trim()) === -1);
}

/**
 * Whether a review on this tier may show "correct" remarks. A small model's "correct" stamped on a wrong
 * fact (gemma4:e2b passed "6 x 7 = 48" and "A nickel is worth 1 cent") is worse for a child than no
 * remark, so tiny and small models show only problems. An unknown tier counts as small.
 */
export function showsCorrectRemarks(tier: ModelTier | undefined): boolean {
  return tier === "medium" || tier === "large";
}

const overlaps = (a: { from: number; to: number }, b: { from: number; to: number }) => a.from < b.to && b.from < a.to;

/**
 * What the review shows: the model's remarks anchored to the note, then checked by code where code can
 * decide. A false arithmetic claim ("6 x 7 = 48", "1/3 is bigger than 1/2") always gets an error mark
 * with the true answer and never a "correct"; a true one never gets an "error". "correct" remarks are
 * shown only on tiers that earn them (showsCorrectRemarks).
 */
export function finishReview(
  content: string,
  annotations: readonly Annotation[],
  tier: ModelTier | undefined,
): { annotations: AnchoredAnnotation[]; dropped: number } {
  const anchored = anchorAnnotations(content, annotations);
  const dropped = unanchorable(content, annotations).length;
  const claims = arithmeticClaims(content);
  const wrong = claims.filter((c) => !c.holds);
  const right = claims.filter((c) => c.holds);

  const kept = anchored.filter((a) => {
    if (a.kind === "correct" && wrong.some((c) => overlaps(a, c))) return false;
    if (a.kind === "error" && right.some((c) => c.from <= a.from && a.to <= c.to)) return false;
    return a.kind !== "correct" || showsCorrectRemarks(tier);
  });
  for (const c of wrong) {
    if (kept.some((a) => a.kind === "error" && overlaps(a, c))) continue;
    kept.push({ quote: c.text, kind: "error", note: c.truth, from: c.from, to: c.to });
  }
  const sorted = kept.sort((x, y) => x.from - y.from || KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind));
  return { annotations: sorted, dropped };
}

/** The `validate` hook for callLLMStructured — turns "you paraphrased" into a repair-retry. */
export function validateReview(content: string) {
  return (parsed: { annotations: Annotation[] }): string[] => {
    const bad = unanchorable(content, parsed.annotations ?? []);
    if (!bad.length) return [];
    // Name the offenders — a repair prompt that says which quote was wrong actually gets fixed.
    return bad.slice(0, 3).map(
      (a) => `The quote ${JSON.stringify(a.quote.slice(0, 60))} does not appear in the note. ` +
             `Copy the exact characters from the note, do not rephrase.`,
    );
  };
}

const REVIEW_SYSTEM = `You are marking up a student's study note, the way a tutor marks a page in red pen.

Return remarks about specific spans of the note. For each remark:
- "quote" MUST be copied character-for-character from the note. Never rephrase, never summarise, never
  fix the student's spelling in the quote. If you cannot copy it exactly, leave the remark out.
- Keep the quote short — the few words the remark is about, not a whole paragraph.
- "kind" is one of:
    error    — factually wrong, or a real misunderstanding
    gap      — something important is missing right here
    question — unclear, ambiguous, or worth the student checking
    correct  — a specific thing they got right that was worth getting right
- "note" is ONE sentence, plain and direct.

Mark what matters. A page covered in ink teaches nothing. Prefer a handful of real remarks over many
trivial ones, and include at least one "correct" when the note deserves it.`;

export function buildReviewMessages(title: string, content: string): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: REVIEW_SYSTEM },
    { role: "user", content: `Note title: ${title || "Untitled"}\n\n---\n${capText(content, MAX_REVIEW_TOKENS)}\n---` },
  ];
}

/** A note's markdown as plain text: no markers, link targets, headings or table rules (TerraTutor's
 *  record/build.ts notePlainText), so "my dad **hits** me" reads as typed. */
function notePlainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*(?:```|~~~).*$/gm, "")
    .replace(/<[^>\n]+>/g, " ")
    .replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (_m, target: string, label?: string) => label ?? target)
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, "")
    .replace(/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*(?::?-+:?)?\s*$/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:>\s?)+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/\|/g, " ")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/gm, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a Notebook note reads as a safety disclosure (child-safety.ts isSafetyDisclosure, with the learner's
 * grade, as the chat reads it): its title, its markdown or its plain text. No model reads one: "Review this
 * note" never sends it (prepareReview), notebook.ts indexNote never embeds it and searchNotebook never returns
 * it; NotesTab shows the safety notice above the editor. Ported from TerraTutor #236.
 */
export function noteIsDisclosure(title: string | null | undefined, content: string | null | undefined, grade: Grade | null = null): boolean {
  const said = (text: string) => isSafetyDisclosure(text, grade);
  return said(title ?? "") || said(content ?? "") || said(notePlainText(content ?? ""));
}

/** Said in plain text under the safety notice when "Review this note" does not send the note (prepareReview). */
export const NOTE_REVIEW_WITHHELD = "This note wasn't sent to the tutor for review, because of what it says.";

/**
 * What "Review this note" sends to the model, or that it sends nothing: a note that reads as a safety
 * disclosure (noteIsDisclosure) is never handed to a model to mark up. NotesAssistant shows the safety
 * notice and NOTE_REVIEW_WITHHELD instead.
 */
export function prepareReview(title: string, content: string, grade: Grade | null):
  { withheld: "safety" } | { messages: Array<{ role: string; content: string }> } {
  if (noteIsDisclosure(title, content, grade)) return { withheld: "safety" };
  return { messages: buildReviewMessages(title, content) };
}

const SUMMARY_SYSTEM = `Turn a tutoring conversation into study notes the student can keep.

Write markdown the student would have written if they had been taking good notes throughout:
- Lead with what was actually being learned, as a "## " heading.
- Bullets for the substance — definitions, steps, worked results, the reasoning that mattered.
- Keep the student's own worked examples and numbers.
- Drop the conversational scaffolding entirely: greetings, "great question", encouragement, the tutor
  asking what they want to do next.
- Do not invent anything that was not in the conversation.

Output only the markdown body. No preamble, no "here are your notes".`;

/**
 * The conversation before the first student message that reads as a safety disclosure (isSafetyDisclosure):
 * that message and everything after it are left out. A disclosure never goes into a note, nor a later reply
 * that may repeat it ("what should i do" next), as the kernel keeps nothing from those turns in the course's
 * memory, notes and flashcards (TutorEngine turnInDisclosedThread, the same window; ported from TerraTutor
 * #238). It is read with the learner's grade, as the chat's notice is, so with a K-12 grade a strong pregnancy
 * self-disclosure is left out too.
 */
function withoutDisclosureExchanges<M extends { role: string; content: string }>(messages: readonly M[], grade: Grade | null): M[] {
  const first = messages.findIndex((m) => m.role === "user" && isSafetyDisclosure(m.content, grade));
  return first < 0 ? [...messages] : messages.slice(0, first);
}

/**
 * Render a transcript for the summariser, newest turns kept when it has to be trimmed. `grade` is the active
 * learner's grade, the one ChatTab reads the same messages with.
 */
export function formatTranscript(
  messages: readonly { role: string; content: string }[],
  grade: Grade | null,
  maxTokens = MAX_TRANSCRIPT_TOKENS,
): string {
  // Everything from the first safety disclosure on is left out (child-safety.ts).
  const lines = withoutDisclosureExchanges(messages, grade)
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
    .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content.trim()}`);

  // Keep the END of the conversation — that is where the understanding landed. Walking backwards also
  // means a single enormous final message can't starve everything before it silently.
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = estTokens(lines[i]) + 1;
    if (used + cost > maxTokens) break;
    kept.unshift(lines[i]);
    used += cost;
  }
  // A conversation whose very first kept line is already over budget still deserves something.
  if (!kept.length && lines.length) kept.push(capText(lines[lines.length - 1], maxTokens));
  return kept.join("\n\n");
}

/**
 * What "Notes from last chat" summarises: formatTranscript's text, or "" when the tutor never answered in
 * what it keeps. A chat holding only the learner's question (the reply failed: Ollama stopped, an error) has
 * nothing to make notes from, and the summariser would write the notes itself (TerraTutor click test
 * 2026-11-19).
 */
export function summaryTranscript(messages: readonly { role: string; content: string }[], grade: Grade | null): string {
  const kept = withoutDisclosureExchanges(messages, grade);
  return kept.some((m) => m.role === "assistant" && m.content.trim()) ? formatTranscript(messages, grade) : "";
}

export function buildSummaryMessages(transcript: string): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: SUMMARY_SYSTEM },
    { role: "user", content: `Conversation:\n\n${transcript}` },
  ];
}

/**
 * The summary as the panel shows it, or `withheld: "safety"` when it reads as a safety disclosure for a learner
 * of this grade (child-safety.ts): the panel then shows SAFETY_NOTICE and never offers it for Insert.
 */
export function finishSummary(markdown: string, grade: Grade | null): { markdown: string } | { withheld: "safety" } {
  return isSafetyDisclosure(markdown, grade) ? { withheld: "safety" } : { markdown };
}

/** Where to put a summary in an existing note — appended under a rule, never overwriting. */
export function appendSummary(content: string, summary: string): string {
  const body = summary.trim();
  if (!content.trim()) return `${body}\n`;
  return `${content.replace(/\s+$/, "")}\n\n---\n\n${body}\n`;
}
