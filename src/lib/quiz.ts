import { callLLM, callLLMStreaming } from "./llm";
import type { LLMConfig, Syllabus, QuizQuestion } from "../types";

export async function generateQuizQuestions(
  syllabus: Syllabus,
  numQuestions: number,
  config: LLMConfig,
): Promise<Array<Omit<QuizQuestion, "id" | "attempt_id" | "user_answer" | "is_correct">>> {
  const prompt = `Generate ${numQuestions} quiz questions for the topic "${syllabus.title}" at level ${syllabus.level}.

The questions should cover these subtopics:
${syllabus.subtopics.map((s) => `- ${s.title}: ${s.key_concepts.join(", ")}`).join("\n")}

Return ONLY a JSON array of questions in this exact format:
[
  {
    "question_text": "The question here?",
    "question_type": "multiple_choice",
    "options": ["A) First option", "B) Second option", "C) Third option", "D) Fourth option"],
    "correct_answer": "A) First option",
    "difficulty_level": ${syllabus.level},
    "explanation": "Why this answer is correct"
  },
  {
    "question_text": "True or false: statement here",
    "question_type": "true_false",
    "options": ["True", "False"],
    "correct_answer": "True",
    "difficulty_level": ${syllabus.level},
    "explanation": "Why this is true/false"
  }
]

Requirements:
- Mix question types: mostly multiple_choice, some true_false
- Each multiple_choice must have exactly 4 options
- Explanations should be educational, 1-2 sentences
- Questions should test understanding, not just memorization
- Difficulty should match level ${syllabus.level}

Respond with ONLY the JSON array.`;

  const response = await callLLM(
    [{ role: "user", content: prompt }],
    config,
  );

  return parseQuestions(response);
}

function parseQuestions(
  response: string,
): Array<Omit<QuizQuestion, "id" | "attempt_id" | "user_answer" | "is_correct">> {
  let jsonStr = response.trim();
  // Strip markdown code fences
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  // Find first [ ... ] in case model added prose before/after
  const start = jsonStr.indexOf("[");
  const end = jsonStr.lastIndexOf("]");
  if (start !== -1 && end !== -1) jsonStr = jsonStr.slice(start, end + 1);
  const parsed = JSON.parse(jsonStr);
  return (parsed as Record<string, unknown>[]).map((q) => {
    const rawType = String(q.question_type ?? "multiple_choice");
    const question_type: "multiple_choice" | "true_false" | "short_answer" =
      rawType === "true_false" ? "true_false"
      : rawType === "short_answer" ? "short_answer"
      : "multiple_choice";
    return {
      question_text: String(q.question_text ?? ""),
      question_type,
      options: Array.isArray(q.options) ? (q.options as string[]) : null,
      correct_answer: String(q.correct_answer ?? ""),
      difficulty_level: Number(q.difficulty_level ?? 1),
      explanation: String(q.explanation ?? ""),
    };
  });
}

// Promotion test: two sections (current level + review of previous levels)
export interface PromotionTestQuestions {
  current: Array<Omit<QuizQuestion, "id" | "attempt_id" | "user_answer" | "is_correct">>;
  review: Array<Omit<QuizQuestion, "id" | "attempt_id" | "user_answer" | "is_correct">>;
}

export async function generatePromotionTestQuestions(
  currentSyllabus: Syllabus,
  previousSyllabuses: Syllabus[],
  config: LLMConfig,
  onChunk?: (token: string) => void,
): Promise<PromotionTestQuestions> {
  const callFn = onChunk
    ? (msgs: { role: string; content: string }[]) => callLLMStreaming(msgs, config, onChunk)
    : (msgs: { role: string; content: string }[]) => callLLM(msgs, config);

  const currentPrompt = `Generate 15 promotion test questions for "${currentSyllabus.title}" at level ${currentSyllabus.level}.
These are high-stakes advancement questions — more rigorous than regular quiz questions.

Cover ALL subtopics:
${currentSyllabus.subtopics.map((s) => `- ${s.title}: ${s.key_concepts.join(", ")}`).join("\n")}

Assessment criteria:
${currentSyllabus.assessment_criteria.map((c) => `- ${c}`).join("\n")}

Return ONLY a JSON array with this format:
[{"question_text":"...","question_type":"multiple_choice","options":["A) ...","B) ...","C) ...","D) ..."],"correct_answer":"A) ...","difficulty_level":${currentSyllabus.level},"explanation":"..."}]

Mix question types: multiple_choice (80%) and true_false (20%). Respond with ONLY the JSON array.`;

  const currentRaw = await callFn([{ role: "user", content: currentPrompt }]);
  const current = parseQuestions(currentRaw);

  let review: typeof current = [];
  if (previousSyllabuses.length > 0) {
    // Weight toward most recent previous levels
    const recents = previousSyllabuses.slice(-3);
    const reviewPrompt = `Generate 5 review questions covering PREVIOUS levels for a student advancing past level ${currentSyllabus.level}.

Previous levels to review:
${recents.map((s) => `Level ${s.level}: ${s.title}\nSubtopics: ${s.subtopics.map((t) => t.title).join(", ")}`).join("\n\n")}

Focus on concepts that are foundational for the current level. Slightly easier than the current level.

Return ONLY a JSON array with this format:
[{"question_text":"...","question_type":"multiple_choice","options":["A) ...","B) ...","C) ...","D) ..."],"correct_answer":"A) ...","difficulty_level":${Math.max(0, currentSyllabus.level - 0.5)},"explanation":"..."}]

Respond with ONLY the JSON array.`;

    try {
      const reviewRaw = await callFn([{ role: "user", content: reviewPrompt }]);
      review = parseQuestions(reviewRaw);
    } catch {
      // Review section is optional — if it fails, proceed with current-only
      review = [];
    }
  }

  return { current, review };
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

Write a focused, actionable study plan (3-5 bullet points) that tells them exactly what to review and practice before retaking the test. Be specific, direct, and encouraging. Use plain text — no markdown headers.`;

  return onChunk
    ? await callLLMStreaming([{ role: "user", content: prompt }], config, onChunk)
    : await callLLM([{ role: "user", content: prompt }], config);
}
