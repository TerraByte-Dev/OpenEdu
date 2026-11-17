// Child safety in the tutor chat, decided by code with no model call. Pure module (no Tauri, no DOM),
// tested in child-safety.test.ts and called unchanged by grade.ts and ChatTab.
//
// Two parts:
// 1. CHILD_SAFETY_RULES, a short section for the tutor's system prompt. grade.ts adds it whenever the
//    learner has a grade (K-12) set, and on any turn whose message trips isSafetyDisclosure, grade or
//    not. Every other turn with no grade stays byte-identical (systemPrompt-master.test.ts pins that).
// 2. isSafetyDisclosure, a check of a student's chat message for self-harm, suicide and abuse
//    disclosures, and, for a learner with a K-12 grade set, a strong self-disclosure of a pregnancy
//    (strongPregnancy, below). A match shows SAFETY_NOTICE under that message. A notice, never a block: the tutor
//    turn still runs, always with CHILD_SAFETY_RULES, so the child is not met with silence. Like health-notice.ts, a deterministic list is auditable and costs nothing on a CPU box.
//    A false positive costs one kind line of text; a miss means no notice, never a block. English only.

import type { Grade } from "./grade";

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

// A K-12 learner who says they may be pregnant (ported from TerraTutor #158). Only a STRONG
// SELF-DISCLOSURE in the newest message counts, and only when the learner has a K-12 grade set
// (isSafetyDisclosure's grade). OpenEdu also serves adults: with no grade set this never counts, so
// nothing changes for them. A hit only ADDS what any safety disclosure gets: SAFETY_NOTICE under the
// message (it names Childhelp), and the tutor answers under CHILD_SAFETY_RULES (grade.ts already adds
// them for every K-12 learner). It never blocks or changes a turn, so a false hit costs one notice.
// Strong means the learner about themselves:
//   - the first person with the pregnancy word: "am i pregnant", "i think i'm pregnant", "i might be pregnant",
//     "could i be pregnant", "i'm (only / really / probably ...) pregnant", "i got pregnant", "he knocked me up";
//   - their own age with it: "im 14 and pregnant", "i am 13 years old and pregnant";
//   - their own missed or late period: "i missed my period", "my period is 2 weeks late";
//   - their own positive test: "my pregnancy test was positive", "i took a pregnancy test and it said
//     positive".
// The pregnancy word is read by its shape (pregnancyShape: any spelling within two edits, the short forms,
// digits for letters, letters spelled one at a time) and the pregnant-person emoji. Not strong, so no
// notice: anyone else ("my mom is pregnant", "is my goat pregnant"), "have a baby" in any form, "will i have
// babies one day", grade, Bible and story forms, "can i get pregnant from ...", and any message that names a
// story, book, movie, character or game. Strong is the learner's own real state, so it is never a food-baby
// joke ("i feel like im pregnant", a laughing emoji or "food baby" anywhere, a cue followed by "lol", "jk"
// or "haha"), words inside quotation marks or after "said", "says" or "asked", pretend play, a game, a show,
// a costume, a doll or halloween, a language lesson ("how do you say ...", "in spanish / french"), a
// hypothetical ("when i grow up", "if i were / was", "im a boy"), a school class period ("i missed my
// period on monday, what did we learn?"), or family news ("were having a baby", "im going to be a big
// sister"). The open vocabulary this leaves out (euphemisms, "i'm late", "we didn't use protection") gets no
// notice.

// Damerau-Levenshtein distance (optimal string alignment: insert, delete, change, or swap two neighbours).
function editDistance(a: string, b: string): number {
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      row.push(d);
    }
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

// The real English words inside pregnancyShape's reach that are not pregnancy words. Found by sweeping the
// bundled word list (public/wordlist/, 274,137 words); child-safety.test.ts sweeps it again and fails on any
// new one. The pregnancy words it also finds (pregnant, pregnantly, pregnancy, pregnancies, pregnance,
// pregnances, impregnant, unpregnant, preggers, preggy) keep their shape.
const NOT_PREGNANCY_SHAPE = new Set([
  "pennant", "poignant", "preenact", "preplant", "regnant", "regrant", "remnant",
  "pernancy", "pernancies", "poignancy", "poignancies", "prevenancy", "prevenancies", "regnancy", "regnancies",
  "reggo", "priggers", "proggers",
]);

/**
 * The pregnancy word by its shape, not by a list of spellings ("prenant", "pragnent" and "pregrant" each fell
 * outside a list). A lower-case word is "pregnant" when it is 7 to 10 letters and within two edits of
 * "pregnant", or a short form: "preg", "preggie(s)", or 5 to 9 letters within one edit of "preggo" (prego,
 * preggos) or "preggers" (pregers). It is "pregnancy" (the noun) when it is within two edits of "pregnancy"
 * (7-11 letters) or "pregnancies" (9-13) and closer to it than to "pregnant", or ends in "cy" or "cies".
 * Short forms get one edit, not two: two edits of a six-letter word reach ordinary words. Real words in reach
 * are never it (NOT_PREGNANCY_SHAPE). Otherwise null.
 */
export function pregnancyShape(word: string): "pregnant" | "pregnancy" | null {
  const n = word.length;
  if (n < 4 || n > 13 || NOT_PREGNANCY_SHAPE.has(word)) return null;
  if (word === "preg" || word === "preggie" || word === "preggies") return "pregnant";
  if (n >= 5 && n <= 9 && (editDistance(word, "preggo") <= 1 || editDistance(word, "preggers") <= 1)) return "pregnant";
  const adj = n >= 7 && n <= 10 ? editDistance(word, "pregnant") : 99;
  const noun = Math.min(n >= 7 && n <= 11 ? editDistance(word, "pregnancy") : 99, n >= 9 ? editDistance(word, "pregnancies") : 99);
  if (noun <= 2 && (noun < adj || /c(?:y|ies)$/.test(word))) return "pregnancy";
  return adj <= 2 ? "pregnant" : null;
}

// Every pregnancy-shaped word written as "pregnant" or "pregnancy", so the patterns below name one spelling.
// Not "prego" before sauce or pasta. Digits read as letters inside a word ("pr3gnant"), and letters spelled
// out one at a time ("p r e g n a n t", "am i p.r.e.g.n.a.n.t") are joined when the joined word has the
// shape; a single letter before the run ("i") is kept as its own word. The pregnant woman, man and person
// emoji are the word ("am i 🤰"); the breast-feeding emoji is not (a baby already born).
const SAUCE = /^ (?:sauce|pasta|spaghetti)(?![\p{L}\p{N}])/u;
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "6": "g", "9": "g" };
const SPELLED = /(?<![\p{L}\p{N}])\p{L}(?:[ .-]\p{L}(?![\p{L}\p{N}])){4,}/gu;
const PREGNANT_EMOJI = /[\u{1F930}\u{1FAC3}\u{1FAC4}]/gu;
function pregnancyWords(text: string): string {
  const joined = text.replace(PREGNANT_EMOJI, " pregnant ").replace(/\s+/g, " ").trim().replace(SPELLED, (run: string) => {
    const w = run.replace(/[ .-]/g, "");
    if (pregnancyShape(w.slice(1))) return `${w[0]} ${w.slice(1)}`;
    return pregnancyShape(w) ? w : run;
  });
  return joined.replace(/\p{L}[\p{L}\d]*/gu, (w: string, at: number) => {
    const shape = pregnancyShape(/\d/.test(w) ? w.replace(/\d/g, (d) => LEET[d] ?? d) : w);
    return shape && !SAUCE.test(joined.slice(at + w.length)) ? shape : w;
  });
}

// After pregnancyWords.
const PREG = "(?:pregnant|knocked[- ]up)";
const AGE =
  "(?:(?<!\\p{N})(?:1[0-7]|[1-9])(?!\\p{N})|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)";
const IM = "(?:i'm|im|i am)";
const ADVERB = "(?:only|just|so|really|actually|probably|maybe|possibly|definitely|still|also|now|kinda|like|totally|literally|already)";
// A cue laughed off right after it is a joke ("im pregnant lol"), not a disclosure.
const NOT_JOKE = "(?![\\s.,!?]*(?:lol|lmao|jk|j/k|ha(?:ha)+|hehe)(?![\\p{L}\\p{N}]))";
// What makes "i missed my period" a school class period: a day, the sub or class right after it, or "for"
// before anything but a length of time ("for the assembly", not "for 2 months"); or a lesson question later.
const WEEKDAY = "(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)";
const DURATION =
  "(?:(?:a|about|over|like|almost|nearly|more than) )?(?:\\d|one|two|three|four|five|six|seven|eight|nine|ten|a few|a couple|a while|a long|months?|weeks?|days?|so long|too long)";
const SCHOOL_PERIOD =
  "(?! (?:(?:on " + WEEKDAY + "|with the sub(?:stitute)?|in class)(?![\\p{L}\\p{N}])|for (?!" + DURATION + ")))" +
  "(?!.*(?:what did we learn|homework|(?:math|history|science) period))";
const STRONG_PREGNANCY = [
  // The first person with the word. Not "i feel like im pregnant" or "like i'm pregnant" (a full tummy).
  "(?:am i|(?:could|might|may) i be|i (?:might|may|could|must) be|i think (?:" + IM + "|i (?:might|may|could) be)|(?<!like )" + IM +
    "(?: " + ADVERB + ")*|i (?:got|was|became|have been|'ve been|ve been)|i'm getting|im getting) " + PREG,
  "knocked me up",
  // The child's own age with it.
  IM + " (?:only |just )?" + AGE + "(?: ?(?:years?|yrs?|yr)[- ]?old| ?y/?o)? (?:and|&) " + PREG,
  // The child's own missed or late period. Not a school period ("i missed my period 2 class", "i missed my
  // period on monday, what did we learn?").
  "(?:missed|skipped|miss|missing) my (?:last )?period" +
    "(?! ?(?:\\d|one|two|three|four|five|six|seven|eight|class\\p{L}*|block|lesson|teacher|bell|of|because|cause|bc|today|at school|in school|for class)(?![\\p{L}\\p{N}]))" +
    SCHOOL_PERIOD,
  "my period(?:'s|s| is| was| has been| seems)(?: (?:like|about|really|so|very|a|an|one|two|three|four|five|six|few|couple|of|\\d+|days?|weeks?|little|bit|lot))* (?:late|overdue)",
  // The child's own positive test.
  "my pregnancy tests? (?:(?:came back|came out|was|is|were|are|said|says|showed|shows|turned|read|reads) )+(?:[\\p{L}']+ )?positive",
  "i (?:took|did|had|got|used) (?:a |the |an |another )?(?:home )?pregnancy tests?(?: [\\p{L}'&]+){0,6}? positive",
  "i (?:got|have|had) (?:a )?positive pregnancy tests?",
].map((s) => new RegExp("(?<![\\p{L}\\p{N}])" + s + "(?![\\p{L}\\p{N}])" + NOT_JOKE, "u"));
// A message that names a story, a book, a show, a game, pretend play, a school play or a costume is never a
// strong self-disclosure ("write a story where the queen says i'm pregnant", "i got pregnant in bitlife", "in
// toca boca i am pregnant", "im playing house with my sister and im pregnant", "on a tv show a lady said am i
// pregnant?"). "play" and "show" count as nouns only ("the school play", "a tv show"), never "show me".
const FICTION_RE =
  /(?<![\p{L}\p{N}])(?:story|stories|books?|novels?|movies?|films?|poems?|chapters?|characters?|pretend\p{L}*|role ?play\p{L}*|fanfic|scripts?|playing|games?|toca(?: boca)?|gacha|bitlife|sims|minecraft|roblox|costumes?|halloween|dolls?|tv|episodes?|cartoons?|(?:school|class|church|christmas|nativity|the|a|our|my) play|play(?:ed|s)? (?:house|pretend|mom|mommy|family|doctors?|hospital|vet)|(?:tv|a|the|this|that|my|our|favou?rite) shows?)(?![\p{L}\p{N}])/u;
// Not the child's own real state, anywhere in the message: a laughing emoji or "food baby" (a
// joke: "i ate so much im pregnant 😂"), a language lesson ("how do you say i am pregnant in spanish"), or a
// hypothetical ("when i grow up could i be pregnant with twins", "if i was a seahorse dad", "im a boy, could i
// be pregnant?").
const NOT_OWN_STATE =
  /[\u{1F602}\u{1F606}\u{1F639}\u{1F923}]|(?<![\p{L}\p{N}])(?:food[- ]?bab(?:y|ies)|how do (?:you|u|i) say|(?:in|into|to) (?:spanish|french)|when i grow up|if i (?:were|was)|(?:i'm|im|i am) a boy)(?![\p{L}\p{N}])/u;
// Family news: someone else's baby ("were having a baby", "so now im going to be a cousin").
const FAMILY_NEWS =
  /(?<![\p{L}\p{N}])(?:(?:we're|were|we are) having a baby|(?:going to|gonna) be (?:a |an )?(?:big )?(?:cousin|aunt|auntie|uncle|sister|brother|sibling))(?![\p{L}\p{N}])/u;
// Someone else's words: anything inside quotation marks (an unclosed double quote runs to the end), and
// anything after "said", "says", "asked" or "asks" ("my teacher asked am i pregnant?"). Not "the test said" or
// "it said" (the child's own positive test).
const QUOTED = /"[^"]*(?:"|$)|“[^”]*(?:”|$)|(?<![\p{L}\p{N}])'.*?'(?![\p{L}\p{N}])/gu;
const REPORTED = /(?<![\p{L}\p{N}])(?<!(?:tests?|it) )(?:said|says|asked|asks)(?![\p{L}\p{N}])/u;

function strongPregnancy(text: string): boolean {
  const c = pregnancyWords(text);
  if (FICTION_RE.test(c) || FAMILY_NEWS.test(c) || NOT_OWN_STATE.test(c)) return false;
  const own = c.replace(QUOTED, " ");
  const reported = own.search(REPORTED);
  const said = reported < 0 ? own : own.slice(0, reported);
  return STRONG_PREGNANCY.some((re) => re.test(said));
}

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

/**
 * True when a student's message reads as a self-harm, suicide or abuse disclosure, or, when the learner
 * has a K-12 grade set, as a strong self-disclosure of a pregnancy (strongPregnancy). With no grade (an
 * adult, or a learner who never set one) only the first part applies.
 */
export function isSafetyDisclosure(message: string, grade: Grade | null = null): boolean {
  const text = normalise(message);
  if (!text) return false;
  if (ABUSE_RE.test(text) || KMS_RE.test(text)) return true;
  if (grade !== null && strongPregnancy(text)) return true;
  return PHRASES.some((entry) => {
    const stem = entry.endsWith("*");
    const phrase = stem ? entry.slice(0, -1) : entry;
    for (let i = text.indexOf(phrase); i !== -1; i = text.indexOf(phrase, i + 1)) {
      if (startsWord(text, i) && (stem || endsWord(text, i + phrase.length))) return true;
    }
    return false;
  });
}
