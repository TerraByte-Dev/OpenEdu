// The dictionary card (#251 PR 3): on a turn where the tutor was given a dictionary entry (the note in
// kernel/defineWord.ts), the chat shows that same entry under the reply, so a learner or grown-up can
// see the source the tutor was told to use. Pure module (no DOM, no Tauri), tested in
// dictionary-card.test.ts; ChatTab draws it.
//
// What it shows is the kernel's DictionaryShown and nothing else: the senses that went into the note,
// after the child-safety filter, the caps and the token budget, numbered as the note numbers them. It
// never looks the word up again, so it cannot show a sense the tutor was not given. It adds nothing to
// the request and is not saved; ChatTab keeps it beside the reply for the app session only.

import type { DictionaryShown } from "./kernel/defineWord";
import { POS_NAMES } from "./dictionary";
import { isEarlyReader, type Grade } from "./grade";

export interface CardSense {
  /** The sense's number in the note the tutor was given (1, 2, ... across every headword). */
  n: number;
  /** The headword's own spelling, only when it differs from the headword ("May" under "may"). */
  form: string | null;
  definition: string;
  /** "" when the sense has none, or the filter dropped it. */
  example: string;
}

export interface CardGroup {
  /** "noun", "verb", "adjective" or "adverb". */
  partOfSpeech: string;
  senses: CardSense[];
}

export interface CardHeadword {
  headword: string;
  /** Set when the student's word is a form of this headword: `"went" is a form of "go".` */
  formOf: string | null;
  /** Consecutive senses with the same part of speech, in the note's order. */
  groups: CardGroup[];
}

export interface DictionaryCard {
  word: string;
  headwords: CardHeadword[];
}

/** The small line under the card. */
export const CARD_SOURCE = "From Open English WordNet";

/** What the card shows for a turn's entry. Every sense in `shown`, in order, and nothing else. */
export function dictionaryCard(shown: DictionaryShown): DictionaryCard {
  let n = 0;
  const headwords = shown.entries.map(({ headword, via, senses }): CardHeadword => {
    const groups: CardGroup[] = [];
    for (const s of senses) {
      n++;
      const partOfSpeech = POS_NAMES[s.pos];
      const sense: CardSense = { n, form: s.form === headword ? null : s.form, definition: s.definition, example: s.example };
      const last = groups[groups.length - 1];
      if (last && last.partOfSpeech === partOfSpeech) last.senses.push(sense);
      else groups.push({ partOfSpeech, senses: [sense] });
    }
    return { headword, formOf: via === "form" ? `"${shown.word}" is a form of "${headword}".` : null, groups };
  });
  return { word: shown.word, headwords };
}

/**
 * Whether the card starts open. Grade 3 and up, and a learner with no grade set, see the source entry.
 * K-2 learners rely on the tutor's simpler rephrase (read aloud to them), so for them it starts closed
 * behind "Show the dictionary entry".
 */
export function cardStartsOpen(grade: Grade | null): boolean {
  return !isEarlyReader(grade);
}

/** The card's toggle. */
export function cardToggleLabel(open: boolean): string {
  return open ? "Hide the dictionary entry" : "Show the dictionary entry";
}

/** What the card's speaker button reads: plain sentences, with "for example" before an example. */
export function cardSpeech(card: DictionaryCard): string {
  const parts: string[] = [];
  for (const h of card.headwords) {
    parts.push(`${h.headword}.`);
    if (h.formOf) parts.push(h.formOf);
    for (const g of h.groups) {
      parts.push(`${g.partOfSpeech[0].toUpperCase()}${g.partOfSpeech.slice(1)}.`);
      for (const s of g.senses) {
        parts.push(`${s.n}. ${sentence(s.definition)}`);
        if (s.example) parts.push(`For example: ${sentence(s.example)}`);
      }
    }
  }
  return parts.join(" ");
}

const sentence = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);
