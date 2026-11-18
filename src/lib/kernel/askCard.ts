// The ask_user.question card, checked and recorded by code. Pure; the kernel and the chat call it.
//
// Click test 2026-11-14 (gemma4:e4b, fractions L1, "Check if I've got this."): the tutor asked "Think
// about the fraction 1/5. Which number, 1 or 5, is the unit fraction part?" with the buttons "What is
// the denominator?" and "What is the numerator?". Neither answers the question. repairAskCard fixes the
// two shapes of that mistake and fails closed: a card it is not sure about is left exactly as the model
// wrote it (the child can always type their own answer under it).
//
//   1. The question names its own choices ("1 or 5", "1/2, 1/3, or 1/4", "bigger or smaller") and no
//      button mentions any of them: the named choices become the buttons. A named choice is a number,
//      a fraction or one word; a list of them is joined by "or" (and commas), all of one kind, and a
//      word like "not", "do" or "yes" ends it ("3 or not?" names nothing).
//   2. Every button is a "What is X?" / "Is it X?" question and the card is not a topic picker ("Which
//      would you like to learn next?" may offer questions as topics): each button becomes "X".
//
// repeatsQuestion and answeredCard keep the thread readable: the card's question is said once, and the
// question and the child's answer stay in the saved reply after the card is gone.

import type { AskChoice } from "../tools/EduTool";
import { withoutTrailingEmoji } from "./suggestions";

export interface AskCard { question: string; choices: AskChoice[] }

const NUMBER = /^-?\d+(?:[.,/]\d+)?$/;
const WORD = /^\p{L}[\p{L}'’-]*$/u;
// Words that end a named list: "3 or not", "stop, or do we...", "yes or no" questions.
const NOT_A_CHOICE = new Set([
  "not", "no", "yes", "so", "else", "both", "neither", "either", "something", "anything", "nothing",
  "other", "another", "do", "does", "did", "is", "are", "was", "were", "can", "could", "should", "would",
  "will", "it", "you", "we", "they", "i", "he", "she", "this", "that", "the", "a", "an",
]);
// A card that asks what the student wants to do or learn, where a question can be a fine topic.
const TOPIC_PICKER = /\b(?:would you like|do you want|want to|like to|prefer|rather|learn|explore|practi[cs]e|focus|start|next|talk about|work on|try|check)\b/i;
const WHAT_IS = /^(?:what is|what's|what are|is it|is the answer)\s+(.+?)\s*\?$/i;

type Kind = "number" | "word";
const kindOf = (s: string): Kind | null => (NUMBER.test(s) ? "number" : WORD.test(s) && !NOT_A_CHOICE.has(s.toLowerCase()) ? "word" : null);

function lastSentence(text: string): string {
  const parts = text.trim().split(/(?<=[.!?])\s+/);
  return parts[parts.length - 1] ?? "";
}

/** The choices a question names ("Which number, 1 or 5, is..."), or null when it names none. */
function namedChoices(question: string): string[] | null {
  const sentence = lastSentence(question);
  if (!sentence.endsWith("?")) return null;
  const or = /,?\s+or\s+/gi;
  for (let m = or.exec(sentence); m; m = or.exec(sentence)) {
    const right = /^[^\s,?:;!]+/.exec(sentence.slice(m.index + m[0].length))?.[0] ?? "";
    const kind = kindOf(right);
    if (!kind) continue;
    const items = [right];
    let rest = sentence.slice(0, m.index);
    let sep: RegExpExecArray | null = /(?:^|[\s(:])([^\s,(:]+)$/.exec(rest);
    // The first item is any word or number before "or"; further ones only after a comma.
    while (sep) {
      const item = sep[1];
      if (kindOf(item) !== kind) break;
      items.unshift(item);
      rest = rest.slice(0, rest.length - item.length);
      if (!/,\s*$/.test(rest)) break;
      rest = rest.replace(/,\s*$/, "");
      sep = /(?:^|[\s(:])([^\s,(:]+)$/.exec(rest);
    }
    const distinct = new Set(items.map((s) => s.toLowerCase()));
    if (items.length >= 2 && items.length <= 5 && distinct.size === items.length) return items;
  }
  return null;
}

const tokens = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}./'’-]+/u).map((t) => t.replace(/[.]+$/, "")).filter(Boolean));

function isCard(args: unknown): args is AskCard {
  if (!args || typeof args !== "object") return false;
  const { question, choices } = args as { question?: unknown; choices?: unknown };
  return typeof question === "string" && Array.isArray(choices) &&
    choices.every((c) => c && typeof c === "object" && typeof (c as AskChoice).label === "string" && typeof (c as AskChoice).value === "string");
}

/**
 * The card with buttons that answer its question, or `args` itself (the same object) when the card is
 * fine, not sure, or not a card. Rules at the top of this file.
 */
export function repairAskCard<T>(args: T): T | AskCard {
  if (!isCard(args)) return args;
  const { question, choices } = args;

  const named = namedChoices(question);
  if (named) {
    const offered = choices.some((c) => { const t = tokens(c.label); return named.some((n) => t.has(n.toLowerCase())); });
    if (!offered) return { ...args, question, choices: named.map((n) => ({ label: n, value: n })) };
    return args;
  }

  if (question.trim().endsWith("?") && !TOPIC_PICKER.test(question) && choices.length >= 2) {
    const answers = choices.map((c) => WHAT_IS.exec(c.label.trim())?.[1]);
    if (answers.every((a): a is string => !!a)) {
      return { ...args, choices: choices.map((c, i) => ({ ...c, label: answers[i].charAt(0).toUpperCase() + answers[i].slice(1) })) };
    }
  }
  return args;
}

// A reply's text compared as the child reads it: no markdown emphasis, no trailing emoji, spaces collapsed.
function plain(text: string): string {
  return withoutTrailingEmoji(text.replace(/\*\*|__|`/g, "").replace(/(^|\s)[*_](\S)/g, "$1$2").replace(/(\S)[*_](?=\s|$)/g, "$1"))
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim().toLowerCase();
}

// A trailing numbered, lettered or bulleted list (the reply-choices shape, replyChoices.ts).
const LIST_ITEM = /^\s*(?:[-*+•]|(?:\*\*)?\(?[0-9A-Ea-e][.)](?:\*\*)?)\s+\S/;

/**
 * True when the reply already ends on the card's question (after any trailing list of choices), so the
 * card need not say it again. The question must start a sentence or a line in the reply.
 */
export function repeatsQuestion(reply: string, question: string): boolean {
  const lines = reply.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && (!lines[lines.length - 1].trim() || LIST_ITEM.test(lines[lines.length - 1]))) lines.pop();
  const text = plain(lines.join("\n"));
  const q = plain(question).replace(/\s+/g, " ");
  if (!q || !text.endsWith(q)) return false;
  const before = text.slice(0, text.length - q.length);
  return before === "" || before.endsWith("\n") || /[.!?:]\s$/.test(before);
}

/** What the child answered: the label of the button picked, or the text they typed. */
export function pickedAnswer(choices: AskChoice[], value: string): { text: string; typed: boolean } {
  const picked = choices.find((c) => c.value === value);
  return picked ? { text: picked.label, typed: false } : { text: value.trim(), typed: true };
}

/**
 * The text the turn shows once the child has answered a card: the question (unless the text before it
 * already ended on it) and the answer, set apart from what came before. Saved with the reply, so the
 * question and the answer stay in the thread.
 */
export function answeredCard(before: string, question: string, answer: { text: string; typed: boolean }): string {
  const sep = !before.trim() ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const said = answer.text.replace(/\s+/g, " ").trim().replace(/[*_`]/g, "\\$&");
  const line = `*${answer.typed ? "You answered" : "You picked"}: ${said}*`;
  return repeatsQuestion(before, question) ? `${sep}${line}\n\n` : `${sep}${question}\n\n${line}\n\n`;
}

/**
 * The text the turn shows for a card the child did not answer, because what they typed there is sent as
 * their own message instead (TutorEngine, `cardMessage`): the question, unless the text before it already
 * ended on it, so the thread still says what was asked. Their words are never echoed into the reply.
 */
export function askedCard(before: string, question: string): string {
  if (repeatsQuestion(before, question)) return "";
  const sep = !before.trim() ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  return `${sep}${question}`;
}
