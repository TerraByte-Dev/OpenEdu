// Golden conversations — the regression bar v2 must clear, phase by phase (V2_ARCHITECTURE.md §9).
//
// Each golden is a fixed sequence of user turns plus a heuristic success() over the transcript.
// Validators are intentionally coarse — they catch GROSS regressions (wrong answer, broken mode
// switch, LaTeX leaking past the plain-text lock), not subtle quality drift. They grow sharper
// and more numerous as phases land. Phase 0 ships 5 to establish a baseline against v1.

import type { TutorModeId } from "../tutor-modes";
import type { Syllabus, LLMConfig } from "../../types";
import { importTextAsNote } from "../notebook";
import { ensureCourse, deleteCourse } from "../db";

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
  // Optional async setup run once before the turns (tool goldens only) — e.g. seed notebook docs.
  setup?: (config: LLMConfig) => Promise<void>;
  // Optional cleanup run after the turns (always, even on error) — e.g. remove a sentinel course.
  teardown?: (config: LLMConfig) => Promise<void>;
  // Phase 4b: when set, the runner resolves this sprite's persona and overrides the identity slot
  // (the <persona> path). Proves persona is prompt-only and doesn't change correctness.
  spriteId?: string;
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

export const GOLDENS: Golden[] = [
  {
    id: "math-word-problem",
    title: "Math word problem — produces the correct answer (40)",
    topic: "Introductory Algebra",
    // Phase 4a: the topic routes the math-tutor domain skill, so math.render is offered. The answer
    // (40) may land in the chat text OR inside a math.render latex arg — both pass. We no longer fail
    // on backslash-LaTeX in chat: inline $…$/$$…$$ now renders (marked-katex-extension), so the old
    // plain-text-in-chat constraint was intentionally relaxed for display.
    useTools: true,
    turns: [{ user: "A train travels 60 miles in 1.5 hours. What is its average speed in miles per hour? Give the number." }],
    success: (t) => {
      const reasons: string[] = [];
      const mathArgs = t
        .flatMap((e) => e.toolCalls ?? [])
        .filter((c) => c.name === "math.render")
        .map((c) => String((c.input as { latex?: unknown })?.latex ?? ""))
        .join(" ");
      if (!/\b40\b/.test(allAssistant(t) + " " + mathArgs)) reasons.push("expected answer 40 (mph) not found in reply or math.render");
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
    // Runs under the `assess` skill — the only skill that exposes progress.mark_mastered after
    // Phase 2 gating. Proves "assess marks mastery" (the gating golden's positive half).
    turns: [{
      user: "I fully understand list comprehensions now — they completely click for me. Please record that I've mastered this subtopic.",
      mode: "assess",
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
  {
    id: "explain-no-action-tools",
    title: "Skill gating — Explain offers no action tools",
    topic: "Python Programming",
    useTools: true,
    syllabus: evalToolSyllabus(),
    // Same tempting prompt as the assess golden, but under the default "explain" skill
    // (tools_required: []). Proves gating's negative half: with no tools offered, the model cannot
    // call an action tool — even when the user explicitly asks it to record mastery.
    turns: [{
      user: "I fully understand list comprehensions now — they completely click for me. Please record that I've mastered this subtopic.",
      mode: "explain",
    }],
    success: (t) => {
      const calls = t.flatMap((e) => e.toolCalls ?? []);
      const actions = calls.filter((c) => c.name === "progress.mark_mastered" || c.name === "knowledge.update_map");
      return {
        pass: actions.length === 0,
        reasons: actions.length ? [`Explain exposed an action tool (called: ${actions.map((c) => c.name).join(", ")})`] : [],
      };
    },
  },
  {
    id: "notebook-retrieval-citation",
    title: "Notebook RAG — retrieves a fact from the student's note and answers from it",
    topic: "Python Programming",
    useTools: true,
    syllabus: evalToolSyllabus(), // course_id __eval_tooluse__ — searchNotebook scopes to it
    // Seed a real sentinel course (notes + notebook_documents FK to courses(id), so a fake id throws
    // 787) plus a note with a fact the model can't know otherwise. Clean slate each run; teardown
    // removes it. Requires the embedding model to be available.
    setup: async () => {
      await deleteCourse("__eval_tooluse__"); // clear leftovers from any crashed run
      await ensureCourse("__eval_tooluse__", "Eval (tooluse)", "Eval");
      await importTextAsNote({
        courseId: "__eval_tooluse__",
        title: "Project Glossary",
        sourceType: "note",
        text: "Project note: the internal codename for our capstone build is Zorblax, and the Zorblax constant is exactly 42.7. Keep this value handy for the final project.",
      });
    },
    teardown: async () => { await deleteCourse("__eval_tooluse__"); },
    turns: [{ user: "According to my notes, what is the value of the Zorblax constant?", mode: "explain" }],
    // Proves the RAG loop end-to-end: the tutor consults the notebook (tool call) and surfaces the
    // retrieved value. The "📓 Source:" chip is a UI concern, not in the transcript.
    success: (t) => {
      const calls = t.flatMap((e) => e.toolCalls ?? []);
      const reasons: string[] = [];
      if (!calls.some((c) => c.name === "notebook.search")) {
        reasons.push(`did not call notebook.search (called: ${calls.map((c) => c.name).join(", ") || "nothing"})`);
      }
      if (!/42\.7/.test(allAssistant(t))) reasons.push("answer did not include 42.7 from the seeded note");
      return { pass: reasons.length === 0, reasons };
    },
  },
  {
    id: "math-render",
    title: "Math rendering — routes an equation through math.render",
    topic: "Introductory Algebra", // → math-tutor domain skill offers math.render
    useTools: true,
    turns: [{ user: "Show me the quadratic formula as a rendered equation, and say what it solves.", mode: "explain" }],
    // Proves the §6.4 path: the tutor calls math.render with valid LaTeX for the equation. We assert
    // the tool fires (the goal) — not the absence of chat LaTeX, since inline math now renders.
    success: (t) => {
      const reasons: string[] = [];
      const calls = t.flatMap((e) => e.toolCalls ?? []);
      const math = calls.find((c) => c.name === "math.render");
      if (!math) reasons.push(`did not call math.render (called: ${calls.map((c) => c.name).join(", ") || "nothing"})`);
      else if (typeof (math.input as { latex?: unknown }).latex !== "string" || !(math.input as { latex?: string }).latex) {
        reasons.push("math.render called with empty/invalid latex");
      }
      return { pass: reasons.length === 0, reasons };
    },
  },
  {
    id: "diagram-render",
    title: "Diagram rendering — routes a flowchart through diagram.render",
    topic: "Python Programming", // → code-tutor domain skill offers diagram.render
    useTools: true,
    turns: [{ user: "Draw a simple flowchart of an if/else decision as a diagram." }],
    success: (t) => {
      const calls = t.flatMap((e) => e.toolCalls ?? []);
      const d = calls.find((c) => c.name === "diagram.render");
      if (!d) return { pass: false, reasons: [`did not call diagram.render (called: ${calls.map((c) => c.name).join(", ") || "nothing"})`] };
      const mermaid = (d.input as { mermaid?: unknown }).mermaid;
      const ok = typeof mermaid === "string" && mermaid.length > 0;
      return { pass: ok, reasons: ok ? [] : ["diagram.render called with empty/invalid mermaid"] };
    },
  },
  {
    id: "persona-no-regression",
    title: "Persona — an active persona identity doesn't break a correct answer",
    topic: "General Knowledge",
    // Phase 4b: the SAGE persona is active (it overrides the identity slot). Persona is prompt-only,
    // so a dead-simple factual turn must still answer correctly — a pure no-regression guard on the
    // <persona> layer. Runs on the byte-identical non-tool path (no tools needed).
    spriteId: "sage",
    turns: [{ user: "What is the capital of France? Give just the name.", mode: "explain" }],
    success: (t) => {
      const ok = /\bparis\b/i.test(allAssistant(t));
      return { pass: ok, reasons: ok ? [] : ["expected 'Paris' with persona active — the persona layer may have broken the answer"] };
    },
  },
];
