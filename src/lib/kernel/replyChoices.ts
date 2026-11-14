// Choices the tutor wrote as a list instead of calling ask_user.question.
//
// On gemma4:e2b the assess skill's "let the student choose with ask_user.question" was followed in 2 of
// 20 turns (TerraTutor B9 readiness run, 2026-11-13). The other replies wrote the same choices into
// the text as a numbered list ("Which topic would you like to start with?\n\n1. ...\n2. ..."), so the
// learner got no buttons and had to type a choice back. The model's intent is right there in the
// text; code can read it. No model call.
//
// Fails closed: buttons under a list that is not a choice ("Do you want to know how to find the
// area?\n1. Measure the length\n2. ...", practice problems, examples to look at) would invite a click
// that means nothing, so anything in doubt gets no buttons. A list only counts when:
//   - it ends the reply, or (numbered lists only) is followed only by the question that asks for the pick;
//   - it has 2 to 5 items (ask_user.question's own bounds), numbered 1, 2, 3... or lettered A, B, C...
//     (or a, b, c...) in order, one marker style throughout;
//   - every item is short (at most MAX_LABEL_CHARS and MAX_LABEL_WORDS) and is not a sentence (it does
//     not end in . ? : ; or =, and holds no second sentence), and is not maths or a blank to fill in
//     (no $, \ or __);
//   - the question next to it asks for one pick: it says which, choose or pick (PICK_CUE), and none of
//     NOT_A_PICK (order, two of, all, each, why, explain, notice, another...), which ask for something
//     else about the items. "Do you want to..." and "Would you like to..." alone are offers to go on,
//     not picks. A lettered list needs that question before it.
// The reply text is never changed. The buttons are extra.

import type { AskChoice } from "../tools/EduTool";

export interface ReplyChoices {
  /** The question line, as written, without markdown emphasis. */
  question: string;
  /** label and value are the item's text without its marker or markdown emphasis. */
  choices: AskChoice[];
}

const MIN_CHOICES = 2;
const MAX_CHOICES = 5;
const MAX_LABEL_CHARS = 80;
const MAX_LABEL_WORDS = 12;

// "1. x", "1) x", "A. x", "A) x", "(A) x", "(1) x". Optionally bold: "**1.** x", "**A)** x".
const ITEM = /^[ \t]*(?:\*\*)?(?:\(([0-9]|[A-Ea-e])\)|([0-9]|[A-Ea-e])[.)])(?:\*\*)?[ \t]+(\S.*)$/;
const PICK_CUE = /\b(?:which|choose|pick)\b/i;
const NOT_A_PICK = /\b(?:order|two of|three of|both|all|each|why|explain|notice|another)\b/i;

interface Item { marker: string; label: string; raw: string }

function plain(s: string): string {
  return s.replace(/\*\*|__|`/g, "").replace(/(^|\s)[*_](\S)/g, "$1$2").replace(/(\S)[*_](?=\s|$)/g, "$1").trim();
}

function isQuestion(line: string): boolean {
  return plain(line).endsWith("?");
}

function itemOf(line: string): Item | null {
  const m = ITEM.exec(line);
  if (!m) return null;
  return { marker: m[1] ?? m[2], label: plain(m[3]), raw: m[3] };
}

// Markers must be 1, 2, 3... or A, B, C... or a, b, c..., starting at the first.
function inOrder(markers: string[]): boolean {
  const first = markers[0];
  const start = /[0-9]/.test(first) ? "1" : /[A-E]/.test(first) ? "A" : "a";
  return markers.every((m, i) => m === String.fromCharCode(start.charCodeAt(0) + i));
}

function isChoiceLabel({ label, raw }: Item): boolean {
  if (!label || label.length > MAX_LABEL_CHARS) return false;
  if (label.split(/\s+/).length > MAX_LABEL_WORDS) return false;
  if (/[$\\]|__/.test(raw)) return false; // LaTeX, or a blank to fill in
  if (/[.?:;=]$/.test(label)) return false;
  if (/[.?!]\s+\p{Lu}/u.test(label)) return false; // a second sentence
  return true;
}

/**
 * The choices a reply offers as a trailing numbered or lettered list, or null when it offers none by
 * the rules above. Pure; the kernel calls it on every completed turn without an ask_user.question call.
 */
export function choicesInReply(text: string): ReplyChoices | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd());
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return null;

  // An optional closing question after the list ("1. A\n2. B\n\nWhich one?").
  let end = lines.length - 1;
  let after: string | null = null;
  if (!itemOf(lines[end]) && isQuestion(lines[end])) {
    after = lines[end];
    end--;
    while (end >= 0 && !lines[end].trim()) end--;
  }

  // The list itself, read upward. Blank lines between items are allowed (a loose markdown list).
  const items: Item[] = [];
  let i = end;
  for (; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    const item = itemOf(lines[i]);
    if (!item) break;
    items.unshift(item);
  }
  if (items.length < MIN_CHOICES || items.length > MAX_CHOICES) return null;
  if (!inOrder(items.map((it) => it.marker))) return null;
  if (!items.every(isChoiceLabel)) return null;
  if (new Set(items.map((it) => it.label.toLowerCase())).size !== items.length) return null;

  const lettered = !/[0-9]/.test(items[0].marker);
  if (lettered && after) return null;
  const before = i >= 0 ? lines[i] : null;
  const question = after ?? (before && isQuestion(before) ? before : null);
  if (!question) return null;
  if (!PICK_CUE.test(question) || NOT_A_PICK.test(question)) return null;

  return {
    question: plain(question),
    choices: items.map((it) => ({ label: it.label, value: it.label })),
  };
}
