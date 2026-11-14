// Content review (lane 1 of TerraTutor's docs/CLOUD-PRIVACY.md): one structured call that reads a
// GENERATED lesson or a batch of GENERATED quiz/test questions before a learner sees them, and returns
// a verdict per item. Code acts on the verdicts (curriculum.ts regenerates a lesson once, quiz.ts drops
// flagged questions and its top-up refills them). The review's words never reach the learner: they go
// to the log and, for a lesson, into the one regeneration prompt.
//
// Privacy rule: a review payload is a function of (topic, generated content) and nothing else. The
// builders below take no learner, grade, answer or history argument, and the callers pass only content
// whose own generation input was learner-free (lessons; freshly generated questions, never the
// review pool of questions a learner missed). content-review-privacy.test.ts holds that line.

import { callLLMStructured, detectModelTier, log } from "./llm";
import type { LessonContent } from "./lesson-format";
import type { LLMConfig, ModelTier } from "../types";
import { modelNeedsCloudNotice } from "./privacy";

export type ReviewVerdict = "ok" | "false_fact" | "wrong_key" | "unanswerable";

export interface ReviewFinding {
  index: number;
  verdict: Exclude<ReviewVerdict, "ok">;
  sentence: string; // the false sentence, copied from the item (false_fact); may be empty otherwise
  reason: string;   // one short line for the log and the regeneration prompt; never shown to a learner
}

interface RawVerdict { index?: number; verdict?: string; sentence?: string; reason?: string }
export interface ReviewReply { verdicts?: RawVerdict[] }

type Messages = Array<{ role: string; content: string }>;

// ─── Which model reviews ──────────────────────────────────────────────────────

// Stored value of the "review model" setting (STORE_KEYS.reviewModel) → the config the review runs on,
// or null for no review. Unset or "" = the generation model, except on the tiny tier, where it is off
// by default (see REVIEW_DEFAULT_OFF_TIERS). "off" = no review. Any other value = that model on the
// current provider. An Ollama cloud model whose privacy notice was never confirmed is ignored (the
// default applies), so a hand-edited settings file cannot send content off the computer unannounced.
export const REVIEW_OFF = "off";
export const REVIEW_DEFAULT_OFF_TIERS: ReadonlySet<ModelTier> = new Set<ModelTier>(["tiny"]);

export function resolveReviewConfig(
  stored: string | null | undefined,
  gen: LLMConfig,
  genTier: ModelTier,
  noticesSeen: readonly string[],
): LLMConfig | null {
  const value = (stored ?? "").trim();
  if (value.toLowerCase() === REVIEW_OFF) return null;
  if (value && value !== gen.model && !modelNeedsCloudNotice(gen.provider, value, noticesSeen)) {
    return { ...gen, model: value, modelTier: undefined };
  }
  return REVIEW_DEFAULT_OFF_TIERS.has(genTier) ? null : { ...gen, modelTier: genTier };
}

// ─── Payloads (pure; the privacy test calls these through the production path) ──

// The lesson as numbered parts: 0 = summary, then each section, then each takeaway.
export function lessonParts(c: LessonContent): string[] {
  return [
    c.summary,
    ...c.sections.map((s) => `${s.heading}\n${s.body}`),
    ...c.key_takeaways,
  ];
}

export function buildLessonReviewMessages(topic: string, title: string, lesson: LessonContent): Messages {
  const body = lessonParts(lesson).map((t, i) => `[index ${i}]\n${t}`).join("\n\n");
  return [{
    role: "user",
    content: `Check this lesson from a course on "${topic}" ("${title}") for factual errors before a student reads it.

For each numbered part, give one verdict:
- "false_fact": the part states something that is factually wrong (a wrong fact, definition, rule, date, place or calculation). Copy the false sentence exactly into "sentence", and in "reason" say in a few words what is true.
- "ok": nothing in the part is false. Simplified, incomplete or informal wording is ok; only flag what is wrong.

Return ONLY a JSON object: {"verdicts":[{"index": <part index>, "verdict": "ok" | "false_fact", "sentence": "", "reason": ""}]}, one entry per part.

${body}`,
  }];
}

// The fields a question carries into the review. Deliberately no learner answer, grade or history.
export interface ReviewableQuestion {
  question_text: string;
  question_type: string;
  options?: string[] | null;
  correct_answer: string;
  explanation?: string | null;
  matching_pairs?: Array<{ left: string; right: string }> | null;
}

export function questionText(q: ReviewableQuestion): string {
  const opts = q.options && q.options.length ? `\nOptions: ${q.options.join(" | ")}` : "";
  const pairs = q.matching_pairs && q.matching_pairs.length
    ? `\nPairs: ${q.matching_pairs.map((p) => `${p.left} = ${p.right}`).join(" | ")}` : "";
  const key = q.question_type === "drag_to_match" ? "" : `\nMarked answer: ${q.correct_answer}`;
  const expl = q.explanation ? `\nExplanation: ${q.explanation}` : "";
  return `Question (${q.question_type}): ${q.question_text}${opts}${pairs}${key}${expl}`;
}

export function buildQuestionReviewMessages(topic: string, questions: ReviewableQuestion[]): Messages {
  const body = questions.map((q, i) => `[index ${i}]\n${questionText(q)}`).join("\n\n");
  return [{
    role: "user",
    content: `Check these test questions on "${topic}" before a student sees them. For each one, first work out the right answer yourself, then compare it with the marked answer.

Give each question one verdict:
- "wrong_key": the marked answer is wrong, or a different option is the right one.
- "unanswerable": there is no single right answer (two options are right, none is, or the question leaves out what it needs).
- "false_fact": the question or its explanation states something factually wrong. Copy that sentence into "sentence".
- "ok": the marked answer is right and nothing stated is false.
In "reason" say in a few words why (empty for ok).

Return ONLY a JSON object: {"verdicts":[{"index": <question index>, "verdict": "ok" | "wrong_key" | "unanswerable" | "false_fact", "sentence": "", "reason": ""}]}, one entry per question.

${body}`,
  }];
}

function reviewSchema(verdicts: readonly ReviewVerdict[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["verdicts"],
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "verdict", "sentence", "reason"],
          properties: {
            index: { type: "number" },
            verdict: { type: "string", enum: [...verdicts] },
            sentence: { type: "string", maxLength: 400 },
            reason: { type: "string", maxLength: 240 },
          },
        },
      },
    },
  };
}

const LESSON_VERDICTS = ["ok", "false_fact"] as const;
const QUESTION_VERDICTS = ["ok", "wrong_key", "unanswerable", "false_fact"] as const;

// ─── Reading the verdicts ─────────────────────────────────────────────────────

const norm = (s: string): string =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\p{L}\p{N}'.%=+×÷/-]+/gu, " ").replace(/\s+/g, " ").trim();

// Whether a false_fact's quoted sentence is really in the item. A small model sometimes "quotes" a
// sentence the item never said; such a flag is noise, not a finding. Accepts the exact text, or a
// quote whose words of 3+ letters all appear in the item (minor paraphrase, dropped quotes).
export function quoteFound(sentence: string, itemText: string): boolean {
  const q = norm(sentence).replace(/^[.\s]+|[.\s]+$/g, "");
  if (q.length < 6) return false;
  const t = norm(itemText);
  if (t.includes(q)) return true;
  const words = q.split(" ").filter((w) => w.length >= 3);
  if (words.length < 3) return false;
  const have = new Set(t.split(" ").map((w) => w.replace(/^[.]+|[.]+$/g, "")));
  return words.every((w) => have.has(w.replace(/^[.]+|[.]+$/g, "")));
}

// Verdicts → findings for the items that should not reach a learner. A missing or unknown verdict
// counts as ok, so a silent or confused reviewer can only keep content, never drain it. A false_fact
// counts only when its sentence is found in the item (quoteFound).
export function parseReviewFindings(
  reply: ReviewReply | null | undefined,
  itemTexts: readonly string[],
  allowed: readonly ReviewVerdict[],
): ReviewFinding[] {
  const out = new Map<number, ReviewFinding>();
  for (const v of Array.isArray(reply?.verdicts) ? reply!.verdicts! : []) {
    const i = v?.index;
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= itemTexts.length || out.has(i)) continue;
    const verdict = v.verdict as ReviewVerdict;
    if (verdict === "ok" || !allowed.includes(verdict)) continue;
    const sentence = typeof v.sentence === "string" ? v.sentence.trim() : "";
    if (verdict === "false_fact" && !quoteFound(sentence, itemTexts[i])) continue;
    out.set(i, { index: i, verdict: verdict as ReviewFinding["verdict"], sentence, reason: typeof v.reason === "string" ? v.reason.trim() : "" });
  }
  return [...out.values()].sort((a, b) => a.index - b.index);
}

// The lesson without the flagged parts. null when no section is left to teach from.
export function withoutFlaggedParts(c: LessonContent, findings: readonly ReviewFinding[]): LessonContent | null {
  const bad = new Set(findings.map((f) => f.index));
  const n = c.sections.length;
  const sections = c.sections.filter((_, i) => !bad.has(1 + i));
  if (sections.length === 0) return null;
  return {
    summary: bad.has(0) ? "" : c.summary,
    sections,
    key_takeaways: c.key_takeaways.filter((_, i) => !bad.has(1 + n + i)),
  };
}

// The note added to the lesson prompt for its one regeneration.
export function correctionsNote(findings: readonly ReviewFinding[]): string {
  const lines = findings.filter((f) => f.verdict === "false_fact")
    .map((f) => `- "${f.sentence}"${f.reason ? ` (${f.reason})` : ""}`);
  return lines.length
    ? `\n\n## Corrections\nA fact check found these statements false in an earlier draft. Do not repeat them; teach the correct fact instead:\n${lines.join("\n")}`
    : "";
}

// ─── The calls ────────────────────────────────────────────────────────────────

async function tierOf(review: LLMConfig): Promise<ModelTier> {
  if (!review.modelTier) review.modelTier = await detectModelTier(review);
  return review.modelTier;
}

// Best-effort, like the verify pass: a failed review call returns no findings and is logged.
export async function reviewLesson(topic: string, title: string, lesson: LessonContent, review: LLMConfig): Promise<ReviewFinding[]> {
  const tier = await tierOf(review);
  try {
    const reply = await callLLMStructured<ReviewReply>(
      buildLessonReviewMessages(topic, title, lesson), review,
      { schema: reviewSchema(LESSON_VERDICTS), toolName: "emit_lesson_review", tier },
    );
    return parseReviewFindings(reply, lessonParts(lesson), LESSON_VERDICTS);
  } catch (e) {
    log.warn("content-review", `lesson "${title}": review failed, lesson kept`, e instanceof Error ? e.message : String(e));
    return [];
  }
}

// Questions per review call. A tiny or small model loses track of long verdict lists.
export function reviewChunkSize(tier: ModelTier): number {
  return tier === "tiny" || tier === "small" ? 8 : 20;
}

// Reviews `questions` in chunks and returns findings indexed into `questions`.
export async function reviewQuestions(topic: string, questions: ReviewableQuestion[], review: LLMConfig): Promise<ReviewFinding[]> {
  const tier = await tierOf(review);
  const size = reviewChunkSize(tier);
  const out: ReviewFinding[] = [];
  for (let start = 0; start < questions.length; start += size) {
    const chunk = questions.slice(start, start + size);
    try {
      const reply = await callLLMStructured<ReviewReply>(
        buildQuestionReviewMessages(topic, chunk), review,
        { schema: reviewSchema(QUESTION_VERDICTS), toolName: "emit_question_review", tier },
      );
      for (const f of parseReviewFindings(reply, chunk.map(questionText), QUESTION_VERDICTS)) out.push({ ...f, index: start + f.index });
    } catch (e) {
      log.warn("content-review", `questions ${start}-${start + chunk.length - 1}: review failed, kept`, e instanceof Error ? e.message : String(e));
    }
  }
  return out;
}
