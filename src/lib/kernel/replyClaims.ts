// Claims a reply may not make, taken out by code as the reply streams (docs/ARCHITECTURE.md, "The answer
// check in assess mode"). Two kinds, on the turns of a mastery check (the kernel decides which):
//   - Mastery. Mastery is recorded by quiz and test scores, or by a progress.mark_mastered call the
//     learner allowed; never by the tutor saying so. A sentence claiming it ("You have mastered
//     loops.", "I will mark that as mastered.") is removed unless a mastery write succeeded earlier in
//     the same turn. Not on other turns: there the system prompt itself asks the tutor to say which
//     subtopics the record shows mastered (curriculum.ts), and a blanket rule removed true sentences.
//   - The verdict on the student's answer, on a turn the answer check gave one (answerCheck.ts): praise
//     when code says the answer is wrong or only partly right, "not quite" when code says it is right,
//     and either when code could not tell.
// The filter holds each sentence until it ends, then lets it through, trims it ("Great, but 7 x 9 is
// 63." → "7 x 9 is 63."; "Great! Now try 8 x 9" → "Now try 8 x 9"), or removes it. The first time it
// takes out a verdict claim, if the reply has not already said the true verdict, a short line saying it
// takes its place ("That's not right yet."). A question is not a claim, but the statement before it in
// the same sentence is ("Great job, can you tell me how you got 72?"). A mastery claim inside "if" or
// "once" is not one, and nothing inside a code fence or `code` is read. Text with no claim comes out
// byte for byte. An ask_user.question card is the tutor speaking too: its question and choice labels
// go through the same rules (`card`).
//
// Known limits: a claim worded outside these patterns gets through (the note the reply was given is the
// first line of defence, this is the second); a mastery claim made in the same model call as the
// mark_mastered call that saves it is removed, because the call has not run when the sentence ends.
// Besides English, only a few common Spanish and French words of praise and doubt are read.

import type { Verdict } from "./answerCheck";
import { numbersIn } from "./answerCompare";

// ── What counts as a claim ──────────────────────────────────────────────────────────────────────

/** Words between a subject and "correct"/"right" that turn the claim around. */
const TURNS_IT = /\b(?:not|never|almost|nearly|partly|partially|half)\b|n't\b/i;
/** Before the claim in its sentence: it is a condition, a doubt or an instruction, not a claim. */
const CONDITION_BEFORE = /\bnot\b|n't\b|\bnever\b|\bif\b|\bwhether\b|\bunless\b|\bmake sure\b|\bbe sure\b|\bensure\b|\bcheck that\b/i;
/** The same for mastery, which is also talked about as a goal: "once you have mastered this", "let's
 *  see how well you've mastered it". ("I can see you've mastered this" is a claim.) */
const MASTERY_CONDITION_BEFORE = /\bnot\b|n't\b|\bnever\b|\bif\b|\bwhether\b|\bunless\b|\bonce\b|\bwhen(?:ever)?\b|\buntil\b|\bafter\b|\bbefore\b|\bcheck\b|\b(?:let['’]?s|let us|to|we['’]?ll|we will|we can|you['’]?ll|you will)\s+see\b|\bgoal\b|\bhelp you\b|\bon your way\b/i;
/** "right" that is not about correctness: "the right track", "right now", "a right angle". */
const OTHER_RIGHT = /^\s*(?:track|idea|way|direction|path|steps?|place|now|away|here|there|angles?|triangles?|side|hand|of|answer\s+(?:is|was|would))\b/i;

function claimAt(re: RegExp, text: string, opts: { between?: number; other?: RegExp } = {}, before = CONDITION_BEFORE): boolean {
  for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))) {
    if (opts.between !== undefined && TURNS_IT.test(m[opts.between] ?? "")) continue;
    if (opts.other && opts.other.test(text.slice(m.index! + m[0].length))) continue;
    if (before.test(text.slice(0, m.index))) continue;
    return true;
  }
  return false;
}

// What a sentence may open with before its first word: emphasis, quotes, a bullet, "¡", an emoji.
const PICTO = String.raw`\p{Extended_Pictographic}|\uFE0F|\u200D|[\u{1F3FB}-\u{1F3FF}]`;
const OPEN = String.raw`(?:[\s*_"“'‘¡¿(#>-]|${PICTO})`;
const CLOSE = String.raw`(?:[\s*_]|${PICTO})*`;
/** Marks that say "right" or celebrate it: ✅ ✔ ☑ 💯 🎉 🎊 🥳 👏 🙌 🏆 🥇 👍. */
const PRAISE_MARK = String.raw`[\u2705\u2714\u2611\u{1F4AF}\u{1F389}\u{1F38A}\u{1F973}\u{1F44F}\u{1F64C}\u{1F3C6}\u{1F947}\u{1F44D}]`;
const PRAISE_WORDS = [
  "yes", "yep", "yeah", "correct", "right", "exactly", "precisely", "perfect", "excellent", "great", "awesome", "amazing",
  "fantastic", "wonderful", "brilliant", "bravo", "super", "superb", "terrific", "good", "nice", "well done", "very well done",
  "very good", "very nice", "really good", "you got it", "nailed it", "spot[\\s-]on", "bingo",
  // "Great job!", "Super work!", "What a great answer!"; not "Good question!" or "Good try!".
  "(?:what an?\\s+)?(?:(?:very|really|so)\\s+)?(?:good|great|nice|excellent|awesome|amazing|super|fantastic|wonderful|brilliant|terrific|outstanding|perfect)\\s+(?:job|work|answer)",
  // "Correct answer!", but not "Correct answer: 63."
  "(?:correct|right) answer(?=[*_]*\\s*(?:[!.]|$))",
  // Spanish and French, the commonest. Not a bare "bien", which is also "okay".
  "muy bien", "correct[oa]", "excelente", "perfect[oa]", "exact[oa]", "exactamente", "bien hecho", "buen trabajo", "genial",
  "fant[aá]stic[oa]", "eso es", "lo lograste", "lo has logrado", "tr[eè]s bien", "parfait", "exactement", "bien jou[eé]",
  "bon travail", "c['’]est (?:ça|ca|correct|juste|exact|parfait)",
].join("|");
const LEADING_PRAISE = new RegExp(
  String.raw`^(?:${OPEN}*?${PRAISE_MARK}${CLOSE}|${OPEN}*(?:${PRAISE_WORDS})[*_]*\s*(?:[!.,:;—–]+|$)${CLOSE})`,
  "iu",
);
const LEADING_REJECTION = new RegExp(
  String.raw`^${OPEN}*(?:no|nope|oops|almost|close|so close|not quite|not exactly|hmm+|nice try|good try|good effort|good attempt|casi|no exactamente|no del todo|pas tout à fait|pas exactement|presque)[*_]*\s*[!.,:;—–]+${CLOSE}`,
  "iu",
);

// "Great job on the first one": about one of several answers, not a verdict on the one being checked.
const ON_ANOTHER = String.raw`(?!\s+(?:on|with|for)\s+(?:the\s+|your\s+)?(?:first|second|third|fourth|last|other|previous|earlier)\b)`;
// The answer being checked, as a subject: "that", "your answer", "your answer of 72", "this answer".
const ANSWER_SUBJECT = String.raw`(?:that|this|it|both|all of them|(?:your|the) (?:final )?answer(?:\s+of\s+[^\s.!?,;:]+(?:\s+[^\s.!?,;:]+){0,2}?)?|(?:that|this) answer)`;
/** A sentence ends here, give or take closing marks and emoji. */
const ENDS = String.raw`(?=[^\p{L}\p{N}]*$)`;

const PRAISE: ReadonlyArray<[RegExp, { between?: number; other?: RegExp }]> = [
  [new RegExp(String.raw`\b${ANSWER_SUBJECT}(?:'s|’s|\s+is|\s+was|\s+are|\s+were)\s+((?:[\w’']+\s+){0,3}?)(?:correct|right|spot[\s-]on)\b`, "i"), { between: 1, other: OTHER_RIGHT }],
  [/\byou(?:'re|’re|\s+are|\s+were)\s+((?:[\w’']+\s+){0,3}?)(?:correct|right|spot[\s-]on)\b(?!\s+(?:that|to|about)\b)/i, { between: 1, other: OTHER_RIGHT }],
  [/\byou(?:'ve|’ve|\s+have)?\s+got\s+(?:it|that|this|them|the (?:right|correct) answer)\b(?!\s+(?:wrong|mixed|backwards|confused|switched|reversed|upside))/i, {}],
  [new RegExp(String.raw`\b(?:well done|nailed it|spot[\s-]on|bingo|perfect answer|exactly right|(?:good|great|nice|excellent|awesome|amazing|super|fantastic|wonderful|brilliant|terrific|outstanding) (?:job|work))\b${ON_ANOTHER}`, "i"), {}],
  [/\byou\s+(?:answered|solved|did|worked out|calculated|found)\s+(?:it|that|this|the (?:question|problem|answer))?\s*(?:correctly|right|perfectly)\b/i, {}],
  // "That's it!" as a whole sentence; not "That's it for today."
  [new RegExp(String.raw`\bthat(?:'s|’s|\s+is)\s+(?:exactly\s+)?it${ENDS}`, "iu"), {}],
  // "That's great!", "That's perfect, now…"; not "It's great to check your work."
  [new RegExp(String.raw`\b(?:that|this)(?:'s|’s|\s+is|\s+was)\s+(?:(?:really|so|just|absolutely)\s+)?(?:great|perfect|excellent|awesome|amazing|fantastic|brilliant|wonderful|exactly right)(?:${ENDS}|(?=\s*[,;:—–]))`, "iu"), {}],
  // "That's a great answer!"; not "A good answer shows the steps."
  [/\b(?:that|this|it)(?:'s|’s|\s+is|\s+was)\s+(?:a|an|such a|one)\s+(?:(?:really|very|so)\s+)?(?:good|great|excellent|awesome|amazing|fantastic|brilliant|wonderful|perfect)\s+answer\b/i, {}],
  // "You did it!", "You figured it out!"; not "You did it the long way."
  [new RegExp(String.raw`\byou(?:'ve|’ve|\s+have)?\s+(?:did|done|solved|cracked|figured|worked)\s+(?:it|that|this)(?:\s+out)?(?:${ENDS}|(?=\s*!))`, "iu"), {}],
];

// Praise for a part of the answer: fine on a partly right one, not on a wrong one. "You correctly…" or
// a past "you multiplied … correctly"; not the instruction "make sure you multiply correctly".
const PAST = String.raw`(?:(?!(?:need|proceed|exceed|succeed|feed|speed|bleed)\b)[a-z]+ed|found|got|did|made|wrote|said|knew|drew|took|put|chose|gave|saw|read|set|split|kept|began|spotted|understood|thought|told)`;
const PART_PRAISE: ReadonlyArray<[RegExp, { between?: number; other?: RegExp }]> = [
  [new RegExp(String.raw`\byou(?:'ve|’ve|\s+have)?\s+(?:(?:also|already|really|just)\s+)?(?:correctly\b|${PAST}\b(?:\s+[\w’']+){0,4}?\s+correctly\b)`, "i"), {}],
  [/\bcorrectly\s+(?:identified|found|used|calculated|computed|explained|named|said|solved|applied|worked|counted|added|multiplied|divided|subtracted|noticed|remembered|described|stated|listed)\b/i, {}],
  [/\byour\s+(?:method|work|working|reasoning|steps?|calculation|thinking|explanation|idea|approach|formula|setup|first step)\b[^.!?]{0,30}?\b(?:is|was|are|were)\s+((?:[\w’']+\s+){0,2}?)(?:correct|right|spot on)\b/i, { between: 1 }],
  [/\b(?:you're|you’re|you are|you were)\s+(?:right|correct)\s+(?:that|to|about)\b/i, {}],
];

const REJECTION: ReadonlyArray<[RegExp, { between?: number; other?: RegExp }]> = [
  [/\b(?:that|this|it|your (?:final )?answer|(?:that|this) answer|you)(?:'s|’s|'re|’re|\s+is|\s+are|\s+was|\s+were)?\s+(?:not|n't)\s+(?:quite\s+|exactly\s+|entirely\s+|completely\s+)?(?:correct|right)\b/i, { other: OTHER_RIGHT }],
  [/\b(?:that|this|it|your (?:final )?answer|(?:that|this) answer)\s+(?:isn't|isn’t|wasn't|wasn’t)\s+(?:quite\s+|exactly\s+)?(?:correct|right)\b/i, { other: OTHER_RIGHT }],
  [/\b(?:that|this|it|your (?:final )?answer|(?:that|this) answer)(?:'s|’s|\s+is|\s+was)\s+(?:[\w’']+\s+){0,2}?(?:incorrect|wrong|a mistake|not the (?:right|correct) answer)\b(?!\s+to\b)/i, {}],
  [/\b(?:not quite|not exactly|(?:you|you've|you’ve) made a (?:small |little )?mistake|there(?:'s| is) a (?:small |little )?mistake|you got (?:it|that|this) wrong|almost there|so close|you'?re close|you are close|nearly there)\b/i, {}],
  [/\bincorrect\b/i, {}],
];
// Asking for another go at this answer doubts it, in a question too ("Can you try again?"). "Try again
// with 8 x 9" moves on to a new one.
const REDO = /\b(?:try again|try once more|have another (?:go|try|look)|give it another (?:go|try)|let'?s try (?:that|it) again|check your (?:work|answer|math|maths|calculation))\b(?!\s+(?:with|on|using|for)\b)/i;

// ── The student's own answer as a subject: "72 is correct!" ─────────────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normWords = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const NOT_A_VALUE = new Set(["a", "an", "the", "i", "it", "this", "that", "yes", "no", "ok", "okay", "maybe"]);

/**
 * The values in the student's answer a reply could name as a subject: its numbers ("46", and
 * "forty-six" as written) and, when the answer is a word or three ("oxygen", "B"), the answer itself.
 * `notKey` leaves out what the key also holds, so "48 is correct" stays when 48 is the key.
 */
export function answerValues(student: string, key: string): { own: string[]; notKey: string[] } {
  const own: string[] = [];
  const notKey: string[] = [];
  const add = (value: string, inKey: boolean) => {
    if (!value || own.includes(value)) return;
    own.push(value);
    if (!inKey) notKey.push(value);
  };
  const keyNumbers = new Set(numbersIn(key).map((n) => n.value));
  for (const n of numbersIn(student)) {
    const inKey = keyNumbers.has(n.value);
    add(String(n.value), inKey);
    add(student.slice(n.from, n.to), inKey);
  }
  const text = student.trim()
    .replace(/^(?:(?:i think|maybe|it['’]?s|it is|is it|i got|my answer is)\s+)+/i, "")
    .replace(/[\s.!?]+$/, "");
  if (/\p{L}/u.test(text) && text.length <= 30 && text.split(/\s+/).length <= 3 && !NOT_A_VALUE.has(text.toLowerCase())) {
    add(text, normWords(text) === normWords(key));
  }
  return { own, notKey };
}

/** "72 is correct" or "72 is wrong", where 72 is one of `values`. Not "8 x 9 = 72 is correct" or "Step 8 is right". */
function valueSubject(values: string[], says: "praise" | "doubt"): RegExp | null {
  if (!values.length) return null;
  const alts = [...values].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
  const subject = String.raw`(?<![=+\-−×xX*/÷·^]\s*)(?<!\b(?:step|question|number|problem|part|page|line|row|item|level|no\.?)\s*)(?<![\p{L}\p{N}.,])["“'‘]?(?:${alts})["”'’]?(?:\s+(?!(?:and|but|or|so|because|which|that|then|is|was|not)\b)\p{L}{1,12}){0,2}\s+`;
  const claim = says === "praise"
    ? String.raw`(?:is|was)\s+((?:[\w’']+\s+){0,3}?)(?:correct|right|spot[\s-]on)\b`
    : String.raw`(?:(?:is|was)\s+(?:not|n't)\s+(?:quite\s+|exactly\s+)?(?:correct|right)|(?:isn't|isn’t|wasn't|wasn’t)\s+(?:quite\s+|exactly\s+)?(?:correct|right)|(?:is|was)\s+(?:[\w’']+\s+){0,2}?(?:incorrect|wrong))\b`;
  return new RegExp(subject + claim, "iu");
}

// ── Questions ───────────────────────────────────────────────────────────────────────────────────

const isQuestion = (plain: string) => /\?[\s"'”’)*_]*$/.test(plain);
// A clause that asks: it opens with a wh-word (not "What a…") or an auxiliary, perhaps after "so" or "and".
const QUESTION_OPENER = /^[^\p{L}\p{N}]*(?:(?:so|and|but|now|then|okay|ok|well|next|also)\s+)?(?:(?:what|which|who|whom|whose|why|where|when|how)\b(?!\s+an?\b)|(?:can|could|would|will|shall|should|do|does|did|is|are|am|was|were|have|has|had|may|might|must)\b|(?:is|are|was|were|do|does|did|have|has|had|ca|could|would|wo|should|must)n['’]t\b)/iu;
const CLAUSE_SPLIT = /[,;:]\s+|\s*[—–]\s*|\s-\s+/g;

/**
 * Where a question sentence's question begins: after the statement before it ("Great job, can you tell
 * me how you got 72?" → at "can"), at the first later clause that opens like a question, else at the
 * last clause. 0 when the sentence opens as a question; -1 when it is not a question.
 */
function questionAt(text: string): number {
  if (!isQuestion(text)) return -1;
  if (QUESTION_OPENER.test(text)) return 0;
  const cuts = [...text.matchAll(CLAUSE_SPLIT)];
  if (!cuts.length) return 0;
  for (const c of cuts) {
    const at = c.index! + c[0].length;
    if (QUESTION_OPENER.test(text.slice(at))) return at;
  }
  const last = cuts[cuts.length - 1];
  return last.index! + last[0].length;
}

/** What a sentence states: all of it, or for a question the clauses before the question. */
export function statementOf(plain: string): string {
  const at = questionAt(plain);
  return at < 0 ? plain : plain.slice(0, at).trimEnd();
}

// A mastery claim: the student has (just) mastered it, or the tutor has marked (or will mark) it
// mastered. A rule about mastery ("A skill is marked as mastered after the quiz", "To mark a skill as
// mastered, you need…") is not one.
const ADVERBS = "(?:\\s+(?:now|already|really|truly|fully|officially|completely|clearly|definitely|totally))*";
const MASTERY: ReadonlyArray<RegExp> = [
  new RegExp(`\\byou(?:'ve|’ve|\\s+have)${ADVERBS}\\s+mastered\\b`, "i"),
  new RegExp(`\\byou${ADVERBS}\\s+mastered\\s+(?:it|this|that|these|them|the (?:topic|subtopic|skill|lesson|unit|level))\\b`, "i"),
  /\b(?:i|i'll|i’ll|i will|i'm going to|i’m going to|i am going to|i've|i’ve|i have|i can|i'd|i would|let me|let's|let’s|we can|we'll|we’ll|we will)\s+(?:\w+\s+){0,3}?(?:mark|record|log|save|set|update)(?:ed|ing)?\b[^.!?]{0,60}?\bas\s+(?:being\s+)?mastered\b/i,
  // "is now mastered", "has been marked as mastered"; not "is mastered through practice" or "is marked as mastered after the quiz".
  /\b(?:has been|have been)\s+(?:officially\s+)?(?:marked\s+(?:as\s+)?)?mastered\b|\b(?:is|are)\s+now\s+(?:officially\s+)?(?:marked\s+(?:as\s+)?)?mastered\b/i,
  /\byou(?:'ve|’ve|\s+have)?\s+(?:\w+\s+)?(?:achieved|reached|shown|demonstrated|earned|got)\s+(?:\w+\s+){0,2}?mastery\b/i,
];

const any = (list: ReadonlyArray<[RegExp, { between?: number; other?: RegExp }]>, plain: string) => list.some(([re, o]) => claimAt(re, plain, o));

/** Praise for the answer. `part` reads praise for a part of it too; `value` is a "72 is correct" subject. */
export function praises(plain: string, part = false, value: RegExp | null = null): boolean {
  const s = statementOf(plain);
  return !!s && (LEADING_PRAISE.test(s) || any(PRAISE, s) || (!!value && claimAt(value, s, { between: 1, other: OTHER_RIGHT })) || (part && any(PART_PRAISE, s)));
}
export function rejects(plain: string, value: RegExp | null = null): boolean {
  const s = statementOf(plain);
  return claimAt(REDO, plain) || (!!s && (LEADING_REJECTION.test(s) || any(REJECTION, s) || (!!value && claimAt(value, s, { other: OTHER_RIGHT }))));
}
export function claimsMastery(plain: string): boolean {
  const s = statementOf(plain);
  return !!s && MASTERY.some((re) => claimAt(re, s, {}, MASTERY_CONDITION_BEFORE));
}
const statesPartly = (plain: string) => /\b(?:part(?:ly|ially)?\s+(?:right|correct)|part of (?:it|your answer|the answer) is (?:right|correct)|half right)\b/i.test(plain);

/** The text a rule reads: `code` blanked, emphasis marks dropped. */
const plainOf = (s: string) => s.replace(/`[^`\n]*`/g, " ").replace(/[*_~]/g, "");

// ── What the reply says instead ─────────────────────────────────────────────────────────────────

/** The line that takes the place of the first claim removed, when the reply has not said the verdict. */
export const VERDICT_LINE: Record<Verdict, string> = {
  correct: "That's right.",
  incorrect: "That's not right yet.",
  partly: "That's partly right.",
  unsure: "",
};

/** The whole reply, when the filter left nothing of it. */
export const VERDICT_FALLBACK: Record<Verdict, string> = {
  correct: "That's right.",
  incorrect: "That's not right yet. Want to try again?",
  partly: "That's partly right. Can you fix the part that's missing?",
  unsure: "Can you tell me how you got your answer?",
};

const capitalize = (s: string) => s.replace(/^([*_\s"“]*)(\p{Ll})/u, (_, pre: string, c: string) => pre + c.toUpperCase());

// ── The filter ──────────────────────────────────────────────────────────────────────────────────

// Any indent: a fence inside a list item is indented past the usual three spaces.
const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})/;
// The end of a sentence: closing punctuation (and quotes, brackets or emphasis after it) followed by
// whitespace, or a line break.
const SENTENCE_END = /[.!?]+["'”’)\]*_]*(?=\s)|\n/;

export interface ClaimFilterOptions {
  /** The answer check's verdict this turn, or null when there was none. */
  verdict: Verdict | null;
  /** True once a progress.mark_mastered call saved a "mastered" mark this turn. */
  masteryWritten: () => boolean;
  /** Read mastery claims (a turn of a mastery check). Default true. With no verdict and this false,
   *  the filter passes text straight through, unheld. */
  checkMastery?: boolean;
  /** The student's answer (the grader's copy of it when there is one) and the key, so "72 is correct"
   *  is read as praise when 72 is the student's answer and not the key. */
  answer?: { student: string; key: string };
}

/** What a filter and the cards it reads share for one turn. */
interface TurnState {
  stated: boolean;   // the reply has said the true verdict itself
  replaced: boolean; // the code-written verdict line has been put in
  removed: Array<{ kind: "mastery" | "verdict"; text: string }>;
  praiseValue: RegExp | null;
  doubtValue: RegExp | null;
}

/** A choice label that is the student's own short reply ("Yes!", "No", "True"), not the tutor's claim. */
const BARE_REPLY = /^[^\p{L}\p{N}]*(?:yes|yeah|yep|yup|sure|ok|okay|no|nope|right|correct|wrong|true|false|s[ií]|oui|non)[^\p{L}\p{N}]*$/iu;

export class ReplyClaimFilter {
  private buf = "";
  private fence: RegExp | null = null;
  private lineStart = true;
  private readonly state: TurnState;
  /** False for a choice label: a claim there is taken out, with no verdict line put in its place. */
  private lines = true;
  // Spaces after the last sentence shown, held until the next one is known to be shown, so a removed
  // sentence leaves no stray space behind.
  private pending = "";
  private lastRemoved = false;

  constructor(private readonly opts: ClaimFilterOptions, state?: TurnState) {
    if (state) { this.state = state; return; }
    const values = opts.answer ? answerValues(opts.answer.student, opts.answer.key) : null;
    this.state = {
      stated: false,
      replaced: false,
      removed: [],
      // On a right answer the student's values are the key's; praising them is said, not contradicted.
      praiseValue: values ? valueSubject(opts.verdict === "correct" ? values.own : values.notKey, "praise") : null,
      doubtValue: values ? valueSubject(values.own, "doubt") : null,
    };
  }

  /** Claims removed or trimmed so far, for the turn result. */
  get removed(): Array<{ kind: "mastery" | "verdict"; text: string }> {
    return this.state.removed;
  }

  /**
   * An ask_user.question card's arguments as they may be shown: the question read like reply text (the
   * verdict line may lead it), each choice label with its claim taken out and no line added. A label
   * that is the student's own short reply ("Yes!") stays; a label left empty drops its choice. Null when
   * what is left is no card: no question, or fewer than two choices. Arguments not shaped like a card
   * are returned as they are, for the tool's own validation to answer.
   */
  card(args: unknown): unknown {
    if (!this.active || !args || typeof args !== "object") return args;
    const { question, choices } = args as { question?: unknown; choices?: unknown };
    if (typeof question !== "string" || !Array.isArray(choices) || !choices.every((c) => c && typeof c === "object" && typeof (c as { label?: unknown }).label === "string")) return args;
    const shownQuestion = this.whole(question, true);
    const shownChoices = (choices as Array<{ label: string }>)
      .map((c) => (BARE_REPLY.test(c.label) ? c : { ...c, label: this.whole(c.label, false) }))
      .filter((c) => c.label);
    if (!shownQuestion || shownChoices.length < 2) return null;
    return { ...(args as object), question: shownQuestion, choices: shownChoices };
  }

  /** `text` through the rules on its own, sharing this turn's verdict state. */
  private whole(text: string, lines: boolean): string {
    const f = new ReplyClaimFilter(this.opts, this.state);
    f.lines = lines;
    return (f.push(text) + f.flush()).trim();
  }

  /** Text from the model; returns what can be shown now. */
  push(text: string): string {
    if (!this.active) return text;
    this.buf += text;
    return this.drain(false);
  }

  private get active(): boolean {
    return !!this.opts.verdict || this.opts.checkMastery !== false;
  }

  /** The end of one model call: everything held is checked and shown. */
  flush(): string {
    let out = this.drain(true);
    if (!this.lastRemoved) out += this.pending;
    this.pending = "";
    this.fence = null;
    this.lineStart = true;
    return out;
  }

  private drain(final: boolean): string {
    let out = "";
    while (this.buf) {
      if (this.fence) {
        const nl = this.buf.indexOf("\n");
        if (nl < 0) { if (final) { out += this.take(this.buf); this.buf = ""; } break; }
        const line = this.buf.slice(0, nl + 1);
        this.buf = this.buf.slice(nl + 1);
        out += this.take(line);
        if (this.fence.test(line.replace(/\r?\n$/, ""))) this.fence = null;
        continue;
      }
      if (this.lineStart && /^[ \t]*(?:[`~]|$)/.test(this.buf)) {
        // It may open a code fence: wait for the whole line.
        const nl = this.buf.indexOf("\n");
        if (nl < 0 && !final) break;
        const line = nl < 0 ? this.buf : this.buf.slice(0, nl + 1);
        const open = FENCE_OPEN.exec(line);
        if (open) {
          out += this.take(line);
          this.buf = this.buf.slice(line.length);
          this.fence = new RegExp(`^[ \\t]*${open[1][0] === "`" ? "`" : "~"}{${open[1].length},}[ \\t]*$`);
          this.lineStart = true;
          continue;
        }
      }
      const m = SENTENCE_END.exec(this.buf);
      if (!m) {
        if (final) { out += this.sentence(this.buf, ""); this.buf = ""; }
        break;
      }
      const isBreak = m[0] === "\n";
      const end = isBreak ? m.index : m.index + m[0].length;
      const trailing = isBreak ? "\n" : /^[ \t]*\n?/.exec(this.buf.slice(end))![0];
      const text = this.buf.slice(0, end);
      this.buf = this.buf.slice(end + trailing.length);
      out += this.sentence(text, trailing);
      this.lineStart = trailing.endsWith("\n");
    }
    return out;
  }

  /** Text shown as it is, after any spaces held before it. */
  private take(text: string): string {
    const out = this.pending + text;
    this.pending = "";
    this.lastRemoved = false;
    return out;
  }

  /** One sentence and the whitespace after it, as it is to be shown. */
  private sentence(text: string, trailing: string): string {
    const lead = /^\s*/.exec(text)![0];
    const core = text.slice(lead.length);
    if (!core) return this.take(text + trailing);
    const kept = this.rewrite(core);
    if (kept) {
      const out = this.take(lead + kept);
      if (trailing.includes("\n")) return out + trailing;
      this.pending = trailing;
      return out;
    }
    // Removed, with the spaces before it. Its line break stays, so the markdown around it keeps its shape.
    this.lastRemoved = true;
    const breaks = lead.includes("\n") ? lead : "";
    if (!trailing.includes("\n")) return breaks;
    this.pending = "";
    return `${breaks}\n`;
  }

  /** The sentence as it may be shown: unchanged, trimmed, replaced, or "" (removed). */
  private rewrite(core: string): string {
    const plain = plainOf(core);
    const state = this.state;
    if (this.opts.checkMastery !== false && !this.opts.masteryWritten() && claimsMastery(plain)) {
      state.removed.push({ kind: "mastery", text: core });
      return "";
    }
    const v = this.opts.verdict;
    if (!v) return core;
    const praise = (s: string, part = false) => praises(s, part, state.praiseValue);
    const doubt = (s: string) => rejects(s, state.doubtValue);
    const contradicts = (s: string) => (
      v === "correct" ? doubt(s)
        : v === "unsure" ? praise(s, true) || doubt(s)
          : praise(s, v === "incorrect")
    );
    if (!contradicts(plain)) {
      // A choice label is the student's words: it never counts as the reply saying the verdict.
      if (this.lines && (v === "correct" ? praise(plain) : v === "incorrect" ? doubt(plain) : v === "partly" ? doubt(plain) || statesPartly(plain) : false)) state.stated = true;
      return core;
    }
    state.removed.push({ kind: "verdict", text: core });
    const trimmed = this.trim(core, contradicts);
    const line = this.lines && !state.stated && !state.replaced ? VERDICT_LINE[v] : "";
    if (line) state.replaced = true;
    if (line && trimmed) return `${line} ${trimmed}`;
    return line || trimmed;
  }

  /** What is left of a sentence once its claim is cut: the words after a leading "Great!", or after "but". "" when nothing is. */
  private trim(core: string, contradicts: (plain: string) => boolean): string {
    const lead = this.opts.verdict === "correct" ? LEADING_REJECTION : this.opts.verdict === "unsure" ? null : LEADING_PRAISE;
    // What is left must say something, and must not open on the "but" that tied it to the claim.
    const usable = (s: string) => {
      const t = s.replace(/^(?:but|however|although|though|and|so)\b[,\s]*/i, "");
      return /[\p{L}\p{N}]/u.test(t) && !contradicts(plainOf(t)) ? capitalize(t) : "";
    };
    let rest = core;
    for (let i = 0; i < 3; i++) {
      const m = (lead && lead.exec(rest)) || (this.opts.verdict === "unsure" ? LEADING_PRAISE.exec(rest) ?? LEADING_REJECTION.exec(rest) : null);
      if (!m) break;
      rest = rest.slice(m[0].length);
    }
    const afterLead = rest !== core ? usable(rest) : "";
    if (afterLead) return afterLead;
    // What follows "but", or a colon or semicolon: "That is the right answer to another question: 7 x 10 is 70."
    // Or a comma and a move on: "That's perfect, now try 7 x 8." (Not any comma: "Yes, that's right, 6 x 8
    // is 46." would keep the wrong sum as a fact.)
    for (const split of [/(?:,\s*|\s+)(?:but|however|although|though)\b[,\s]*/i, /[:;]\s+/, /,\s+(?=(?:now|next|then|let['’]?s|let us|here['’]?s|here is|try)\b)/i]) {
      const m = split.exec(core);
      const after = m ? usable(core.slice(m.index + m[0].length)) : "";
      if (after) return after;
    }
    // The question after the claim: "That's correct, so what is 8 x 9?" keeps "What is 8 x 9?"
    const asks = questionAt(core);
    return asks > 0 ? usable(core.slice(asks)) : "";
  }
}

/** The whole of `text` through the filter, as one model call. */
export function filterReplyClaims(text: string, opts: ClaimFilterOptions): string {
  const f = new ReplyClaimFilter(opts);
  return f.push(text) + f.flush();
}
