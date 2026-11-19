import { callLLMStructured, detectModelTier, log } from "./llm";
import { MATH_FORMATTING_RULES, MATH_FORMATTING_RULES_PROSE } from "./formatting";
import { splitNewVsReview, storedToGenQuestion, pickReview, interleaveReview } from "./quiz-review";
import {
  checkAnswerConsistency, shouldRejectNumericReasoning, runsVerifyPass,
  buildBatchGradePrompt, parseBatchGradeResults, batchGradeSchema,
  buildVerifyPrompt, parseVerifyDrops, splitCount, dedupeByQuestionText,
  planSlotSubtopics, summarizeForLedger, alignKeyToOption,
  hasSelfCorrection, duplicateOptionPair, optionEqualToKey, rewriteLetterRefs, isNearDuplicate,
  repeatedMatchSide, questionWithSentence, questionKey, askedText, type EarlierQuestion,
  type GradeOutcome, type BatchGradeReply,
} from "./quiz-grading";
import { reviewQuestions } from "./content-review";
import { isLocalModel } from "./privacy";
import { ollamaUnavailable } from "./plain-language";
import { settleByCode, misspellingCandidates, misspeltNameCandidates, personNameWords, misspeltKeyWords, misspellingNote, wordsWithin, formsWithin, singular, type SpellingLookup, type WordSenses } from "./answer-match";
import { lookupWord, oneWordHeadwords, type DictionaryEntry } from "./dictionary";
import { inWordList } from "./wordlist";
import { isNonAnswer } from "./non-answer";
import { isSafetyDisclosure } from "./child-safety";
import type { Grade } from "./grade";
import type { LLMConfig, ModelTier, Syllabus, QuizQuestion } from "../types";

// The generation-time question shape (no DB/runtime fields yet).
type GenQuestion = Omit<QuizQuestion, "id" | "attempt_id" | "user_answer" | "is_correct">;

// Target / floor question counts (issue #83). Target = what we aim to generate. A quiz under its floor
// ships with an honest "your model may be struggling" note; a level test under TEST_FLOOR is not given
// at all (levelTestShortfall). Quizzes 10–20, promotion tests 30–45.
export const QUIZ_TARGET = 20;
export const QUIZ_FLOOR = 10;
/** How many questions from the latest quizzes on a level a new quiz on it tries not to repeat (about two quizzes). */
export const RECENT_QUESTIONS = 2 * QUIZ_TARGET;
export const TEST_CURRENT_TARGET = 35;
export const TEST_REVIEW_TARGET = 10;
export const TEST_TOTAL_TARGET = TEST_CURRENT_TARGET + TEST_REVIEW_TARGET; // 45
export const TEST_FLOOR = 30;
// The fewest review questions a level test is given with. The review section has its own bar
// (level-test.ts PASS_REVIEW, 60%): with 1 or 2 questions one miss fails it (0% or 50%), and the whole
// test with it; from 3, one miss leaves 67%. A shorter review section is refused like an empty one.
export const TEST_REVIEW_FLOOR = 3;

const QUESTION_TYPES = [
  "multiple_choice", "true_false", "fill_in_blank",
  "written_response", "word_problem", "drag_to_match", "short_answer",
] as const;
const VALID_QUESTION_TYPES = new Set<string>(QUESTION_TYPES);

// Raw question object as emitted by the model (matches QUESTION_SCHEMA). All fields are always
// present — inapplicable ones use sentinel empties (options [], matching_pairs [], blank_position "")
// so the schema stays free of unions/conditionals the validator subset can't express.
export interface GeneratedQuestion {
  question_text: string;
  question_type: string;
  options: string[];
  correct_answer: string;
  difficulty_level: number;
  explanation: string;
  subtopic_id: string;
  blank_position: string;
  matching_pairs: Array<{ left: string; right: string }>;
}

// ─── Schema (JSON-Schema subset consumed by callLLMStructured) ────────────────
// Mirrors curriculum.ts (inline schemas, not the zod DSL — that layer isn't wired into the harness).
// One permissive object schema + a semantic validate callback handles the per-type rules the
// validator subset (no if/oneOf/anyOf) can't express structurally.
const QUESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["question_text", "question_type", "options", "correct_answer", "difficulty_level", "explanation", "subtopic_id", "blank_position", "matching_pairs"],
  properties: {
    question_text: { type: "string", minLength: 10, maxLength: 400 },
    question_type: { type: "string", enum: [...QUESTION_TYPES] },
    options: { type: "array", maxItems: 6, items: { type: "string" } },
    correct_answer: { type: "string", minLength: 1, maxLength: 400 },
    difficulty_level: { type: "number" },
    explanation: { type: "string", minLength: 8, maxLength: 400 },
    subtopic_id: { type: "string" },
    blank_position: { type: "string" },
    matching_pairs: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["left", "right"],
        properties: { left: { type: "string" }, right: { type: "string" } },
      },
    },
  },
};

// Root must be an object (OpenAI strict requires it), wrapping the questions array.
function buildBatchSchema(count: number): object {
  return {
    type: "object",
    additionalProperties: false,
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        minItems: Math.max(1, count - 1),
        maxItems: count + 1,
        items: QUESTION_SCHEMA,
      },
    },
  };
}

// ─── Semantic validation (drives callLLMStructured's repair-retry) ────────────
// Catches the content-quality failures schema can't: question type ↔ stem/format mismatches.
// Mirrors validateOutlineLevels in curriculum.ts. Returns [] when valid.
const MC_STEM_RE = /\bwhich (of the following|of these|option|one)\b|\ball of the (following|above)\b|\bselect (the|all|one|each)\b|\bnone of the (following|above)\b/i;

export function validateQuizBatch(
  questions: GeneratedQuestion[],
  allowedIds: Set<string>,
  { tier }: { tier?: ModelTier } = {},
): string[] {
  const issues: string[] = [];
  const stripPrefix = (s: string) => s.replace(/^[A-D]\)\s*/i, "").trim().toLowerCase();

  questions.forEach((raw, i) => {
    const q = alignKeyToOption(raw);
    const at = `question[${i}]`;
    const type = String(q.question_type ?? "");
    const stem = String(q.question_text ?? "");
    const opts = Array.isArray(q.options) ? q.options.map((o) => String(o)) : [];

    if (!VALID_QUESTION_TYPES.has(type)) {
      issues.push(`${at}: question_type "${type}" is not an allowed type.`);
    }

    if (type === "true_false") {
      if (MC_STEM_RE.test(stem)) {
        issues.push(`${at}: true_false has a multiple-choice-style stem ("${stem.slice(0, 60)}…"). Rewrite question_text as a declarative statement that is clearly true or false, OR change question_type to multiple_choice with 4 distinct options.`);
      }
      const ca = String(q.correct_answer ?? "").trim().toLowerCase();
      if (ca !== "true" && ca !== "false") {
        issues.push(`${at}: true_false correct_answer must be exactly "True" or "False" (got "${q.correct_answer}").`);
      }
    } else if (type === "multiple_choice") {
      if (opts.length !== 4) issues.push(`${at}: multiple_choice must have exactly 4 options (got ${opts.length}).`);
      if (opts.some((o) => !o.trim())) issues.push(`${at}: multiple_choice has an empty option.`);
      const set = new Set(opts.map(stripPrefix));
      if (set.size === 2 && set.has("true") && set.has("false")) {
        issues.push(`${at}: multiple_choice options are just True/False — use question_type "true_false" instead, or provide 4 substantive options.`);
      }
      // alignKeyToOption has set a key that names one option (in any letter case) to that option, and
      // grading compares the exact option string: a key that is still not an option has no right answer.
      if (opts.length > 0 && !opts.includes(String(q.correct_answer ?? ""))) {
        issues.push(`${at}: multiple_choice correct_answer ("${q.correct_answer}") must exactly match one of the options.`);
      }
      // Grading compares the exact option string, so a child who picks the twin of the key is marked wrong.
      const twins = duplicateOptionPair(opts, stem);
      if (twins) {
        issues.push(`${at}: options ${twins.map((i) => `"${opts[i]}"`).join(" and ")} are the same answer. Give 4 different options with exactly one correct.`);
      }
      // The key's number written another way ("0.5" beside the key "1/2"): picking it is right, but it is
      // not the key string, so it would be marked wrong (TerraTutor click test 2026-11-19 part 2, issue 5).
      const equal = twins ? null : optionEqualToKey(opts, String(q.correct_answer ?? ""), stem);
      if (equal !== null) {
        issues.push(`${at}: option "${opts[equal]}" is the same number as the correct answer "${q.correct_answer}". Give 4 different options with exactly one correct.`);
      }
    } else if (type === "fill_in_blank") {
      if (!String(q.blank_position ?? "").includes("___")) {
        issues.push(`${at}: fill_in_blank blank_position must be the full sentence containing "___".`);
      }
    } else if (type === "drag_to_match") {
      // The matching key can't be verified (it's excluded from VERIFIABLE_TYPES and the consistency
      // check), so don't let the weakest model ship an unverifiable answer key (issue #83 audit).
      if (tier === "tiny" || tier === "small") {
        issues.push(`${at}: drag_to_match is not allowed for small models — use multiple_choice, true_false, or fill_in_blank instead.`);
      }
      const pairs = Array.isArray(q.matching_pairs) ? q.matching_pairs : [];
      if (pairs.length < 3 || pairs.length > 5) issues.push(`${at}: drag_to_match needs 3–5 matching_pairs (got ${pairs.length}).`);
      if (pairs.some((p) => !p || !String(p.left).trim() || !String(p.right).trim())) {
        issues.push(`${at}: drag_to_match has an empty pair side.`);
      }
      // Each right item can be matched to one left item only, so a repeated item leaves a pair that can
      // never be made and the question can never be submitted (repeatedMatchSide).
      const repeated = repeatedMatchSide(pairs.map((p) => ({ left: String(p?.left ?? ""), right: String(p?.right ?? "") })));
      if (repeated) {
        issues.push(`${at}: drag_to_match has the same ${repeated} item twice. Every left item and every right item must be different, with exactly one match each.`);
      }
    }

    const sid = String(q.subtopic_id ?? "").trim();
    if (allowedIds.size > 0 && sid && !allowedIds.has(sid)) {
      issues.push(`${at}: subtopic_id "${sid}" is not one of the allowed ids [${[...allowedIds].join(", ")}].`);
    }

    // ── Answer quality (issue #83): the schema enforces shape; these enforce truthfulness. ──
    // Self-consistency: a numeric answer must agree with the value its own explanation works toward
    // (catches the C³⁻ "stores 6 but reasons to 9" bug). Applies on every tier — it's free.
    const consistency = checkAnswerConsistency(q);
    if (consistency) issues.push(`${at}: ${consistency}`);

    // An explanation that corrects itself mid-way ("Wait, let's re-evaluate") is not one to show a child,
    // and its key is often the value it argued against.
    if (hasSelfCorrection(String(q.explanation ?? ""))) {
      issues.push(`${at}: the explanation corrects itself ("Wait", "let's re-evaluate", "Actually,"...). Solve the problem first, then write a clean explanation that reaches correct_answer without revising itself.`);
    }

    // On the floor model, a multi-step numeric question with no shown working is where correct_answer
    // drifts. Force it to either go conceptual or show its work (which the consistency check then
    // validates). Capable tiers skip this — they get the independent verify pass instead.
    if (shouldRejectNumericReasoning(q, tier)) {
      issues.push(`${at}: this looks like a multi-step numeric/arithmetic question, which small models often get wrong. Either rewrite it as a conceptual question (no calculation needed), or show the full working in the explanation and end with "Therefore the answer is <value>".`);
    }
  });

  return issues;
}

// ─── Post-processing helpers (reused from the previous free-text path) ────────

// Shuffle multiple_choice options and update correct_answer to match new position
function shuffleMultipleChoiceOptions(
  q: ReturnType<typeof buildParsedQuestion>,
): ReturnType<typeof buildParsedQuestion> {
  if (q.question_type !== "multiple_choice" || !Array.isArray(q.options) || q.options.length < 2) {
    return q;
  }

  // Strip letter prefix to get raw text ("b) " too; alignKeyToOption has set the key to its option as written)
  const stripPrefix = (s: string) => s.replace(/^[A-D]\)\s*/i, "").trim();
  const correctText = stripPrefix(q.correct_answer);

  // Shuffle the raw option texts
  const texts = q.options.map(stripPrefix);
  for (let i = texts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [texts[i], texts[j]] = [texts[j], texts[i]];
  }

  // Re-label A) B) C) D)
  const labels = ["A", "B", "C", "D"];
  const relabeled = texts.map((text, i) => `${labels[i]}) ${text}`);

  // Find new correct_answer
  const correctIdx = texts.findIndex((t) => t === correctText);
  const newCorrect = correctIdx !== -1 ? relabeled[correctIdx] : q.correct_answer;

  // The explanation was written against the model's labels ("Therefore the answer is C", "Option A is
  // 2:45"). Rename each letter to where that option now sits, so it names what the learner sees. Label
  // by the model's own "X) " labels when every option has one, else by position. When an option is
  // itself a letter ("Which letter comes after A?"), "the answer is B" may mean the letter: left as is.
  const before = q.options.map((o) => /^([A-D])\)/.exec(o)?.[1]);
  const byLabel = before.every(Boolean);
  const letterOptions = texts.some((t) => /^[a-z]$/i.test(t));
  const explanation = letterOptions ? q.explanation : rewriteLetterRefs(q.explanation, (letter) => {
    const at = byLabel ? before.indexOf(letter) : labels.indexOf(letter);
    if (at < 0 || at >= q.options!.length) return null;
    const moved = texts.indexOf(stripPrefix(q.options![at]));
    return moved < 0 ? null : labels[moved];
  });

  return { ...q, options: relabeled, correct_answer: newCorrect, explanation };
}

// Build a typed parsed question object (extracted for type inference)
function buildParsedQuestion(q: Record<string, unknown>, question_type: QuizQuestion["question_type"]) {
  let correct_answer = String(q.correct_answer ?? "");

  // Normalize true_false correct_answer to "True" or "False"
  if (question_type === "true_false") {
    const raw = correct_answer.toLowerCase();
    correct_answer = raw.includes("true") ? "True" : "False";
  }

  return {
    question_text: String(q.question_text ?? ""),
    question_type,
    options: Array.isArray(q.options) ? (q.options as string[]) : null,
    correct_answer,
    difficulty_level: Number(q.difficulty_level ?? 1),
    explanation: String(q.explanation ?? ""),
    subtopic_id: q.subtopic_id ? String(q.subtopic_id) : null,
    blank_position: q.blank_position ? String(q.blank_position) : null,
    matching_pairs: Array.isArray(q.matching_pairs) ? q.matching_pairs as Array<{ left: string; right: string }> : null,
  };
}

// Map a validated structured question into the final GenQuestion shape: coerce sentinel empties to
// null (downstream/renderer expects null), normalize true_false, shuffle multiple_choice options.
function finalizeQuestion(raw: GeneratedQuestion): GenQuestion {
  const g = alignKeyToOption(raw);
  const type: QuizQuestion["question_type"] = VALID_QUESTION_TYPES.has(g.question_type)
    ? (g.question_type as QuizQuestion["question_type"])
    : "multiple_choice";
  const built = buildParsedQuestion(g as unknown as Record<string, unknown>, type);
  const cleaned = {
    ...built,
    options: built.options && built.options.length > 0 ? built.options : null,
    matching_pairs: built.matching_pairs && built.matching_pairs.length > 0 ? built.matching_pairs : null,
  };
  return shuffleMultipleChoiceOptions(cleaned);
}

// ─── Batched structured generation (decompose, don't dump — mirrors expandSubtopics) ──

interface BatchContext {
  topic: string;
  levelLabel: string;
  subtopics: Array<{ id: string; title: string; key_concepts: string[] }>;
  count: number;
  highStakes: boolean; // promotion-test current section — rigorous
  easier: boolean;     // review section — slightly easier
  difficulty: number;  // difficulty_level to embed
  tier: ModelTier;
  config: LLMConfig;
  /** Stops the generation when the learner leaves the "making" screen (stopIfAborted). */
  signal?: AbortSignal;
  /** Questions this learner's earlier quizzes on the level asked on these subtopics (ledger lines), to ask others. */
  earlier?: string[];
}

/** The prompt lines that ask for questions other than the ones earlier quizzes asked ("" when none). */
function earlierLines(ctx: BatchContext): string {
  return ctx.earlier?.length
    ? `\nEarlier quizzes on this level already asked these questions. Ask about something else, or ask it in a new way; do NOT repeat any of them:\n${ctx.earlier.map((x) => `- ${x}`).join("\n")}\n`
    : "";
}

// The learner left the "making" screen: no more model calls, and the generator rejects instead of
// returning a short set, so the caller never starts a half-made quiz or test.
function stopIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Aborted");
}

function subtopicsForGen(syllabus: Syllabus): Array<{ id: string; title: string; key_concepts: string[] }> {
  if (syllabus.subtopics && syllabus.subtopics.length > 0) {
    return syllabus.subtopics.map((s) => ({ id: s.id, title: s.title, key_concepts: s.key_concepts ?? [] }));
  }
  // Defensive fallback for a malformed syllabus with no subtopics.
  return [{ id: `${syllabus.level}.1`, title: syllabus.title, key_concepts: [] }];
}

function buildBatchPrompt(ctx: BatchContext): string {
  const small = ctx.tier === "tiny" || ctx.tier === "small";
  const subtopicList = ctx.subtopics
    .map((s) => `- id="${s.id}" title="${s.title}": ${s.key_concepts.join(", ")}`)
    .join("\n");

  const stakes = ctx.highStakes
    ? "These are high-stakes promotion-test questions — rigorous but fair.\n"
    : ctx.easier
    ? "These review earlier material — keep them slightly easier than the current level.\n"
    : "";

  const typeGuide = small
    ? "Use mostly multiple_choice. You may use true_false or fill_in_blank where they fit naturally."
    : "Use a mix: mostly multiple_choice, plus some true_false, fill_in_blank, word_problem, or drag_to_match where they fit.";

  const steer = small
    ? "\n- Prefer conceptual understanding, definitions, and reasoning. Avoid multi-step arithmetic and unit-conversion questions where you can; if a question DOES require calculation, show every step of the working in the explanation."
    : "";

  return `Generate ${ctx.count} quiz question${ctx.count === 1 ? "" : "s"} about "${ctx.topic}" — ${ctx.levelLabel}.
${stakes}
Cover ONLY the following subtopic(s); put the matching id in each question's subtopic_id:
${subtopicList}
${earlierLines(ctx)}
${typeGuide}

Rules for every question:
- multiple_choice: provide EXACTLY 4 options ("A) ...", "B) ...", "C) ...", "D) ..."); correct_answer must be one of those options verbatim. Vary which letter is correct — do not always use A.
- true_false: question_text MUST be a declarative statement that is clearly true or false — never "Which of the following..." or "Select...". correct_answer is exactly "True" or "False".
- fill_in_blank: blank_position is the full sentence with ___ where the answer goes.
- drag_to_match: matching_pairs is 3–5 {left, right} objects; correct_answer is "See matching_pairs".
- For any field a question does not use, set it empty: options [], matching_pairs [], blank_position "".
- explanation: 1–2 educational sentences. Solve the question first, then end the explanation with "Therefore the answer is X" and set correct_answer to exactly that X — the explanation and correct_answer must never disagree. difficulty_level: ${ctx.difficulty}.
- The correct_answer must be unambiguously correct.${steer}

Math/formatting:
- Plain-text math only: × ÷ ² ³ π ≤ ≥ √ Δ θ α β. No LaTeX, no backslashes, no $...$ delimiters.`;
}

// One schema-enforced + semantically-validated batch. Returns [] on failure (logged) so a single
// bad batch degrades the test gracefully instead of crashing it. callLLMStructured already
// repair-retries on validation issues; this catch handles timeouts / unrecoverable failures.
async function generateQuestionBatch(ctx: BatchContext): Promise<GeneratedQuestion[]> {
  const allowedIds = new Set(ctx.subtopics.map((s) => s.id));
  try {
    const result = await callLLMStructured<{ questions: GeneratedQuestion[] }>(
      [{ role: "user", content: buildBatchPrompt(ctx) }],
      ctx.config,
      {
        schema: buildBatchSchema(ctx.count),
        toolName: "emit_quiz_questions",
        validate: (parsed) => validateQuizBatch(parsed?.questions ?? [], allowedIds, { tier: ctx.tier }),
        tier: ctx.tier,
        // A question cut short can lose the sentence that asks it, or its key; it is rewritten instead.
        trimOverlong: false,
        signal: ctx.signal,
      },
    );
    const qs = Array.isArray(result?.questions) ? result.questions : [];
    log.info("generateQuestionBatch", `${ctx.levelLabel} [${[...allowedIds].join(",")}] → ${qs.length}/${ctx.count}`);
    return qs;
  } catch (e) {
    stopIfAborted(ctx.signal);
    log.warn("generateQuestionBatch", `batch failed for ${ctx.levelLabel} [${[...allowedIds].join(",")}] — skipping`, e instanceof Error ? e.message : String(e));
    return [];
  }
}

// ─── One-question-per-call generation, LOCAL path (issue #83) ─────────────────
// On a 4B local model, asking for a whole batch as one constrained JSON blob is what timed out and
// truncated; one question per call is ~10–30s, gets the model's full attention (higher quality), and
// isolates failure to a single question. Each call is steered by a short ledger of the questions
// already produced (auto-derived summaries) so independent calls still cover distinct ideas.
function buildOneQuestionPrompt(ctx: BatchContext, priorSummaries: string[]): string {
  const small = ctx.tier === "tiny" || ctx.tier === "small";
  const s = ctx.subtopics[0];
  const stakes = ctx.highStakes
    ? "This is a high-stakes promotion-test question — rigorous but fair.\n"
    : ctx.easier
    ? "This reviews earlier material — keep it slightly easier than the current level.\n"
    : "";
  const typeGuide = small
    ? "Use multiple_choice, or true_false / fill_in_blank where it fits naturally."
    : "Pick whichever type fits best: multiple_choice, true_false, fill_in_blank, word_problem, or drag_to_match.";
  const steer = small
    ? "\n- Prefer conceptual understanding, definitions, and reasoning. Avoid multi-step arithmetic and unit-conversion where you can; if calculation IS needed, show every step in the explanation."
    : "";
  const avoid = priorSummaries.length
    ? `\nThis quiz already includes these questions — ask about a DIFFERENT idea; do NOT repeat or paraphrase any of them:\n${priorSummaries.map((x) => `- ${x}`).join("\n")}\n`
    : "";

  return `Generate ONE quiz question about "${ctx.topic}" — ${ctx.levelLabel}.
${stakes}Cover this subtopic and put its id in subtopic_id:
- id="${s.id}" title="${s.title}": ${s.key_concepts.join(", ")}
${earlierLines(ctx)}${avoid}
${typeGuide}

Rules:
- multiple_choice: provide EXACTLY 4 options ("A) ...", "B) ...", "C) ...", "D) ..."); correct_answer must be one of them verbatim. Vary which letter is correct.
- true_false: question_text MUST be a declarative statement clearly true or false — never "Which of the following...". correct_answer is exactly "True" or "False".
- fill_in_blank: blank_position is the full sentence with ___ where the answer goes.
- drag_to_match: matching_pairs is 3–5 {left, right} objects; correct_answer is "See matching_pairs".
- For any field this question does not use, set it empty: options [], matching_pairs [], blank_position "".
- explanation: 1–2 sentences. Solve the question first, then end with "Therefore the answer is X" and set correct_answer to exactly that X — they must never disagree. difficulty_level: ${ctx.difficulty}.
- The correct_answer must be unambiguously correct.${steer}

Math/formatting:
- Plain-text math only: × ÷ ² ³ π ≤ ≥ √ Δ θ α β. No LaTeX, no backslashes, no $...$ delimiters.`;
}

async function generateOneQuestion(ctx: BatchContext, priorSummaries: string[]): Promise<GenQuestion | null> {
  const allowedIds = new Set(ctx.subtopics.map((s) => s.id));
  try {
    const q = await callLLMStructured<GeneratedQuestion>(
      [{ role: "user", content: buildOneQuestionPrompt(ctx, priorSummaries) }],
      ctx.config,
      {
        schema: QUESTION_SCHEMA,
        toolName: "emit_quiz_question",
        validate: (parsed) => validateQuizBatch(parsed ? [parsed] : [], allowedIds, { tier: ctx.tier }),
        tier: ctx.tier,
        trimOverlong: false,
        signal: ctx.signal,
      },
    );
    return q ? finalizeQuestion(q) : null;
  } catch (e) {
    stopIfAborted(ctx.signal);
    // Ollama stopped or the model is gone: every later question fails the same way, so the quiz or test
    // stops here and the screen says to start Ollama (friendlyError), not that the model struggled.
    if (ollamaUnavailable(e)) throw e;
    log.warn("generateOneQuestion", `failed for ${ctx.levelLabel} [${[...allowedIds].join(",")}]`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ─── Generate to a target count (issue #83) ───────────────────────────────────
// Provider-aware. LOCAL (Ollama) optimizes for QUALITY: one call per question, sequential, with a live
// anti-repeat ledger (time is free on local). CLOUD optimizes for COST on a free plan: batch questions
// per subtopic to minimize call count + repeated prompt tokens, fired in parallel. Both dedupe, top up
// a shortfall (capped rounds), and run the independent verify pass where runsVerifyPass says to, or the
// content review instead when a review model is set (plan.review; see checkFresh).
interface GenPlan {
  subtopics: Array<{ id: string; title: string; key_concepts: string[] }>;
  topic: string;
  levelLabel: string;
  difficulty: number;
  highStakes: boolean;
  easier: boolean;
  tier: ModelTier;
  config: LLMConfig;
  review: LLMConfig | null;
  signal?: AbortSignal;
  /** Questions already in this quiz or test (the review pool's, the current section's): a fresh one that
   * repeats one of them, exactly or nearly (isNearDuplicate), is dropped and the top-up refills it. */
  avoid?: GenQuestion[];
  /** Questions this learner's earlier quizzes on the level asked (db.ts getRecentQuizQuestions). The prompt
   * asks for others, and a fresh one that repeats one of them, exactly or nearly, is set aside: it is
   * used only when the quiz would otherwise come up short. */
  earlier?: EarlierQuestion[];
}

// Compared on askedText, so two fill-in-the-blank questions that share "Fill in the blank." but ask
// different sentences are not repeats.
type Asked = Parameters<typeof askedText>[0] & { correct_answer?: string };
const repeatsAny = (list: ReadonlyArray<Asked>, q: GenQuestion): boolean => {
  const asked = (x: Asked) => ({ question_text: askedText(x), correct_answer: x.correct_answer });
  const b = asked(q);
  const k = questionKey(b.question_text);
  return list.some((x) => { const a = asked(x); return questionKey(a.question_text) === k || isNearDuplicate(a, b); });
};

// A fresh question that repeats one already in the quiz or test (GenPlan.avoid).
function repeatsAvoided(plan: GenPlan, q: GenQuestion): boolean {
  return repeatsAny(plan.avoid ?? [], q);
}

// A fresh question that repeats one an earlier quiz on the level asked (GenPlan.earlier).
function repeatsEarlier(plan: GenPlan, q: GenQuestion): boolean {
  return repeatsAny(plan.earlier ?? [], q);
}

/** The ledger lines for a subtopic's earlier questions, newest first, capped by tier like the quiz's own ledger.
 *  None for a cloud model: what a learner was asked is about that learner (lane 1 of TerraTutor's
 *  docs/CLOUD-PRIVACY.md), so there only the code check (repeatsEarlier) applies. */
function earlierFor(plan: GenPlan, subtopicId: string): string[] {
  if (!isLocalModel(plan.config)) return [];
  const cap = plan.tier === "tiny" || plan.tier === "small" ? 6 : 12;
  return (plan.earlier ?? []).filter((q) => !q.subtopic_id || q.subtopic_id === subtopicId).slice(0, cap)
    .map((q) => summarizeForLedger({ question_text: askedText(q), subtopic_id: q.subtopic_id }));
}

/** Questions set aside as repeats of earlier quizzes, checked as fresh ones are, to fill a quiz that came up short. */
async function fillFromRepeats(
  plan: GenPlan, produced: GenQuestion[], spares: GenQuestion[], target: number, label: string,
): Promise<GenQuestion[]> {
  if (produced.length >= target || spares.length === 0) return produced;
  let fill = dedupeByQuestionText(spares).filter((q) => !repeatsAny(produced, q));
  const check = checkFresh(plan);
  if (check && fill.length) fill = await check(fill, `${label} repeats`);
  stopIfAborted(plan.signal);
  log.info("quiz", `${label}: ${Math.min(fill.length, target - produced.length)} question(s) from earlier quizzes fill the gap`);
  return [...produced, ...fill.slice(0, target - produced.length)];
}

// The check a round's freshly generated questions get before they count: the content review when a
// review model is set (it subsumes the verify pass: it checks the key and also flags unanswerable
// questions and false facts), else the verify pass where runsVerifyPass says to, else none.
function checkFresh(plan: GenPlan): ((qs: GenQuestion[], label: string) => Promise<GenQuestion[]>) | null {
  const { review, config, tier } = plan;
  if (review) return (qs, label) => reviewAndFilter(qs, plan.topic, review, label, plan.signal);
  if (runsVerifyPass(tier, config.model)) return (qs, label) => verifyAndFilter(qs, config, tier, label, plan.signal);
  return null;
}

function planSlotCtx(plan: GenPlan, subIdx: number): BatchContext {
  return {
    topic: plan.topic, levelLabel: plan.levelLabel, subtopics: [plan.subtopics[subIdx]], count: 1,
    highStakes: plan.highStakes, easier: plan.easier, difficulty: plan.difficulty, tier: plan.tier, config: plan.config,
    signal: plan.signal, earlier: earlierFor(plan, plan.subtopics[subIdx].id),
  };
}

async function generatePerQuestion(
  plan: GenPlan, target: number, label: string, onProgress?: (done: number, total: number) => void,
): Promise<GenQuestion[]> {
  const { tier } = plan;
  const check = checkFresh(plan);
  const ledgerCap = tier === "tiny" || tier === "small" ? 8 : 16;
  const MAX_ROUNDS = 3;

  let produced: GenQuestion[] = [];
  const spares: GenQuestion[] = [];
  const seen = new Set<string>();
  const keyOf = (q: GenQuestion) => q.question_text.trim().toLowerCase();
  const ledgerTail = () => produced.slice(-ledgerCap).map(summarizeForLedger);
  const add = (q: GenQuestion | null): void => {
    if (!q) return;
    const k = keyOf(q);
    if (!k || seen.has(k) || produced.some((p) => isNearDuplicate(p, q)) || repeatsAvoided(plan, q)) return;
    if (repeatsEarlier(plan, q)) { spares.push(q); return; }
    seen.add(k); produced.push(q); onProgress?.(produced.length, target);
  };

  for (let round = 1; round <= MAX_ROUNDS && produced.length < target; round++) {
    const roundStart = produced.length;
    for (const subIdx of planSlotSubtopics(plan.subtopics.length, target - produced.length)) {
      if (produced.length >= target) break;
      stopIfAborted(plan.signal);
      add(await generateOneQuestion(planSlotCtx(plan, subIdx), ledgerTail()));
    }
    if (check && produced.length > roundStart) {
      const fresh = produced.slice(roundStart);
      const kept = await check(fresh, `${label} r${round}`);
      stopIfAborted(plan.signal);
      if (kept.length !== fresh.length) {
        const keptKeys = new Set(kept.map(keyOf));
        for (const q of fresh) if (!keptKeys.has(keyOf(q))) seen.delete(keyOf(q));
        produced = produced.slice(0, roundStart).concat(kept);
      }
    }
    if (produced.length === roundStart) {
      log.warn("quiz", `${label}: round ${round} added 0 questions — stopping at ${produced.length}/${target}`);
      break;
    }
    if (round > 1) log.info("quiz", `${label}: top-up round ${round} → ${produced.length}/${target}`);
  }
  produced = await fillFromRepeats(plan, produced, spares, target, label);
  onProgress?.(Math.min(produced.length, target), target);

  if (produced.length < target) log.warn("quiz", `${label}: generated ${produced.length}/${target} — model may be struggling (short test)`);
  else log.info("quiz", `${label}: ${produced.length}/${target} questions ready`);
  return produced.slice(0, target);
}

async function generateBatched(
  plan: GenPlan, target: number, label: string, onProgress?: (done: number, total: number) => void,
): Promise<GenQuestion[]> {
  const { tier, config } = plan;
  const check = checkFresh(plan);
  const MAX_ROUNDS = 3;
  let produced: GenQuestion[] = [];
  const spares: GenQuestion[] = [];

  for (let round = 1; round <= MAX_ROUNDS && produced.length < target; round++) {
    const before = produced.length;
    // One batch call per subtopic — minimizes call count + repeated prompt tokens for a free-plan key.
    const counts = splitCount(target - produced.length, plan.subtopics.length);
    const ctxs: BatchContext[] = plan.subtopics
      .map((s, i): BatchContext => ({
        topic: plan.topic, levelLabel: plan.levelLabel, subtopics: [s], count: counts[i],
        highStakes: plan.highStakes, easier: plan.easier, difficulty: plan.difficulty, tier, config, signal: plan.signal,
        earlier: earlierFor(plan, s.id),
      }))
      .filter((c) => c.count > 0);
    if (ctxs.length === 0) break;

    let batch = (await Promise.all(ctxs.map(generateQuestionBatch))).flat().map(finalizeQuestion)
      .filter((q) => !repeatsAvoided(plan, q));
    spares.push(...batch.filter((q) => repeatsEarlier(plan, q)));
    batch = batch.filter((q) => !repeatsEarlier(plan, q));
    if (check) batch = await check(batch, `${label} r${round}`);
    stopIfAborted(plan.signal);

    produced = dedupeByQuestionText([...produced, ...batch]);
    onProgress?.(Math.min(produced.length, target), target);
    if (produced.length === before) {
      log.warn("quiz", `${label}: round ${round} added 0 questions — stopping at ${produced.length}/${target}`);
      break;
    }
    if (round > 1) log.info("quiz", `${label}: top-up round ${round} → ${produced.length}/${target}`);
  }
  produced = await fillFromRepeats(plan, produced, spares, target, label);
  onProgress?.(Math.min(produced.length, target), target);

  const final = produced.length > target ? produced.slice(0, target) : produced;
  if (final.length < target) log.warn("quiz", `${label}: generated ${final.length}/${target} — model may be struggling (short test)`);
  else log.info("quiz", `${label}: ${final.length}/${target} questions ready`);
  return final;
}

async function generateToTarget(
  plan: GenPlan, target: number, label: string, onProgress?: (done: number, total: number) => void,
): Promise<GenQuestion[]> {
  if (plan.subtopics.length === 0 || target <= 0) return [];
  stopIfAborted(plan.signal);
  return plan.config.provider === "ollama"
    ? generatePerQuestion(plan, target, label, onProgress)   // local: quality, one call per question
    : generateBatched(plan, target, label, onProgress);       // cloud: cost, batched per subtopic
}

// ─── Independent verification pass (issue #83) ────────────────────────────────
// Gated by the caller (runsVerifyPass: every tier but tiny, plus the default local models). One
// structured call re-solves the checkable questions and flags any whose stored answer it disagrees
// with; those are dropped and top-up refills.
// The output is tiny (verdicts, not full questions), so it's cheap even on the floor model. Best-effort:
// any failure returns the batch untouched (but Ollama stopped or missing the model, which stops the
// quiz or test), and a drop only happens on an explicit disagreement, so a confused verifier can't
// silently drain the question count.
const VERIFIABLE_TYPES = new Set(["multiple_choice", "true_false", "fill_in_blank", "short_answer", "word_problem"]);
const VERIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "proposed_is_correct"],
        properties: { index: { type: "number" }, proposed_is_correct: { type: "boolean" } },
      },
    },
  },
};

async function verifyAndFilter(
  questions: GenQuestion[],
  config: LLMConfig,
  tier: ModelTier,
  label: string,
  signal?: AbortSignal,
): Promise<GenQuestion[]> {
  // index = position in `questions` so parseVerifyDrops maps straight back to a filter predicate.
  const items = questions
    .map((q, index) => ({ q, index }))
    .filter(({ q }) => VERIFIABLE_TYPES.has(q.question_type))
    .map(({ q, index }) => ({ index, question: questionWithSentence(q), options: q.options, proposed: q.correct_answer }));
  if (items.length === 0) return questions;

  try {
    const parsed = await callLLMStructured<{ verdicts: Array<{ index: number; proposed_is_correct: boolean }> }>(
      [{ role: "user", content: buildVerifyPrompt(items) }],
      config,
      { schema: VERIFY_SCHEMA, toolName: "emit_verdicts", tier, signal },
    );
    const drop = parseVerifyDrops(parsed, items);
    if (drop.size === 0) return questions;
    log.info("quiz", `${label}: verify pass dropped ${drop.size}/${items.length} with disagreeing answers`);
    return questions.filter((_, i) => !drop.has(i));
  } catch (e) {
    stopIfAborted(signal);
    if (ollamaUnavailable(e)) throw e;
    log.warn("quiz", `${label}: verify pass failed — keeping batch as-is`, e instanceof Error ? e.message : String(e));
    return questions;
  }
}

// Content review of freshly generated questions (content-review.ts): drops every question the review
// flags (wrong_key, unanswerable, false_fact); the top-up loop refills. Only fresh questions come here,
// never the review pool: which questions a learner missed is data about that learner, so the pool's
// verify pass runs only on a local model (generateQuizQuestions, poolVerifier).
async function reviewAndFilter(questions: GenQuestion[], topic: string, review: LLMConfig, label: string, signal?: AbortSignal): Promise<GenQuestion[]> {
  if (questions.length === 0) return questions;
  const findings = await reviewQuestions(topic, questions, review, signal);
  stopIfAborted(signal);
  if (findings.length === 0) return questions;
  const counts = findings.reduce<Record<string, number>>((m, f) => ({ ...m, [f.verdict]: (m[f.verdict] ?? 0) + 1 }), {});
  log.info("quiz", `${label}: content review dropped ${findings.length}/${questions.length} (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")})`);
  const drop = new Set(findings.map((f) => f.index));
  return questions.filter((_, i) => !drop.has(i));
}

// `reviewPool` (optional) holds previously-missed questions for this course; ~20% of the quiz is
// re-posed from it (retrieval practice / spaced review), the rest freshly generated. An empty pool
// degrades to all-fresh — identical to the pre-A2 behavior, so legacy callers are unaffected.
// `reviewer` (store.ts getReviewConfig; null = off) is the content review model for fresh questions.
// `poolVerifier` (store.ts getLocalVerifyConfig) is the model for the review pool's verify pass. The pool
// is which questions this learner missed, which lane 1 of TerraTutor's docs/CLOUD-PRIVACY.md keeps on
// the computer, so that pass runs only on a local model (privacy.ts isLocalModel). Left out, it is the
// generation model when that is local; with a cloud model, or null, the pass is skipped and the pool
// keeps only the validator re-check below.
// `earlier` (db.ts getRecentQuizQuestions) is what this learner's last quizzes on the level asked: fresh
// questions are asked to differ from them, and one that repeats them is used only to fill a short quiz
// (GenPlan.earlier; TerraTutor click test 2026-11-19 part 3).
export async function generateQuizQuestions(
  syllabus: Syllabus,
  numQuestions: number,
  config: LLMConfig,
  reviewPool: QuizQuestion[] = [],
  onProgress?: (done: number, total: number) => void,
  reviewer: LLMConfig | null = null,
  poolVerifier?: LLMConfig | null,
  signal?: AbortSignal,
  earlier: EarlierQuestion[] = [],
): Promise<GenQuestion[]> {
  const tier = config.modelTier ?? await detectModelTier(config);
  config.modelTier = tier;

  // Re-posed review questions bypass generation-time validation, so a stored question with a bad answer
  // would recur FOREVER: it's always graded wrong → never leaves the pool (a miss leaves it only once the
  // question is answered right, db.ts getReviewPoolQuestions) → re-served every quiz. Run each through
  // the SAME validator (answer↔explanation consistency + structural shape) and drop the broken ones, so
  // a poisoned question can't keep popping up (issue #83). allowedIds is empty
  // (we don't re-check subtopic membership for re-posed items).
  const validReviewPool = reviewPool
    .map((q) => alignKeyToOption(storedToGenQuestion(q)))
    .filter((q) => validateQuizBatch([q as unknown as GeneratedQuestion], new Set<string>(), { tier }).length === 0);
  const { fresh, review } = splitNewVsReview(numQuestions, validReviewPool.length);
  let reviewQs = pickReview(validReviewPool, review);
  // The review pool is the path that leaked the recurring bad question, so re-posed items also get the
  // independent verify pass (runsVerifyPass) — not just the consistency/structural re-check above —
  // but only on a model on this computer.
  if (reviewQs.length > 0) {
    const verifier = poolVerifier === undefined ? config : poolVerifier;
    if (verifier && isLocalModel(verifier)) {
      const vTier = verifier === config ? tier : verifier.modelTier ?? (verifier.modelTier = await detectModelTier(verifier));
      if (runsVerifyPass(vTier, verifier.model)) {
        reviewQs = await verifyAndFilter(reviewQs, verifier, vTier, `quiz L${syllabus.level} review`, signal);
      }
    } else {
      log.info("quiz", `quiz L${syllabus.level} review: no local model, so ${reviewQs.length} re-posed question(s) skip the verify pass`);
    }
  }

  const freshQs = await generateToTarget(
    {
      subtopics: subtopicsForGen(syllabus),
      topic: syllabus.title,
      levelLabel: `Level ${syllabus.level}`,
      difficulty: syllabus.level,
      highStakes: false,
      easier: false,
      tier,
      config,
      review: reviewer,
      signal,
      // A missed question re-posed from the pool is not asked again fresh in the same quiz.
      avoid: reviewQs,
      earlier,
    },
    fresh,
    `quiz L${syllabus.level}`,
    onProgress,
  );
  if (freshQs.length === 0 && reviewQs.length === 0) {
    throw new Error("Could not generate quiz questions — the model returned no valid questions. Try again, or switch to a more capable model.");
  }
  return interleaveReview(freshQs, reviewQs);
}

// Promotion test: two sections (current level + review of previous levels)
export interface PromotionTestQuestions {
  current: GenQuestion[];
  review: GenQuestion[];
  /** The course has earlier levels with subtopics, so the test must have a review section. */
  reviewWanted: boolean;
}

/** The earlier levels a level test reviews: the last four before it that have subtopics. A Level 1 test has
 *  none, so it has no review section. */
export function levelTestReviewLevels(previousSyllabuses: ReadonlyArray<Syllabus>): Syllabus[] {
  return previousSyllabuses.slice(-4).filter((s) => s.subtopics && s.subtopics.length > 0);
}

/** How many questions a level test aims for: TEST_TOTAL_TARGET with a review section, TEST_CURRENT_TARGET
 *  without one (Level 1), which is all a test with no review section can be made with. */
export function levelTestTarget(hasReview: boolean): number {
  return hasReview ? TEST_TOTAL_TARGET : TEST_CURRENT_TARGET;
}

/**
 * Why a generated level test cannot be given, or null when it can. A test under TEST_FLOOR questions, or
 * one whose review section came back empty although the course has earlier levels, is not started: it
 * is not taken and cannot promote (the pass rule would skip an empty review section). Nor is one whose
 * review section has fewer than TEST_REVIEW_FLOOR questions, where a single miss would fail the review
 * bar and the test. The learner can try again.
 */
export function levelTestShortfall(t: PromotionTestQuestions): string | null {
  const total = t.current.length + t.review.length;
  if (total < TEST_FLOOR) {
    return `Only ${total} of ${levelTestTarget(t.reviewWanted)} questions were made, and a level test needs at least ${TEST_FLOOR}. The test was not started and does not count. Try again, or pick a more capable model in Settings.`;
  }
  if (t.reviewWanted && t.review.length === 0) {
    return "No questions on the earlier levels were made, and a level test needs them. The test was not started and does not count. Try again.";
  }
  if (t.reviewWanted && t.review.length < TEST_REVIEW_FLOOR) {
    return `Only ${t.review.length} ${t.review.length === 1 ? "question" : "questions"} on the earlier levels ${t.review.length === 1 ? "was" : "were"} made, and a level test needs at least ${TEST_REVIEW_FLOOR}, so that one miss there cannot fail the test. The test was not started and does not count. Try again.`;
  }
  return null;
}

export async function generatePromotionTestQuestions(
  currentSyllabus: Syllabus,
  previousSyllabuses: Syllabus[],
  config: LLMConfig,
  onProgress?: (done: number, total: number, phase: "current" | "review") => void,
  reviewer: LLMConfig | null = null,
  signal?: AbortSignal,
): Promise<PromotionTestQuestions> {
  const tier = config.modelTier ?? await detectModelTier(config);
  config.modelTier = tier;

  // ── Current section: the current level's subtopics, round-robin to TEST_CURRENT_TARGET. ──
  const current = await generateToTarget(
    {
      subtopics: subtopicsForGen(currentSyllabus),
      topic: currentSyllabus.title,
      levelLabel: `Level ${currentSyllabus.level} promotion test`,
      difficulty: currentSyllabus.level,
      highStakes: true,
      easier: false,
      tier,
      config,
      review: reviewer,
      signal,
    },
    TEST_CURRENT_TARGET,
    `promotion L${currentSyllabus.level} current`,
    onProgress ? (d, t) => onProgress(d, t, "current") : undefined,
  );

  // ── Review section: the last ≤4 prior levels' subtopics flattened, slightly easier. ──
  let review: GenQuestion[] = [];
  const recents = levelTestReviewLevels(previousSyllabuses);
  const reviewSubs = recents.flatMap((s) => s.subtopics.map((t) => ({ id: t.id, title: t.title, key_concepts: t.key_concepts ?? [] })));
  if (reviewSubs.length > 0) {
    review = await generateToTarget(
      {
        subtopics: reviewSubs,
        topic: currentSyllabus.title,
        levelLabel: "review of earlier material",
        difficulty: Math.max(1, currentSyllabus.level - 1),
        highStakes: false,
        easier: true,
        tier,
        config,
        review: reviewer,
        signal,
        avoid: current,
      },
      TEST_REVIEW_TARGET,
      `promotion L${currentSyllabus.level} review`,
      onProgress ? (d, t) => onProgress(d, t, "review") : undefined,
    );
  }

  return { current, review, reviewWanted: reviewSubs.length > 0 };
}

// ─── End-of-test grading (issue #83) ──────────────────────────────────────────
// Grades every free-text answer in ONE place at finish, instead of a blocking LLM call per answer
// mid-test (the old gradeWrittenResponse, which bogged the machine down). Normalized exact / numeric
// matches are settled deterministically with zero model calls; only the genuinely fuzzy answers go to
// a single batched structured call. Returns answer-index → {isCorrect, feedback}. Best-effort: a
// grader failure marks the unresolved answers correct (lenient) rather than punishing the student.
// The answers are the learner's own words, which lane 1 of TerraTutor's docs/CLOUD-PRIVACY.md keeps on
// the computer: `config` is the local grader (store.ts getLocalVerifyConfig). Given a cloud model or
// null, nothing is sent and the answers code cannot settle are passed the same lenient way ("fallback").
export interface AnswerToGrade {
  index: number;     // stable id back to the caller's question list
  question: string;
  expected: string;
  student: string;
  type: string;
}

// Which of these words are real words, from the bundled dictionary. A word the dictionary could not be
// read for counts as real, so a misspelling is accepted only when the dictionary says it is not a word.
async function realWords(words: string[]): Promise<(w: string) => boolean> {
  const notWords = new Set<string>();
  await Promise.all([...new Set(words)].map(async (w) => {
    try { if ((await lookupWord(w)).length === 0) notWords.add(w); }
    catch { /* unreadable: treated as a word */ }
  }));
  return (w) => !notWords.has(w);
}

// Which of these words are in the English word list (wordlist.ts). A word the list could not be read
// for counts as listed, so a misspelt name is accepted only when the list says it is not a word.
async function wordListHas(words: string[]): Promise<(w: string) => boolean> {
  const unlisted = new Set<string>();
  await Promise.all([...new Set(words)].map(async (w) => {
    try { if (!(await inWordList(w))) unlisted.add(w); }
    catch { /* unreadable: treated as listed */ }
  }));
  return (w) => !unlisted.has(w);
}

// What the dictionary says of each of these words: an adjective sense, a sense in small letters (an
// everyday word). A word the dictionary could not be read for counts as both, so no key is taken for a
// person's name on a guess (answer-match.ts namesAThing).
async function dictionarySenses(words: string[]): Promise<(w: string) => WordSenses> {
  const out = new Map<string, WordSenses>();
  await Promise.all([...new Set(words)].map(async (w) => {
    try {
      const senses = (await lookupWord(w)).flatMap((e) => e.senses);
      out.set(w, { adjective: senses.some((s) => s.pos === "a"), everyday: senses.some((s) => s.form === s.form.toLowerCase()) });
    } catch { out.set(w, { adjective: true, everyday: true }); }
  }));
  return (w) => out.get(w) ?? { adjective: true, everyday: true };
}

// A note for the model on each answer that may be the key misspelt (answer-match.ts misspellingNote),
// or null. The dictionary says what is a real word and which real words are near, and the English word
// list (wordlist.ts) says what else is a real word; WordNet's full headword list is read only when some
// answer's word is in neither. If either cannot be read, no note.
async function misspellingNotes(items: AnswerToGrade[]): Promise<Array<string | null>> {
  const none = items.map(() => null);
  const words = items.flatMap(misspeltKeyWords);
  if (words.length === 0) return none;
  try {
    const entries = new Map<string, DictionaryEntry[]>();
    await Promise.all([...new Set(words.flatMap((w) => [w.answer, w.key]))].map(async (w) => { entries.set(w, await lookupWord(w)); }));
    const isWord = (w: string) => (entries.get(w) ?? []).length > 0;
    const listedWords = new Set<string>();
    await Promise.all([...new Set(words.flatMap((w) => [w.answer, singular(w.answer)]))].map(async (w) => { if (await inWordList(w)) listedWords.add(w); }));
    const listed = (w: string) => listedWords.has(w);
    // The real words near each answer word that is not one: headwords and irregular forms, plus other
    // words' regular forms ("attaching" for "attatching") that the dictionary resolves.
    const open = words.filter((w) => isWord(w.key) && !isWord(w.answer) && !listed(w.answer) && !listed(singular(w.answer)));
    const headwords = open.length > 0 ? await oneWordHeadwords() : [];
    const near = new Map<string, string[]>();
    for (const { answer, edits } of open) {
      const a = singular(answer);
      if (near.has(`${a} ${edits}`)) continue;
      const forms = await Promise.all(formsWithin(headwords, a, edits).map(async (f) => ((await lookupWord(f)).length > 0 ? [f] : [])));
      near.set(`${a} ${edits}`, [...wordsWithin(headwords, a, edits), ...forms.flat()]);
    }
    const dict: SpellingLookup = {
      isWord,
      listed,
      synonyms: (w) => (entries.get(w) ?? []).flatMap((e) => e.senses.flatMap((s) => s.synonyms.map((x) => x.toLowerCase()))),
      wordsNear: (w, edits) => near.get(`${w} ${edits}`) ?? [],
    };
    return items.map((it) => misspellingNote(it, dict));
  } catch (e) {
    log.warn("quiz", "misspelling notes skipped: the dictionary could not be read", e instanceof Error ? e.message : String(e));
    return none;
  }
}

// What a learner reads under an answer code marked wrong (an amount, unit or time that differs from the
// key's). Code says no more: a reason it worked out ("you wrote grams") could be wrong about what the
// learner meant.
export const CODE_MISMATCH_FEEDBACK = "This does not match the answer key.";

// The grader's feedback is shown to the learner on the quiz and level-test results, but the prompt asks
// for "1 short sentence on what the student wrote", so it talks about them: "The student did not provide
// an answer." for a typed "xyz" (TerraTutor click test 2026-11-19), "The student wrote a code, not a
// time.", "No amount is given.". Neither is said to a learner. The prompt is unchanged (it was measured
// with this wording, feedback before verdict); code rewrites the feedback, and changes the mark in one
// case only:
//   - a RIGHT mark whose feedback plainly says no answer was given (SAYS_NOTHING_ANSWERED: "The student
//     did not provide an answer.", "No answer was given.", "That is not an answer.") contradicts itself,
//     so it is marked wrong and told NO_ANSWER_FEEDBACK (TerraTutor click test 2026-11-19 part 2: typed
//     "xyz" answers came back right and were shown "Correct."; non-answer.ts now stops those before the
//     model, so this is a backstop). Narrower than SAYS_NO_ANSWER on purpose: words that can be about the
//     topic ("Yes, Jabberwocky is a nonsense poem.", "random letters and numbers", "no response to
//     touch") only have their feedback rewritten, and a line that also says but, though, right, correct
//     or yes ("did not write the unit, but 12 is right") keeps its mark;
//   - a wrong answer whose feedback says nothing was answered is told NO_ANSWER_FEEDBACK (they did type
//     something; it just doesn't answer the question). Not "does not include / name / state": that is
//     said of a partial answer ("The answer does not include the unit"), which did answer;
//   - any other feedback about "the student" (or the learner, the child) becomes the line code uses for a
//     settled answer: "Correct." or CODE_MISMATCH_FEEDBACK. The results row already shows the learner's
//     answer beside the key when it was marked wrong.
// Feedback that speaks to the learner or about the subject ("Five o'clock is 5:00.") is kept as it is.
// A typed answer code can see answers nothing ("xyz", "?!": non-answer.ts) never reaches the model.
export const NO_ANSWER_FEEDBACK = "That doesn't answer the question yet.";
const ABOUT_THE_LEARNER = /\b(?:student|learner|pupil)s?\b|\b(?:the|this|a)\s+(?:child|user)\b/i;
const SAYS_NO_ANSWER = /\b(?:did|does|do|has|have)(?:\s+not|n['’]t)\s+(?:provide|give|write|enter|offer|answer|attempt|respond)\b|\bno\s+(?:answer|response|attempt)\b|\bno\s+\w+\s+(?:is|was)\s+(?:given|provided|written|stated)\b|\b(?:gibberish|nonsense)\b|\brandom\s+(?:letters|characters|text|words)\b|\b(?:unrelated|not\s+related)\s+to\s+the\s+question\b/i;
// Only what is said of the answer itself: that none was given. Topic words ("a nonsense poem", "random
// letters and numbers", "no response to touch") are left to the feedback rewrite, and a line that also
// says the answer is right ("but 12 is right") never changes the mark.
const NOT = String.raw`(?:did|does|do|has|have)(?:\s+not|n['’]t)`;
const SAYS_NOTHING_ANSWERED = new RegExp([
  String.raw`\b${NOT}\s+(?:provide|give|write|enter|offer|make)\s+(?:an?\s+|any\s+)?(?:answer|response)\b`,
  String.raw`\bno\s+answer\s+(?:is|was|has\s+been)\s+(?:given|provided|written|entered)\b`,
  String.raw`\b(?:is|was)(?:\s+not|n['’]t)\s+an\s+answer(?:\s+to\s+(?:the|this)\s+question)?\s*(?:[.!]|$)`,
].join("|"), "i");
const SAYS_RIGHT_TOO = /\b(?:but|though|although|right|correct|yes)\b/i;

function feedbackForLearner(o: GradeOutcome): GradeOutcome {
  if (o.isCorrect && SAYS_NOTHING_ANSWERED.test(o.feedback) && !SAYS_RIGHT_TOO.test(o.feedback)) {
    return { ...o, isCorrect: false, feedback: NO_ANSWER_FEEDBACK };
  }
  if (!o.isCorrect && SAYS_NO_ANSWER.test(o.feedback)) return { ...o, feedback: NO_ANSWER_FEEDBACK };
  if (ABOUT_THE_LEARNER.test(o.feedback) || SAYS_NO_ANSWER.test(o.feedback)) {
    return { ...o, feedback: o.isCorrect ? "Correct." : CODE_MISMATCH_FEEDBACK };
  }
  return o;
}

export async function gradeAnswersBatch(
  items: AnswerToGrade[],
  config: LLMConfig | null,
  // The learner's grade, as the chat's safety notice reads it (child-safety.ts isSafetyDisclosure).
  grade: Grade | null = null,
): Promise<Map<number, GradeOutcome>> {
  const out = new Map<number, GradeOutcome>();
  const needsLLM: AnswerToGrade[] = [];

  // A self-harm or abuse disclosure (or, with a K-12 grade set, a pregnancy one) typed as an answer
  // (child-safety.ts isSafetyDisclosure, the chat's own check with the same grade) is not an answer to
  // mark. It is never settled by code or sent to a model, and never marked wrong: it is passed as not
  // checked ('fallback'), like an answer no model could check, and the quiz and level-test screens show
  // the chat's SAFETY_NOTICE on it in place of the answer and the key (ported from TerraTutor #175).
  const answers: AnswerToGrade[] = [];
  for (const it of items) {
    if (isSafetyDisclosure(it.student, grade)) out.set(it.index, { isCorrect: true, feedback: "", by: "fallback" });
    else answers.push(it);
  }

  // An answer that is the key in another form ("washington", "h two o", "a hundred degrees",
  // "tadpoles") is settled in code first (answer-match.ts), so the model never gets the chance to fail
  // it. A misspelling counts only when the word is not a real word, which the dictionary says; a misspelt
  // name ("sahera" for the Sahara) only when neither the dictionary nor the English word list has it.
  const isWord = await realWords(answers.flatMap(misspellingCandidates));
  const listed = await wordListHas(answers.flatMap(misspeltNameCandidates));
  // A key that names a place or a thing ("Soviet Union") is not taken for a person's name.
  const senses = await dictionarySenses(answers.flatMap(personNameWords));
  // settleByCode returns false only when the key and the answer are each one quantity and code is
  // sure the amounts differ ("4.5%" for 45%); anything it is unsure of is null and goes to the model.
  // A code rejection is stored as 'exact' like a code accept, and can be marked again by hand.
  const byCode = new Map(answers.map((it) => [it.index, settleByCode(it, isWord, listed, senses)]));
  // Of the rest, an answer that answers nothing ("xyz", "?!", non-answer.ts) is marked wrong by code too,
  // with or without a model: gemma4:e2b marked typed "xyz" right in 4 of 5 rows (TerraTutor click test 2026-11-19).
  const nothing = new Set<number>();
  await Promise.all(answers.filter((it) => byCode.get(it.index) === null).map(async (it) => {
    if (await isNonAnswer(it.student, it.expected, it.question)) nothing.add(it.index);
  }));
  for (const it of answers) {
    const settled = byCode.get(it.index);
    if (nothing.has(it.index)) {
      out.set(it.index, { isCorrect: false, feedback: NO_ANSWER_FEEDBACK, by: "exact" });
    } else if (settled === true) {
      out.set(it.index, { isCorrect: true, feedback: "Correct.", by: "exact" });
    } else if (settled === false) {
      out.set(it.index, { isCorrect: false, feedback: CODE_MISMATCH_FEEDBACK, by: "exact" });
    } else {
      needsLLM.push(it);
    }
  }

  if (needsLLM.length > 0 && !(config && isLocalModel(config))) {
    log.info("quiz", `no local model to grade ${needsLLM.length} written answer(s); passing them leniently rather than sending them off this computer`);
    for (const it of needsLLM) out.set(it.index, { isCorrect: true, feedback: "", by: "fallback" });
  } else if (needsLLM.length > 0 && config) {
    const tier = config.modelTier ?? await detectModelTier(config);
    config.modelTier = tier;
    try {
      const notes = await misspellingNotes(needsLLM);
      const parsed = await callLLMStructured<BatchGradeReply>(
        [{ role: "user", content: buildBatchGradePrompt(needsLLM.map((it, k) => ({ ...it, note: notes[k] })), MATH_FORMATTING_RULES) }],
        config,
        { schema: batchGradeSchema(needsLLM), toolName: "emit_grades", tier },
      );
      // One about "the student", or one that says no answer was given, is said to the learner (feedbackForLearner).
      for (const [idx, outcome] of parseBatchGradeResults(parsed, needsLLM)) out.set(idx, feedbackForLearner(outcome));
    } catch (e) {
      log.warn("quiz", `batch grade failed — marking ${needsLLM.length} answers correct (lenient)`, e instanceof Error ? e.message : String(e));
      for (const it of needsLLM) out.set(it.index, { isCorrect: true, feedback: "", by: "fallback" });
    }
  }

  return out;
}

// The study plan is 3-5 items the model returns as a JSON list, and code writes the bullets. Asked for
// "3-5 bullet points" in "plain text", gemma4:e2b wrote paragraphs in 17 of 20 plans (B9 readiness run,
// 2026-11-13). minItems is halved for small tiers like every structured schema, so a tiny model may
// return fewer than 3; each item is still its own bullet. The count and length caps are applied by
// renderStudyPlan, not the schema, so a long or sixth item is trimmed instead of failing the call.
const STUDY_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      minItems: 3,
      items: { type: "string", minLength: 10 },
    },
  },
};
const STUDY_PLAN_MAX_ITEMS = 5;
const STUDY_PLAN_MAX_ITEM_CHARS = 300;

/** One item, cut at a word boundary when it runs over STUDY_PLAN_MAX_ITEM_CHARS. */
function capItem(text: string): string {
  if (text.length <= STUDY_PLAN_MAX_ITEM_CHARS) return text;
  const cut = text.slice(0, STUDY_PLAN_MAX_ITEM_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, "")}…`;
}

/**
 * The plan as the results screen shows it: one "• " line per item, at most STUDY_PLAN_MAX_ITEMS,
 * with any list marker or markdown bold the model wrote removed.
 */
function renderStudyPlan(items: readonly string[]): string {
  return items
    .map((it) => it.replace(/\*\*/g, "").replace(/(^|\W)\*(\S[^*]*?)\*(?!\w)/g, "$1$2").replace(/\s+/g, " ").trim().replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .slice(0, STUDY_PLAN_MAX_ITEMS)
    .map((it) => `• ${capItem(it)}`)
    .join("\n");
}

/** The plan code can write without a model: each missed question with its answer and why. */
function fallbackStudyPlan(missedQuestions: ReadonlyArray<{ question_text: string; correct_answer: string; explanation: string }>): string {
  return renderStudyPlan(missedQuestions.map((q) =>
    `Review "${q.question_text.trim()}" The answer is ${q.correct_answer.trim()}. ${q.explanation.trim()}`));
}

// Generate a study plan from missed questions after a failed promotion test. Which questions the learner
// missed is data about them, kept on the computer (lane 1): `config` is a local model (store.ts
// getLocalVerifyConfig). Given a cloud model or null, no model is asked and the plan code writes is used.
export async function generateStudyPlan(
  topic: string,
  level: number,
  missedQuestions: Array<{ question_text: string; correct_answer: string; explanation: string }>,
  config: LLMConfig | null,
): Promise<string> {
  if (!config || !isLocalModel(config)) {
    log.info("quiz", "no local model for the study plan; showing the missed questions instead");
    return fallbackStudyPlan(missedQuestions);
  }
  const prompt = `A student studying "${topic}" just failed their Level ${level} promotion test.

Missed questions:
${missedQuestions.slice(0, 10).map((q, i) => `${i + 1}. ${q.question_text}\n   Correct answer: ${q.correct_answer}\n   Why: ${q.explanation}`).join("\n\n")}

Write a focused, actionable study plan of 3 to 5 items that tells them exactly what to review and practice before retaking the test. Each item is one or two sentences about one thing to do. Be specific, direct, and encouraging.

${MATH_FORMATTING_RULES_PROSE}`;

  // One repair at most: the plan is shown on the results screen, and each attempt can take the tier's
  // full timeout. When the model still fails, the learner gets the plan code can write.
  try {
    const tier = config.modelTier ?? await detectModelTier(config);
    config.modelTier = tier;
    const { items } = await callLLMStructured<{ items: string[] }>(
      [{ role: "user", content: prompt }],
      config,
      { schema: STUDY_PLAN_SCHEMA, toolName: "emit_study_plan", tier, maxRepairAttempts: 1 },
    );
    const plan = renderStudyPlan(items);
    if (plan) return plan;
  } catch (e) {
    log.warn("quiz", "study plan call failed — showing the missed questions instead", e instanceof Error ? e.message : String(e));
  }
  return fallbackStudyPlan(missedQuestions);
}
