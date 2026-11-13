// Child safety in the tutor chat, decided by code with no model call. Pure module (no Tauri, no DOM),
// tested in child-safety.test.ts and called unchanged by grade.ts and ChatTab.
//
// Two parts:
// 1. CHILD_SAFETY_RULES, a short section for the tutor's system prompt. grade.ts adds it only when the
//    learner has a grade (K-12) set, so a prompt with no grade stays byte-identical
//    (systemPrompt-master.test.ts pins that).
// 2. isSafetyDisclosure, a check of a student's chat message for self-harm, suicide and abuse
//    disclosures. A match shows SAFETY_NOTICE under that message. A notice, never a block: the tutor
//    turn still runs (with CHILD_SAFETY_RULES when a grade is set), so the child is not met with
//    silence. Like health-notice.ts, a deterministic list is auditable and costs nothing on a CPU box.
//    A false positive costs one kind line of text; a miss means no notice, never a block. English only.

/** The child-safety section of the tutor's system prompt. Plain and short, for small models. */
export const CHILD_SAFETY_RULES =
  "## Safety\nThe student is a child. Never write sexual content. Never explain how to hurt yourself or " +
  "others, or how to get or use weapons, drugs or other dangerous things. Never describe violence in " +
  "graphic detail. Keep to schoolwork. If the student seems upset or unsafe, or says someone is hurting " +
  "them, answer kindly and tell them to talk to a grown-up they trust.";

/** Shown in the chat under a message that trips isSafetyDisclosure. Fixed text, never model-written. */
export const SAFETY_NOTICE =
  "You matter, and you don't have to deal with this alone. Please tell a grown-up you trust, like a " +
  "parent, teacher or school counselor, right away. In the US you can call or text 988 (Suicide & " +
  "Crisis Lifeline), or call 1-800-422-4453 (Childhelp National Child Abuse Hotline), any time, day " +
  "or night.";

// Lower-case phrases, matched as whole words at both ends: "hurt myself" does not match inside a longer
// word. A trailing "*" makes an entry a stem that matches at the start of a word: "suicid*" catches
// suicide and suicidal.
// Kept to first-person and disclosure wording on purpose, so schoolwork does not trip it: "kill the
// process", "the character died", "cut the fraction", "my brother beats me at chess". Bare "kill",
// "die", "cut", "abuse" (substance abuse, abuse of power) and "beats me" are left out for that reason.
// "suicid*" is the one bare topic word kept: a literature lesson about a character's suicide shows the
// notice, which is the cheap side of the trade.
const PHRASES = [
  // Suicide and wanting to die
  "suicid*", "kill myself", "killing myself", "kill my self", "end my life", "ending my life",
  "take my own life", "taking my own life", "want to die", "wanna die", "want to be dead",
  "wish i was dead", "wish i were dead", "wish i was never born", "better off dead",
  "better off without me", "don't want to live", "dont want to live", "don't want to be alive",
  "dont want to be alive",
  // Self-harm
  "hurt myself", "hurting myself", "harm myself", "harming myself", "cut myself", "cutting myself",
  "self-harm*", "self harm*",
  // Abuse disclosures
  "hits me", "hitting me", "beat me up", "beats me up", "hurts me", "hurting me", "abuses me",
  "abused me", "abusing me", "molest*", "touched me", "touches me", "touching me", "raped", "rape me",
  "rapes me", "sexually abused", "not safe at home", "scared to go home", "afraid to go home",
];

function normalise(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ").trim();
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
function startsWord(text: string, i: number): boolean {
  return i === 0 || !WORD_CHAR.test(text[i - 1]);
}
function endsWord(text: string, i: number): boolean {
  return i >= text.length || !WORD_CHAR.test(text[i]);
}

/** True when a student's message reads as a self-harm, suicide or abuse disclosure. */
export function isSafetyDisclosure(message: string): boolean {
  const text = normalise(message);
  if (!text) return false;
  return PHRASES.some((entry) => {
    const stem = entry.endsWith("*");
    const phrase = stem ? entry.slice(0, -1) : entry;
    for (let i = text.indexOf(phrase); i !== -1; i = text.indexOf(phrase, i + 1)) {
      if (startsWord(text, i) && (stem || endsWord(text, i + phrase.length))) return true;
    }
    return false;
  });
}
