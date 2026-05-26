import { callLLM, callLLMStreaming, callLLMStructured, detectModelTier, log, sanitizeJsonEscapes } from "./llm";
import { MATH_FORMATTING_RULES, MATH_FORMATTING_RULES_PROSE } from "./formatting";
import type { LLMConfig, ModelTier, Syllabus, QuizQuestion } from "../types";

// The generation-time question shape (no DB/runtime fields yet).
type GenQuestion = Omit<QuizQuestion, "id" | "attempt_id" | "user_answer" | "is_correct">;

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

export function validateQuizBatch(questions: GeneratedQuestion[], allowedIds: Set<string>): string[] {
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

// Split `total` questions across `buckets`, as evenly as possible (remainder to the first buckets).
function splitCount(total: number, buckets: number): number[] {
  if (buckets <= 0) return [];
  const base = Math.floor(total / buckets);
  let rem = total - base * buckets;
  return Array.from({ length: buckets }, () => base + (rem-- > 0 ? 1 : 0));
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
    ? "\n- Prefer conceptual understanding, definitions, and reasoning. AVOID multi-step arithmetic and unit-conversion questions, and do not include numeric details irrelevant to the answer."
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
- explanation: 1–2 educational sentences. difficulty_level: ${ctx.difficulty}.
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
        validate: (parsed) => validateQuizBatch(parsed?.questions ?? [], allowedIds),
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

// Sequential on Ollama (single-GPU swap cost), parallel on cloud APIs — mirrors expandSubtopics.
async function runBatches(ctxs: BatchContext[], config: LLMConfig): Promise<GeneratedQuestion[]> {
  if (config.provider === "ollama") {
    const out: GeneratedQuestion[] = [];
    for (const ctx of ctxs) out.push(...(await generateQuestionBatch(ctx)));
    return out;
  }
  const settled = await Promise.all(ctxs.map((c) => generateQuestionBatch(c)));
  return settled.flat();
}

export async function generateQuizQuestions(
  syllabus: Syllabus,
  numQuestions: number,
  config: LLMConfig,
): Promise<GenQuestion[]> {
  const tier = config.modelTier ?? await detectModelTier(config);
  config.modelTier = tier;

  const subs = subtopicsForGen(syllabus);
  const counts = splitCount(numQuestions, subs.length);
  const ctxs: BatchContext[] = subs
    .map((s, i): BatchContext => ({
      topic: syllabus.title,
      levelLabel: `Level ${syllabus.level}`,
      subtopics: [s],
      count: counts[i],
      highStakes: false,
      easier: false,
      difficulty: syllabus.level,
      tier,
      config,
    }))
    .filter((c) => c.count > 0);

  const questions = (await runBatches(ctxs, config)).map(finalizeQuestion);
  if (questions.length === 0) {
    throw new Error("Could not generate quiz questions — the model returned no valid questions. Try again, or switch to a more capable model.");
  }
  return questions;
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
): Promise<PromotionTestQuestions> {
  const tier = config.modelTier ?? await detectModelTier(config);
  config.modelTier = tier;

  // ── Current section: per-subtopic over the current level (35 total). Even split across 3–6
  // subtopics naturally yields ≥2 per subtopic, satisfying the mandatory-coverage rule. ──
  const curSubs = subtopicsForGen(currentSyllabus);
  const curCounts = splitCount(35, curSubs.length);
  const curCtxs: BatchContext[] = curSubs
    .map((s, i): BatchContext => ({
      topic: currentSyllabus.title,
      levelLabel: `Level ${currentSyllabus.level} promotion test`,
      subtopics: [s],
      count: curCounts[i],
      highStakes: true,
      easier: false,
      difficulty: currentSyllabus.level,
      tier,
      config,
    }))
    .filter((c) => c.count > 0);
  const current = (await runBatches(curCtxs, config)).map(finalizeQuestion);

  // ── Review section: per previous level (last ≤4), 10 total, slightly easier. ──
  let review: GenQuestion[] = [];
  const recents = previousSyllabuses.slice(-4).filter((s) => s.subtopics && s.subtopics.length > 0);
  if (recents.length > 0) {
    const revCounts = splitCount(10, recents.length);
    const revCtxs: BatchContext[] = recents
      .map((s, i): BatchContext => ({
        topic: s.title,
        levelLabel: `Level ${s.level} (review of earlier material)`,
        subtopics: s.subtopics.map((t) => ({ id: t.id, title: t.title, key_concepts: t.key_concepts ?? [] })),
        count: revCounts[i],
        highStakes: false,
        easier: true,
        difficulty: Math.max(1, currentSyllabus.level - 1),
        tier,
        config,
      }))
      .filter((c) => c.count > 0);
    review = (await runBatches(revCtxs, config)).map(finalizeQuestion);
  }

  return { current, review };
}

// Grade a written response or word problem using the LLM
export async function gradeWrittenResponse(
  question: string,
  correctAnswer: string,
  studentAnswer: string,
  config: LLMConfig,
): Promise<{ isCorrect: boolean; feedback: string }> {
  const prompt = `You are grading a student's written answer. Return a JSON object.

Question: ${question}
Expected answer: ${correctAnswer}
Student's answer: ${studentAnswer}

Evaluate if the student demonstrates understanding of the core concept. Allow for different wording as long as the meaning is correct. Be generous with partial credit — if they show understanding, mark correct.

Return ONLY valid JSON: {"correct": true/false, "feedback": "1-2 sentence feedback explaining the evaluation"}

${MATH_FORMATTING_RULES}`;

  const response = await callLLM([{ role: "user", content: prompt }], config);
  let jsonStr = response.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  const s = jsonStr.indexOf("{");
  const e = jsonStr.lastIndexOf("}");
  if (s !== -1 && e !== -1) jsonStr = jsonStr.slice(s, e + 1);
  let result: { correct: boolean; feedback: string };
  try {
    result = JSON.parse(jsonStr) as { correct: boolean; feedback: string };
  } catch {
    result = JSON.parse(sanitizeJsonEscapes(jsonStr)) as { correct: boolean; feedback: string };
  }
  return { isCorrect: Boolean(result.correct), feedback: String(result.feedback ?? "") };
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
