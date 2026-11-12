// The dictionary note on a "what does X mean" turn (issue #251; docs/BENCHMARKS.md section 3, lever 18).
//
// The thesis: deterministic code owns facts, the small model only phrases them. When the student's
// newest message explicitly asks what a word means, the kernel looks the word up in the bundled Open
// English WordNet (src/lib/dictionary.ts) and appends the entry, plus a short note, after the student's
// text, the same way and in the same place as the check-before-praise note (checkBeforePraise.ts):
// code decides when, from the message alone; no model call is added; the system prompt stays
// byte-identical; the note is not saved, because ChatTab saves what the student typed. When the word is
// not in the dictionary, or the lookup fails, the turn is sent exactly as it would be without this
// file.
//
// What fires (askedWord): the newest message's last sentence is one of
//   what does/do/did [the word] X mean          what's / whats / what is [the word] X mean
//   what's / what is the meaning|definition of [the word] X
//   meaning of X / definition of X               define X / can you define X
//   I don't know|understand|get what [the word] X means
// optionally followed by a sentence it is about ("... mean in 'we sat on the bank'", "... mean in this
// sentence: ...", "... mean here", "...: ..."), and optionally after other sentences (the context, when
// the question points at it with "here" or "in this sentence"). X is 1 to 3 words of letters,
// apostrophes and hyphens, quoted or not.
//
// What does not fire, on purpose:
//   - pronouns, determiners and deictics as X: "what does that/it/this mean", "what do you mean",
//     "what does the answer mean", "what does my teacher mean";
//   - a single letter ("what does x mean" in maths), numbers and symbols ("what does 2x / π mean");
//   - a lone function word ("what does is mean"): the lookup maps some of them to a letter;
//   - anything after X that is not a context: "what does freedom mean to you", "... mean for plants";
//   - "the meaning of life", and an X with a question word in it ("the meaning of life and why");
//   - a capitalised X unless the message quotes a sentence that uses it: "What does Frost mean in the
//     last stanza?" asks what a poet or character meant, and the lookup would give the common noun
//     ("frost", "lincoln" the sheep breed). Partial: a name asked about with a sentence that contains it
//     still fires, and a lower-case name ("what does tom mean") is not caught;
//   - an X that, somewhere in the message, touches an operator or a digit: "what does mx mean in
//     y=mx+b", "what does dy mean in dy/dx", "what does sin mean in sin(2x)" (algebra, not words).
//     Ordinal and decade endings are exempt ("what does th mean in 5th"); a unit against a number is
//     refused too ("5cm", "3pm"). "what does slope mean in y=mx+b" fires and gets its note. A bare "what
//     does mx mean" fires too; for a two-letter word typed in lower case the note drops senses whose
//     stored form is capitalised ("Mx", "Dy", "XY"), so it gets no note;
//   - "the meaning of ..." or "definition of ..." after a colon or semicolon ("Essay prompt: the
//     meaning of courage"), and "... in your own words" (an assignment, not a question);
//   - a question about another language: "what does chat mean in french", "... in Spanish class"
//     (added 2026-11-12, after the test run). The English entry for "chat" would be the wrong word.
//     "... in English" still fires: it asks for the meaning in plain words;
//   - "what is a X": a question about a thing, not a word. That is a separate, later arm (#251).

import type { DictionaryEntry, Pos } from "../dictionary";
import { POS_NAMES } from "../dictionary";
import { estTokens } from "./budget";

export interface AskedWord {
  /** The word or phrase as the student typed it, quotes removed. */
  word: string;
  /** The text the question is about, when the message gives some: the text after "in" / "here" / ":",
   *  else the text before the question. Reserved for PR 3: nothing reads it yet (the model sees the
   *  whole message), and it is not exact ("in the last stanza" comes back as "the last stanza"). */
  context?: string;
}

// ── The detector ─────────────────────────────────────────────────────────────

// Words that make X a reference to something else, not a word to look up. Checked against X's first
// word ("what does that word mean", "what does your answer mean") and against a one-word X.
const NOT_A_WORD = new Set(
  ("that this it these those they them their there here he she him her his its you your yours we us our " +
    "i me my mine what which who whom whose something anything everything nothing someone anyone everyone " +
    "somebody anybody all one ones so the a an such stuff thing things word words")
    .split(" "),
);
// Function words, refused as a one-word X: the lookup resolves several of them to a letter or a wrong
// base by suffix rules ("is" -> "i", "us" -> "u", "his" -> "hi"), and a wrong entry is worse than none.
const FUNCTION_WORD = new Set(
  ("is am are was were be been being do does did has have had of to in on at by for from with and or nor " +
    "but as if than then not no yes")
    .split(" "),
);

// Question words anywhere in X mean the question goes on past the word ("the meaning of life and why").
const QUESTION_WORD = new Set("why how when where what who which whom whose".split(" "));

const WORD = String.raw`[a-z][a-z'-]*`;
// X: 1 to 3 words, optionally in quotes or asterisks. Group "x". Lazy, so in "define bank here" or
// "meaning of bank in this sentence: ..." X is "bank" and the rest is read as the context.
const X = String.raw`["'\`*]?(?<x>${WORD}(?:\s+${WORD}){0,2}?)["'\`*]?`;
const THE_WORD = String.raw`(?:the\s+(?:word|term|phrase)\s+)?`;
// Leading chatter a student puts before the question.
const FILLER = String.raw`(?:(?:hey|hi|um+|uh+|so|ok|okay|and|but|also|wait|sorry|please|pls|plz)[,!]?\s+)*`;
// After X: a context, "please", closing punctuation, nothing else. Group "ctx" is the context text.
const TAIL = String.raw`(?:\s*(?:,\s*)?(?:(?:in|here)\b(?:\s+(?:this|that|the|my)\s+(?:sentence|story|text|book|passage|line|poem|paragraph|reading|context))?|[:–—-])\s*:?\s*(?<ctx>.+?)?)?\s*(?:,?\s*(?:please|pls|plz))?\s*[?.!]*\s*$`;

const HEADS = [
  String.raw`what\s+(?:does|do|did)\s+${THE_WORD}${X}\s+mean`,
  String.raw`what(?:'s|s|\s+is)\s+the\s+(?:meaning|definition)\s+of\s+${THE_WORD}${X}`,
  String.raw`what(?:'s|s|\s+is)\s+${THE_WORD}${X}\s+mean`,
  String.raw`(?:the\s+)?(?:meaning|definition)\s+of\s+${THE_WORD}${X}`,
  String.raw`(?:(?:can|could|would|will)\s+(?:you|u)\s+(?:please\s+)?)?define\s+${THE_WORD}${X}`,
  String.raw`i\s+(?:don't|dont|do\s+not)\s+(?:know|understand|get)\s+what\s+${THE_WORD}${X}\s+means?`,
];
// The question starts the message or follows a sentence break; it runs to the end of the message.
// A bare "meaning of" / "definition of" (HEADS[3]) is not read after a colon or semicolon, where it is
// usually a title or a prompt ("Essay prompt: the meaning of courage").
const PATTERNS = HEADS.map((h, i) => new RegExp(String.raw`(?:^|(?<=[.!?${i === 3 ? "" : ";:"}\n]))\s*${FILLER}${h}${TAIL}`, "i"));
// Maths: X written against an operator (not "*", which is markdown emphasis) or a digit somewhere
// in the message ("y=mx+b", "dy/dx",
// "sin(2x)"). Ordinal and decade endings are not maths ("5th", "21st", "1990s").
const OPERATOR_BEFORE = /[=+/^<>\d]/;
const OPERATOR_AFTER = /[=+/^<>(\d]/;
const ORDINAL_OR_DECADE = /^(?:st|nd|rd|th|s|'s)$/i;
function touchesMaths(t: string, word: string): boolean {
  const re = new RegExp(`(?<![\\p{L}])${escapeRe(word)}(?![\\p{L}])`, "giu");
  for (const m of t.matchAll(re)) {
    const before = t[m.index! - 1] ?? "";
    const after = t[m.index! + m[0].length] ?? "";
    if (/\d/.test(before) && ORDINAL_OR_DECADE.test(word)) continue;
    if (OPERATOR_BEFORE.test(before) || OPERATOR_AFTER.test(after)) return true;
  }
  return false;
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A context that is only a language other than English: "in french", "in Spanish class", "in the
// Latin language". The word is then that language's word, not the English headword.
const LANGUAGES =
  "spanish|french|latin|german|italian|portuguese|chinese|mandarin|cantonese|japanese|korean|arabic|hebrew|greek|" +
  "russian|hindi|urdu|bengali|punjabi|tagalog|filipino|vietnamese|thai|indonesian|malay|swahili|somali|amharic|" +
  "turkish|persian|farsi|dutch|swedish|norwegian|danish|finnish|polish|ukrainian|czech|hungarian|romanian|irish|" +
  "gaelic|welsh|yiddish|sanskrit|esperanto|navajo|cherokee|hawaiian|haitian creole|creole|sign language|asl";
const LANGUAGE_CONTEXT = new RegExp(`^(?:the\\s+)?(?:${LANGUAGES})(?:\\s+(?:language|class|lesson|homework|words?))?$`, "i");

const unquote = (s: string) => s.trim().replace(/^["'`*]+|["'`*]+$/g, "").trim();

/**
 * The word the student's message asks the meaning of, or null when it is not an explicit meaning
 * question (see the top of this file). `text` is the newest student message as typed.
 */
export function askedWord(text: string): AskedWord | null {
  const t = text.normalize("NFKC").replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[ \t]+/g, " ").trim();
  if (!t) return null;
  for (const re of PATTERNS) {
    const m = re.exec(t);
    if (!m?.groups) continue;
    const word = unquote(m.groups.x);
    const words = word.toLowerCase().split(/\s+/);
    if (NOT_A_WORD.has(words[0].replace(/'s$/, "")) || NOT_A_WORD.has(words[words.length - 1])) continue;
    if (words.some((w) => QUESTION_WORD.has(w))) continue;
    // "the meaning of life" is a question about life, not about the word.
    if (words.join(" ") === "life" && /meaning\s+of\s+life/i.test(m[0])) continue;
    if (words.length === 1 && (words[0].replace(/[^a-z]/g, "").length < 2 || FUNCTION_WORD.has(words[0]))) continue;
    // "in this sentence?" leaves only punctuation in ctx: no context of its own, so the text before it.
    const after = m.groups.ctx && /[\p{L}\p{N}]/u.test(m.groups.ctx) ? unquote(m.groups.ctx) : "";
    if (/\byour own words\b/i.test(after) || LANGUAGE_CONTEXT.test(after)) continue;
    const before = t.slice(0, m.index).trim();
    const context = after || before;
    if (touchesMaths(t, word)) continue;
    // A capitalised X is read as a name unless the context is a sentence that uses it.
    if (/^\p{Lu}/u.test(word) && !(context && new RegExp(`(?<![\\p{L}])${escapeRe(word)}(?![\\p{L}])`, "iu").test(context))) continue;
    return context ? { word, context } : { word };
  }
  return null;
}

// ── The note ─────────────────────────────────────────────────────────────────

/** Most senses shown per part of speech of one headword (WordNet lists a POS's senses most used first). */
export const DICTIONARY_SENSES_PER_POS = 3;
/** Most senses shown per headword. */
export const DICTIONARY_SENSES_PER_HEADWORD = 6;
/** Most senses shown in all, across the headwords lookupWord returned (it returns up to 3). */
export const DICTIONARY_MAX_SENSES = 8;
/** The entry block is cut, last sense first, until it is at most this many estTokens (at least one
 *  sense is always kept). */
export const DICTIONARY_MAX_ENTRY_TOKENS = 360;

/** Appended after the entry. Prompt-wording iteration 1 of at most 3. `{word}` is the asked word. */
export const DICTIONARY_NOTE = `<tutor_note>
The student asked what "{word}" means. Use the dictionary entry above as the source for its meaning. Explain it in words the student can understand, with one everyday example. If the student's message includes a sentence, explain only the meaning that fits that sentence, and do not list the other meanings. If none of the listed meanings fits the sentence, set them aside and say what the word means in that sentence. If there is no sentence, begin with the most common meaning, briefly. Except in that one case, do not add meanings that are not listed. Do not mention this note.
</tutor_note>`;

/** One sense as the tutor is given it: after the child-safety filter, the caps and the token budget. */
export interface Shown { form: string; pos: Pos; definition: string; example: string }

/** The entry exactly as the tutor was given it on a define turn: the headwords, in order, with only the
 *  senses that went into the note. The raw lookup is not carried, so nothing the filter or the caps
 *  removed can reach a caller (the on-screen dictionary card, #251 PR 3, reads this). */
export interface DictionaryShown {
  /** The word as the student typed it. */
  word: string;
  entries: Array<{ headword: string; via: DictionaryEntry["via"]; senses: Shown[] }>;
}

// ── Child-safety filter (lever 18; widened 2026-11-12, after the test run) ───────────────────────────
// Deterministic: regexes over WordNet's own wording plus short word lists, no model. Derived from a
// sweep of every headword; define-safety.test.ts sweeps the whole shipped dictionary through
// lookupWord and selectSenses and pins that no sense or example the filter keeps matches a broad
// unsafe check. A sense worded unlike anything here can still get through, so it stays partial.
// Leaving a sense out costs little (with nothing left the turn goes out with no note, as it would
// without the lever); showing a wrong one to a child costs a lot, so where wording is ambiguous the
// filter leaves the sense out.

/** Phrases that use "sexual" neutrally: biology, health, and sexual orientation or identity. They are
 *  taken out of a text before SENSITIVE_SENSE is tried, so "gamete" ("a mature sexual reproductive
 *  cell"), "aids" ("transmitted ... especially by sexual contact") and "straight" ("a person having a
 *  sexual orientation to persons of the opposite sex") keep those senses; any other "sexual" removes
 *  the sense ("pedophile": "an adult who is sexually attracted to children"). */
export const NEUTRAL_PHRASE = new RegExp(
  [
    "\\bsexual(?:ly)?\\s+(?:reproduc\\w*|produced|spores?|phases?|cells?|fusion|differentiation|characteristics?|development|maturity|differences|orientation|identity|identification|transmitted)\\b",
    "\\bsexual and asexual\\b", "\\bby sexual contact\\b",
    "\\bsexually attracted to (?:both sexes|(?:persons|members|people) of (?:the same|the opposite|your own) sex)\\b",
  ].join("|"),
  "gi",
);

/** Senses a child must not be shown, whatever they asked: sexual senses, and labelled slurs, insults
 *  and obscenities. The bare labels need a label noun after them ("obscene expression", "vulgar
 *  slang") or a bracket round them ("(offensive British slang)"), so "chaste", "censor", "expletive",
 *  "euphemism" and an "offensive" play in football keep their senses. */
export const SENSITIVE_SENSE = new RegExp(
  [
    // Sexual: any "sexual" left after NEUTRAL_PHRASE, and the words WordNet uses for sex acts.
    "\\bsexual\\w*",
    "\\bsex (?:acts?|organs?|appeal|toys?|objects?|symbols?|kittens?|bombs?|crimes?|offenders?|life|drive|partners?|workers?)\\b",
    "\\b(?:have|has|had|having) sex\\b", "\\bsex (?:with|without|against|for)\\b",
    "\\b(?:oral|anal|promiscuous|extramarital|illicit|unlawful|casual|kinky) sex\\b",
    "\\b(?:hetero|homo|bi)sexual (?:desires?|relations|intimacy|activity|acts?|intercourse|love)\\b",
    "\\b(?:foreplay|lovemaking|fellatio|cunnilingus|coitus|coition|sodomy|fornicat\\w*|intercourse)\\b",
    "\\b(?:erotic\\w*|porn\\w*|prostitut\\w*|brothels?|whores?|whoring|harlots?|pimps?|pimping|masturbat\\w*|copulat\\w*|ejaculat\\w*|orgasm\\w*|promiscu\\w*|semen)\\b",
    "\\b(?:incest\\w*|lust|lustful\\w*|lewd\\w*|lascivious\\w*|libid\\w*|lecher\\w*|orgy|orgies|orgiastic|aphrodisiac\\w*|voyeur\\w*|nymphomania\\w*|pa?edophil\\w*|molesters?|molestation)\\b",
    "\\b(?:virginity|deflower\\w*|hymen|nudity|x-rated|debauch\\w*|cock ring|erectile dysfunction|virility drugs?|his mistress|intimate parts|contraceptive device|condoms?)\\b",
    "\\b(?:feeling|felt|feel|get|got) horny\\b", "\\berections?\\b(?! of)",
    "\\b(?:bare|uncovered) (?:her |your |their )?breasts\\b", "\\bbreasts uncovered\\b",
    // Rape, but not the rape plant ("rapeseed": "seed of rape plants").
    "\\brap(?:e|ed|es|ing|ist|ists)\\b(?! (?:plants?|oil|seeds?)\\b)",
    // Labelled slurs, insults and obscenities.
    "\\bstreet names? for\\b",
    "\\b(?:obscene|vulgar|offensive|derogatory|pejorative|insulting|disparaging) (?:slang|terms?|names?|words?|expressions?|epithets?|references?)\\b",
    "\\b(?:a )?negative terms? for\\b", "\\b(?:ethnic|racial) slurs?\\b", "\\bterms? of abuse\\b",
    "\\([^()]*\\b(?:offensive|derogatory|slur)\\b[^()]*\\)",
    "\\b(?:now considered|regarded as) offensive\\b", "\\b(?:and|usually) pejorative\\b",
    "\\b(?:mentally retarded|retarded in intellectual development|the retarded)\\b",
    "\\b(?:nigg(?:er|a)s?|negro\\w*|faggot\\w*|fagot\\w*)\\b",
    "^a poor white person\\b",
  ].join("|"),
  "i",
);

/** Wording that is neutral on a few biology, health and identity words (ALLOWED_WORDS) and not
 *  elsewhere: genitals named outright, and a people named by a bare nickname gloss ("frog", "polack",
 *  "limey": "a person of French descent"; "chicano" keeps the same gloss). "fanny" and "crotch" lose
 *  their genital senses through SENSITIVE_SENSE ("external sex organs"). */
export const BODY_SENSE = new RegExp(
  [
    "\\b(?:genital\\w*|penis\\w*|penile|vagin\\w*|vulva\\w*|clitor\\w*|testic\\w*|testes|scrot\\w*|labia (?:majora|minora))\\b",
    "^an? (?:person|man|woman) of \\w+ descent$",
  ].join("|"),
  "i",
);

/** The allow-list: headwords whose neutral senses keep BODY_SENSE wording. They keep only those:
 *  SENSITIVE_SENSE still removes the rest ("sex" keeps "either of the two categories (male or
 *  female)" and loses "activities associated with sexual intercourse"). */
export const ALLOWED_WORDS: ReadonlySet<string> = new Set(
  ("sex male female mate mating puberty reproduction reproduce reproductive pregnant pregnancy gamete sperm " +
    "egg ovum fertilization testosterone androgen estrogen urethra psoriasis chicano").split(" ").concat("birth canal"),
);

const DRUG_NAMES = "\\b(?:amphetamines?|marijuana|marihuana|cannabis|cocaine|heroin|hashish|methamphetamine|lsd|hallucinogen\\w*)\\b";
// "medicine or narcotic" is how "drug" itself is defined, so "drug" keeps that sense.
const NARCOTIC = "(?<!medicine or )\\bnarcotics?\\b";
const DRUG_USE = [
  "\\b(?:recreational|illegal|illicit|hard|soft|street|club|psychoactive|psychedelic|narcotic) drugs?\\b",
  "\\b(?:take|takes|taking|took|do|does|doing|did|use|uses|using|inhale|snort|sell|sells|selling) (?:recreational |illegal )?drugs\\b",
  "\\b(?:induced by|under the influence of|high on|addicted to|hooked on) (?:\\w+ )?drugs?\\b",
  "\\b(?:bag|bags|packet|supply|quantity|amount) of (?:illegal )?drugs?\\b", "\\bworth of (?:a |an )?(?:illegal )?drugs?\\b",
  "\\bdrug (?:use|users?|abuse|abusers?|addicts?|addiction|dealers?|dealing|pushers?|peddl\\w*|lords?|barons?|cartels?|trafficking|habit|taking)\\b",
  "\\b(?:drugged|stoned)\\b",
];

/** A drug's name. A headword that is one keeps the senses DRUG_SENSE would remove ("cocaine",
 *  "heroin", "lsd", "narcotic" keep their entries). */
export const DRUG_NAME = new RegExp(`${DRUG_NAMES}|${NARCOTIC}`, "i");

/** A drug, or the use of drugs, named in a definition. A sense that matches is dropped unless the
 *  headword is a drug's name (DRUG_NAME): "chalk", "trip", "user", "pusher" lose their drug senses;
 *  "drug" keeps its medicine sense and loses "use recreational drugs". */
export const DRUG_SENSE = new RegExp([DRUG_NAMES, NARCOTIC, ...DRUG_USE].join("|"), "i");

/** The same in an example, except a bare "narcotic", which there is also the adjective for
 *  sleep-inducing ("a narcotic speech"): "snort" and "huff" lose their cocaine examples. */
export const DRUG_EXAMPLE = new RegExp([DRUG_NAMES, ...DRUG_USE].join("|"), "i");

/** Profanity stems and a few slurs, matched per token. A typed word or headword with such a token
 *  gives no note at all, and a definition or example with one is not shown. Innocent words that
 *  contain a stem are let through: "saltwater", "wristwatch" (twat), "swank" and "wankel" (wank),
 *  "cushitic" and "shittim" (shit), "clitic", "proclitic" and "clitoria" (clit). */
const PROFANE_TOKEN = /fuck|(?<!cu)shit(?!t(?:ah|im))|cunt|bitch|^twat|^wank(?!el)|whore|whoring|slut|dildo|^clit(?:s|oris\w*|oral\w*|oric\w*|orid\w*)?$|blowjob|porn|^nigg(?:er|a)s?$|^(?:kike|wetback|dago)s?$/;

/** Headwords that give no note at all, whether typed or reached as a form: profanity worded neutrally
 *  in WordNet, explicit words, and slurs whose other senses would pass for their meaning ("faggot",
 *  "spic"). Typed words and headwords are also refused by PROFANE_TOKEN, which covers compounds
 *  ("fuck off", "bullshit", "shithead", "bitchiness"), and by the tokens "retard" and "retarded". */
export const BLOCKED_HEADWORDS: ReadonlySet<string> = new Set(
  ("cunt cunts bitch bitches bitchy bitching bitched fuck fucks fucked fucker fuckers fucking " +
    "shit shits shitty shitting shitted twat twats retard retards retarded " +
    "blowjob wank horny sexy whore harlot pimp slut porn kinky fetish bondage orgasm erection " +
    "bugger molest dildo clit camgirl prickteaser " +
    "negro negroes negroid nigra mongoloid faggot faggots fagot fagots spic spick spik wop " +
    // Words whose only remaining senses would mislead a child who asked about the adult one ("rape"
    // would be explained as the plant): no note, so the model answers on its own.
    "rape rapes raped raping rapist rapists hooker hookers stripper strippers dyke dykes fag fags homo homos").split(" ").concat("jerk off"),
);

const tokens = (text: string) => text.toLowerCase().split(/[^a-z]+/).filter((t) => t !== "");
const profane = (text: string) => tokens(text).some((t) => PROFANE_TOKEN.test(t));

/** True when a typed word or a headword must give no note: a blocked headword, a PROFANE_TOKEN, or
 *  the token "retard" or "retarded" (the verb "retards" in a definition is left alone). */
export function blockedWord(word: string): boolean {
  const w = word.trim().toLowerCase();
  return BLOCKED_HEADWORDS.has(w) || profane(w) || tokens(w).some((t) => t === "retard" || t === "retarded");
}

/** True when a sense of `headword` with this definition may be shown to a child. */
export function childSafeSense(headword: string, definition: string): boolean {
  return safeText(headword, definition, DRUG_SENSE);
}

/** True when a kept sense's example may be quoted: the same rules with DRUG_EXAMPLE, and no word in
 *  it is a blocked headword ("feeling horny", "kinky sex"). */
export function childSafeExample(headword: string, example: string): boolean {
  return safeText(headword, example, DRUG_EXAMPLE) && !tokens(example).some((t) => BLOCKED_HEADWORDS.has(t)) && !ADULT_EXAMPLE.test(example);
}

// Example sentences that are fine as definitions elsewhere but not as a quoted example for a child
// ("her exposed breast", "on drugs"). Only the example is dropped; the sense stays.
const ADULT_EXAMPLE = /\b(?:breasts?|nude|naked|massage parlou?r|on drugs|traffic(?:ked|king)? drugs)\b/i;

function safeText(headword: string, raw: string, drug: RegExp): boolean {
  if (blockedWord(headword)) return false;
  const text = raw.replace(NEUTRAL_PHRASE, " ");
  if (SENSITIVE_SENSE.test(text) || profane(text)) return false;
  if (BODY_SENSE.test(text) && !ALLOWED_WORDS.has(headword)) return false;
  return !(drug.test(text) && !DRUG_NAME.test(headword));
}

/** The senses shown, in lookupWord's order: per headword its senses in stored order, skipping a sense
 *  whose part of speech already has DICTIONARY_SENSES_PER_POS, up to the per-headword and total caps.
 *  Left out:
 *   - the child-safety filter (childSafeSense, childSafeExample): a typed word or headword that
 *     blockedWord refuses (no note at all); a sense whose definition matches SENSITIVE_SENSE ("go" as a
 *     drug, "come" as semen, "naughty" as sexual, "fairy" as a slur), BODY_SENSE (unless the headword
 *     is in ALLOWED_WORDS) or a profanity token; a sense naming a drug or drug use (DRUG_SENSE) unless
 *     the headword is a drug's name ("chalk", "trip", "user" lose their drug senses; "cocaine" keeps
 *     its entry); and a kept sense's example if it is unsafe. A headword with nothing left gives no
 *     note;
 *   - a one-letter headword reached as a form ("vs" -> "v");
 *   - a two-letter headword reached as a form when the word has an entry of its own ("gas" -> "ga" next
 *     to "gas"); without one it stays ("went" -> "go", "ads" -> "ad");
 *   - when the student typed a two-letter word in lower case, a sense whose stored form has a capital
 *     ("Mx", "Dy", "XY", "AC"): a symbol or abbreviation, not the word asked about ("tv" keeps "tv",
 *     "cm" keeps "cm"). Longer words keep their capitalised senses ("welsh", "may", "thanksgiving"). */
export function selectSenses(
  entries: readonly DictionaryEntry[],
  typed = "",
  /** Tests only: false turns the child-safety filter off, to check that it changes no item entry. */
  childSafe = true,
): Array<{ entry: DictionaryEntry; senses: Shown[] }> {
  const out: Array<{ entry: DictionaryEntry; senses: Shown[] }> = [];
  let total = 0;
  const lowerTwoLetter = typed.length === 2 && typed === typed.toLowerCase();
  const hasExact = entries.some((e) => e.via === "exact");
  if (childSafe && blockedWord(typed)) return out;
  for (const entry of entries) {
    if (childSafe && blockedWord(entry.headword)) continue;
    if (entry.via === "form" && (entry.headword.length === 1 || (entry.headword.length === 2 && hasExact))) continue;
    if (total >= DICTIONARY_MAX_SENSES) break;
    const perPos = new Map<Pos, number>();
    const senses: Shown[] = [];
    for (const s of entry.senses) {
      if (senses.length >= DICTIONARY_SENSES_PER_HEADWORD || total >= DICTIONARY_MAX_SENSES) break;
      if (lowerTwoLetter && s.form !== s.form.toLowerCase()) continue;
      if (childSafe && !childSafeSense(entry.headword, s.definition)) continue;
      const n = perPos.get(s.pos) ?? 0;
      if (n >= DICTIONARY_SENSES_PER_POS) continue;
      perPos.set(s.pos, n + 1);
      // A kept sense's example is dropped (not the sense) if it is itself unsafe.
      const example = childSafe && !childSafeExample(entry.headword, s.example) ? "" : s.example;
      senses.push({ form: s.form, pos: s.pos, definition: s.definition, example });
      total++;
    }
    if (senses.length) out.push({ entry, senses });
  }
  return out;
}

function renderEntry(shown: DictionaryShown): string {
  const lines: string[] = [];
  let n = 0;
  for (const { headword, via, senses } of shown.entries) {
    if (via === "form") lines.push(`"${shown.word}" is a form of "${headword}".`);
    for (const s of senses) {
      n++;
      lines.push(`${n}. ${s.form} (${POS_NAMES[s.pos]}): ${s.definition}${s.example ? `. Example: "${s.example}"` : ""}`);
    }
  }
  return `<dictionary_entry source="Open English WordNet">\n${lines.join("\n")}\n</dictionary_entry>`;
}

const asShown = (word: string, picked: Array<{ entry: DictionaryEntry; senses: Shown[] }>): DictionaryShown => ({
  word,
  entries: picked.map(({ entry, senses }) => ({ headword: entry.headword, via: entry.via, senses })),
});

/**
 * The senses a define turn gives the tutor: selectSenses, then cut last sense first until the entry
 * block fits DICTIONARY_MAX_ENTRY_TOKENS (at least one sense is kept). Null when nothing is left.
 */
export function shownEntry(word: string, entries: readonly DictionaryEntry[]): DictionaryShown | null {
  let picked = selectSenses(entries, word);
  let count = picked.reduce((k, p) => k + p.senses.length, 0);
  if (count === 0) return null;
  while (estTokens(renderEntry(asShown(word, picked))) > DICTIONARY_MAX_ENTRY_TOKENS && count > 1) {
    const last = picked[picked.length - 1];
    picked = last.senses.length > 1
      ? [...picked.slice(0, -1), { ...last, senses: last.senses.slice(0, -1) }]
      : picked.slice(0, -1);
    count--;
  }
  return asShown(word, picked);
}

/** The text appended after the student's message for an entry shownEntry returned. */
export function noteFor(shown: DictionaryShown): string {
  return `${renderEntry(shown)}\n${DICTIONARY_NOTE.replace("{word}", () => shown.word)}`;
}

/**
 * The text appended after the student's message on a define turn: the entry block, then the note. Null
 * when there is nothing to show (no entries), so the turn is sent unchanged.
 */
export function dictionaryNote(word: string, entries: readonly DictionaryEntry[]): string | null {
  const shown = shownEntry(word, entries);
  return shown ? noteFor(shown) : null;
}

/** The student's message as the model sees it on a define turn. */
export function withDictionaryNote(userContent: string, note: string): string {
  return `${userContent}\n\n${note}`;
}

/** How long the kernel waits for the lookup before sending the turn without a note. The shards are
 *  bundled files, so this only matters if something is badly wrong. */
export const DICTIONARY_LOOKUP_DEADLINE_MS = 2000;

/**
 * Look `word` up and build the note, or null. Never throws and never waits past the deadline: a failed
 * or slow lookup sends the turn without a note.
 */
export async function lookupDictionaryNote(
  word: string,
  lookup: (w: string) => Promise<DictionaryEntry[]>,
  deadlineMs = DICTIONARY_LOOKUP_DEADLINE_MS,
  turnSignal?: AbortSignal,
): Promise<string | null> {
  return (await lookupDictionary(word, lookup, deadlineMs, turnSignal))?.note ?? null;
}

/** lookupDictionaryNote, plus the entry the note was built from (what the dictionary card shows). */
export async function lookupDictionary(
  word: string,
  lookup: (w: string) => Promise<DictionaryEntry[]>,
  deadlineMs = DICTIONARY_LOOKUP_DEADLINE_MS,
  turnSignal?: AbortSignal,
): Promise<{ note: string; shown: DictionaryShown } | null> {
  // The turn stops waiting at the deadline, or at once when the student presses Stop; the load itself
  // is shared and keeps going, so a slow first load still warms the cache (dictionary.ts gives up on a
  // hung file on its own timeout).
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onStop: (() => void) | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deadlineMs);
    onStop = () => resolve(null);
    turnSignal?.addEventListener("abort", onStop, { once: true });
  });
  try {
    if (turnSignal?.aborted) return null;
    const entries = await Promise.race([lookup(word), late]);
    const shown = entries ? shownEntry(word, entries) : null;
    return shown ? { note: noteFor(shown), shown } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (onStop) turnSignal?.removeEventListener("abort", onStop);
  }
}
