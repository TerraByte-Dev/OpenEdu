export type TutorModeId = "explain" | "socratic" | "quiz" | "review" | "hint";

export interface TutorMode {
  id: TutorModeId;
  label: string;
  icon: string;
  title: string;
  promptSuffix: string;
}

export const TUTOR_MODES: TutorMode[] = [
  {
    id: "explain",
    label: "Explain",
    icon: "📖",
    title: "Default teaching mode",
    promptSuffix: "",
  },
  {
    id: "socratic",
    label: "Socratic",
    icon: "🤔",
    title: "Guide with questions",
    promptSuffix: `\n\n## Current Mode: Socratic
You are in Socratic mode. Do NOT give direct explanations or answers. Instead, respond ONLY with guiding questions that lead the student to discover the answer themselves. Ask one question at a time. If the student is completely stuck, give a tiny hint in the form of another question.`,
  },
  {
    id: "quiz",
    label: "Quiz Me",
    icon: "✏️",
    title: "Assessment mode",
    promptSuffix: `\n\n## Current Mode: Assessment
You are in quiz mode. Do NOT give hints, explanations, or confirm/deny answers during questioning. Ask the student a question related to the current level's subtopics. Wait for their answer. Then evaluate it: if correct, acknowledge briefly and move on; if incorrect, explain what was wrong and why. Keep questions focused on the syllabus.`,
  },
  {
    id: "review",
    label: "Review",
    icon: "📋",
    title: "Summarize what you've learned",
    promptSuffix: `\n\n## Current Mode: Review
You are in review mode. Summarize what the student should have learned at this level so far, referencing the syllabus subtopics. Ask the student which areas feel solid and which feel shaky. Be encouraging and help them identify what to revisit before taking the promotion test.`,
  },
  {
    id: "hint",
    label: "Hint",
    icon: "💡",
    title: "Minimal nudges only",
    promptSuffix: `\n\n## Current Mode: Hint-Only
You are in hint mode. Give ONLY brief nudges — one sentence maximum. Do not explain fully. Do not solve the problem. Just give a tiny push in the right direction. If the student asks for a full explanation, remind them that hint mode gives small nudges only and they can switch modes for more detail.`,
  },
];

export function getTutorModePrompt(modeId: TutorModeId): string {
  return TUTOR_MODES.find((m) => m.id === modeId)?.promptSuffix ?? "";
}
