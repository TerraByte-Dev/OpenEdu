// "Raise hand": help a learner gets by tapping, never by typing (docs/ARCHITECTURE.md, "Raise hand").
//
// Each lesson carries a few "stuck points" (what a learner would tap: "What does numerator mean?") and,
// for each, three kinds of help: explain another way, a worked example, a hint. They are written by the
// model that writes the lesson, from the course topic, the syllabus subtopic and the lesson's own text
// (`buildStuckPointsPrompt`), and stored with the lesson (`lessons.help_json`, migration 21). A lesson
// written before this has none; the first Raise hand writes them the same way (curriculum.ts
// `lessonHelpFor`). Nothing the learner did or typed is ever an input, so the request is the same for
// every learner.
//
// During a session nothing calls a model: tapping reads the stored material, and `handStep` (pure) picks
// what the panel shows next. "Did this help?" answers stay in the panel's memory and are never saved or
// sent. src/components/RaiseHand.tsx draws it.

import { callLLMStructured, log } from "./llm";
import { MATH_FORMATTING_RULES } from "./formatting";
import { endsMidSentence, type LessonContent } from "./lesson-format";
import { reviewLesson } from "./content-review";
import type { LLMConfig, ModelTier } from "../types";

export const HELP_KINDS = ["another_way", "example", "hint"] as const;
export type HelpKind = (typeof HELP_KINDS)[number];

export interface StuckPoint {
  /** What the learner taps, in their own voice and short words. */
  label: string;
  another_way: string;
  example: string;
  hint: string;
}

export interface LessonHelp {
  stuck_points: StuckPoint[];
}

/** Where the panel is open. Reading a lesson starts with a new explanation; practice starts with a hint. */
export type HelpSurface = "lesson" | "practice";

export function helpOrder(surface: HelpSurface): HelpKind[] {
  return surface === "lesson" ? ["another_way", "example", "hint"] : ["hint", "another_way", "example"];
}

// ─── Words the panel shows (short, for K-2 readers too) ─────────────────────────

export const HAND_WORDS = {
  button: "Raise hand",
  title: "Your tutor",
  loading: "Getting help ready…",
  unavailable: "Help is not ready right now.",
  whichPart: "Which part?",
  pick: "What is tricky?",
  somethingElse: "Something else",
  didItHelp: "Did this help?",
  yes: "Yes",
  no: "No",
  helped: "Great! Keep going.",
  stuckAgain: "I'm stuck on something else",
  close: "Close",
  more: "Let's get more help.",
  oneMore: "Show me one more way",
  askGrownUp: "Ask a grown-up",
  typeToTutor: "Try typing to your tutor",
  readToMe: "Read it to me",
  stopReading: "Stop reading",
} as const;

export const KIND_HEADINGS: Record<HelpKind, string> = {
  another_way: "Let me say it another way.",
  example: "Here is an example.",
  hint: "Here is a hint.",
};

// ─── The panel's steps (pure) ──────────────────────────────────────────────────

export type HandState =
  | { at: "pick" }
  /** Showing help for stuck point `point`; `tried` is every kind shown so far, the last one on screen. */
  | { at: "help"; point: number; tried: HelpKind[] }
  | { at: "helped"; point: number }
  /** Two "No"s, or "Something else" (`point` null): more help, a grown-up, or typing. */
  | { at: "more"; point: number | null; tried: HelpKind[] };

export type HandEvent =
  | { type: "pick"; point: number }
  | { type: "something_else" }
  | { type: "yes" }
  | { type: "no" }
  | { type: "one_more" }
  | { type: "again" };

/** "No" twice ends the automatic next-kind and offers the other ways to get help. */
export const NOS_BEFORE_MORE = 2;

export function handStep(state: HandState, event: HandEvent, surface: HelpSurface): HandState {
  const order = helpOrder(surface);
  const untried = (tried: HelpKind[]) => order.find((k) => !tried.includes(k));
  switch (event.type) {
    case "pick":
      return { at: "help", point: event.point, tried: [order[0]] };
    case "something_else":
      return { at: "more", point: null, tried: [] };
    case "again":
      return { at: "pick" };
    case "yes":
      return state.at === "help" ? { at: "helped", point: state.point } : state;
    case "no": {
      if (state.at !== "help") return state;
      const next = untried(state.tried);
      if (state.tried.length >= NOS_BEFORE_MORE || !next) return { at: "more", point: state.point, tried: state.tried };
      return { at: "help", point: state.point, tried: [...state.tried, next] };
    }
    case "one_more": {
      if (state.at !== "more" || state.point === null) return state;
      const next = untried(state.tried);
      return next ? { at: "help", point: state.point, tried: [...state.tried, next] } : state;
    }
  }
}

export type MoreChoice = "one_more" | "ask_grown_up" | "type_to_tutor";

/** What the "more help" step offers. A grown-up is offered only where the app has one to ask. */
export function moreChoices(state: HandState, surface: HelpSurface, canAskGrownUp: boolean): MoreChoice[] {
  if (state.at !== "more") return [];
  const out: MoreChoice[] = [];
  if (state.point !== null && helpOrder(surface).some((k) => !state.tried.includes(k))) out.push("one_more");
  if (canAskGrownUp) out.push("ask_grown_up");
  out.push("type_to_tutor");
  return out;
}

// ─── Stored form ───────────────────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The stored help, or null when there is none or it is not usable. */
export function parseLessonHelp(json: string | null | undefined): LessonHelp | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as { stuck_points?: unknown };
    const points = (Array.isArray(raw?.stuck_points) ? raw.stuck_points : [])
      .map((p: Record<string, unknown>) => ({ label: str(p?.label), another_way: str(p?.another_way), example: str(p?.example), hint: str(p?.hint) }))
      .filter((p) => p.label && p.another_way && p.example && p.hint);
    return points.length ? { stuck_points: points } : null;
  } catch {
    return null;
  }
}

// ─── Writing it (one structured call, the lesson's model) ───────────────────────

export const STUCK_POINTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["stuck_points"],
  properties: {
    stuck_points: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "another_way", "example", "hint"],
        properties: {
          label: { type: "string", minLength: 6, maxLength: 60 },
          another_way: { type: "string", minLength: 40, maxLength: 600 },
          example: { type: "string", minLength: 40, maxLength: 700 },
          hint: { type: "string", minLength: 15, maxLength: 240 },
        },
      },
    },
  },
};

export const MAX_LABEL_WORDS = 8;

/** The request. Its only inputs are the course topic, the syllabus subtopic and the lesson text. */
export function buildStuckPointsPrompt(
  topic: string,
  subtopic: { title: string; key_concepts: string[] },
  lessonText: string,
): string {
  const concepts = subtopic.key_concepts.length ? subtopic.key_concepts.join(", ") : subtopic.title;
  return `A learner is reading this lesson from a course on "${topic}". When they get stuck they tap a button instead of typing. Write those buttons and the help behind each one.

## Subtopic
- Title: ${subtopic.title}
- Key concepts: ${concepts}

## The lesson
${lessonText.trim()}

## What to write
stuck_points: 3-5 places where a learner could get stuck in THIS lesson, the most common first. For each one:
- label: the button, in the learner's own voice, in short, simple words a young child can read. At most ${MAX_LABEL_WORDS} words. For example: "What does ___ mean?", "I'm stuck on the example.", "Why does this step work?"
- another_way: explain that point again, a different way than the lesson did, in 2-4 short sentences.
- example: one worked example of that point, step by step, with the answer at the end.
- hint: one short nudge that helps the learner think it through, without giving the whole answer.
Use plain, friendly words and keep every fact correct. Do not ask quiz questions.

${MATH_FORMATTING_RULES}`;
}

/** The `validate` hook: distinct, short labels and help that does not stop mid-sentence. */
export function stuckPointIssues(help: LessonHelp): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const p of help.stuck_points ?? []) {
    const key = p.label.trim().toLowerCase();
    if (seen.has(key)) issues.push(`Two stuck points have the label "${p.label.trim()}". Give each one a different label.`);
    seen.add(key);
    const words = p.label.trim().split(/\s+/).filter(Boolean).length;
    if (words > MAX_LABEL_WORDS) issues.push(`The label "${p.label.trim()}" has ${words} words. Use at most ${MAX_LABEL_WORDS} short words.`);
    for (const kind of ["another_way", "example"] as const) {
      if (endsMidSentence(p[kind])) issues.push(`The ${kind} for "${p.label.trim()}" stops mid-sentence. Finish it with a complete sentence.`);
    }
  }
  return issues;
}

/**
 * Write the stuck points for one lesson, on the model that wrote the lesson. With a Checking model
 * (`review`, content-review.ts) the help is fact-checked like the lesson, and a stuck point with a
 * flagged part is dropped. Best-effort: returns null on failure, and the lesson is kept without help.
 */
export async function writeLessonHelp(
  topic: string,
  subtopic: { title: string; key_concepts: string[] },
  lessonText: string,
  config: LLMConfig,
  tier: ModelTier,
  review: LLMConfig | null = null,
): Promise<LessonHelp | null> {
  try {
    const out = await callLLMStructured<LessonHelp>(
      [{ role: "user", content: buildStuckPointsPrompt(topic, subtopic, lessonText) }],
      config,
      // An over-long field is written again shorter, never cut: a cut worked example loses its answer.
      { schema: STUCK_POINTS_SCHEMA, toolName: "emit_stuck_points", tier, validate: stuckPointIssues, trimOverlong: false },
    );
    let help = parseLessonHelp(JSON.stringify(out));
    if (help && review) help = await withoutFlaggedHelp(topic, subtopic.title, help, review);
    return help;
  } catch (e) {
    log.warn("raise-hand", `stuck points for "${subtopic.title}" failed; the lesson is kept without them`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** The help as a lesson for the content review: part 0 names it, then three parts per stuck point. */
export function helpAsLesson(title: string, help: LessonHelp): LessonContent {
  const sections = help.stuck_points.flatMap((p) => HELP_KINDS.map((k) => ({ heading: p.label, body: p[k] })));
  return { summary: `Help for a learner who is stuck on "${title}".`, sections, key_takeaways: [] };
}

async function withoutFlaggedHelp(topic: string, title: string, help: LessonHelp, review: LLMConfig): Promise<LessonHelp | null> {
  const findings = await reviewLesson(topic, title, helpAsLesson(title, help), review);
  const bad = new Set(findings.filter((f) => f.index > 0).map((f) => Math.floor((f.index - 1) / HELP_KINDS.length)));
  const kept = help.stuck_points.filter((_, i) => !bad.has(i));
  if (bad.size) log.info("raise-hand", `"${title}": review dropped ${bad.size} stuck point(s)`);
  return kept.length ? { stuck_points: kept } : null;
}
