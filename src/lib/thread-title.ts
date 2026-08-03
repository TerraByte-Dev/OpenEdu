// Deriving a thread title from its first message.
//
// ChatGPT and Claude title a conversation with a model call. This does not, deliberately: on the
// hardware this app targets that is 3–8 seconds spent on a label, and the same reasoning already
// removed the per-turn knowledge-reflection call. A first message is nearly always a question about
// a thing, and the thing is usually already the subject of the sentence — so trimming the politeness
// scaffolding off the front gets you most of the way for free.
//
// Pure and Tauri-free.

/** Leading scaffolding that carries no topic. Ordered longest-first so the greedy strip works. */
const LEAD_INS = [
  "can you please help me understand",
  "could you please help me understand",
  "can you help me understand",
  "could you help me understand",
  "can you please explain",
  "could you please explain",
  "i was wondering if you could",
  "i don't really understand",
  "i dont really understand",
  "can you please tell me",
  "could you tell me about",
  "can you tell me about",
  "i need help with",
  "help me understand",
  "can you explain",
  "could you explain",
  "please explain",
  "i don't understand",
  "i dont understand",
  "tell me about",
  "what exactly is",
  "explain to me",
  "can you help",
  "i'm confused about",
  "im confused about",
  "please help me",
  "help me with",
  "explain",
  "what are",
  "what is",
  "whats",
  "what's",
  "how do i",
  "how does",
  "how do",
  "why does",
  "why is",
  "please",
];

const MAX_TITLE_CHARS = 44;

/**
 * A short human title for a thread, from the student's first message.
 *
 * Falls back to "New chat" rather than to a truncated fragment — a title that is one dangling word is
 * worse than an honest placeholder, because it looks like the feature broke.
 */
export function deriveThreadTitle(firstMessage: string): string {
  let text = firstMessage.replace(/\s+/g, " ").trim();
  // Punctuation comes off BEFORE the lead-in pass, not after: otherwise a message that is nothing but
  // scaffolding ("please?") fails the prefix test on its trailing "?" and survives as a title.
  text = text.replace(/[?!.,;:]+$/g, "").trim();
  if (!text) return "New chat";

  // Strip lead-ins repeatedly: "Can you explain what is stoichiometry" sheds two. A lead-in that
  // matches the WHOLE remaining string leaves nothing, which is the correct answer for "what is".
  let stripped = true;
  while (stripped) {
    stripped = false;
    const lower = text.toLowerCase();
    for (const lead of LEAD_INS) {
      if (lower === lead) { text = ""; stripped = false; break; }
      if (lower.startsWith(lead + " ")) {
        text = text.slice(lead.length + 1).replace(/[?!.,;:]+$/g, "").trim();
        stripped = true;
        break;
      }
    }
  }

  // Drop any "... better", "... please" tail that survived the lead-in pass.
  text = text.replace(/\s+(better|more|again|please)$/i, "").trim();
  if (!text) return "New chat";

  if (text.length > MAX_TITLE_CHARS) {
    const cut = text.slice(0, MAX_TITLE_CHARS);
    const lastSpace = cut.lastIndexOf(" ");
    text = (lastSpace > MAX_TITLE_CHARS * 0.5 ? cut.slice(0, lastSpace) : cut).trim() + "…";
  }

  // Sentence case, but never lowercase something already capitalised mid-word (an acronym, a name).
  return text.charAt(0).toUpperCase() + text.slice(1);
}
