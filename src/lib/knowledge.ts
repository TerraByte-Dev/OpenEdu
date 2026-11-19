import { getTutorInstructions, saveTutorInstruction } from "./db";
import { callLLM } from "./llm";
import { KNOWLEDGE_TYPES, appendStudyLog, parseReflection, tutorCorrectedLearner, withoutBlanks, type KnowledgeType } from "./knowledge-reflect";
import type { LLMConfig } from "../types";
import { evaluatePermission } from "./permissions/evaluate";
import { loadPermissionRules } from "./permissions/store";
import type { PermissionMode } from "./tools/EduTool";

// The rule the post-turn reflection answers to: the knowledge.update_map tool's (tools/knowledge).
const KNOWLEDGE_UPDATE = { name: "knowledge.update_map", isReadOnly: false } as const;

const STUDY_PLAN = " Study plan: ";
const NEEDS_REVIEW = "Needs review: ";

// What the study log calls the attempt. Lines written before level tests had their own name say
// "Quiz" for both, and keep it.
type LogLabel = "Quiz" | "Level test";
const logLabel = (levelTest: boolean): LogLabel => (levelTest ? "Level test" : "Quiz");

// The study log's line for a finished quiz or level test. It starts with the date, the name and the
// score, by which a mark made later finds it again (reviseQuizLog).
const quizLogHead = (dateStr: string, label: LogLabel, score: number) => `[${dateStr}] ${label}: ${score.toFixed(0)}% `;
// One line: the study log is split on newlines and keeps its last 3, and a bulleted plan has several.
const planText = (studyPlan: string) => `${STUDY_PLAN}${studyPlan.replace(/\s+/g, " ").trim().slice(0, 250)}`;

function quizLogEntry(dateStr: string, label: LogLabel, score: number, totalQuestions: number, missedTopics: ReadonlyArray<string>, studyPlan: string | null): string {
  return `${quizLogHead(dateStr, label, score)}(${totalQuestions} questions)` +
    (missedTopics.length > 0 ? `. Weak areas: ${missedTopics.slice(0, 5).join(", ")}.` : ". All areas strong.") +
    (studyPlan ? planText(studyPlan) : "");
}

const needsReviewNote = (missedTopics: ReadonlyArray<string>) => `${NEEDS_REVIEW}${missedTopics.slice(0, 8).join(", ")}`;

// Update knowledge files after a quiz or promotion test completes (no LLM call — direct write).
// Returns the study log line it wrote.
export async function updateKnowledgeAfterQuiz(
  courseId: string,
  score: number,
  totalQuestions: number,
  missedTopics: string[],
  studyPlan: string | null,
  levelTest: boolean,
  _config?: LLMConfig,
): Promise<string> {
  const instructions = await getTutorInstructions(courseId);
  const currentStudyLog = (instructions["study_log"] ?? "").trim();
  const currentKnowledgeMap = (instructions["knowledge_map"] ?? "").trim();

  const quizEntry = quizLogEntry(new Date().toLocaleDateString(), logLabel(levelTest), score, totalQuestions, missedTopics, studyPlan);

  const logLines = currentStudyLog.split("\n").filter((l) => l.trim());
  logLines.push(quizEntry);
  await saveTutorInstruction(courseId, "study_log", logLines.slice(-3).join("\n"));

  if (missedTopics.length > 0) {
    const gapNote = needsReviewNote(missedTopics);
    const updatedMap = currentKnowledgeMap ? `${currentKnowledgeMap}\n${gapNote}` : gapNote;
    await saveTutorInstruction(courseId, "knowledge_map", updatedMap.slice(-500));
  }
  return quizEntry;
}

/**
 * A failed level test's study plan, added to the line updateKnowledgeAfterQuiz wrote for the test once
 * the plan is ready. Only while that line is still in the log as written: a mark made in the meantime
 * rewrote it (reviseQuizLog), and the plan was written for the old misses.
 */
export async function addStudyPlanToLog(courseId: string, entry: string, studyPlan: string): Promise<void> {
  const lines = ((await getTutorInstructions(courseId))["study_log"] ?? "").split("\n");
  const i = lines.lastIndexOf(entry);
  if (i < 0 || entry.includes(STUDY_PLAN)) return;
  lines[i] = entry + planText(studyPlan);
  await saveTutorInstruction(courseId, "study_log", lines.join("\n"));
}

export interface QuizLogFacts {
  score: number;
  /** The subtopic of every wrong answer, as updateKnowledgeAfterQuiz takes them. */
  missedTopics: string[];
}

const sameTopics = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

/**
 * A finished attempt's study log line and "Needs review" note, written again after a hand mark changed
 * its score or its wrong answers (finish-effects.ts recountAfterMarks). The line is found by its date
 * (finishedOn, the local date the attempt finished), its name and old score; the note by its old
 * subtopics. A level test's line written before level tests had their own name says "Quiz", so that is
 * looked for when no "Level test" line is there, and the rewritten line keeps the name it had. One no
 * longer there (the log keeps 3 lines, a chat reflection rewrites the map) is left alone, never added
 * again. A study plan on the line stays only when keepPlan says the wrong answers did not change: it was
 * written for them, and no model is asked again.
 */
export async function reviseQuizLog(courseId: string, levelTest: boolean, finishedOn: string, before: QuizLogFacts, after: QuizLogFacts, keepPlan: boolean): Promise<void> {
  const instructions = await getTutorInstructions(courseId);

  const logLines = (instructions["study_log"] ?? "").split("\n");
  const labels: LogLabel[] = levelTest ? ["Level test", "Quiz"] : ["Quiz"];
  const found = labels
    .map((label) => ({ label, head: quizLogHead(finishedOn, label, before.score) }))
    .map((h) => ({ ...h, at: logLines.map((l) => l.startsWith(h.head)).lastIndexOf(true) }))
    .find((h) => h.at >= 0);
  if (found) {
    const { label, head, at } = found;
    const line = logLines[at];
    const count = /^\((\d+) questions\)/.exec(line.slice(head.length))?.[1];
    const plan = line.indexOf(STUDY_PLAN);
    if (count) {
      const studyPlan = keepPlan && plan >= 0 ? line.slice(plan + STUDY_PLAN.length) : null;
      logLines[at] = quizLogEntry(finishedOn, label, after.score, Number(count), after.missedTopics, studyPlan);
      await saveTutorInstruction(courseId, "study_log", logLines.join("\n"));
    }
  }

  if (before.missedTopics.length === 0 || sameTopics(before.missedTopics, after.missedTopics)) return;
  const mapLines = (instructions["knowledge_map"] ?? "").split("\n");
  const old = before.missedTopics.slice(0, 8);
  const note = mapLines.map((l) => l.startsWith(NEEDS_REVIEW) && sameTopics(l.slice(NEEDS_REVIEW.length).split(", "), old)).lastIndexOf(true);
  if (note < 0) return;
  if (after.missedTopics.length > 0) mapLines[note] = needsReviewNote(after.missedTopics);
  else mapLines.splice(note, 1);
  await saveTutorInstruction(courseId, "knowledge_map", mapLines.join("\n"));
}

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

// The study log within its budget. Every writer appends the newest line at the end, so whole lines are
// kept from the end back, oldest first as stored. A newest line longer than the budget on its own keeps
// its start (the date, the name and the score), cut there.
function newestLines(log: string, budget: number): string {
  const lines = log.split("\n").filter((l) => l.trim());
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = lines[i].length + (kept.length > 0 ? 1 : 0);
    if (used + cost > budget) break;
    kept.unshift(lines[i]);
    used += cost;
  }
  if (kept.length > 0) return kept.join("\n");
  const newest = lines[lines.length - 1] ?? "";
  return newest.slice(0, budget) + "...";
}

// Read all 4 knowledge types and return a single prompt section (capped at 1500 chars)
export async function getKnowledgeSummary(courseId: string): Promise<string> {
  const instructions = await getTutorInstructions(courseId);

  const sections: string[] = [];
  for (const type of KNOWLEDGE_TYPES) {
    const content = (instructions[type] ?? "").trim();
    if (!content) continue;
    const budget = BUDGETS[type];
    const truncated = type === "study_log" ? newestLines(content, budget) : content.length > budget ? content.slice(0, budget) + "..." : content;
    const label = type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    sections.push(`**${label}:**\n${truncated}`);
  }

  return sections.join("\n\n");
}

// Merge a concise note into the knowledge_map file (append + tail-cap to its budget). This is the
// explicit, mid-conversation path the tutor uses via the knowledge.update_map tool — the model
// supplies the already-distilled note, so no second LLM call is needed (unlike the holistic
// post-turn reflection in updateKnowledgeFiles below).
export async function recordKnowledgeNote(courseId: string, note: string): Promise<void> {
  const trimmed = note.trim();
  if (!trimmed) return;
  const instructions = await getTutorInstructions(courseId);
  const current = (instructions["knowledge_map"] ?? "").trim();
  const merged = current ? `${current}\n${trimmed}` : trimmed;
  await saveTutorInstruction(courseId, "knowledge_map", merged.slice(-BUDGETS.knowledge_map));
}

/**
 * How long the post-turn reflection may run before it is dropped. On a CPU-only PC Ollama answers one
 * request at a time, so a reflection still running holds the learner's next reply behind it.
 */
export const REFLECTION_TIMEOUT_MS = 60_000;
/**
 * Most tokens the reflection may write: four values of under 400 characters (about 100 tokens each) and
 * their keys. A reply cut here is not valid JSON and writes nothing. It is the bound that holds even when
 * an aborted request leaves Ollama generating (llm.ts ollamaOptions).
 */
export const REFLECTION_MAX_TOKENS = 512;

// Background reflection: update knowledge files after a chat exchange.
// It never delays the learner: `signal` (ChatTab aborts it when the next turn starts or the chat closes),
// REFLECTION_TIMEOUT_MS and REFLECTION_MAX_TOKENS bound it, and a stopped or failed one writes nothing.
// It is the tutor updating its notes on its own, so it obeys the "Update knowledge map" permission: Deny
// writes nothing. It cannot stop to ask after every reply, so Ask lets it run (Settings › Tutor Permissions says
// so on that row).
export async function updateKnowledgeFiles(
  courseId: string,
  userMessage: string,
  assistantResponse: string,
  config: LLMConfig,
  mode: PermissionMode = "default",
  signal?: AbortSignal,
): Promise<void> {
  if (evaluatePermission(KNOWLEDGE_UPDATE, mode, await loadPermissionRules()) === "deny") return;
  const instructions = await getTutorInstructions(courseId);
  if (signal?.aborted) return;

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

  // A plain controller and timer (as kernel/gloss.ts), not AbortSignal.any/timeout.
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, REFLECTION_TIMEOUT_MS);
  let response: string;
  try {
    response = await callLLM([{ role: "user", content: prompt }], config, {
      signal: controller.signal,
      numPredict: REFLECTION_MAX_TOKENS,
    });
  } catch {
    return; // knowledge file updates are best-effort
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
  if (controller.signal.aborted) return;

  // Arrays and objects become the file's text instead of being dropped (knowledge-reflect.ts).
  const files = parseReflection(response);
  // The misconceptions file is permanent tutor context, so it is written only when the tutor's reply
  // shows the learner was wrong. On a confirmed answer the model invents one ("Corrected
  // misconception: ...") about as often as not.
  if (files.misconceptions && !tutorCorrectedLearner(assistantResponse)) delete files.misconceptions;
  // A template blank the model copied in ("[Current Date]") gets the date the quiz lines use, or goes.
  const today = new Date().toLocaleDateString();
  for (const type of KNOWLEDGE_TYPES) {
    const text = files[type];
    if (text) files[type] = withoutBlanks(text, today) || undefined;
  }
  // The study log is appended to, never replaced, so the quiz-score line survives.
  if (files.study_log) files.study_log = appendStudyLog(instructions["study_log"] ?? "", files.study_log);

  for (const type of KNOWLEDGE_TYPES) {
    const text = files[type];
    if (text) await saveTutorInstruction(courseId, type, text);
  }
}
