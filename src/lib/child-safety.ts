// Child safety in the tutor chat, decided by code with no model call. Pure module (no Tauri, no DOM),
// tested in child-safety.test.ts and called unchanged by grade.ts and ChatTab.
//
// Two parts:
// 1. CHILD_SAFETY_RULES, a short section for the tutor's system prompt. grade.ts adds it whenever the
//    learner has a grade (K-12) set, and on any turn whose message trips isSafetyDisclosure, grade or
//    not. Every other turn with no grade stays byte-identical (systemPrompt-master.test.ts pins that).
// 2. isSafetyDisclosure, a check of a student's chat message for self-harm, suicide and abuse
//    disclosures. A match shows SAFETY_NOTICE under that message. A notice, never a block: the tutor
//    turn still runs, always with CHILD_SAFETY_RULES, so the child is not met with silence. Like health-notice.ts, a deterministic list is auditable and costs nothing on a CPU box.
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
  "parent, teacher or school counselor, right away. If you are in danger right now, call 911. In the " +
  "US you can call or text 988 (Suicide & Crisis Lifeline), or call 1-800-422-4453 (Childhelp " +
  "National Child Abuse Hotline), any time, day or night.";

// Lower-case phrases, matched as whole words at both ends: "hurt myself" does not match inside a longer
// word. A trailing "*" makes an entry a stem that matches at the start of a word: "suicid*" catches
// suicide and suicidal.
// Kept to first-person and disclosure wording on purpose, so schoolwork does not trip it: "kill the
// process", "the character died", "cut the fraction", "my brother beats me at chess". Bare "kill",
// "die", "cut", "abuse" (substance abuse, abuse of power) and "beats me" are left out for that reason.
// "Hits me", "hurts me", "touched me" and the like are not phrases either ("the poem touched me", "a
// wave hits me", "my hand hurts me"): ABUSE_RE below matches them only after a person as the subject.
// "suicid*" is the one bare topic word kept: a literature lesson about a character's suicide shows the
// notice, which is the cheap side of the trade. child-safety.test.ts lists the other known, accepted
// false positives.
const PHRASES = [
  // Suicide and wanting to die
  "suicid*", "kill myself", "killing myself", "kill my self", "end my life", "ending my life",
  "take my own life", "taking my own life", "want to die", "wanna die", "want to be dead",
  "wish i was dead", "wish i were dead", "wish i was never born", "better off dead",
  "better off without me", "don't want to live", "dont want to live", "don't want to be alive",
  "dont want to be alive", "do not want to live", "do not want to be alive", "don't wanna live",
  "dont wanna live", "don't wanna be alive", "dont wanna be alive", "wanna be dead", "rather be dead",
  "wish i could die", "wish i wasn't alive", "wish i had never been born", "wish i'd never been born",
  "if i died", "end it all", "no reason to live", "unalive*",
  // Self-harm
  "hurt myself", "hurting myself", "harm myself", "harming myself", "cut myself", "cutting myself",
  "hurt my self", "harm my self", "cut my wrist*", "self-harm*", "self harm*", "selfharm*",
  // Abuse disclosures. Someone hitting, hurting or touching the child is ABUSE_RE's job.
  "beat me up", "beats me up", "abuses me", "abused me", "abusing me", "being abused", "molest*",
  "raped", "rape me", "rapes me", "sexually abused", "not safe at home", "scared to go home",
  "afraid to go home",
];

// A person doing something to the child, or to their family: "my dad hit me", "he touches my private
// parts", "my stepdad hurts my sister". The subject has to be a person (a family member, a grown-up,
// he/she/they/someone), which keeps "the poem touched me" and "a wave hits me" out. Only "beat" takes a
// games exclusion (see BEAT); "kicked me off the team" and "kicked us out" are dropped for every verb.
// Known, accepted miss the other way: "he hit me with a great idea" fires.
const WHO =
  "(?:(?:(?:my|our) )?(?:step[ -]?|foster )?(?:dad|daddy|papa|father|mom|mommy|mama|mum|mother|parents?|uncle|aunt|grandpa|" +
  "grandma|grandfather|grandmother|brother|sister|cousin|teacher|coach|babysitter|neighbou?r|boyfriend|girlfriend)" +
  "(?:'s (?:boyfriend|girlfriend|friend))?|he|she|they|someone|somebody|a grown-?up|an adult)(?:'s|'re)?";
const FILL = "(?: (?:always|often|keeps?|sometimes|just|is|was|are|were|has|have|had|been|would|will|used to)){0,3}";
const OBJ = "(?:me|us|my (?:(?:little|big|baby|older|younger) )?(?:mom|mum|mother|dad|father|sister|brother|private\\w*))";
const ACT =
  "(?:hit|hits|hitting|hurt|hurts|hurting|punch(?:es|ed|ing)?|slap(?:s|ped|ping)?|smack(?:s|ed|ing)?|" +
  "spank(?:s|ed|ing)?|kick(?:s|ed|ing)?|whip(?:s|ped|ping)?|chok(?:es|ed|ing)|touch(?:es|ed|ing)?|abus(?:es|ed|ing))";
// "beat" is the games verb ("beat me at chess", "beat us by 3", "beat us 3-0", "beat me to it"), so only
// it takes the follow-word exclusion. "hit me in the face" and "hits me at night" must fire.
const BEAT = "(?:beat|beats|beating)";
const END = "(?![\\p{L}\\p{N}])";
const ABUSE_RE = new RegExp(
  "(?<![\\p{L}\\p{N}])" + WHO + FILL + " (?:" + ACT + " " + OBJ + END + "(?! (?:off|out) )|" +
    BEAT + " " + OBJ + END + "(?! (?:at|in|by|to|again at|\\d)))",
  "u",
);
// "kms" is also kilometres ("5 kms", "miles to kms"): it counts only as the whole message (with chat
// filler) or right after a first-person lead-in.
const KMS_RE =
  /^kms(?: (?:lol|lmao|rn|fr|bruh|omg))*[.!?]*$|(?<![\p{L}\p{N}])(?:i|i'll|ill|i'm|im|gonna|imma|ima|wanna|want to|going to|might|should|just) kms(?![\p{L}\p{N}])/u;

function normalise(s: string): string {
  // Apostrophes first: NFKC turns "´" into a space and a combining accent.
  return s.replace(/[‘’ʼ`´]/g, "'").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
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
  if (ABUSE_RE.test(text) || KMS_RE.test(text)) return true;
  return PHRASES.some((entry) => {
    const stem = entry.endsWith("*");
    const phrase = stem ? entry.slice(0, -1) : entry;
    for (let i = text.indexOf(phrase); i !== -1; i = text.indexOf(phrase, i + 1)) {
      if (startsWord(text, i) && (stem || endsWord(text, i + phrase.length))) return true;
    }
    return false;
  });
}
