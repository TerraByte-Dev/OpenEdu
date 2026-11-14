// Pure halves of the post-turn knowledge reflection (updateKnowledgeFiles in knowledge.ts).
//
// Two small-model failures from the B9 readiness run on gemma4:e2b (2026-11-13), both fixed in code:
//   1. The model returns a file as an array of lines or an object of labelled notes instead of a
//      string. The app wrote strings only and dropped the rest: 15 of 20 replies sent `study_log` as
//      an array, so 4 of 20 wrote everything they returned. `parseReflection` now turns arrays and
//      simple objects into the string the file holds (one note per line).
//   2. On 7 of the 10 exchanges with no mistake in them, the model wrote an invented misconception
//      ("Corrected misconception: ..." after the tutor said "Yes."). `tutorCorrectedLearner` reads
//      the opening of the tutor's reply, and the misconceptions file is written only when it shows a
//      correction. The kernel has no right/wrong signal for a chat turn, so the tutor's own reply is
//      the evidence the code can check.

import { tryParseJsonLenient } from "./json-lenient";

export const KNOWLEDGE_TYPES = ["knowledge_map", "misconceptions", "study_log", "learning_profile"] as const;
export type KnowledgeType = typeof KNOWLEDGE_TYPES[number];

/** Entries the study log keeps (updateKnowledgeAfterQuiz keeps the same number). */
export const STUDY_LOG_ENTRIES = 3;

/**
 * One knowledge file's value as text. A string as is; an array as one line per item; an object as
 * `key: value` lines. An object inside an array stays one line, its pairs joined with "; ". Numbers,
 * booleans (`"misconceptions": false`) and nesting deeper than that are dropped rather than guessed
 * at. Returns "" when nothing usable is left.
 */
export function knowledgeValueToText(value: unknown, depth = 0): string {
  if (typeof value === "string") return value.trim();
  if (depth >= 2 || value === null || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    return value
      .map((v) => knowledgeValueToText(v, depth + 1).replace(/\n/g, "; "))
      .filter(Boolean)
      .join("\n");
  }
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => {
      const text = knowledgeValueToText(v, depth + 1);
      return text ? `${k}: ${text.replace(/\n/g, "; ")}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

/** The JSON object in a reply, fenced or not, parsed leniently (LaTeX `\pi` in a string is kept). */
function parseJsonObject(raw: string): unknown {
  let jsonStr = raw.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  const start = jsonStr.indexOf("{");
  const end = jsonStr.lastIndexOf("}");
  if (start !== -1 && end !== -1) jsonStr = jsonStr.slice(start, end + 1);
  return tryParseJsonLenient(jsonStr);
}

/**
 * The files a reflection reply asks to write, each as the text to store. Unknown keys and empty
 * values are left out. Returns {} when the reply holds no JSON object.
 */
export function parseReflection(raw: string): Partial<Record<KnowledgeType, string>> {
  let parsed: unknown;
  try {
    parsed = parseJsonObject(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Partial<Record<KnowledgeType, string>> = {};
  for (const type of KNOWLEDGE_TYPES) {
    const text = knowledgeValueToText((parsed as Record<string, unknown>)[type]);
    if (text) out[type] = text;
  }
  return out;
}

/**
 * The study log after a reflection. One exchange adds one entry: the model's new lines (any the log
 * already holds are skipped, since the model is shown the log and often sends it back) joined into
 * one line, appended, and the last STUDY_LOG_ENTRIES kept. The model's text never replaces the file,
 * so the quiz-score line updateKnowledgeAfterQuiz wrote survives a chat turn.
 */
export function appendStudyLog(current: string, added: string): string {
  const lines = current.split("\n").map((l) => l.trim()).filter(Boolean);
  const entry = added.split("\n").map((l) => l.trim()).filter((l) => l && !lines.includes(l)).join(" ");
  if (entry) lines.push(entry);
  return lines.slice(-STUDY_LOG_ENTRIES).join("\n");
}

// The guard writes a child's permanent profile, so it fails closed: only a plain correction counts.
// The reply opens by confirming the learner: "Yes.", "Correct:", "Exactly right.", "Right!".
const AFFIRMATION = /^(?:yes|yep|yeah|correct|exactly|perfect|excellent|spot on|you got it|you're right|you are right|that's right|that is right|that's correct|that is correct|nice work|great job|good job|well done)\b|^right[!,.]/;
// A hedge inside that confirming sentence turns it into a correction: "Yes, but ...".
const AFFIRMATION_HEDGE = /\b(?:but|however|almost|wrong|instead)\b/;
// What a tutor says when the learner got something wrong.
const CORRECTION = new RegExp(
  [
    String.raw`\bnot quite\b`, String.raw`\bnot exactly\b`, String.raw`\bnot really\b`, String.raw`\bnot correct\b`,
    String.raw`\b(?:isn't|is not|that's not|that is not) (?:right|correct|true)\b`,
    String.raw`\bincorrect\b`, String.raw`\bwrong\b`, String.raw`(?<!common )\bmistake\b`, String.raw`\bmix(?:ed)?[ -]up\b`,
    String.raw`\bconfus`, String.raw`\bcareful\b`, String.raw`^(?:so )?close[!,.]`, String.raw`\balmost\b`,
    String.raw`\b(?:good|nice) try\b`, String.raw`\btry again\b`, String.raw`\blook again\b`, String.raw`\bcheck again\b`,
    String.raw`^no[,.!]`, String.raw`\bnope\b`, String.raw`\boops\b`,
    // A number put right: "7 + 5 is 12, not 13", "it is 42, not 24".
    String.raw`,\s*not\s+-?\d`, String.raw`\bis [^,.;!?]{1,40}, not \S`,
  ].join("|"),
);

/**
 * Whether the tutor's reply corrects the learner. Only the first two sentences are read, where a
 * tutor says right or wrong; a later "a common mistake is ..." in an explanation does not count.
 * A reply that opens by confirming the learner is not a correction unless that sentence hedges.
 */
export function tutorCorrectedLearner(tutorReply: string): boolean {
  const sentences = tutorReply
    .replace(/[*_`#>]/g, "")
    .trim()
    .toLowerCase()
    .split(/(?<=[.!?:])\s+/)
    .slice(0, 2);
  if (sentences.length === 0 || !sentences[0]) return false;
  if (AFFIRMATION.test(sentences[0])) return AFFIRMATION_HEDGE.test(sentences[0]);
  return sentences.some((s) => CORRECTION.test(s));
}
