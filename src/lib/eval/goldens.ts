// Golden conversations — the regression bar v2 must clear, phase by phase (V2_ARCHITECTURE.md §9).
//
// Each golden is a fixed sequence of user turns plus a heuristic success() over the transcript.
// Validators are intentionally coarse — they catch GROSS regressions (wrong answer, broken mode
// switch, LaTeX leaking past the plain-text lock), not subtle quality drift. They grow sharper
// and more numerous as phases land. Phase 0 ships 5 to establish a baseline against v1.

import type { TutorModeId } from "../tutor-modes";
import type { Syllabus } from "../../types";

export interface GoldenTurn {
  user: string;
  mode?: TutorModeId; // tutor mode active for this turn (default "explain")
}

export interface GoldenTranscriptEntry {
  role: "user" | "assistant";
  content: string;
  mode?: TutorModeId;
  // Tool calls the assistant made this turn (Phase 1). Only populated for tool goldens, which
  // run through TutorEngine; text-only goldens leave this undefined.
  toolCalls?: Array<{ name: string; input: unknown }>;
}

export interface GoldenResult {
  pass: boolean;
  reasons: string[]; // why it failed; empty when pass
}

export interface Golden {
  id: string;
  title: string;
  topic: string; // course topic, fed to the system prompt
  turns: GoldenTurn[];
  success: (transcript: GoldenTranscriptEntry[]) => GoldenResult;
  // Phase 1: when true, the runner drives this golden through TutorEngine with tools enabled
  // (and captures tool_calls). Omitted/false → the byte-identical v1 streaming path, so the
  // 5 baseline goldens are unaffected.
  useTools?: boolean;
  // Optional seeded syllabus for tool goldens that need real subtopic ids (e.g. mark_mastered).
  syllabus?: Syllabus;
}

// A minimal in-memory syllabus for tool goldens. Its course_id doubles as the eval sentinel
// course for any DB writes the tools attempt (harmless no-ops against a course that doesn't exist).
export function evalToolSyllabus(): Syllabus {
  return {
    id: "eval-syl-1",
    course_id: "__eval_tooluse__",
    level: 1,
    title: "Python Basics",
    description: "Eval-only syllabus for tool goldens.",
    learning_objectives: ["Understand list comprehensions and loops"],
    subtopics: [
      { id: "py-listcomp", title: "List Comprehensions", key_concepts: ["comprehension", "iterable"], practice_type: "exercises", mastered: false, practiced: false },
      { id: "py-loops", title: "Loops", key_concepts: ["for", "while"], practice_type: "exercises", mastered: false, practiced: false },
    ],
    assessment_criteria: ["Can write a list comprehension"],
    estimated_hours: 2,
    generated_at: new Date().toISOString(),
  };
}

// ── transcript helpers ──
const assistantTurns = (t: GoldenTranscriptEntry[]) => t.filter((e) => e.role === "assistant").map((e) => e.content);
const allAssistant = (t: GoldenTranscriptEntry[]) => assistantTurns(t).join("\n").toLowerCase();
const lastAssistant = (t: GoldenTranscriptEntry[]) => { const a = assistantTurns(t); return a.length ? a[a.length - 1] : ""; };
// A backslash followed by a letter = a LaTeX command (\frac, \alpha…) — forbidden by the
// HANDOFF plain-text-math lock. Checked against the raw (non-lowercased) text.
const hasLatex = (t: GoldenTranscriptEntry[]) => assistantTurns(t).some((c) => /\\[a-zA-Z]/.test(c));

export const GOLDENS: Golden[] = [
  {
    id: "math-word-problem",
    title: "Math word problem — correct answer, no LaTeX",
    topic: "Introductory Algebra",
    turns: [{ user: "A train travels 60 miles in 1.5 hours. What is its average speed in miles per hour? Give the number." }],
    success: (t) => {
      const reasons: string[] = [];
      if (!/\b40\b/.test(allAssistant(t))) reasons.push("expected answer 40 (mph) not found");
      if (hasLatex(t)) reasons.push("contains backslash-LaTeX — violates the plain-text-math lock");
      return { pass: reasons.length === 0, reasons };
    },
  },
  {
    id: "code-debugging",
    title: "Code debugging — identifies the operator bug",
    topic: "Python Programming",
    turns: [{ user: "This function is supposed to add two numbers but returns wrong results:\n\ndef add(a, b):\n    return a - b\n\nWhat is the bug?" }],
    success: (t) => {
      const a = lastAssistant(t);
      const ok = /subtract|subtraction|minus|should (be|use)( a)? ?\+|\bplus\b|a \+ instead|wrong operator|`-`/i.test(a);
      return { pass: ok, reasons: ok ? [] : ["did not identify the subtraction-instead-of-addition bug"] };
    },
  },
  {
    id: "language-conjugation",
    title: "Language — present-tense conjugation",
    topic: "Beginner Spanish",
    turns: [{ user: "Conjugate the verb 'hablar' in the present tense for yo, tú, and él. List each form." }],
    success: (t) => {
      const a = allAssistant(t);
      const reasons: string[] = [];
      for (const form of ["hablo", "hablas", "habla"]) if (!a.includes(form)) reasons.push(`missing conjugation "${form}"`);
      return { pass: reasons.length === 0, reasons };
    },
  },
  {
    id: "mode-switch-socratic",
    title: "Mode switch — socratic turn asks rather than tells",
    topic: "Classical Physics",
    turns: [
      { user: "What is Newton's second law?", mode: "explain" },
      { user: "Now switch to quizzing me on it.", mode: "socratic" },
    ],
    success: (t) => {
      const last = lastAssistant(t);
      const ok = last.includes("?");
      return { pass: ok, reasons: ok ? [] : ["socratic turn did not pose a question (mode switch had no behavioral effect)"] };
    },
  },
  {
    id: "error-recovery",
    title: "Error recovery — recovers from gibberish then answers",
    topic: "Introductory Chemistry",
    turns: [
      { user: "asdfghjkl qwerty zzz" },
      { user: "Sorry, I meant: what is an atom?" },
    ],
    success: (t) => {
      const a = lastAssistant(t).toLowerCase();
      const reasons: string[] = [];
      if (!a.includes("atom")) reasons.push("did not address the corrected question");
      if (!/(smallest|element|proton|electron|nucleus|particle)/.test(a)) reasons.push("did not actually define an atom");
      return { pass: reasons.length === 0, reasons };
    },
  },
  {
    id: "tool-mark-mastered",
    title: "Tool use — marks a subtopic mastered",
    topic: "Python Programming",
    useTools: true,
    syllabus: evalToolSyllabus(),
    turns: [{
      user: "I fully understand list comprehensions now — they completely click for me. Please record that I've mastered this subtopic.",
    }],
    // Validates tool SELECTION + well-formed args (the spike measured arg fidelity; this adds
    // "picks the right tool"). Exact subtopic_id matching depends on the prompt surfacing ids, so
    // we assert the core: the right tool, a non-empty subtopic_id, and status "mastered".
    success: (t) => {
      const calls = t.flatMap((e) => e.toolCalls ?? []);
      const marked = calls.find((c) => c.name === "progress.mark_mastered");
      if (!marked) return { pass: false, reasons: [`did not call progress.mark_mastered (called: ${calls.map((c) => c.name).join(", ") || "nothing"})`] };
      const input = marked.input as { subtopic_id?: unknown; status?: unknown };
      const reasons: string[] = [];
      if (typeof input?.subtopic_id !== "string" || !input.subtopic_id) reasons.push("missing/empty subtopic_id");
      if (input?.status !== "mastered") reasons.push(`expected status "mastered", got "${String(input?.status)}"`);
      return { pass: reasons.length === 0, reasons };
    },
  },
];
