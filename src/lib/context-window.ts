// What Settings › Models › Context window says (ProviderModels.tsx). Pure (no Tauri), so the words are
// tested against the numbers the app actually sends.
//
// The cap is not one window for everything. Tutor chat and the notes assistant use it as set
// (store.ts getChatConfig / getChatTurnConfig → getOllamaNumCtx). Lessons, quizzes, level tests, Raise
// hand, course building and the warm-up at launch use getGenerationConfig, which raises a cap below
// DEFAULT_CONTEXT_TOKENS back up to it, because course building needs that much. Ollama keeps one
// runner per model and num_ctx, so a cap below 8k, with the usual setup where chat and lessons share
// one model, reloads the model on every switch between chat and those screens.

import { DEFAULT_CONTEXT_TOKENS } from "./kernel/budget";
import { LARGE_MODEL_MIN_RAM_BYTES } from "./models";
import { APP_NAME } from "./product";

/** "8k", "16k": how the choices are labelled. */
export function contextLabel(tokens: number): string {
  return tokens >= 1024 ? `${tokens / 1024}k` : String(tokens);
}

const FLOOR = contextLabel(DEFAULT_CONTEXT_TOKENS);

/** The help under the row's label. */
export const CONTEXT_WINDOW_HELP =
  `How much the tutor can hold at once, for models on this computer (Ollama); cloud models manage their own. ` +
  `${APP_NAME} sends this size with every request, so it replaces whatever context length Ollama itself is set to. ` +
  `Tutor chat and the notes assistant use exactly this size. Lessons, quizzes, level tests and course building ` +
  `need at least ${FLOOR}: below ${FLOOR} they still use ${FLOOR}, above it they use the bigger size too. ` +
  `Bigger is not better: a larger window takes more memory and tends to make small models answer worse. ` +
  `${FLOOR} is right for almost every computer.`;

/**
 * The line under the choices for `tokens`, and whether it is a warning. `ramBytes` is this computer's
 * memory (store.ts systemMemoryBytes), null when unknown. Below LARGE_MODEL_MIN_RAM_BYTES is the 8 GB
 * class of computer, where models.ts picks the small model and the bigger window does not fit.
 */
export function contextWindowNote(tokens: number, ramBytes: number | null): { text: string; warn: boolean } {
  if (tokens < DEFAULT_CONTEXT_TOKENS) {
    const size = tokens <= 2048
      ? "Minimum: long answers in chat will be cut short."
      : "Frugal: roughly 19 messages of chat history.";
    // store.ts getOllamaNumCtx: a reload is 88 s cold on a CPU-only 8 GB computer.
    return {
      warn: true,
      text: `${size} This changes tutor chat only, and does not make ${APP_NAME} faster. Lessons, quizzes, ` +
        `level tests and course building still use ${FLOOR}, so each time the learner moves between them ` +
        `and chat, the model reloads: about a minute and a half on a computer without a graphics card. ` +
        `Choose ${FLOOR} unless only chat is used.`,
    };
  }
  if (tokens === DEFAULT_CONTEXT_TOKENS) {
    return {
      warn: false,
      text: "Recommended. Roughly 48 messages of chat history and room for a long reply. " +
        "Chat, lessons, quizzes, level tests and course building all use this size, so the model stays loaded.",
    };
  }
  // kernel/budget.ts: 8192 is about 1.1 GB of the model's working memory on a 4B model, 16384 about 2.2 GB.
  const small = ramBytes !== null && Number.isFinite(ramBytes) && ramBytes > 0 && ramBytes < LARGE_MODEL_MIN_RAM_BYTES;
  if (small) {
    const gb = Math.round(ramBytes / 1024 ** 3);
    return {
      warn: true,
      text: `Too big for this computer. It has about ${gb} GB of memory, and ${contextLabel(tokens)} needs about ` +
        `twice the working memory of ${FLOOR} for every request, chat, lessons and course building alike, so the ` +
        `model may load very slowly or not at all. Choose ${FLOOR}.`,
    };
  }
  return {
    warn: false,
    text: "Generous. More history than a small model reliably uses, and about twice the working memory of " +
      `${FLOOR}. Chat, lessons, quizzes, level tests and course building all use this size.`,
  };
}
