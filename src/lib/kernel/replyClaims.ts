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
// takes its place ("That's not right yet."). Questions are never claims, a mastery claim inside "if"
// or "once" is not one, and nothing inside a code fence or `code` is read. Text with no claim comes
// out byte for byte.
//
// Known limits: a claim worded outside these patterns gets through (the note the reply was given is the
// first line of defence, this is the second); a mastery claim made in the same model call as the
// mark_mastered call that saves it is removed, because the call has not run when the sentence ends.

import type { Verdict } from "./answerCheck";

// ── What counts as a claim ──────────────────────────────────────────────────────────────────────

/** Words between a subject and "correct"/"right" that turn the claim around. */
const TURNS_IT = /\b(?:not|never|almost|nearly|partly|partially|half)\b|n't\b/i;
/** Before the claim in its sentence: it is a condition or a doubt, not a claim. */
const CONDITION_BEFORE = /\bnot\b|n't\b|\bnever\b|\bif\b|\bwhether\b|\bunless\b/i;
/** The same for mastery, which is also talked about as a goal: "once you have mastered this". */
const MASTERY_CONDITION_BEFORE = /\bnot\b|n't\b|\bnever\b|\bif\b|\bwhether\b|\bunless\b|\bonce\b|\bwhen(?:ever)?\b|\buntil\b|\bafter\b|\bbefore\b|\bcheck\b|\bsee\b|\bgoal\b|\bhelp you\b|\bon your way\b/i;
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

const LEADING_PRAISE = /^[*_\s]*(?:yes|yep|yeah|correct|right|exactly|perfect|excellent|great|awesome|fantastic|wonderful|brilliant|bravo|super|good|nice|well done|great job|good job|nice job|nice work|great work|good work|you got it|nailed it|spot on|bingo)[*_]*\s*[!.,:;—–]+[*_]*\s*/i;
const LEADING_REJECTION = /^[*_\s]*(?:no|nope|oops|almost|close|so close|not quite|not exactly|hmm+|nice try|good try|good effort|good attempt)[*_]*\s*[!.,:;—–]+[*_]*\s*/i;

const PRAISE: ReadonlyArray<[RegExp, { between?: number; other?: RegExp }]> = [
  [/\b(?:that|this|it|your (?:final )?answer|the answer|both|all of them)(?:'s|’s|\s+is|\s+was|\s+are|\s+were)\s+((?:[\w’']+\s+){0,3}?)(?:correct|right|spot on)\b/i, { between: 1, other: OTHER_RIGHT }],
  [/\byou(?:'re|’re|\s+are|\s+were)\s+((?:[\w’']+\s+){0,3}?)(?:correct|right|spot on)\b(?!\s+(?:that|to|about)\b)/i, { between: 1, other: OTHER_RIGHT }],
  [/\byou(?:'ve|’ve|\s+have)?\s+got\s+(?:it|that|this|them|the (?:right|correct) answer)\b(?!\s+(?:wrong|mixed|backwards|confused|switched|reversed|upside))/i, {}],
  [/\b(?:well done|nailed it|spot on|bingo|good job|great job|nice job|nice work|great work|good work|excellent work|perfect answer|exactly right|that'?s it)\b/i, {}],
  [/\byou\s+(?:answered|solved|did|worked out|calculated|found)\s+(?:it|that|this|the (?:question|problem|answer))?\s*(?:correctly|right|perfectly)\b/i, {}],
];

// Praise for a part of the answer: fine on a partly right one, not on a wrong one.
const PART_PRAISE: ReadonlyArray<[RegExp, { between?: number; other?: RegExp }]> = [
  [/\byou(?:'ve|’ve|\s+have)?\s+(?:[\w’']+\s+){0,2}?correctly\b/i, {}],
  [/\bcorrectly\s+(?:identified|found|used|calculated|computed|explained|named|said|solved|applied|worked|counted|added|multiplied|divided|subtracted|noticed|remembered|described|stated|listed)\b/i, {}],
  [/\byour\s+(?:method|work|working|reasoning|steps?|calculation|thinking|explanation|idea|approach|formula|setup|first step)\b[^.!?]{0,30}?\b(?:is|was|are|were)\s+((?:[\w’']+\s+){0,2}?)(?:correct|right|spot on)\b/i, { between: 1 }],
  [/\b(?:you're|you’re|you are|you were)\s+(?:right|correct)\s+(?:that|to|about)\b/i, {}],
];

const REJECTION: ReadonlyArray<[RegExp, { between?: number; other?: RegExp }]> = [
  [/\b(?:that|this|it|your (?:final )?answer|you)(?:'s|’s|'re|’re|\s+is|\s+are|\s+was|\s+were)?\s+(?:not|n't)\s+(?:quite\s+|exactly\s+|entirely\s+|completely\s+)?(?:correct|right)\b/i, { other: OTHER_RIGHT }],
  [/\b(?:that|this|it|your (?:final )?answer)\s+(?:isn't|isn’t|wasn't|wasn’t)\s+(?:quite\s+|exactly\s+)?(?:correct|right)\b/i, { other: OTHER_RIGHT }],
  [/\b(?:that|this|it|your (?:final )?answer)(?:'s|’s|\s+is|\s+was)\s+(?:[\w’']+\s+){0,2}?(?:incorrect|wrong|a mistake|not the (?:right|correct) answer)\b(?!\s+to\b)/i, {}],
  [/\b(?:not quite|not exactly|try again(?!\s+(?:with|on|using|for)\b)|try once more|have another (?:go|try|look)|give it another (?:go|try)|let'?s try (?:that|it) again|(?:you|you've|you’ve) made a (?:small |little )?mistake|there(?:'s| is) a (?:small |little )?mistake|check your (?:work|answer|math|maths|calculation)|you got (?:it|that|this) wrong|almost there|so close|you'?re close|you are close|nearly there)\b/i, {}],
  [/\bincorrect\b/i, {}],
];

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

const isQuestion = (plain: string) => /\?[\s"'”’)*_]*$/.test(plain);
const any = (list: ReadonlyArray<[RegExp, { between?: number; other?: RegExp }]>, plain: string) => list.some(([re, o]) => claimAt(re, plain, o));

export function praises(plain: string, part = false): boolean {
  return !isQuestion(plain) && (LEADING_PRAISE.test(plain) || any(PRAISE, plain) || (part && any(PART_PRAISE, plain)));
}
export function rejects(plain: string): boolean {
  return !isQuestion(plain) && (LEADING_REJECTION.test(plain) || any(REJECTION, plain));
}
export function claimsMastery(plain: string): boolean {
  return !isQuestion(plain) && MASTERY.some((re) => claimAt(re, plain, {}, MASTERY_CONDITION_BEFORE));
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
}

export class ReplyClaimFilter {
  private buf = "";
  private fence: RegExp | null = null;
  private lineStart = true;
  private stated = false;   // the reply has said the true verdict itself
  private replaced = false; // the code-written verdict line has been put in
  // Spaces after the last sentence shown, held until the next one is known to be shown, so a removed
  // sentence leaves no stray space behind.
  private pending = "";
  private lastRemoved = false;
  /** Claims removed or trimmed so far, for the turn result. */
  readonly removed: Array<{ kind: "mastery" | "verdict"; text: string }> = [];

  constructor(private readonly opts: ClaimFilterOptions) {}

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
    if (this.opts.checkMastery !== false && !this.opts.masteryWritten() && claimsMastery(plain)) {
      this.removed.push({ kind: "mastery", text: core });
      return "";
    }
    const v = this.opts.verdict;
    if (!v) return core;
    const contradicts = (s: string) => (
      v === "correct" ? rejects(s)
        : v === "unsure" ? praises(s, true) || rejects(s)
          : praises(s, v === "incorrect")
    );
    if (!contradicts(plain)) {
      if (v === "correct" ? praises(plain) : v === "incorrect" ? rejects(plain) : v === "partly" ? rejects(plain) || statesPartly(plain) : false) this.stated = true;
      return core;
    }
    this.removed.push({ kind: "verdict", text: core });
    const trimmed = this.trim(core, contradicts);
    const line = !this.stated && !this.replaced ? VERDICT_LINE[v] : "";
    if (line) this.replaced = true;
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
    for (const split of [/(?:,\s*|\s+)(?:but|however|although|though)\b[,\s]*/i, /[:;]\s+/]) {
      const m = split.exec(core);
      const after = m ? usable(core.slice(m.index + m[0].length)) : "";
      if (after) return after;
    }
    return "";
  }
}

/** The whole of `text` through the filter, as one model call. */
export function filterReplyClaims(text: string, opts: ClaimFilterOptions): string {
  const f = new ReplyClaimFilter(opts);
  return f.push(text) + f.flush();
}
