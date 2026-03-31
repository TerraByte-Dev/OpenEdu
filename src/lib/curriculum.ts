import { callLLM, callLLMStreaming, log } from "./llm";
import { saveSyllabus, saveTutorInstruction } from "./db";
import type { LLMConfig, Syllabus } from "../types";

const LEVEL_MEANINGS: Record<number, string> = {
  0.0: "Absolute beginner — no prior knowledge assumed",
  0.5: "Exposure — basic terminology and orientation",
  1.0: "Foundational — core concepts understood",
  1.5: "Applied foundations — can use basics independently",
  2.0: "Working knowledge — handles standard problems",
  2.5: "Confident practitioner — tackles moderate complexity",
  3.0: "Intermediate — connects concepts across domains",
  3.5: "Advanced intermediate — identifies edge cases and trade-offs",
  4.0: "Advanced — can teach others, designs solutions",
  4.5: "Expert — deep understanding, handles novel problems",
  5.0: "Mastery — authoritative knowledge, pushes boundaries",
};

export function getLevelMeaning(level: number): string {
  return LEVEL_MEANINGS[level] ?? "Unknown level";
}

// Phase 1: Research the topic deeply — this is the triaging step from CONCEPT.md.
// Produces a rich brief that informs all subsequent generation.
export async function researchTopic(topic: string, config: LLMConfig, onChunk?: (t: string) => void): Promise<string> {
  const prompt = `You are a master curriculum designer with deep knowledge of thousands of textbooks, university courses, professional certifications, and expert learning paths.

Your task: thoroughly research the topic "${topic}" and produce a comprehensive curriculum research brief.

Cover the following:

## Subject Overview
What is ${topic}? Why is it important? What can someone do once they master it?

## Key Knowledge Domains
The 5-8 major areas of knowledge within ${topic} (e.g., for Python: syntax, data structures, OOP, standard library, etc.)

## Full Learning Progression (Beginner → Mastery)
How do learners actually progress? What are the real milestones? What do traditional university courses, bootcamps, or professional certs focus on at each stage?

## Essential Concepts by Stage
- **Complete Beginner (Level 0-1)**: The absolute first things to learn
- **Foundations (Level 1-2)**: Building blocks that everything else depends on
- **Working Knowledge (Level 2-3)**: What makes someone productive/useful
- **Intermediate (Level 3-4)**: Where depth and nuance begin
- **Advanced to Mastery (Level 4-5)**: Expert territory, specializations

## Common Learning Obstacles
Where do learners typically get stuck? What misconceptions are common? What do most courses get wrong?

## Real-World Applications at Each Stage
What can someone actually BUILD or DO at each milestone?

## Prerequisite Knowledge
What should someone ideally know before starting ${topic}?

Be thorough, specific, and draw on real educational best practices. This brief will be used to generate a full 0.0-5.0 mastery curriculum.`;

  log.info("researchTopic", `Researching "${topic}" with ${config.provider}/${config.model}`);
  const result = onChunk
    ? await callLLMStreaming([{ role: "user", content: prompt }], config, onChunk)
    : await callLLM([{ role: "user", content: prompt }], config);
  if (!result.trim()) {
    throw new Error(`Model returned an empty research brief for "${topic}". Check your API key and model selection in Settings.`);
  }
  log.info("researchTopic", `Got ${result.length} char brief`);
  return result;
}

// Phase 2-3: Generate tutor identity + pedagogy informed by research
export async function generateTutorInstructions(
  courseId: string,
  topic: string,
  researchBrief: string,
  config: LLMConfig,
  onChunk?: (t: string) => void,
): Promise<void> {
  const contextSnippet = researchBrief.slice(0, 1200); // First 1200 chars for context

  const identityPrompt = `Based on this curriculum research about "${topic}":
---
${contextSnippet}
---

Write a tutor identity instruction (2-3 paragraphs) for an AI tutor teaching ${topic}. Define:
- A fitting name and personality for this tutor
- Their teaching style and what makes them great at this subject
- How they address the student (warm but focused)

Write in second person ("You are..."). Keep it concise and authentic.`;

  const identity = onChunk
    ? await callLLMStreaming([{ role: "user", content: identityPrompt }], config, onChunk)
    : await callLLM([{ role: "user", content: identityPrompt }], config);
  await saveTutorInstruction(courseId, "identity", identity);

  const pedagogyPrompt = `Based on this curriculum research about "${topic}":
---
${contextSnippet}
---

Write a pedagogy instruction (2-3 paragraphs) for a ${topic} tutor. Define:
- The primary teaching approach best suited for this subject (e.g., examples-first for programming, Socratic for math, immersion for languages)
- How to structure explanations at different levels
- When to use analogies vs formal definitions vs hands-on practice
- How to handle confusion and build on what the student already knows

Write in second person ("You should..."). Keep it actionable.`;

  const pedagogy = onChunk
    ? await callLLMStreaming([{ role: "user", content: pedagogyPrompt }], config, onChunk)
    : await callLLM([{ role: "user", content: pedagogyPrompt }], config);
  await saveTutorInstruction(courseId, "pedagogy", pedagogy);

  const rules = `You are a focused tutor. Follow these rules:
- Stay within the current level's syllabus scope. Don't introduce higher-level concepts unprompted.
- Guide the student to discover answers rather than giving them immediately.
- When stuck, give hints — not full solutions.
- Reference the current level's specific subtopics and objectives when relevant.
- If asked about something beyond scope, acknowledge their curiosity and note it's a great question for a later level.
- Celebrate genuine understanding, not just completion.
- When you see the student has mastered a subtopic, say so explicitly.
- Never give answers during quiz/assessment mode.`;

  await saveTutorInstruction(courseId, "rules", rules);

  // Store the full research brief for use in future syllabus generation
  await saveTutorInstruction(courseId, "research", researchBrief);
}

// Phase 4: Generate a syllabus level, informed by the research brief
export async function generateSyllabus(
  courseId: string,
  topic: string,
  level: number,
  config: LLMConfig,
  researchBrief: string = "",
  onChunk?: (t: string) => void,
  previousSyllabuses?: Syllabus[],
): Promise<Syllabus> {
  const researchContext = researchBrief
    ? `\nCurriculum Research Context:\n---\n${researchBrief.slice(0, 2000)}\n---\n`
    : "";

  const prevContext = previousSyllabuses && previousSyllabuses.length > 0
    ? `\nPrevious levels already covered:\n${previousSyllabuses.map((s) => `- Level ${s.level}: ${s.title} (subtopics: ${s.subtopics.map((t) => t.title).join(", ")})`).join("\n")}\nBuild on these — do not repeat covered subtopics.\n`
    : "";

  const prompt = `You are a curriculum designer creating a structured syllabus for "${topic}" at level ${level} (${getLevelMeaning(level)}).
${researchContext}${prevContext}
Produce ONLY a valid JSON object in this exact format:
{
  "level": ${level},
  "title": "Specific title for this level",
  "description": "1-2 sentences: what the student will understand and be able to do after this level",
  "learning_objectives": [
    "Specific, measurable objective 1",
    "Specific, measurable objective 2",
    "Specific, measurable objective 3",
    "Specific, measurable objective 4"
  ],
  "subtopics": [
    {
      "id": "${level}.1",
      "title": "Subtopic title",
      "key_concepts": ["concept 1", "concept 2", "concept 3"],
      "practice_type": "code_exercise",
      "mastered": false
    }
  ],
  "assessment_criteria": [
    "Student can do X",
    "Student can explain Y",
    "Student can build Z"
  ],
  "estimated_hours": 8
}

Rules:
- 3-6 subtopics, each with 2-4 key concepts
- practice_type: one of code_exercise, reading, discussion, guided_project, debugging_exercise, problem_set
- Estimated hours: 4-12 hours (scale with level complexity)
- Difficulty MUST match: "${getLevelMeaning(level)}"
- Subtopic IDs follow pattern: ${level}.1, ${level}.2, etc.

Respond with ONLY the JSON. No markdown, no explanation.`;

  log.info("generateSyllabus", `Requesting level ${level} for "${topic}"`);
  const response = onChunk
    ? await callLLMStreaming([{ role: "user", content: prompt }], config, onChunk)
    : await callLLM([{ role: "user", content: prompt }], config);

  if (!response.trim()) {
    throw new Error(`Model returned an empty response for syllabus level ${level}. Try again or switch models in Settings.`);
  }

  let jsonStr = response.trim();
  // Strip markdown code fences if present
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\r?\n?/, "").replace(/\r?\n?```$/, "");
  }
  // Find the JSON object boundaries in case there's surrounding text
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    log.error("generateSyllabus", "JSON parse failed", { raw: response.slice(0, 500) });
    throw new Error(`Failed to parse syllabus JSON from model response. Raw snippet: "${response.slice(0, 200)}..." — Try regenerating or switching models.`);
  }

  const syllabus: Omit<Syllabus, "id" | "generated_at"> = {
    course_id: courseId,
    level: parsed.level ?? level,
    title: parsed.title ?? `Level ${level}`,
    description: parsed.description ?? "",
    learning_objectives: Array.isArray(parsed.learning_objectives) ? parsed.learning_objectives : [],
    subtopics: Array.isArray(parsed.subtopics) ? parsed.subtopics : [],
    assessment_criteria: Array.isArray(parsed.assessment_criteria) ? parsed.assessment_criteria : [],
    estimated_hours: parsed.estimated_hours ?? 8,
  };

  await saveSyllabus(syllabus);
  return { ...syllabus, id: "", generated_at: new Date().toISOString() } as Syllabus;
}

export function buildSystemPrompt(
  instructions: Record<string, string>,
  syllabus: Syllabus | null,
  courseLevel: number,
  topic: string,
  modePromptSuffix?: string,
): string {
  const parts: string[] = [];

  if (instructions.identity) {
    parts.push(`## Tutor Identity\n${instructions.identity}`);
  }
  if (instructions.pedagogy) {
    parts.push(`## Teaching Approach\n${instructions.pedagogy}`);
  }
  if (instructions.rules) {
    parts.push(`## Rules\n${instructions.rules}`);
  }
  if (syllabus) {
    parts.push(`## Current Level: ${syllabus.level} — ${syllabus.title}
${syllabus.description}

### Learning Objectives
${syllabus.learning_objectives.map((o) => `- ${o}`).join("\n")}

### Subtopics in Scope
${syllabus.subtopics.map((s) => `- **${s.title}** (${s.mastered ? "MASTERED ✓" : "in progress"}): ${s.key_concepts.join(", ")}`).join("\n")}

Level: ${getLevelMeaning(courseLevel)}`);
  } else {
    // Fallback when no syllabus exists yet
    parts.push(`## Subject\nYou are tutoring the student on: ${topic}. Help them learn this subject step by step, starting from their current level of understanding.`);
  }
  if (instructions.progress_context) {
    parts.push(`## Student Progress\n${instructions.progress_context}`);
  }

  const base = parts.join("\n\n---\n\n");
  return modePromptSuffix ? base + modePromptSuffix : base;
}
