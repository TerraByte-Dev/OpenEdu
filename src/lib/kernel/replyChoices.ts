// Choices the tutor wrote as a list instead of calling ask_user.question.
//
// On gemma4:e2b the assess skill's "let the student choose with ask_user.question" was followed in 2 of
// 20 turns (TerraTutor B9 readiness run, 2026-11-13). The other replies wrote the same choices into
// the text as a numbered list ("Which topic would you like to start with?\n\n1. ...\n2. ..."), so the
// learner got no buttons and had to type a choice back. The model's intent is right there in the
// text; code can read it. No model call.
//
// Conservative on purpose: buttons under an explanatory list ("How do we find the area?\n1. Measure
// the length\n2. ...") would invite a click that means nothing. So a list only counts when:
//   - it ends the reply, or is followed only by the one question that asks for the pick;
//   - it has 2 to 5 items (ask_user.question's own bounds), numbered 1, 2, 3... or lettered A, B, C...
//     (or a, b, c...) in order, one marker style throughout;
//   - every item is short (at most MAX_LABEL_CHARS and MAX_LABEL_WORDS) and is not a sentence: it does
//     not end in . ? : or ; and holds no second sentence;
//   - the line right before it (or right after it) is a question. For a numbered list the question must
//     also ask for a pick (CHOICE_CUE: which, choose, would you like, ...). A lettered list after a
//     question is a multiple-choice question, and needs no cue.
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
const CHOICE_CUE = /\b(?:which|choose|pick|select|prefer|rather|would you like|do you want|want to|shall we|should we)\b/i;

function plain(s: string): string {
  return s.replace(/\*\*|__|`/g, "").replace(/(^|\s)[*_](\S)/g, "$1$2").replace(/(\S)[*_](?=\s|$)/g, "$1").trim();
}

function isQuestion(line: string): boolean {
  return plain(line).endsWith("?");
}

function itemOf(line: string): { marker: string; label: string } | null {
  const m = ITEM.exec(line);
  if (!m) return null;
  return { marker: m[1] ?? m[2], label: plain(m[3]) };
}

// Markers must be 1, 2, 3... or A, B, C... or a, b, c..., starting at the first.
function inOrder(markers: string[]): boolean {
  const first = markers[0];
  const start = /[0-9]/.test(first) ? "1" : /[A-E]/.test(first) ? "A" : "a";
  return markers.every((m, i) => m === String.fromCharCode(start.charCodeAt(0) + i));
}

function isChoiceLabel(label: string): boolean {
  if (!label || label.length > MAX_LABEL_CHARS) return false;
  if (label.split(/\s+/).length > MAX_LABEL_WORDS) return false;
  if (/[.?:;]$/.test(label)) return false;
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
  const items: Array<{ marker: string; label: string }> = [];
  let i = end;
  for (; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    const item = itemOf(lines[i]);
    if (!item) break;
    items.unshift(item);
  }
  if (items.length < MIN_CHOICES || items.length > MAX_CHOICES) return null;
  if (!inOrder(items.map((it) => it.marker))) return null;
  if (!items.every((it) => isChoiceLabel(it.label))) return null;
  if (new Set(items.map((it) => it.label.toLowerCase())).size !== items.length) return null;

  const before = i >= 0 ? lines[i] : null;
  const question = after ?? (before && isQuestion(before) ? before : null);
  if (!question) return null;
  const lettered = !/[0-9]/.test(items[0].marker);
  if (!lettered && !CHOICE_CUE.test(question)) return null;

  return {
    question: plain(question),
    choices: items.map((it) => ({ label: it.label, value: it.label })),
  };
}
