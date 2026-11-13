// Plain-language copy for learner-facing surfaces. The pipeline and the tool layer speak in ids
// ("syllabus_L3", "notebook.search") because code needs stable names; a learner never should see
// them. Everything here is a pure map from an id to a sentence a parent or a kid can read. Pure
// module (no DOM, no Tauri) so the UI stays a thin shell and the copy is unit-tested.

import { defaultOllamaModelForRam } from "./models";

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
    case "progress":   return "Your tutor wants to mark a topic as learned.";
    case "knowledge":  return "Your tutor wants to update its notes about how you learn.";
    case "code":       return "Your tutor wants to run a small piece of code.";
    case "math":       return "Your tutor wants to work out some math.";
    case "diagram":    return "Your tutor wants to draw a diagram.";
    default:           return `Your tutor wants to use ${humanizeId(toolName)}.`;
  }
}

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

// The finished chip for a tool that has no card of its own.
export function describeToolDone(toolName: string): string {
  const [family, action = ""] = toolName.split(".", 2);
  switch (family) {
    case "notebook":   return action === "ingest" ? "Saved to your notes" : "Looked through your notes";
    case "library":    return "Looked it up in the library";
    case "web":        return "Looked it up on the internet";
    case "flashcard":  return "Checked your flashcards";
    case "progress":   return action === "mark_mastered" ? "Marked a topic as learned" : "Checked your progress";
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
// never shown. Empty when the arguments hold nothing a learner would recognise.
export function describeToolCall(toolName: string, args: unknown): string {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const text = (k: string) => (typeof a[k] === "string" ? (a[k] as string).trim() : "");
  const clip = (s: string) => (s.length > 120 ? `${s.slice(0, 120)}…` : s);
  switch (toolName) {
    case "flashcard.create": return text("front") ? `The card: “${clip(text("front"))}”` : "";
    case "notebook.ingest":  return text("title") ? `The note: “${clip(text("title"))}”` : "";
    case "web.search":       return text("query") ? `Searching for: “${clip(text("query"))}”` : "";
    case "web.fetch":        return text("url") ? `The page: ${clip(text("url"))}` : "";
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
  /Network error — check your internet connection and try again\./,
];

export function friendlyError(e: unknown, ctx: ErrorContext = {}): string {
  const raw = (e instanceof Error ? e.message : String(e ?? "")).trim();

  for (const re of PLAIN_SENTENCES) {
    const m = re.exec(raw);
    if (m) return m[0];
  }
  // llm.ts friendlyHttpError: the cloud key and plan cases are already sentences with a next step.
  if (/^(Invalid API key|Rate limit hit|Access denied) \(/.test(raw) || /is having server issues \(\d+\)/.test(raw)) return raw;
  if (/^Model not found \(/.test(raw)) {
    return "The model picked in Settings isn't available any more. Open Settings and pick another one.";
  }
  if (/embedding model "[^"]+" not found/i.test(raw)) {
    return "Notebook search isn't set up on this computer yet, so your notes can't be searched. Open Settings to add it.";
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

// A chat turn the model stopped partway through (no output for too long).
export const STALLED_TURN = "The tutor stopped partway. Try again. If it keeps happening, close other programs or pick a smaller model in Settings.";

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
