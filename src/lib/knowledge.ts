import { getTutorInstructions, saveTutorInstruction } from "./db";
import { callLLM } from "./llm";
import type { LLMConfig } from "../types";

// Update knowledge files after a quiz or promotion test completes (no LLM call — direct write)
export async function updateKnowledgeAfterQuiz(
  courseId: string,
  score: number,
  totalQuestions: number,
  missedTopics: string[],
  studyPlan: string | null,
  _config: LLMConfig,
): Promise<void> {
  const instructions = await getTutorInstructions(courseId);
  const currentStudyLog = (instructions["study_log"] ?? "").trim();
  const currentKnowledgeMap = (instructions["knowledge_map"] ?? "").trim();

  const dateStr = new Date().toLocaleDateString();
  const quizEntry = `[${dateStr}] Quiz: ${score.toFixed(0)}% (${totalQuestions} questions)` +
    (missedTopics.length > 0 ? `. Weak areas: ${missedTopics.slice(0, 5).join(", ")}.` : ". All areas strong.") +
    (studyPlan ? ` Study plan: ${studyPlan.slice(0, 250)}` : "");

  const logLines = currentStudyLog.split("\n").filter((l) => l.trim());
  logLines.push(quizEntry);
  await saveTutorInstruction(courseId, "study_log", logLines.slice(-3).join("\n"));

  if (missedTopics.length > 0) {
    const gapNote = `Needs review: ${missedTopics.slice(0, 8).join(", ")}`;
    const updatedMap = currentKnowledgeMap ? `${currentKnowledgeMap}\n${gapNote}` : gapNote;
    await saveTutorInstruction(courseId, "knowledge_map", updatedMap.slice(-500));
  }
}

const KNOWLEDGE_TYPES = ["knowledge_map", "misconceptions", "study_log", "learning_profile"] as const;
type KnowledgeType = typeof KNOWLEDGE_TYPES[number];

// Character budgets per section (total <= 1500)
const BUDGETS: Record<KnowledgeType, number> = {
  knowledge_map: 500,
  misconceptions: 500,
  learning_profile: 300,
  study_log: 200,
};

const DEFAULT_CONTENT: Record<KnowledgeType, string> = {
  knowledge_map: "",
  misconceptions: "",
  study_log: "",
  learning_profile: "",
};

// Seed empty knowledge file stubs for a new course
export async function initKnowledgeFiles(courseId: string): Promise<void> {
  for (const type of KNOWLEDGE_TYPES) {
    await saveTutorInstruction(courseId, type, DEFAULT_CONTENT[type]);
  }
}

// Read all 4 knowledge types and return a single prompt section (capped at 1500 chars)
export async function getKnowledgeSummary(courseId: string): Promise<string> {
  const instructions = await getTutorInstructions(courseId);

  const sections: string[] = [];
  for (const type of KNOWLEDGE_TYPES) {
    const content = (instructions[type] ?? "").trim();
    if (!content) continue;
    const budget = BUDGETS[type];
    const truncated = content.length > budget ? content.slice(0, budget) + "..." : content;
    const label = type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    sections.push(`**${label}:**\n${truncated}`);
  }

  return sections.join("\n\n");
}

// Background reflection: update knowledge files after a chat exchange
export async function updateKnowledgeFiles(
  courseId: string,
  userMessage: string,
  assistantResponse: string,
  config: LLMConfig,
): Promise<void> {
  const instructions = await getTutorInstructions(courseId);

  const currentFiles = KNOWLEDGE_TYPES.map((type) => {
    const content = (instructions[type] ?? "").trim();
    const label = type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return `**${label}:**\n${content || "(empty)"}`;
  }).join("\n\n");

  const prompt = `You maintain student knowledge files for an AI tutor. Given the current files and the latest exchange, return a JSON object updating ONLY the files that changed. Omit unchanged files entirely.

Current knowledge files:
${currentFiles}

Latest exchange:
Student: ${userMessage.slice(0, 500)}
Tutor: ${assistantResponse.slice(0, 500)}

Return a JSON object with only the keys that need updating. Valid keys: "knowledge_map", "misconceptions", "study_log", "learning_profile".

Rules:
- knowledge_map: Track what the student understands. Add new concepts they clearly grasped. Mark if they struggled.
- misconceptions: Record errors or wrong beliefs the student showed. Note when a misconception was corrected.
- study_log: Brief 1-2 sentence diary entry about this session's focus. Keep only the 3 most recent entries.
- learning_profile: Note how this student learns best (pace, preferred explanations, engagement style).
- Be concise. Each value should be plain text under 400 characters.
- If nothing meaningful changed, return {}

Respond with ONLY valid JSON.`;

  let response: string;
  try {
    response = await callLLM([{ role: "user", content: prompt }], config);
  } catch {
    return; // knowledge file updates are best-effort
  }

  let parsed: Record<string, string>;
  try {
    let jsonStr = response.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const start = jsonStr.indexOf("{");
    const end = jsonStr.lastIndexOf("}");
    if (start !== -1 && end !== -1) jsonStr = jsonStr.slice(start, end + 1);
    parsed = JSON.parse(jsonStr);
  } catch {
    return;
  }

  for (const type of KNOWLEDGE_TYPES) {
    if (typeof parsed[type] === "string" && parsed[type].trim()) {
      await saveTutorInstruction(courseId, type, parsed[type].trim());
    }
  }
}
