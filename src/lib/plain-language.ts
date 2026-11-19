// Plain-language copy for learner-facing surfaces. The pipeline and the tool layer speak in ids
// ("syllabus_L3", "notebook.search") because code needs stable names; a learner never should see
// them. Everything here is a pure map from an id to a sentence a parent or a kid can read. Pure
// module (no DOM, no Tauri) so the UI stays a thin shell and the copy is unit-tested.

import { defaultOllamaModelForRam } from "./models";
import { OLLAMA_ADDRESS_NOT_ALLOWED } from "./ollama-guide";

// courses.generation_state → what is still being built. `null` and "completed" mean nothing is
// pending; callers already branch on that, so they get a neutral sentence here.
export function describeGenerationState(state: string | null | undefined): string {
  if (!state || state === "completed") return "Your course is ready.";
  if (state.startsWith("failed:")) return describeGenerationState(state.slice("failed:".length));
  const level = /^syllabus_L(\d)$/.exec(state);
  if (level) {
    const n = Number(level[1]);
    return n === 6 ? "Your course still needs its final exam." : `Your course still needs Level ${n}.`;
  }
  switch (state) {
    case "researching":  return "Your course is still being researched.";
    case "outlining":    return "Your course is still being planned.";
    case "instructions": return "Your tutor is still being set up.";
    case "mastery":      return "Your course still needs its final exam.";
    default:             return "Your course is not finished building yet.";
  }
}

// A tool id → what the tutor is asking to do with it, for the Allow / Don't allow card. Grouped by
// the id's namespace so a new tool in a known family reads correctly without a copy change.
export function describeToolRequest(toolName: string): string {
  const [family, action = ""] = toolName.split(".", 2);
  switch (family) {
    case "notebook":
      return action === "ingest" ? "Your tutor wants to add something to your notes."
                                 : "Your tutor wants to look through your notes.";
    case "library":    return "Your tutor wants to look something up in the library.";
    case "web":        return "Your tutor wants to look something up on the internet.";
    case "flashcard":  return "Your tutor wants to make you a flashcard.";
    case "progress":   return "Your tutor wants to save your progress on a topic.";
    case "knowledge":  return "Your tutor wants to update its notes about how you learn.";
    case "code":       return "Your tutor wants to run a small piece of code.";
    case "math":       return "Your tutor wants to work out some math.";
    case "diagram":    return "Your tutor wants to draw a diagram.";
    default:           return `Your tutor wants to use ${humanizeId(toolName)}.`;
  }
}

/** The Allow / Don't allow card's question, shown and read aloud (speech.ts chatCardSpeech). */
export function confirmCardQuestion(toolName: string): string {
  return `${describeToolRequest(toolName)} Is that okay?`;
}
/** The Allow / Don't allow card's two buttons, in the order shown and read aloud. */
export const CONFIRM_CHOICES = { yes: "Yes, go ahead", no: "No, not now" } as const;

// "knowledge.update_map" → "knowledge update map": the last-resort reading of an unknown id.
function humanizeId(id: string): string {
  return id.replace(/[._]+/g, " ").trim();
}

// What a running tool chip says while the tutor works. The tool's own progress text can carry ids
// (`looking up "x" in periodic_table…`), so the chip never shows it.
export function describeToolActivity(toolName: string): string {
  const [family, action = ""] = toolName.split(".", 2);
  switch (family) {
    case "notebook":   return action === "ingest" ? "Saving to your notes…" : "Looking through your notes…";
    case "library":    return "Looking it up in the library…";
    case "web":        return "Looking it up on the internet…";
    case "flashcard":  return action === "review_due" ? "Checking your flashcards…" : "Making a flashcard…";
    case "progress":   return "Checking your progress…";
    case "knowledge":  return "Checking its notes about how you learn…";
    case "study_plan": return "Checking your study plan…";
    case "quiz":       return "Making a quiz…";
    case "code":       return "Running a small piece of code…";
    case "math":       return "Working out some math…";
    case "diagram":    return "Drawing a diagram…";
    case "ask_user":   return "Waiting for your answer…";
    default:           return "Working on it…";
  }
}

// The finished chip for a tool that has no card of its own. `value` is the tool's result: a progress
// mark says what it saved, practiced or learned, in the words the "Is that okay?" card used.
export function describeToolDone(toolName: string, value?: unknown): string {
  if (toolName === "progress.mark_mastered") {
    const v = (value && typeof value === "object" ? value : {}) as { status?: unknown; title?: unknown };
    const title = typeof v.title === "string" && v.title.trim() ? v.title.trim() : "";
    const topic = title ? `“${title.length > 120 ? `${title.slice(0, 120)}…` : title}”` : "a topic";
    return `Marked ${topic} as ${v.status === "practiced" ? "practiced" : "learned"}`;
  }
  const [family, action = ""] = toolName.split(".", 2);
  switch (family) {
    case "notebook":   return action === "ingest" ? "Saved to your notes" : "Looked through your notes";
    case "library":    return "Looked it up in the library";
    case "web":        return "Looked it up on the internet";
    case "flashcard":  return "Checked your flashcards";
    case "progress":   return "Checked your progress";
    case "knowledge":  return action === "update_map" ? "Updated its notes about how you learn" : "Checked its notes about how you learn";
    case "study_plan": return "Checked your study plan";
    case "quiz":       return "Made a quiz";
    case "code":       return "Ran the code";
    case "math":       return "Worked out the math";
    case "diagram":    return "Drew a diagram";
    default:           return "Done";
  }
}

// The line under "Is that okay?": what exactly will be saved or searched, from the call's own
// arguments. A tool's description is written for the model ("Plain text only — no LaTeX"), so it is
// never shown. Empty when the arguments hold nothing a learner would recognise. `subtopics` is the
// level's syllabus, so a progress mark names the topic by its title, as the model may send the id.
export function describeToolCall(toolName: string, args: unknown, subtopics: ReadonlyArray<{ id: string; title: string }> = []): string {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const text = (k: string) => (typeof a[k] === "string" ? (a[k] as string).trim() : "");
  const clip = (s: string) => (s.length > 120 ? `${s.slice(0, 120)}…` : s);
  switch (toolName) {
    case "flashcard.create": return text("front") ? `The card: “${clip(text("front"))}”` : "";
    case "notebook.ingest":  return text("title") ? `The note: “${clip(text("title"))}”` : "";
    case "web.search":       return text("query") ? `Searching for: “${clip(text("query"))}”` : "";
    case "web.fetch":        return text("url") ? `The page: ${clip(text("url"))}` : "";
    case "progress.mark_mastered": {
      const ref = text("subtopic_id");
      if (!ref) return "";
      const topic = subtopics.find((t) => t.id === ref) ?? subtopics.find((t) => t.title.trim().toLowerCase() === ref.toLowerCase());
      return `Mark “${clip(topic?.title ?? ref)}” as ${a.status === "practiced" ? "practiced" : "learned"}`;
    }
    default:                 return "";
  }
}

// ─── Errors, in words a parent can act on ────────────────────────────────────
// The LLM layer throws messages written for a developer ("Structured output failed after 3 attempts.
// Issues: …", "done_reason=length", "run: ollama pull …"). Every screen that shows an error passes it
// through here and keeps the raw text in the log. One plain sentence, then one next step. Ollama is
// named only where the parent has to do something to it.

export interface ErrorContext {
  /** The model the failed call used, when the screen knows it. */
  model?: string;
  provider?: string;
  /** Physical RAM, so model advice never names a model this computer can't run. */
  ramBytes?: number | null;
}

// Sentences the app already writes for people (llm.ts ollamaUnreachable and networkAwareMessage).
// Matched anywhere, because the course builder wraps them ("… Reason: Ollama, the program …").
const PLAIN_SENTENCES = [
  /Ollama, the program that runs the tutor, isn't running on this computer\. Start Ollama, then try again\./,
  /Ollama isn't answering at \S+\. Check that the computer running it is on and Ollama is started\./,
  new RegExp(OLLAMA_ADDRESS_NOT_ALLOWED.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")),
  /Network error — check your internet connection and try again\./,
];

/**
 * True when a model call failed because Ollama can't be reached or doesn't have the tutor's model
 * (llm.ts ollamaUnreachable, and its 404 "Ollama model … not found"). Trying again, or another
 * question, fails the same way until someone starts Ollama or adds the model, so the work stops
 * there and friendlyError shows that sentence, never advice about the model.
 */
export function ollamaUnavailable(e: unknown): boolean {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return PLAIN_SENTENCES.slice(0, 3).some((re) => re.test(raw)) || /Ollama model "[^"]+" not found/.test(raw);
}

// llm.ts embed(): Ollama answered 404 for the embedding model (Settings › Provider & Models).
const EMBEDDER_MISSING = /embedding model "[^"]+" not found/i;

// The disk is full: SQLite's SQLITE_FULL ("database or disk is full", code 13) from a course build, a
// lesson or a saved chat reply, and the OS's own words from a file write (Windows os error 112, Linux
// and macOS os error 28). Trying again fails the same way until space is freed, so it is said plainly.
const DISK_FULL = /disk is full|SQLITE_FULL|\(code: 13\)|not enough space on the disk|os error 112|no space left on device|os error 28\b/i;
export const OUT_OF_SPACE = "This computer is out of space. Delete some files you don't need, then try again.";

/** True when a write failed because the disk is full. */
export function outOfSpace(e: unknown): boolean {
  return DISK_FULL.test(e instanceof Error ? e.message : String(e ?? ""));
}

/**
 * What the chat says when the learner's message could not be saved: it was not sent either, and the
 * words are back in the box to send again.
 */
export function messageNotSaved(e: unknown): string {
  return `Your message wasn't saved, so it wasn't sent. It's still in the box. ${outOfSpace(e) ? OUT_OF_SPACE : "Try sending it again in a moment."}`;
}

/**
 * What the notebook says above a note that could not be saved. Shown only over that note, open with its
 * unsaved words still in the editor (NotesTab won't open another note over them), beside a Save again button.
 */
export function noteNotSaved(title: string, e: unknown): string {
  const name = title.trim() ? `Your note “${title.trim()}”` : "Your note";
  return `${name} wasn't saved. Your words are still here. ${outOfSpace(e) ? OUT_OF_SPACE : "Press Save again in a moment."}`;
}

/**
 * Said under the safety notice while a Notebook folder's new name reads as a safety disclosure
 * (child-safety.ts isSafetyDisclosure, with the learner's grade). The name isn't saved: the box stays open with
 * the folder's old name kept (ported from TerraTutor #237).
 */
export const FOLDER_NAME_DISCLOSURE = "This can't be a folder name. Try other words.";

/** True when an embed failed because the embedding model isn't on this computer. */
export function embeddingModelMissing(e: unknown): boolean {
  return EMBEDDER_MISSING.test(e instanceof Error ? e.message : String(e ?? ""));
}

/**
 * True when an embed failed because notebook search can't run on this computer at all (no embedding
 * model, Ollama not answering, or the OpenAI embedder with no key or no connection), so every other note
 * would fail the same way. False for a failure that may be the one note's own.
 */
export function embedderUnavailable(e: unknown): boolean {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return ollamaUnavailable(raw) || EMBEDDER_MISSING.test(raw) || /OpenAI API key not set|Cannot reach OpenAI to embed/.test(raw);
}

export function friendlyError(e: unknown, ctx: ErrorContext = {}): string {
  const raw = (e instanceof Error ? e.message : String(e ?? "")).trim();

  for (const re of PLAIN_SENTENCES) {
    const m = re.exec(raw);
    if (m) return m[0];
  }
  if (DISK_FULL.test(raw)) return OUT_OF_SPACE;
  // llm.ts friendlyHttpError: the cloud key and plan cases are already sentences with a next step.
  if (/^(Invalid API key|Rate limit hit|Access denied) \(/.test(raw) || /is having server issues \(\d+\)/.test(raw)) return raw;
  if (/^Model not found \(/.test(raw)) {
    return "The model picked in Settings isn't available any more. Open Settings and pick another one.";
  }
  if (EMBEDDER_MISSING.test(raw)) {
    return "Searching notes by meaning isn't set up on this computer yet; they're still searched by their words. Open Settings to add it.";
  }
  const missing = /model "([^"]+)" not found/i.exec(raw);
  if (missing) {
    return `The tutor's model (${missing[1]}) isn't on this computer yet. Open Settings to pick one that is, or import it from a USB stick.`;
  }
  if (/did not finish loading/i.test(raw)) return MODEL_LOAD_TIMED_OUT;
  if (/timed out after|did not respond within/i.test(raw)) {
    return "The tutor took too long to answer. Try again — the first try after the computer starts is often the slowest.";
  }
  if (/done_reason=length|context (window|limit)/i.test(raw)) {
    return "That was too much for the tutor to take in at once. Try again with a shorter topic, or start a new chat.";
  }
  if (/Structured output failed|valid JSON|no valid questions|subtopic expansions failed|outline (missing|not found)|Course outline missing/i.test(raw)) {
    const advice = modelAdvice(ctx);
    return `The tutor couldn't put this together this time. Try again.${advice ? ` ${advice}` : ""}`;
  }
  if (/^Unknown provider/i.test(raw)) return "No tutor is picked in Settings. Open Settings and choose one.";
  if (/^No active learner/i.test(raw)) return "Pick who is learning first, then try again.";
  if (/API key not set/i.test(raw)) return "Add your API key in Settings, then try again.";
  if (/requires more system memory|out of memory/i.test(raw)) {
    return "This computer doesn't have enough free memory for the tutor right now. Close other programs, then try again.";
  }
  if (/^Ollama (error\b|returned no response|stream error)/i.test(raw)) {
    return "The tutor ran into a problem. Try again. If it keeps happening, close Ollama and start it again.";
  }
  return "Something went wrong. Try again in a moment.";
}

// Advice to switch models, only when it can help: a local model, and a different one that suits this
// computer's memory. On an 8 GB machine that is never the 9.6 GB gemma4:e4b (models.ts).
function modelAdvice(ctx: ErrorContext): string {
  if (ctx.provider && ctx.provider !== "ollama") return "";
  if (!ctx.model || ctx.ramBytes == null) return "";
  const pick = defaultOllamaModelForRam(ctx.ramBytes);
  if (pick === ctx.model.trim().toLowerCase()) return "";
  return `If it keeps happening, switch the tutor to ${pick} in Settings. It suits this computer.`;
}

// Shown while a course build, a chat turn or quiz grading waits for the model to load (llm.ts
// warmOllamaModel): after the computer starts, after 30 minutes idle, or after a model switch. A
// CPU-only computer took 88 s to load the default model after starting up.
export const TUTOR_WARMING_UP = "Loading the learning model. On this computer that can take a minute or two.";

// A model load that ran past llm.ts OLLAMA_LOAD_TIMEOUT_MS, wherever it surfaces (the check before a
// course build, or any other call).
export const MODEL_LOAD_TIMED_OUT = "The learning model took too long to load. Close other programs, then try again.";

// Under a conversation that opens on the learner's own message with no reply saved after it: its reply
// was stopped when the chat closed while it was starting, or Ollama was not running then. With an
// "Ask again" button (UNANSWERED_ASK_AGAIN), which runs the reply to that same message.
export const UNANSWERED_TURN = "The tutor didn't answer this one.";
export const UNANSWERED_ASK_AGAIN = "Ask again";

// A chat turn the model stopped partway through (no output for too long).
export const STALLED_TURN = "The tutor stopped partway. Try again. If it keeps happening, close other programs or pick a smaller model in Settings.";

// A finished chat turn that left nothing to show (the model wrote nothing, or only tool-call text the
// kernel removed) and ran no tool. Shown and saved as the tutor's reply, so a turn is never blank.
export const MIXED_UP_REPLY = "Sorry, I got mixed up. Can you ask that again?";

// The tutor's reply when the child answered a question card and the model then wrote nothing, twice
// (TutorEngine). Keeps the child going instead of leaving them on their own answer.
export const AFTER_ANSWER_REPLY = "Thanks! Tell me a little about why you chose that, and we'll keep going.";

// The check before a course build. A model still loading into memory is not a broken one, so a
// timeout never mentions models.
export function preflightMessage(timedOut: boolean, raw: string, ctx: ErrorContext = {}): string {
  if (timedOut && /did not finish loading/i.test(raw)) return MODEL_LOAD_TIMED_OUT;
  if (timedOut) return "The tutor took too long to wake up. Try again — it is usually quicker the second time.";
  return friendlyError(raw, ctx);
}

// A model download from the setup screen. Ollama reports a missing internet connection in its own
// words ("dial tcp: lookup registry.ollama.ai …"); a parent needs to know it needs the internet.
export function friendlyDownloadError(e: unknown): string {
  const raw = (e instanceof Error ? e.message : String(e ?? "")).trim();
  if (/Ollama, the program|Ollama isn't answering/.test(raw)) return friendlyError(raw);
  if (/dial tcp|lookup |no such host|registry\.ollama|i\/o timeout|connection (refused|reset)|network|TLS handshake/i.test(raw)) {
    return "Downloading the model needs the internet, and this computer isn't connected. Connect and try again, or import the model from a USB stick.";
  }
  if (/no space|disk full|not enough space/i.test(raw)) {
    return "There isn't enough free space on this computer for the model. Free up some space, then try again.";
  }
  return "The download didn't finish. Try again, or import the model from a USB stick.";
}

// The titlebar's tutor indicator. For a local tutor it says something only when the last setup
// check found a problem: a standing green "Ollama" was drawn from Settings with no check behind it,
// and stayed green while every chat failed. A cloud provider keeps its name, so a parent can see
// that questions leave this computer.
export function tutorStatusLabel(
  provider: string,
  ollama: "ready" | "no-model" | "not-running" | "not-installed" | undefined,
): { text: string; tone: "warn" | "info" } | null {
  if (provider === "openai") return { text: "OpenAI", tone: "info" };
  if (provider === "anthropic") return { text: "Anthropic", tone: "info" };
  if (provider !== "ollama") return null;
  switch (ollama) {
    case "not-running":
    case "not-installed": return { text: "Tutor not running", tone: "warn" };
    case "no-model":      return { text: "Tutor model missing", tone: "warn" };
    default:              return null; // ready, or not checked yet: claim nothing
  }
}
