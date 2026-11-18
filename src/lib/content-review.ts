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
import type { LLMConfig, LLMProvider, ModelTier } from "../types";
import { isOllamaCloudModel, modelNeedsCloudNotice, needsCloudNotice, type CloudFeature } from "./privacy";
import { lessonCheckCounts } from "./ai-notice";
import { GENERATION_MODELS, isOllamaTag, legacyModelOwner } from "./models";
import { questionWithSentence } from "./quiz-grading";

export type ReviewVerdict = "ok" | "false_fact" | "wrong_key" | "unanswerable";

export interface ReviewFinding {
  index: number;
  verdict: Exclude<ReviewVerdict, "ok">;
  sentence: string; // the false sentence, copied from the item (false_fact); may be empty otherwise
  reason: string;   // one short line for the log and the regeneration prompt; never shown to a learner
}

interface RawVerdict { index?: number; verdict?: string; sentence?: string; reason?: string; statement_is_false?: boolean }
export interface ReviewReply { verdicts?: RawVerdict[] }

type Messages = Array<{ role: string; content: string }>;

// ─── Which model reviews ──────────────────────────────────────────────────────

// Stored value of the "review model" setting (STORE_KEYS.reviewModel) → the config the review runs on,
// or null for no review. Unset or "" = the generation model, except for LESSONS on the tiny and small
// tiers (LESSON_REVIEW_DEFAULT_OFF_TIERS). "off" = no review. "<provider>:<model>" = that model on another
// configured provider (parseReviewModel), e.g. "anthropic:claude-haiku-5-5" with the key saved for
// Anthropic, so a local model can write and a cloud model check. Settings always saves that form. A bare
// model name (written by an older version, or by hand) belongs to the provider models.ts legacyModelOwner
// gives it (a cloud provider only for its exact catalog or shutdown ids, otherwise Ollama) and is used only
// when that is the course model's provider, so a "gemma4:e2b" or a local "claude-3.7-…-gemma3" is never sent
// to Anthropic. An Ollama "name:tag" named for a cloud provider ("anthropic:gemma4:e2b") is ignored too
// (models.ts isOllamaTag). Ignored means the default applies. A cloud reviewer whose privacy notice was
// never confirmed here (an Ollama cloud model, or OpenAI/Anthropic before their confirm), or a cloud
// provider with no saved key, is ignored (the default applies), so a hand-edited settings file cannot send content off the computer
// unannounced. The payload is the same for every reviewer: topic, title and generated content.
//
// Why lessons are off on tiny: replaying B9 rerun 2 (2026-11-14) through a gemma4:e2b review caught
// 0 of the 5 known false lessons and flagged 5 true statements in 4 other lessons. On questions the
// same reviewer flagged 17 of 118 questions, 14 of them truly bad (12 of 12 on one test of 38 that had
// about 19 bad), so the question review stays on.
// Why also small: gemma4:e4b, the default on 16 GB machines, tiers as small and has never been measured
// as a lesson reviewer. The only measurement (e2b) caught nothing, and a false flag costs a regeneration
// plus a second review (about three lesson calls on a CPU) and can drop a true section. Naming a model
// in review_model still turns it on.
export const REVIEW_OFF = "off";
export type ReviewKind = "lesson" | "questions";
export const LESSON_REVIEW_DEFAULT_OFF_TIERS: ReadonlySet<ModelTier> = new Set<ModelTier>(["tiny", "small"]);

// The other providers this install has credentials for, as store.ts reads them: the API key saved for
// OpenAI or Anthropic, and the Ollama URL. A review on another provider needs its entry here.
export type ProviderCredentials = Partial<Record<LLMProvider, { apiKey?: string; ollamaUrl?: string }>>;

const PROVIDERS: readonly LLMProvider[] = ["ollama", "openai", "anthropic"];

// "<provider>:<model>" names a model on that provider ("anthropic:claude-haiku-5-5",
// "ollama:qwen3.5:9b"); anything else is a model on the generation provider. Only the three provider
// names count as a prefix, so an Ollama tag like "gemma4:e2b" stays a plain model name.
export function parseReviewModel(value: string): { provider: LLMProvider | null; model: string } {
  const at = value.indexOf(":");
  const head = at > 0 ? value.slice(0, at).toLowerCase() : "";
  const provider = PROVIDERS.find((p) => p === head) ?? null;
  return provider ? { provider, model: value.slice(at + 1).trim() } : { provider: null, model: value };
}

// A review model on a provider other than the generation one ("local model writes, cloud model
// checks"), or null when it cannot be used: no key saved for that cloud provider, its one-time privacy
// confirm never accepted here (needsCloudNotice), or an Ollama cloud model never confirmed.
function otherProviderReview(provider: LLMProvider, model: string, creds: ProviderCredentials, seen: readonly string[]): LLMConfig | null {
  if (!model) return null;
  if (provider === "ollama") {
    if (modelNeedsCloudNotice("ollama", model, seen)) return null;
    return { provider, model, ollamaUrl: creds.ollama?.ollamaUrl };
  }
  const apiKey = creds[provider]?.apiKey;
  if (!apiKey || needsCloudNotice(provider, seen)) return null;
  return { provider, model, apiKey };
}

export function resolveReviewConfig(
  stored: string | null | undefined,
  gen: LLMConfig,
  genTier: ModelTier,
  noticesSeen: readonly string[],
  kind: ReviewKind,
  creds: ProviderCredentials = {},
): LLMConfig | null {
  // A hand-edited settings import can put anything here; a non-string counts as unset.
  const value = typeof stored === "string" ? stored.trim() : "";
  if (value.toLowerCase() === REVIEW_OFF) return null;
  const named = parseReviewModel(value);
  const provider = named.provider ?? legacyModelOwner(named.model);
  if (named.model && !(provider !== "ollama" && isOllamaTag(named.model))) {
    if (provider !== gen.provider) {
      const other = named.provider ? otherProviderReview(provider, named.model, creds, noticesSeen) : null;
      if (other) return other;
    } else if (!modelNeedsCloudNotice(gen.provider, named.model, noticesSeen)) {
      return named.model === gen.model ? { ...gen, modelTier: genTier } : { ...gen, model: named.model, modelTier: undefined };
    }
  }
  if (kind === "lesson" && LESSON_REVIEW_DEFAULT_OFF_TIERS.has(genTier)) return null;
  return { ...gen, modelTier: genTier };
}

// ─── The Checking model setting (Settings › Models, ReviewModelPicker.tsx) ─────

export interface ReviewChoice { value: string; label: string; group: "default" | LLMProvider }

// What the setting offers, in order: the default (unset = the course model), off, the models Ollama has
// installed (not embedding models), and the generation catalog of each cloud provider with a key saved
// here. Every model is stored as "<provider>:<model>". A stored value that is not on the list (typed into
// settings.json, or imported) stays visible as its own choice, so the selection is what the app uses.
export function reviewModelChoices(opts: {
  ollamaModels: readonly string[];
  cloudKeys: Partial<Record<"openai" | "anthropic", boolean>>;
  stored: string;
}): ReviewChoice[] {
  const choices: ReviewChoice[] = [
    { value: "", label: "Same as the course model", group: "default" },
    { value: REVIEW_OFF, label: "Off", group: "default" },
    ...opts.ollamaModels.filter((m) => !/embed/i.test(m)).map((m) => ({ value: `ollama:${m}`, label: m, group: "ollama" as const })),
  ];
  for (const p of ["openai", "anthropic"] as const) {
    if (opts.cloudKeys[p]) choices.push(...GENERATION_MODELS[p].map((m) => ({ value: `${p}:${m.id}`, label: m.label, group: p })));
  }
  const stored = opts.stored.trim();
  if (stored && stored.toLowerCase() !== REVIEW_OFF && !choices.some((c) => c.value === stored)) {
    choices.push({ value: stored, label: stored, group: parseReviewModel(stored).provider ?? "default" });
  }
  return choices;
}

// The one-time cloud confirm (privacy.ts) a Checking model choice needs before it is saved, or null: the
// company's notice for an OpenAI or Anthropic model, Ollama's for an Ollama model whose name ends in
// cloud, each only when not accepted here before. resolveReviewConfig ignores a cloud reviewer without
// it anyway; asking at the pick is what makes the choice take effect.
export function reviewChoiceNotice(value: string, seen: readonly string[]): CloudFeature | null {
  const { provider, model } = parseReviewModel(value.trim());
  if (provider === "openai" || provider === "anthropic") return needsCloudNotice(provider, seen) ? provider : null;
  if (provider === "ollama" && isOllamaCloudModel(model)) return needsCloudNotice("ollama-cloud", seen) ? "ollama-cloud" : null;
  return null;
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
Then set "statement_is_false": true only if the sentence you copied is false as written. If your reason finds the sentence true, or only loosely worded, set it to false.

Return ONLY a JSON object: {"verdicts":[{"index": <part index>, "verdict": "ok" | "false_fact", "sentence": "", "reason": "", "statement_is_false": false}]}, one entry per part.

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
  /** The sentence a fill-in-the-blank question shows the learner (quiz-grading.ts questionWithSentence). */
  blank_position?: string | null;
}

export function questionText(q: ReviewableQuestion): string {
  const opts = q.options && q.options.length ? `\nOptions: ${q.options.join(" | ")}` : "";
  const pairs = q.matching_pairs && q.matching_pairs.length
    ? `\nPairs: ${q.matching_pairs.map((p) => `${p.left} = ${p.right}`).join(" | ")}` : "";
  const key = q.question_type === "drag_to_match" ? "" : `\nMarked answer: ${q.correct_answer}`;
  const expl = q.explanation ? `\nExplanation: ${q.explanation}` : "";
  return `Question (${q.question_type}): ${questionWithSentence(q)}${opts}${pairs}${key}${expl}`;
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
For "false_fact", set "statement_is_false": true only if the sentence you copied is false as written; if your reason finds it true, set it to false. For every other verdict set it to false.

Return ONLY a JSON object: {"verdicts":[{"index": <question index>, "verdict": "ok" | "wrong_key" | "unanswerable" | "false_fact", "sentence": "", "reason": "", "statement_is_false": false}]}, one entry per question.

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
          required: ["index", "verdict", "sentence", "reason", "statement_is_false"],
          // statement_is_false comes after the reason, so the model writes its reason first and then
          // commits to whether the quoted sentence is false. B10: 4 of claude-haiku-5-5's 5 false alarms
          // were false_fact verdicts whose own reason said the statement was true ("This is actually
          // true…"). Code reads this field, never the reason's words.
          properties: {
            index: { type: "number" },
            verdict: { type: "string", enum: [...verdicts] },
            sentence: { type: "string", maxLength: 400 },
            reason: { type: "string", maxLength: 240 },
            statement_is_false: { type: "boolean" },
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
// counts only when the reviewer set statement_is_false to true and its sentence is found in the item
// (quoteFound); a false_fact without statement_is_false: true is the reviewer contradicting itself.
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
    if (verdict === "false_fact" && (v.statement_is_false !== true || !quoteFound(sentence, itemTexts[i]))) continue;
    out.set(i, { index: i, verdict: verdict as ReviewFinding["verdict"], sentence, reason: typeof v.reason === "string" ? v.reason.trim() : "" });
  }
  return [...out.values()].sort((a, b) => a.index - b.index);
}

// Whether the review settled every one of the items: each has an "ok", or a finding parseReviewFindings keeps,
// which code acts on (the lesson is rewritten, or the part dropped). A reply that skips any part has not judged
// the whole lesson. Nor has one with a flag parseReviewFindings throws away (a false_fact whose
// statement_is_false is not true, or whose quote is not in the lesson, or one on a part the lesson does not
// have): that part was neither passed nor acted on. Either way the lesson is not stored as checked
// (lesson_checks), even when nothing in it was flagged.
export function judgesEveryItem(reply: ReviewReply | null | undefined, itemTexts: readonly string[], allowed: readonly ReviewVerdict[]): boolean {
  const kept = new Set(parseReviewFindings(reply, itemTexts, allowed).map((f) => f.index));
  const judged = new Set<number>();
  for (const v of Array.isArray(reply?.verdicts) ? reply!.verdicts! : []) {
    const i = v?.index;
    const verdict = v?.verdict as ReviewVerdict;
    // A verdict outside the allowed list is unreadable, not an ok: unchecked.
    if (!allowed.includes(verdict)) return false;
    const inRange = typeof i === "number" && Number.isInteger(i) && i >= 0 && i < itemTexts.length;
    if (verdict !== "ok" && !(inRange && kept.has(i))) return false;
    if (inRange) judged.add(i);
  }
  return itemTexts.length > 0 && judged.size === itemTexts.length;
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
  return (await reviewLessonIfRan(topic, title, lesson, review))?.findings ?? [];
}

// The same review, with null when the call failed (logged; the lesson is kept), so generateLesson can tell
// a lesson the reviewer read and passed from one it never read (lesson_checks, ai-notice.ts lessonStatusLine).
// `judgedEveryPart` is false when the reply left any part without a verdict ({"verdicts":[]} included), or
// flagged one in a way parseReviewFindings throws away (judgesEveryItem): its findings still count, but the
// lesson is not "checked".
export async function reviewLessonIfRan(
  topic: string, title: string, lesson: LessonContent, review: LLMConfig,
): Promise<{ findings: ReviewFinding[]; judgedEveryPart: boolean } | null> {
  const tier = await tierOf(review);
  try {
    const reply = await callLLMStructured<ReviewReply>(
      buildLessonReviewMessages(topic, title, lesson), review,
      { schema: reviewSchema(LESSON_VERDICTS), toolName: "emit_lesson_review", tier },
    );
    const parts = lessonParts(lesson);
    const judgedEveryPart = judgesEveryItem(reply, parts, LESSON_VERDICTS);
    if (!judgedEveryPart) log.warn("content-review", `lesson "${title}": the review left part of the lesson without a verdict it could act on, so it is not marked checked`);
    return { findings: parseReviewFindings(reply, parts, LESSON_VERDICTS), judgedEveryPart };
  } catch (e) {
    log.warn("content-review", `lesson "${title}": review failed, lesson kept`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

// What lesson_checks stores for a lesson this reviewer read and returned on: "<provider>:<model>" when the
// review counts as a check (ai-notice.ts lessonCheckCounts), else null. `writer` is the config that wrote
// that lesson (generateLesson's own `config`, not the setting). Never "checked": a Checking model on this
// computer (the measured local reviewer, gemma4:e2b, caught 0 of 5 known false lessons), or the model that
// wrote the lesson reading its own work (a self-review was never measured). Another model from the same
// company counts. Fable's decisions, 2026-11-16. The review still runs and its flags are still acted on;
// only the label depends on this.
export function cloudCheckedBy(review: LLMConfig | null, writer: LLMConfig): string | null {
  return review && lessonCheckCounts(review, writer) ? `${review.provider}:${review.model}` : null;
}

// Questions per review call. A tiny or small model loses track of long verdict lists.
export function reviewChunkSize(tier: ModelTier): number {
  return tier === "tiny" || tier === "small" ? 8 : 20;
}

// Reviews `questions` in chunks and returns findings indexed into `questions`.
export async function reviewQuestions(topic: string, questions: ReviewableQuestion[], review: LLMConfig, signal?: AbortSignal): Promise<ReviewFinding[]> {
  const tier = await tierOf(review);
  const size = reviewChunkSize(tier);
  const out: ReviewFinding[] = [];
  for (let start = 0; start < questions.length; start += size) {
    if (signal?.aborted) break; // the learner left the making screen; the caller stops (quiz.ts stopIfAborted)
    const chunk = questions.slice(start, start + size);
    try {
      const reply = await callLLMStructured<ReviewReply>(
        buildQuestionReviewMessages(topic, chunk), review,
        { schema: reviewSchema(QUESTION_VERDICTS), toolName: "emit_question_review", tier, signal },
      );
      for (const f of parseReviewFindings(reply, chunk.map(questionText), QUESTION_VERDICTS)) out.push({ ...f, index: start + f.index });
    } catch (e) {
      log.warn("content-review", `questions ${start}-${start + chunk.length - 1}: review failed, kept`, e instanceof Error ? e.message : String(e));
    }
  }
  return out;
}
