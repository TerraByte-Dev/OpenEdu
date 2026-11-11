// The dictionary note on a "what does X mean" turn (issue #251; docs/BENCHMARKS.md section 3, lever 16).
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
//   - "what is a X": a question about a thing, not a word. That is a separate, later arm (#251).

import type { DictionaryEntry, Pos } from "../dictionary";
import { POS_NAMES } from "../dictionary";
import { estTokens } from "./budget";

export interface AskedWord {
  /** The word or phrase as the student typed it, quotes removed. */
  word: string;
  /** The sentence the question is about, when the message gives one. */
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
const PATTERNS = HEADS.map((h) => new RegExp(String.raw`(?:^|(?<=[.!?;:\n]))\s*${FILLER}${h}${TAIL}`, "i"));

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
    const before = t.slice(0, m.index).trim();
    const context = after || before;
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
The student asked what "{word}" means. Use the dictionary entry above as the source for its meaning. Explain it in words the student can understand, with one everyday example. If several meanings are listed, use the one that fits the student's sentence; if there is no sentence, briefly give the common ones. Do not add meanings that are not listed. Do not mention this note.
</tutor_note>`;

interface Shown { form: string; pos: Pos; definition: string; example: string }

/** The senses shown, in lookupWord's order: per headword its senses in stored order, skipping a sense
 *  whose part of speech already has DICTIONARY_SENSES_PER_POS, up to the per-headword and total caps. */
export function selectSenses(entries: readonly DictionaryEntry[]): Array<{ entry: DictionaryEntry; senses: Shown[] }> {
  const out: Array<{ entry: DictionaryEntry; senses: Shown[] }> = [];
  let total = 0;
  for (const entry of entries) {
    if (total >= DICTIONARY_MAX_SENSES) break;
    const perPos = new Map<Pos, number>();
    const senses: Shown[] = [];
    for (const s of entry.senses) {
      if (senses.length >= DICTIONARY_SENSES_PER_HEADWORD || total >= DICTIONARY_MAX_SENSES) break;
      const n = perPos.get(s.pos) ?? 0;
      if (n >= DICTIONARY_SENSES_PER_POS) continue;
      perPos.set(s.pos, n + 1);
      senses.push({ form: s.form, pos: s.pos, definition: s.definition, example: s.example });
      total++;
    }
    if (senses.length) out.push({ entry, senses });
  }
  return out;
}

function renderEntry(word: string, picked: Array<{ entry: DictionaryEntry; senses: Shown[] }>): string {
  const lines: string[] = [];
  let n = 0;
  for (const { entry, senses } of picked) {
    if (entry.via === "form") lines.push(`"${word}" is a form of "${entry.headword}".`);
    for (const s of senses) {
      n++;
      lines.push(`${n}. ${s.form} (${POS_NAMES[s.pos]}): ${s.definition}${s.example ? `. Example: "${s.example}"` : ""}`);
    }
  }
  return `<dictionary_entry source="Open English WordNet">\n${lines.join("\n")}\n</dictionary_entry>`;
}

/**
 * The text appended after the student's message on a define turn: the entry block, then the note. Null
 * when there is nothing to show (no entries), so the turn is sent unchanged.
 */
export function dictionaryNote(word: string, entries: readonly DictionaryEntry[]): string | null {
  let picked = selectSenses(entries);
  let count = picked.reduce((k, p) => k + p.senses.length, 0);
  if (count === 0) return null;
  let entry = renderEntry(word, picked);
  while (estTokens(entry) > DICTIONARY_MAX_ENTRY_TOKENS && count > 1) {
    const last = picked[picked.length - 1];
    picked = last.senses.length > 1
      ? [...picked.slice(0, -1), { ...last, senses: last.senses.slice(0, -1) }]
      : picked.slice(0, -1);
    count--;
    entry = renderEntry(word, picked);
  }
  return `${entry}\n${DICTIONARY_NOTE.replace("{word}", word)}`;
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
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), deadlineMs); });
  try {
    const entries = await Promise.race([lookup(word), late]);
    return entries ? dictionaryNote(word, entries) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
