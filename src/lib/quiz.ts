import { callLLM, callLLMStreaming, callLLMStructured, detectModelTier, log } from "./llm";
import { MATH_FORMATTING_RULES, MATH_FORMATTING_RULES_PROSE } from "./formatting";
import { splitNewVsReview, storedToGenQuestion, pickReview, interleaveReview } from "./quiz-review";
import {
  checkAnswerConsistency, shouldRejectNumericReasoning,
  gradeFreeTextDeterministic, buildBatchGradePrompt, parseBatchGradeResults,
  buildVerifyPrompt, parseVerifyDrops, splitCount, dedupeByQuestionText,
  planSlotSubtopics, summarizeForLedger,
  type GradeOutcome,
} from "./quiz-grading";
import type { LLMConfig, ModelTier, Syllabus, QuizQuestion } from "../types";

// The generation-time question shape (no DB/runtime fields yet).
type GenQuestion = Omit<QuizQuestion, "id" | "attempt_id" | "user_answer" | "is_correct">;

// Target / floor question counts (issue #83). Target = what we aim to generate; floor = the count
// below which a degraded run surfaces an honest "your model may be struggling" note instead of
// silently shipping a short test. Quizzes 10–20, promotion tests 30–45.
export const QUIZ_TARGET = 20;
export const QUIZ_FLOOR = 10;
export const TEST_CURRENT_TARGET = 35;
export const TEST_REVIEW_TARGET = 10;
export const TEST_TOTAL_TARGET = TEST_CURRENT_TARGET + TEST_REVIEW_TARGET; // 45
export const TEST_FLOOR = 30;

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

  questions.forEach((q, i) => {
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
      if (opts.length > 0 && !set.has(stripPrefix(String(q.correct_answer ?? "")))) {
        issues.push(`${at}: multiple_choice correct_answer ("${q.correct_answer}") must exactly match one of the options.`);
      }
    } else if (type === "fill_in_blank") {
      if (!String(q.blank_position ?? "").includes("___")) {
        issues.push(`${at}: fill_in_blank blank_position must be the full sentence containing "___".`);
      }
    } else if (type === "drag_to_match") {
      const pairs = Array.isArray(q.matching_pairs) ? q.matching_pairs : [];
      if (pairs.length < 3 || pairs.length > 5) issues.push(`${at}: drag_to_match needs 3–5 matching_pairs (got ${pairs.length}).`);
      if (pairs.some((p) => !p || !String(p.left).trim() || !String(p.right).trim())) {
        issues.push(`${at}: drag_to_match has an empty pair side.`);
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

  // Strip letter prefix to get raw text
  const stripPrefix = (s: string) => s.replace(/^[A-D]\)\s*/, "").trim();
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

  return { ...q, options: relabeled, correct_answer: newCorrect };
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
function finalizeQuestion(g: GeneratedQuestion): GenQuestion {
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
      },
    );
    const qs = Array.isArray(result?.questions) ? result.questions : [];
    log.info("generateQuestionBatch", `${ctx.levelLabel} [${[...allowedIds].join(",")}] → ${qs.length}/${ctx.count}`);
    return qs;
  } catch (e) {
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
${avoid}
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
      },
    );
    return q ? finalizeQuestion(q) : null;
  } catch (e) {
    log.warn("generateOneQuestion", `failed for ${ctx.levelLabel} [${[...allowedIds].join(",")}]`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ─── Generate to a target count (issue #83) ───────────────────────────────────
// Provider-aware. LOCAL (Ollama) optimizes for QUALITY: one call per question, sequential, with a live
// anti-repeat ledger (time is free on local). CLOUD optimizes for COST on a free plan: batch questions
// per subtopic to minimize call count + repeated prompt tokens, fired in parallel. Both dedupe, top up
// a shortfall (capped rounds), and on capable tiers run the independent verify pass.
interface GenPlan {
  subtopics: Array<{ id: string; title: string; key_concepts: string[] }>;
  topic: string;
  levelLabel: string;
  difficulty: number;
  highStakes: boolean;
  easier: boolean;
  tier: ModelTier;
  config: LLMConfig;
}

function planSlotCtx(plan: GenPlan, subIdx: number): BatchContext {
  return {
    topic: plan.topic, levelLabel: plan.levelLabel, subtopics: [plan.subtopics[subIdx]], count: 1,
    highStakes: plan.highStakes, easier: plan.easier, difficulty: plan.difficulty, tier: plan.tier, config: plan.config,
  };
}

async function generatePerQuestion(
  plan: GenPlan, target: number, label: string, onProgress?: (done: number, total: number) => void,
): Promise<GenQuestion[]> {
  const { tier, config } = plan;
  const verify = tier === "medium" || tier === "large";
  const ledgerCap = tier === "tiny" || tier === "small" ? 8 : 16;
  const MAX_ROUNDS = 3;

  let produced: GenQuestion[] = [];
  const seen = new Set<string>();
  const keyOf = (q: GenQuestion) => q.question_text.trim().toLowerCase();
  const ledgerTail = () => produced.slice(-ledgerCap).map(summarizeForLedger);
  const add = (q: GenQuestion | null): void => {
    if (!q) return;
    const k = keyOf(q);
    if (!k || seen.has(k)) return;
    seen.add(k); produced.push(q); onProgress?.(produced.length, target);
  };

  for (let round = 1; round <= MAX_ROUNDS && produced.length < target; round++) {
    const roundStart = produced.length;
    for (const subIdx of planSlotSubtopics(plan.subtopics.length, target - produced.length)) {
      if (produced.length >= target) break;
      add(await generateOneQuestion(planSlotCtx(plan, subIdx), ledgerTail()));
    }
    if (verify && produced.length > roundStart) {
      const fresh = produced.slice(roundStart);
      const kept = await verifyAndFilter(fresh, config, tier, `${label} r${round}`);
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

  if (produced.length < target) log.warn("quiz", `${label}: generated ${produced.length}/${target} — model may be struggling (short test)`);
  else log.info("quiz", `${label}: ${produced.length}/${target} questions ready`);
  return produced.slice(0, target);
}

async function generateBatched(
  plan: GenPlan, target: number, label: string, onProgress?: (done: number, total: number) => void,
): Promise<GenQuestion[]> {
  const { tier, config } = plan;
  const verify = tier === "medium" || tier === "large";
  const MAX_ROUNDS = 3;
  let produced: GenQuestion[] = [];

  for (let round = 1; round <= MAX_ROUNDS && produced.length < target; round++) {
    const before = produced.length;
    // One batch call per subtopic — minimizes call count + repeated prompt tokens for a free-plan key.
    const counts = splitCount(target - produced.length, plan.subtopics.length);
    const ctxs: BatchContext[] = plan.subtopics
      .map((s, i): BatchContext => ({
        topic: plan.topic, levelLabel: plan.levelLabel, subtopics: [s], count: counts[i],
        highStakes: plan.highStakes, easier: plan.easier, difficulty: plan.difficulty, tier, config,
      }))
      .filter((c) => c.count > 0);
    if (ctxs.length === 0) break;

    let batch = (await Promise.all(ctxs.map(generateQuestionBatch))).flat().map(finalizeQuestion);
    if (verify) batch = await verifyAndFilter(batch, config, tier, `${label} r${round}`);

    produced = dedupeByQuestionText([...produced, ...batch]);
    onProgress?.(Math.min(produced.length, target), target);
    if (produced.length === before) {
      log.warn("quiz", `${label}: round ${round} added 0 questions — stopping at ${produced.length}/${target}`);
      break;
    }
    if (round > 1) log.info("quiz", `${label}: top-up round ${round} → ${produced.length}/${target}`);
  }

  const final = produced.length > target ? produced.slice(0, target) : produced;
  if (final.length < target) log.warn("quiz", `${label}: generated ${final.length}/${target} — model may be struggling (short test)`);
  else log.info("quiz", `${label}: ${final.length}/${target} questions ready`);
  return final;
}

async function generateToTarget(
  plan: GenPlan, target: number, label: string, onProgress?: (done: number, total: number) => void,
): Promise<GenQuestion[]> {
  if (plan.subtopics.length === 0 || target <= 0) return [];
  return plan.config.provider === "ollama"
    ? generatePerQuestion(plan, target, label, onProgress)   // local: quality, one call per question
    : generateBatched(plan, target, label, onProgress);       // cloud: cost, batched per subtopic
}

// ─── Independent verification pass (issue #83) ────────────────────────────────
// Gated to capable tiers by the caller. One structured call re-solves the checkable questions and
// flags any whose stored answer it disagrees with; those are dropped and the top-up loop refills.
// Best-effort: any failure returns the batch untouched so a flaky verify never blocks generation.
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
): Promise<GenQuestion[]> {
  // index = position in `questions` so parseVerifyDrops maps straight back to a filter predicate.
  const items = questions
    .map((q, index) => ({ q, index }))
    .filter(({ q }) => VERIFIABLE_TYPES.has(q.question_type))
    .map(({ q, index }) => ({ index, question: q.question_text, options: q.options, proposed: q.correct_answer }));
  if (items.length === 0) return questions;

  try {
    const parsed = await callLLMStructured<{ verdicts: Array<{ index: number; proposed_is_correct: boolean }> }>(
      [{ role: "user", content: buildVerifyPrompt(items) }],
      config,
      { schema: VERIFY_SCHEMA, toolName: "emit_verdicts", tier },
    );
    const drop = parseVerifyDrops(parsed, items);
    if (drop.size === 0) return questions;
    log.info("quiz", `${label}: verify pass dropped ${drop.size}/${items.length} with disagreeing answers`);
    return questions.filter((_, i) => !drop.has(i));
  } catch (e) {
    log.warn("quiz", `${label}: verify pass failed — keeping batch as-is`, e instanceof Error ? e.message : String(e));
    return questions;
  }
}

// `reviewPool` (optional) holds previously-missed questions for this course; ~20% of the quiz is
// re-posed from it (retrieval practice / spaced review), the rest freshly generated. An empty pool
// degrades to all-fresh — identical to the pre-A2 behavior, so legacy callers are unaffected.
export async function generateQuizQuestions(
  syllabus: Syllabus,
  numQuestions: number,
  config: LLMConfig,
  reviewPool: QuizQuestion[] = [],
  onProgress?: (done: number, total: number) => void,
): Promise<GenQuestion[]> {
  const tier = config.modelTier ?? await detectModelTier(config);
  config.modelTier = tier;

  const { fresh, review } = splitNewVsReview(numQuestions, reviewPool.length);
  const reviewQs = pickReview(reviewPool.map(storedToGenQuestion), review);

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
}

export async function generatePromotionTestQuestions(
  currentSyllabus: Syllabus,
  previousSyllabuses: Syllabus[],
  config: LLMConfig,
  onProgress?: (done: number, total: number, phase: "current" | "review") => void,
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
    },
    TEST_CURRENT_TARGET,
    `promotion L${currentSyllabus.level} current`,
    onProgress ? (d, t) => onProgress(d, t, "current") : undefined,
  );

  // ── Review section: the last ≤4 prior levels' subtopics flattened, slightly easier. ──
  let review: GenQuestion[] = [];
  const recents = previousSyllabuses.slice(-4).filter((s) => s.subtopics && s.subtopics.length > 0);
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
      },
      TEST_REVIEW_TARGET,
      `promotion L${currentSyllabus.level} review`,
      onProgress ? (d, t) => onProgress(d, t, "review") : undefined,
    );
  }

  return { current, review };
}

// ─── End-of-test grading (issue #83) ──────────────────────────────────────────
// Grades every free-text answer in ONE place at finish, instead of a blocking LLM call per answer
// mid-test (the old gradeWrittenResponse, which bogged the machine down). Normalized exact / numeric
// matches are settled deterministically with zero model calls; only the genuinely fuzzy answers go to
// a single batched structured call. Returns answer-index → {isCorrect, feedback}. Best-effort: a
// grader failure marks the unresolved answers correct (lenient) rather than punishing the student.
export interface AnswerToGrade {
  index: number;     // stable id back to the caller's question list
  question: string;
  expected: string;
  student: string;
  type: string;
}

const BATCH_GRADE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "correct", "feedback"],
        properties: {
          index: { type: "number" },
          correct: { type: "boolean" },
          feedback: { type: "string", maxLength: 300 },
        },
      },
    },
  },
};

export async function gradeAnswersBatch(
  items: AnswerToGrade[],
  config: LLMConfig,
): Promise<Map<number, GradeOutcome>> {
  const out = new Map<number, GradeOutcome>();
  const needsLLM: AnswerToGrade[] = [];

  for (const it of items) {
    // gradeFreeTextDeterministic only ever returns true (confident match) or null (defer) — never a
    // false, so it can't wrongly fail a correct-but-reworded answer.
    if (gradeFreeTextDeterministic(it.expected, it.student, it.type) === true) {
      out.set(it.index, { isCorrect: true, feedback: "Correct." });
    } else {
      needsLLM.push(it);
    }
  }

  if (needsLLM.length > 0) {
    const tier = config.modelTier ?? await detectModelTier(config);
    config.modelTier = tier;
    try {
      const parsed = await callLLMStructured<{ results: Array<{ index: number; correct: boolean; feedback: string }> }>(
        [{ role: "user", content: buildBatchGradePrompt(needsLLM, MATH_FORMATTING_RULES) }],
        config,
        { schema: BATCH_GRADE_SCHEMA, toolName: "emit_grades", tier },
      );
      for (const [idx, outcome] of parseBatchGradeResults(parsed, needsLLM)) out.set(idx, outcome);
    } catch (e) {
      log.warn("quiz", `batch grade failed — marking ${needsLLM.length} answers correct (lenient)`, e instanceof Error ? e.message : String(e));
      for (const it of needsLLM) out.set(it.index, { isCorrect: true, feedback: "" });
    }
  }

  return out;
}

// Generate a study plan from missed questions after a failed promotion test
export async function generateStudyPlan(
  topic: string,
  level: number,
  missedQuestions: Array<{ question_text: string; correct_answer: string; explanation: string }>,
  config: LLMConfig,
  onChunk?: (token: string) => void,
): Promise<string> {
  const prompt = `A student studying "${topic}" just failed their Level ${level} promotion test.

Missed questions:
${missedQuestions.slice(0, 10).map((q, i) => `${i + 1}. ${q.question_text}\n   Correct answer: ${q.correct_answer}\n   Why: ${q.explanation}`).join("\n\n")}

Write a focused, actionable study plan (3-5 bullet points) that tells them exactly what to review and practice before retaking the test. Be specific, direct, and encouraging. Use plain text — no markdown headers.

${MATH_FORMATTING_RULES_PROSE}`;

  return onChunk
    ? await callLLMStreaming([{ role: "user", content: prompt }], config, onChunk)
    : await callLLM([{ role: "user", content: prompt }], config);
}
