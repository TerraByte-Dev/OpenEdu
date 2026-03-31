import { callLLM, callLLMStreaming } from "./llm";
import type { LLMConfig, Syllabus, QuizQuestion } from "../types";

export async function generateQuizQuestions(
  syllabus: Syllabus,
  numQuestions: number,
  config: LLMConfig,
): Promise<Array<Omit<QuizQuestion, "id" | "attempt_id" | "user_answer" | "is_correct">>> {
  const subtopicList = syllabus.subtopics.map((s) => `- id="${s.id}" title="${s.title}": ${s.key_concepts.join(", ")}`).join("\n");
  const prompt = `Generate ${numQuestions} quiz questions for the topic "${syllabus.title}" at level ${syllabus.level}.

The questions must cover these subtopics (use the subtopic id in each question):
${subtopicList}

Use a DIVERSE MIX of question types with this approximate distribution:
- multiple_choice (40%): 4 options labeled A) B) C) D), one correct
- fill_in_blank (15%): a complete sentence with ___ where the answer goes; blank_position is the full sentence with ___
- written_response (10%): open-ended question requiring a 1-3 sentence explanation; correct_answer is the ideal answer
- word_problem (15%): scenario or practical problem requiring applied knowledge; correct_answer is the expected answer
- drag_to_match (10%): provide matching_pairs as array of {left, right} objects (3-5 pairs); correct_answer is "See matching_pairs"
- true_false (10%): statement that is true or false

Return ONLY a JSON array in this exact format:
[
  {
    "question_text": "The question here?",
    "question_type": "multiple_choice",
    "options": ["A) First option", "B) Second option", "C) Third option", "D) Fourth option"],
    "correct_answer": "A) First option",
    "difficulty_level": ${syllabus.level},
    "explanation": "Why this answer is correct",
    "subtopic_id": "${syllabus.subtopics[0]?.id ?? ""}",
    "blank_position": null,
    "matching_pairs": null
  }
]

Requirements:
- Include subtopic_id matching the id field from the subtopic list above
- Distribute questions across all subtopics
- Each multiple_choice must have exactly 4 options
- For fill_in_blank: blank_position is the full sentence with ___ inserted (e.g. "The ___ is used to declare variables in JavaScript")
- For drag_to_match: matching_pairs is an array like [{"left": "term", "right": "definition"}, ...]
- Explanations should be educational, 1-2 sentences
- Questions should test understanding, not just memorization
- Difficulty should match level ${syllabus.level}
- Set blank_position to null for non-fill_in_blank types
- Set matching_pairs to null for non-drag_to_match types

Respond with ONLY the JSON array.`;

  const response = await callLLM(
    [{ role: "user", content: prompt }],
    config,
  );

  return parseQuestions(response);
}

const VALID_QUESTION_TYPES = new Set([
  "multiple_choice", "true_false", "short_answer", "fill_in_blank",
  "written_response", "drag_to_match", "word_problem",
]);

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
    const question_type = VALID_QUESTION_TYPES.has(rawType)
      ? rawType as QuizQuestion["question_type"]
      : "multiple_choice";
    return {
      question_text: String(q.question_text ?? ""),
      question_type,
      options: Array.isArray(q.options) ? (q.options as string[]) : null,
      correct_answer: String(q.correct_answer ?? ""),
      difficulty_level: Number(q.difficulty_level ?? 1),
      explanation: String(q.explanation ?? ""),
      subtopic_id: q.subtopic_id ? String(q.subtopic_id) : null,
      blank_position: q.blank_position ? String(q.blank_position) : null,
      matching_pairs: Array.isArray(q.matching_pairs) ? q.matching_pairs as Array<{ left: string; right: string }> : null,
    };
  });
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

Return ONLY valid JSON: {"correct": true/false, "feedback": "1-2 sentence feedback explaining the evaluation"}`;

  const response = await callLLM([{ role: "user", content: prompt }], config);
  let jsonStr = response.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  const start = jsonStr.indexOf("{");
  const end = jsonStr.lastIndexOf("}");
  if (start !== -1 && end !== -1) jsonStr = jsonStr.slice(start, end + 1);
  const parsed = JSON.parse(jsonStr) as { correct: boolean; feedback: string };
  return { isCorrect: Boolean(parsed.correct), feedback: String(parsed.feedback ?? "") };
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
