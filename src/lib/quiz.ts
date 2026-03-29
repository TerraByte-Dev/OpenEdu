import { callLLM } from "./llm";
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

  let jsonStr = response.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(jsonStr);
  return parsed.map((q: Record<string, unknown>) => ({
    question_text: q.question_text as string,
    question_type: q.question_type as string,
    options: q.options as string[] | null,
    correct_answer: q.correct_answer as string,
    difficulty_level: q.difficulty_level as number,
    explanation: q.explanation as string,
  }));
}
